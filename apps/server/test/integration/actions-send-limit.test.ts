import { randomBytes } from "node:crypto";

import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import {
  applySend,
  claimActions,
  createCommitterJob,
  createFolderResolver,
  noDelegationHooks,
  type ApplyDeps,
  type ClaimedAction,
  type SendLimitHit,
} from "../../src/modules/actions";
import { lockMailboxSends } from "../../src/modules/actions/repo";
import { composeMessage } from "../../src/modules/mail";
import { createFakeMailProvider, type FakeMailProvider } from "../../src/modules/mail/fake";
import { createFakeMailSender, type FakeMailSender } from "../../src/modules/mail/fake/sender";
import { insertCredentials } from "../../src/modules/mail/repo";
import { contentHash } from "../../src/modules/mail/sync-rules";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB, Db, TenantContext } from "../../src/platform/db";
import { setLogLevel } from "../../src/platform/log";
import { waitFor } from "../wait-for";

import { createOrgWithMailbox, insertDraftAndSend, insertTriagedWithActions, pauseOtherMailboxes } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

afterEach(() => {
  setLogLevel("info");
});

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NOW = new Date("2026-11-20T10:00:00Z");
const CREATED = new Date(NOW.getTime() - HOUR);
const at = (minutes: number): Date => new Date(NOW.getTime() + minutes * MINUTE);
const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);

interface Setup {
  ctx: TenantContext;
  userId: string;
  mailboxId: string;
  address: string;
  fake: FakeMailProvider;
  sender: FakeMailSender;
  folderMap: Record<string, string>;
}

async function setup(trx: Transaction<DB>): Promise<Setup> {
  const box = await createOrgWithMailbox(trx);
  const mailbox = await trx
    .selectFrom("mailboxes")
    .select("address")
    .where("id", "=", box.mailboxId)
    .executeTakeFirstOrThrow();
  const folderMap = { drafts: "Drafts", sent: "Sent" };
  await trx
    .updateTable("mailboxes")
    .set({ folder_map: JSON.stringify(folderMap) })
    .where("id", "=", box.mailboxId)
    .execute();
  const fake = createFakeMailProvider();
  await fake.ensureFolder("Drafts");
  await fake.ensureFolder("Sent");
  return {
    ctx: { orgId: box.orgId },
    userId: box.userId,
    mailboxId: box.mailboxId,
    address: mailbox.address,
    fake,
    sender: createFakeMailSender(),
    folderMap,
  };
}

async function addCredentials(trx: Transaction<DB>, s: Setup): Promise<void> {
  const secret = secrets.encrypt("pw", `mailbox:${s.mailboxId}`);
  await insertCredentials(trx, s.ctx, {
    mailboxId: s.mailboxId,
    encryptedSecret: secret.ciphertext,
    secretKind: "password",
    keyVersion: secret.keyVersion,
  });
}

function depsOf(
  s: Setup,
  conn: Db | Transaction<DB>,
  hits: SendLimitHit[],
  over: Partial<ApplyDeps> = {},
  sender: FakeMailSender = s.sender
): ApplyDeps {
  const folders = createFolderResolver(
    { db: conn, now: () => NOW, provider: s.fake, mailboxId: s.mailboxId, folderMap: s.folderMap },
    s.ctx
  );
  return {
    db: conn,
    now: () => NOW,
    mailboxId: s.mailboxId,
    folders,
    mailbox: { address: s.address, capabilities: { uidplus: true }, folderMap: s.folderMap },
    owner: { displayName: "Owner" },
    organization: { styleText: null, timezone: "Europe/Warsaw" },
    compose: composeMessage,
    sender,
    hooks: noDelegationHooks,
    appendFolders: new Set(),
    onSendLimited: (_ctx, hit) => {
      hits.push(hit);
    },
    ...over,
  };
}

const claimAll = (conn: Db | Transaction<DB>, s: Setup, time: Date = NOW) =>
  claimActions(conn, s.ctx, s.mailboxId, {
    now: time,
    limit: 20,
    staleBefore: new Date(time.getTime() - 10 * MINUTE),
    filter: { mailbox: { kind: "all" }, send: { kind: "all" } },
  });

function pick(claimed: ClaimedAction[], id: string): ClaimedAction {
  const action = claimed.find((row) => row.id === id);
  if (action === undefined) throw new Error("the action was not claimed");
  return action;
}

// Sends of the mailbox that count: `applied` with `send_started_at` set by one UPDATE.
async function insertCountedSends(
  trx: Transaction<DB>,
  s: Setup,
  times: readonly Date[],
  to?: string,
  over: { status?: string; statusReason?: string } = {}
): Promise<string[]> {
  const ids: string[] = [];
  for (const time of times) {
    const sent = await insertDraftAndSend(trx, s.ctx, s.mailboxId, {
      createdAt: CREATED,
      sendStatus: over.status ?? "applied",
      approved: { userId: s.userId, at: at(-120) },
      ...(to === undefined ? {} : { to }),
    });
    await trx
      .updateTable("actions")
      .set({ send_started_at: time, ...(over.statusReason === undefined ? {} : { status_reason: over.statusReason }) })
      .where("id", "=", sent.sendId)
      .execute();
    ids.push(sent.sendId);
  }
  return ids;
}

const minutesAgo = (from: number, to: number): Date[] =>
  Array.from({ length: to - from + 1 }, (_, index) => at(-(from + index)));

// An approved send with an applied draft, ready to be claimed.
function approvedSend(trx: Transaction<DB>, s: Setup, to = "n@x.test") {
  return insertDraftAndSend(trx, s.ctx, s.mailboxId, {
    createdAt: CREATED,
    draftStatus: "applied",
    draftProviderResult: { uid: 1, folder: "Drafts" },
    sendStatus: "approved",
    approved: { userId: s.userId, at: at(-1) },
    to,
  });
}

async function row(conn: Db | Transaction<DB>, id: string) {
  return conn.selectFrom("actions").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

async function auditOf(conn: Db | Transaction<DB>, actionId: string, event: string) {
  return conn
    .selectFrom("audit_log")
    .selectAll()
    .where("action_id", "=", actionId)
    .where("event", "=", event)
    .execute();
}

describe("the send limit in the committer", () => {
  test("(1) a send over the hour limit is held: no SMTP, approved, one audit row, one callback", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await insertCountedSends(trx, s, minutesAgo(31, 50));
      const p = await approvedSend(trx, s);
      const hits: SendLimitHit[] = [];
      const claimed = pick(await claimAll(trx, s), p.sendId);
      const before = await row(trx, p.sendId);

      expect(await applySend(depsOf(s, trx, hits), s.ctx, claimed, s.fake)).toEqual({ kind: "retry", soft: false });

      expect(s.sender.calls).toEqual([]);
      const held = await row(trx, p.sendId);
      expect(held.status).toBe("approved");
      expect(held.locked_at).toBeNull();
      expect(held.next_attempt_at?.toISOString()).toBe("2026-11-20T10:10:00.000Z");
      expect(held.last_error).toBe("send_limit:mailbox_hour");
      expect(held.attempts).toBe(before.attempts);
      expect(held.approved_at?.getTime()).toBe(before.approved_at?.getTime() as number);
      expect(held.send_started_at).toBeNull();
      const limited = await auditOf(trx, p.sendId, "action.send_limited");
      expect(limited).toHaveLength(1);
      expect(limited[0]?.reason_code).toBe("send_limit");
      expect(limited[0]?.data).toEqual({
        limit: "mailbox_hour",
        until: "2026-11-20T10:10:00.000Z",
        mailbox_id: s.mailboxId,
      });
      expect(await auditOf(trx, p.sendId, "action.applying")).toHaveLength(0);
      expect(hits).toEqual([{ mailboxId: s.mailboxId, limit: "mailbox_hour", until: at(10), at: NOW }]);
    });
  });

  test("(2) through the committer: held, not claimed before the window ends, then sent", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const s = await setup(trx);
      await addCredentials(trx, s);
      await insertCountedSends(trx, s, minutesAgo(31, 50));
      const p = await approvedSend(trx, s);
      const hits: SendLimitHit[] = [];
      let clock = NOW;
      const job = createCommitterJob({
        db: trx,
        secrets,
        openProvider: async () => s.fake,
        openSender: async () => s.sender,
        scope: { kind: "all" },
        sendScope: { kind: "all" },
        now: () => clock,
        onSendLimited: (_ctx, hit) => {
          hits.push(hit);
        },
      });

      await job.run();
      expect(s.sender.sent).toHaveLength(0);
      expect((await row(trx, p.sendId)).status).toBe("approved");
      expect(await auditOf(trx, p.sendId, "action.send_limited")).toHaveLength(1);
      expect(hits).toHaveLength(1);

      clock = at(5);
      await job.run();
      expect(s.sender.sent).toHaveLength(0);
      expect(await auditOf(trx, p.sendId, "action.send_limited")).toHaveLength(1);

      clock = at(10);
      await job.run();
      expect(s.sender.sent).toHaveLength(1);
      const sent = await row(trx, p.sendId);
      expect(sent.status).toBe("applied");
      expect(sent.send_started_at?.toISOString()).toBe("2026-11-20T10:10:00.000Z");
    });
  });

  test("(3) the recipient limit counts one address in any letter case", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await insertCountedSends(
        trx,
        s,
        [-10, -8, -6, -4, -2].map((hours) => at(hours * 60)),
        "dlg@x.test"
      );
      const p = await approvedSend(trx, s, "DLG@x.test");
      const hits: SendLimitHit[] = [];
      const claimed = pick(await claimAll(trx, s), p.sendId);

      expect(await applySend(depsOf(s, trx, hits), s.ctx, claimed, s.fake)).toEqual({ kind: "retry", soft: false });

      const held = await row(trx, p.sendId);
      expect(held.last_error).toBe("send_limit:recipient_day");
      expect(held.next_attempt_at?.toISOString()).toBe("2026-11-21T00:00:00.000Z");
      expect(hits).toHaveLength(1);
    });
  });

  test("(4) 19 counted sends in the hour: the send goes out", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await insertCountedSends(trx, s, minutesAgo(32, 50));
      const p = await approvedSend(trx, s);
      const hits: SendLimitHit[] = [];
      const claimed = pick(await claimAll(trx, s), p.sendId);

      expect(await applySend(depsOf(s, trx, hits), s.ctx, claimed, s.fake)).toEqual({ kind: "applied" });

      expect(s.sender.calls).toHaveLength(1);
      expect((await row(trx, p.sendId)).send_started_at?.getTime()).toBe(NOW.getTime());
      expect(hits).toEqual([]);
    });
  });

  test("(5) failed sends that the server refused do not count", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await insertCountedSends(trx, s, minutesAgo(31, 50), undefined, {
        status: "failed",
        statusReason: "smtp_rejected",
      });
      const p = await approvedSend(trx, s);
      const hits: SendLimitHit[] = [];
      const claimed = pick(await claimAll(trx, s), p.sendId);

      expect(await applySend(depsOf(s, trx, hits), s.ctx, claimed, s.fake)).toEqual({ kind: "applied" });

      expect(s.sender.calls).toHaveLength(1);
      expect(hits).toEqual([]);
    });
  });

  test("(7) an applying send (crash after step 2) recovers as before, even over the limit", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await insertCountedSends(trx, s, minutesAgo(31, 50));
      const p = await approvedSend(trx, s);
      await trx
        .updateTable("actions")
        .set({ status: "applying", send_started_at: at(-1), outgoing_message_id: "<crash@x.test>" })
        .where("id", "=", p.sendId)
        .execute();
      const hits: SendLimitHit[] = [];
      const claimed = pick(await claimAll(trx, s, at(11)), p.sendId);

      expect(await applySend(depsOf(s, trx, hits), s.ctx, claimed, s.fake)).toEqual({
        kind: "failed",
        reason: "outcome_unknown",
      });

      expect(s.sender.calls).toEqual([]);
      const ended = await row(trx, p.sendId);
      expect(ended.status).toBe("failed");
      expect(ended.status_reason).toBe("outcome_unknown");
      expect(await auditOf(trx, p.sendId, "action.send_limited")).toHaveLength(0);
      expect(hits).toEqual([]);
    });
  });

  test("(8) a held send does not stop the batch: a later flag is applied in the same run", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const s = await setup(trx);
      await addCredentials(trx, s);
      await insertCountedSends(trx, s, minutesAgo(31, 50));
      const p = await approvedSend(trx, s);
      const receivedAt = at(-10);
      const uid = s.fake.deliver(
        "INBOX",
        { messageId: "<flag1@x.test>", from: "sender@x.test", to: [s.address], subject: "s", date: receivedAt },
        { internalDate: receivedAt }
      );
      const meta = await s.fake.fetchMetaIn("INBOX", uid);
      const mail = await insertTriagedWithActions(trx, s.ctx, s.mailboxId, {
        category: "info",
        createdAt: receivedAt,
        receivedAt,
        from: "sender@x.test",
        messageId: "<flag1@x.test>",
        uid,
        contentHash: contentHash(meta as NonNullable<typeof meta>),
        actions: [{ type: "flag", status: "ready" }],
      });
      const job = createCommitterJob({
        db: trx,
        secrets,
        openProvider: async () => s.fake,
        openSender: async () => s.sender,
        scope: { kind: "all" },
        sendScope: { kind: "all" },
        now: () => NOW,
      });

      await job.run();

      expect((await row(trx, p.sendId)).status).toBe("approved");
      expect(await auditOf(trx, p.sendId, "action.send_limited")).toHaveLength(1);
      expect((await row(trx, mail.actionIds[0] as string)).status).toBe("applied");
      expect((await s.fake.fetchMetaIn("INBOX", uid))?.flags).toContain("\\Flagged");
    });
  });

  test("(9) a callback that throws does not change the outcome; one warn line", async () => {
    const logSpy = spyOn(console, "log").mockImplementation((): void => undefined);
    const errorSpy = spyOn(console, "error").mockImplementation((): void => undefined);
    try {
      await withRollback(db, async (trx) => {
        const s = await setup(trx);
        await insertCountedSends(trx, s, minutesAgo(31, 50));
        const p = await approvedSend(trx, s);
        const claimed = pick(await claimAll(trx, s), p.sendId);
        const deps = depsOf(s, trx, [], {
          onSendLimited: () => {
            throw new Error("callback boom");
          },
        });

        expect(await applySend(deps, s.ctx, claimed, s.fake)).toEqual({ kind: "retry", soft: false });

        expect((await row(trx, p.sendId)).status).toBe("approved");
        const lines = errorSpy.mock.calls
          .map((call: unknown[]) => call.map(String).join(" "))
          .filter((line) => line.includes("send_limited_callback_failed"));
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain(p.sendId);
      });
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  test("(10) the log line of a held send holds ids and the kind, no address", async () => {
    const logSpy = spyOn(console, "log").mockImplementation((): void => undefined);
    const errorSpy = spyOn(console, "error").mockImplementation((): void => undefined);
    setLogLevel("debug");
    try {
      await withRollback(db, async (trx) => {
        const s = await setup(trx);
        await insertCountedSends(trx, s, minutesAgo(31, 50));
        const p = await approvedSend(trx, s);
        const claimed = pick(await claimAll(trx, s), p.sendId);

        await applySend(depsOf(s, trx, []), s.ctx, claimed, s.fake);

        const output = [...logSpy.mock.calls, ...errorSpy.mock.calls]
          .map((call: unknown[]) => call.map(String).join(" "))
          .join("\n");
        const lines = output.split("\n").filter((line) => line.includes("send_limited"));
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain(p.sendId);
        expect(lines[0]).toContain(s.mailboxId);
        expect(lines[0]).toContain("mailbox_hour");
        expect(output).not.toContain("@x.test");
        expect(output).not.toContain("dropped_fields");
      });
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  test("(11) lockMailboxSends outside a transaction throws", async () => {
    await expect(lockMailboxSends(db, { orgId: "00000000-0000-4000-8000-000000000000" }, "m")).rejects.toThrow(
      "lockMailboxSends needs a transaction"
    );
  });
});

describe("two committers at once", () => {
  test("(6) the second send waits for the lock, sees the 20th send and is held", async () => {
    const db1 = testDb();
    const db2 = testDb();
    const s = await db1.transaction().execute((trx) => setup(trx));
    try {
      const { counted, a, b, twentieth } = await db1.transaction().execute(async (trx) => {
        const ids = await insertCountedSends(trx, s, minutesAgo(32, 50));
        const first = await approvedSend(trx, s, "a@x.test");
        const second = await approvedSend(trx, s, "b@x.test");
        const last = await insertDraftAndSend(trx, s.ctx, s.mailboxId, {
          createdAt: CREATED,
          sendStatus: "awaiting_approval",
        });
        return { counted: ids, a: first.sendId, b: second.sendId, twentieth: last.sendId };
      });
      expect(counted).toHaveLength(19);
      const claimed = await claimAll(db1, s);
      const claimedB = pick(claimed, b);
      pick(claimed, a);

      const sender2 = createFakeMailSender();
      const hits: SendLimitHit[] = [];
      let granted = false;
      let pB: Promise<unknown> | undefined;
      const poll = setInterval(() => {
        void sql<{ n: string }>`SELECT count(*) AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`
          .execute(db1)
          .then((result) => {
            if (Number(result.rows[0]?.n ?? 0) > 0) granted = true;
          });
      }, 25);
      let outcome: unknown;
      try {
        await db1.transaction().execute(async (trx) => {
          await lockMailboxSends(trx, s.ctx, s.mailboxId);
          // The 20th counted send of the hour starts while the lock is held.
          await trx
            .updateTable("actions")
            .set({
              status: "applying",
              send_started_at: NOW,
              approved_by: s.userId,
              approved_at: at(-5),
              approved_via: "telegram",
            })
            .where("id", "=", twentieth)
            .execute();
          pB = applySend(depsOf(s, db2, hits, {}, sender2), s.ctx, claimedB, s.fake).then((value) => {
            outcome = value;
            return value;
          });
          await waitFor(() => granted, "the second committer waits for the advisory lock");
        });
        await pB;
      } finally {
        clearInterval(poll);
      }

      expect(outcome).toEqual({ kind: "retry", soft: false });
      const held = await row(db1, b);
      expect(held.status).toBe("approved");
      expect(held.last_error).toBe("send_limit:mailbox_hour");
      expect(sender2.calls).toHaveLength(0);
      expect(hits).toHaveLength(1);
    } finally {
      await db1.deleteFrom("organizations").where("id", "=", s.ctx.orgId).execute();
      await db1.deleteFrom("users").where("id", "=", s.userId).execute();
      await db1.destroy();
      await db2.destroy();
    }
  });
});
