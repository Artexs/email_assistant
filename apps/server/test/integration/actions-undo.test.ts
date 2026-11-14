import { randomBytes, randomUUID } from "node:crypto";

import { AI_FOLDER_NAMES } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import {
  applyAction,
  claimActions,
  createCommitterJob,
  createFolderResolver,
  undo,
  type ActionsScope,
  type ClaimedAction,
} from "../../src/modules/actions";
import { INBOX, syncMailbox } from "../../src/modules/mail";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import {
  createFakeMailProvider,
  type FakeMailProvider,
  type FakeMailProviderOptions,
} from "../../src/modules/mail/fake";
import { insertCredentials, updateCursor } from "../../src/modules/mail/repo";
import { contentHash } from "../../src/modules/mail/sync-rules";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB, TenantContext } from "../../src/platform/db";
import { HardError, SoftError } from "../../src/platform/errors";

import {
  applyDepsDefaults,
  createOrgWithMailbox,
  insertAction,
  insertTriagedWithActions,
  pauseOtherMailboxes,
} from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = new Date("2026-11-07T12:00:00Z");
const RECEIVED = new Date(NOW.getTime() - 2 * HOUR);
const APPLIED = new Date(NOW.getTime() - HOUR);
const SINCE = new Date(RECEIVED.getTime() - DAY);
const MESSAGE_ID = "<undo-1@x.test>";
const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);

// Interia: a protocol COPY gives a new UID (no MOVE, UIDPLUS); a webmail move keeps it.
const INTERIA: FakeMailProviderOptions = {
  capabilities: { move: false, uidplus: true },
  keepUidOnCopy: false,
  keepUidOnUserMove: true,
};

interface Setup {
  ctx: TenantContext;
  userId: string;
  mailboxId: string;
  address: string;
  fake: FakeMailProvider;
  scope: ActionsScope;
}

async function setup(trx: Transaction<DB>, options: FakeMailProviderOptions = {}): Promise<Setup> {
  await pauseOtherMailboxes(trx);
  const address = `box-${randomUUID()}@x.test`;
  const box = await createOrgWithMailbox(trx, { address });
  const secret = secrets.encrypt("pw", `mailbox:${box.mailboxId}`);
  await insertCredentials(
    trx,
    { orgId: box.orgId },
    {
      mailboxId: box.mailboxId,
      encryptedSecret: secret.ciphertext,
      secretKind: "password",
      keyVersion: secret.keyVersion,
    }
  );
  return {
    ctx: { orgId: box.orgId },
    userId: box.userId,
    mailboxId: box.mailboxId,
    address,
    fake: createFakeMailProvider(options),
    scope: { kind: "all" },
  };
}

interface ActionSeed {
  type: "move" | "flag" | "mark_read" | "save_summary";
  status: string;
  payload?: Record<string, string>;
  appliedAt?: Date | null;
}

// A mail row (no fake message) with action rows.
async function insertMail(
  trx: Transaction<DB>,
  s: Setup,
  actions: ActionSeed[],
  messageId: string = MESSAGE_ID
): Promise<{ emailId: string; actionIds: string[] }> {
  return insertTriagedWithActions(trx, s.ctx, s.mailboxId, {
    category: "info",
    createdAt: RECEIVED,
    receivedAt: RECEIVED,
    from: "sender@x.test",
    messageId,
    actions: actions.map((action) => ({
      appliedAt: action.status === "applied" || action.status === "undone" ? APPLIED : null,
      ...action,
    })),
  });
}

const opts = (s: Setup, now: Date = NOW) => ({ now, userId: s.userId, scope: s.scope });

async function reverseRows(trx: Transaction<DB>, s: Setup) {
  return trx
    .selectFrom("actions")
    .selectAll()
    .where("org_id", "=", s.ctx.orgId)
    .where("reverses_action_id", "is not", null)
    .orderBy("created_at")
    .orderBy("id")
    .execute();
}

async function actionState(trx: Transaction<DB>, id: string) {
  return trx.selectFrom("actions").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

async function emailState(trx: Transaction<DB>, id: string) {
  return trx.selectFrom("emails").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

async function auditRows(trx: Transaction<DB>, s: Setup, event: string) {
  return trx
    .selectFrom("audit_log")
    .selectAll()
    .where("org_id", "=", s.ctx.orgId)
    .where("event", "=", event)
    .orderBy("created_at")
    .orderBy("id")
    .execute();
}

describe("undo: the reverse rows", () => {
  test("(1) every applied mailbox action gets a reverse row and an audit row", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const mail = await insertMail(trx, s, [
        { type: "mark_read", status: "applied" },
        { type: "move", status: "applied", payload: { folder: "ai_info" } },
        { type: "save_summary", status: "applied" },
      ]);

      expect(await undo(trx, s.ctx, mail.emailId, opts(s))).toEqual({ kind: "started", created: 2 });

      const rows = await reverseRows(trx, s);
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        const original = mail.actionIds.indexOf(row.reverses_action_id as string);
        expect([0, 1]).toContain(original);
        expect(row).toMatchObject({ status: "ready", idempotency_key: `${row.reverses_action_id}:undo` });
      }
      expect(rows.find((row) => row.type === "move")?.payload).toEqual({ folder: "ai_info" });
      const audit = await auditRows(trx, s, "action.undo_requested");
      expect(audit).toHaveLength(2);
      expect(audit.every((row) => row.actor === s.userId && row.email_id === mail.emailId)).toBe(true);
      expect(audit[0]?.data).toMatchObject({ original_action_id: audit[0]?.action_id });
      expect((await emailState(trx, mail.emailId)).undo_pending_at?.getTime()).toBe(NOW.getTime());
    });
  });

  test("(1b) a flag-only Undo sets no undo_pending_at", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const mail = await insertMail(trx, s, [{ type: "flag", status: "applied" }]);

      expect(await undo(trx, s.ctx, mail.emailId, opts(s))).toEqual({ kind: "started", created: 1 });

      expect((await emailState(trx, mail.emailId)).undo_pending_at).toBeNull();
    });
  });

  test("(2) the second call does nothing", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const mail = await insertMail(trx, s, [
        { type: "mark_read", status: "applied" },
        { type: "move", status: "applied", payload: { folder: "ai_info" } },
      ]);
      await undo(trx, s.ctx, mail.emailId, opts(s));

      expect(await undo(trx, s.ctx, mail.emailId, opts(s))).toEqual({ kind: "already" });

      expect(await reverseRows(trx, s)).toHaveLength(2);
      expect(await auditRows(trx, s, "action.undo_requested")).toHaveLength(2);
    });
  });

  test("(3) one original undone and the other with a reverse: already", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const mail = await insertMail(trx, s, [
        { type: "mark_read", status: "undone" },
        { type: "flag", status: "applied" },
      ]);
      await insertAction(trx, s.ctx, mail.emailId, {
        type: "flag",
        status: "ready",
        reversesActionId: mail.actionIds[1] as string,
      });

      expect(await undo(trx, s.ctx, mail.emailId, opts(s))).toEqual({ kind: "already" });
      expect(await reverseRows(trx, s)).toHaveLength(1);
    });
  });

  test("(4) only save_summary: nothing", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const mail = await insertMail(trx, s, [{ type: "save_summary", status: "applied" }]);

      expect(await undo(trx, s.ctx, mail.emailId, opts(s))).toEqual({ kind: "nothing" });
      expect(await reverseRows(trx, s)).toHaveLength(0);
    });
  });

  test("(5) applied 8 days ago: too_old; a mix undoes the recent one only", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const old = new Date(NOW.getTime() - 8 * DAY);
      const oldMail = await insertMail(trx, s, [{ type: "flag", status: "applied", appliedAt: old }]);
      expect(await undo(trx, s.ctx, oldMail.emailId, opts(s))).toEqual({ kind: "too_old" });
      expect(await reverseRows(trx, s)).toHaveLength(0);

      const mixed = await insertMail(
        trx,
        s,
        [
          { type: "flag", status: "applied", appliedAt: old },
          { type: "mark_read", status: "applied" },
        ],
        "<undo-2@x.test>"
      );
      expect(await undo(trx, s.ctx, mixed.emailId, opts(s))).toEqual({ kind: "started", created: 1 });
      const rows = await reverseRows(trx, s);
      expect(rows.map((row) => row.reverses_action_id)).toEqual([mixed.actionIds[1] as string]);
    });
  });

  test("(6) another organization's mail and an unknown id: not_found", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const other = await setup(trx);
      const theirs = await insertMail(trx, other, [{ type: "flag", status: "applied" }]);

      expect(await undo(trx, s.ctx, theirs.emailId, opts(s))).toEqual({ kind: "not_found" });
      expect(await undo(trx, s.ctx, randomUUID(), opts(s))).toEqual({ kind: "not_found" });

      expect(await reverseRows(trx, other)).toHaveLength(0);
      expect(await auditRows(trx, other, "action.undo_requested")).toHaveLength(0);
    });
  });

  test("(6b) held: scope off, scope synthetic with a real mail, a paused mailbox", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const mail = await insertMail(trx, s, [{ type: "flag", status: "applied" }]);

      expect(await undo(trx, s.ctx, mail.emailId, { ...opts(s), scope: { kind: "off" } })).toEqual({ kind: "held" });
      expect(
        await undo(trx, s.ctx, mail.emailId, { ...opts(s), scope: { kind: "synthetic", testMail: NO_TEST_SENDERS } })
      ).toEqual({
        kind: "held",
      });
      await trx.updateTable("mailboxes").set({ status: "paused" }).where("id", "=", s.mailboxId).execute();
      expect(await undo(trx, s.ctx, mail.emailId, opts(s))).toEqual({ kind: "held" });

      expect(await reverseRows(trx, s)).toHaveLength(0);
      expect(await auditRows(trx, s, "action.undo_requested")).toHaveLength(0);
      expect((await emailState(trx, mail.emailId)).undo_pending_at).toBeNull();
    });
  });

  test("(6b2) scope synthetic admits a synthetic mail", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const mail = await insertMail(trx, s, [{ type: "flag", status: "applied" }], "<a@ea-seed.test>");

      expect(
        await undo(trx, s.ctx, mail.emailId, { ...opts(s), scope: { kind: "synthetic", testMail: NO_TEST_SENDERS } })
      ).toEqual({
        kind: "started",
        created: 1,
      });
    });
  });

  test("(6c) a ready original in a retry wait is expired by the Undo", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const mail = await insertMail(trx, s, [
        { type: "move", status: "applied", payload: { folder: "ai_info" } },
        { type: "flag", status: "ready" },
      ]);
      await trx
        .updateTable("actions")
        .set({ next_attempt_at: new Date(NOW.getTime() + 5 * 60_000) })
        .where("id", "=", mail.actionIds[1] as string)
        .execute();

      expect(await undo(trx, s.ctx, mail.emailId, opts(s))).toEqual({ kind: "started", created: 1 });

      expect(await actionState(trx, mail.actionIds[1] as string)).toMatchObject({
        status: "expired",
        status_reason: "undo",
      });
      const expired = await auditRows(trx, s, "action.expired");
      expect(expired).toHaveLength(1);
      expect(expired[0]).toMatchObject({ action_id: mail.actionIds[1], actor: s.userId, reason_code: "undo" });
      expect(expired[0]?.data).toMatchObject({ action_type: "flag" });
    });
  });
});

function jobFor(trx: Transaction<DB>, s: Setup) {
  return createCommitterJob({
    db: trx,
    secrets,
    openProvider: async () => s.fake,
    scope: s.scope,
    now: () => NOW,
  });
}

// A fake INBOX mail with ready flag, mark_read and move rows.
async function insertQueuedMail(trx: Transaction<DB>, s: Setup) {
  const uid = s.fake.deliver(
    INBOX,
    { messageId: MESSAGE_ID, from: "sender@x.test", to: [s.address], subject: "s", date: RECEIVED },
    { internalDate: RECEIVED }
  );
  const meta = await s.fake.fetchMetaIn(INBOX, uid);
  const mail = await insertTriagedWithActions(trx, s.ctx, s.mailboxId, {
    category: "info",
    createdAt: RECEIVED,
    receivedAt: RECEIVED,
    from: "sender@x.test",
    messageId: MESSAGE_ID,
    uid,
    contentHash: contentHash(meta as NonNullable<typeof meta>),
    actions: [
      { type: "flag", status: "ready" },
      { type: "mark_read", status: "ready" },
      { type: "move", status: "ready", payload: { folder: "ai_info" } },
    ],
  });
  return { ...mail, uid };
}

describe("undo with the committer", () => {
  test("(7) the mail comes back to INBOX without the flags", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx, { keepUidOnCopy: true });
      const mail = await insertQueuedMail(trx, s);
      await jobFor(trx, s).run();
      expect(await s.fake.searchSinceIn(INBOX, SINCE)).toEqual([]);
      const moved = await s.fake.fetchMetaIn("AI/Info", mail.uid);
      expect(moved?.flags.sort()).toEqual(["\\Flagged", "\\Seen"]);

      expect(await undo(trx, s.ctx, mail.emailId, opts(s))).toEqual({ kind: "started", created: 3 });
      await jobFor(trx, s).run();

      const back = await s.fake.searchSinceIn(INBOX, SINCE);
      expect(back).toHaveLength(1);
      expect((await s.fake.fetchMetaIn(INBOX, back[0] as number))?.flags).toEqual([]);
      expect(await s.fake.searchSinceIn("AI/Info", SINCE)).toEqual([]);
      for (const id of mail.actionIds) {
        expect(await actionState(trx, id)).toMatchObject({ status: "undone", status_reason: "undo" });
      }
      const reverses = await reverseRows(trx, s);
      expect(reverses.map((row) => row.status)).toEqual(["applied", "applied", "applied"]);
      const email = await emailState(trx, mail.emailId);
      expect(email).toMatchObject({ folder: INBOX, moved_at: null, undo_pending_at: null });
      const applied = (await auditRows(trx, s, "action.applied")).filter((row) => {
        const data = row.data as { reverse?: boolean };
        return data.reverse === true;
      });
      expect(applied).toHaveLength(3);
      expect(await auditRows(trx, s, "action.undone")).toHaveLength(3);
    });
  });

  test("(8) the flags act on the AI-folder UID before the move", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx, { keepUidOnCopy: true });
      const mail = await insertQueuedMail(trx, s);
      await jobFor(trx, s).run();
      await undo(trx, s.ctx, mail.emailId, opts(s));
      s.fake.calls.length = 0;

      await jobFor(trx, s).run();

      expect(s.fake.calls.filter((call) => call === "setFlags" || call === "moveMessage")).toEqual([
        "setFlags",
        "setFlags",
        "moveMessage",
      ]);
    });
  });
});

describe("undo: a reverse move in flight (D22)", () => {
  // The mail sits in AI/Info (a webmail move keeps the UID); the cursor is past the INBOX UID.
  async function movedMail(trx: Transaction<DB>, s: Setup) {
    const inboxUid = s.fake.deliver(
      INBOX,
      { messageId: MESSAGE_ID, from: "sender@x.test", to: [s.address], subject: "s", date: RECEIVED },
      { internalDate: RECEIVED }
    );
    const infoUid = s.fake.userMove(INBOX, inboxUid, "AI/Info");
    const meta = await s.fake.fetchMetaIn("AI/Info", infoUid);
    const mail = await insertTriagedWithActions(trx, s.ctx, s.mailboxId, {
      category: "info",
      createdAt: RECEIVED,
      receivedAt: RECEIVED,
      from: "sender@x.test",
      messageId: MESSAGE_ID,
      folder: "AI/Info",
      uid: infoUid,
      inboxUid,
      contentHash: contentHash(meta as NonNullable<typeof meta>),
      movedAt: APPLIED,
      actions: [{ type: "move", status: "applied", payload: { folder: "ai_info" }, appliedAt: APPLIED }],
    });
    expect(
      await updateCursor(
        trx,
        s.ctx,
        s.mailboxId,
        { uidValidity: null, lastUid: null },
        { uidValidity: 7, lastUid: inboxUid }
      )
    ).toBe(true);
    return { ...mail, inboxUid };
  }

  function claim(trx: Transaction<DB>, s: Setup, at: Date): Promise<ClaimedAction[]> {
    return claimActions(trx, s.ctx, s.mailboxId, {
      now: at,
      limit: 20,
      staleBefore: new Date(at.getTime() - 10 * 60_000),
      filter: { mailbox: { kind: "all" }, send: { kind: "none" } },
    });
  }

  function depsOf(s: Setup, trx: Transaction<DB>, at: Date) {
    const folders = createFolderResolver(
      { db: trx, now: () => at, provider: s.fake, mailboxId: s.mailboxId, folderMap: { ...AI_FOLDER_NAMES } },
      s.ctx
    );
    return { db: trx, now: () => at, mailboxId: s.mailboxId, folders, ...applyDepsDefaults() };
  }

  const syncDeps = (trx: Transaction<DB>, s: Setup, at: Date) => ({
    db: trx,
    provider: s.fake,
    isOwnActionId: async () => false,
    now: () => at,
  });

  async function stoppedReverse(trx: Transaction<DB>, s: Setup) {
    const mail = await movedMail(trx, s);
    expect(await undo(trx, s.ctx, mail.emailId, opts(s))).toEqual({ kind: "started", created: 1 });
    const [reverse] = await claim(trx, s, NOW);
    s.fake.failOn("deleteMessage", new SoftError("connection lost"));
    const outcome = await applyAction(depsOf(s, trx, NOW), s.ctx, reverse as ClaimedAction, s.fake);
    expect(outcome).toEqual({ kind: "retry", soft: true });
    // COPY done, expunge not: the mail sits in both folders.
    expect(await s.fake.searchSinceIn(INBOX, SINCE)).toHaveLength(1);
    expect(await s.fake.searchSinceIn("AI/Info", SINCE)).toHaveLength(1);
    return mail;
  }

  test("(10) the sync stores no #2, the retry deletes the source", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx, { ...INTERIA, uidValidity: 7 });
      const mail = await stoppedReverse(trx, s);

      const later = new Date(NOW.getTime() + 60_000);
      const result = await syncMailbox(syncDeps(trx, s, later), s.ctx, s.mailboxId);
      expect(result).toMatchObject({ stored: 0, moveInFlight: 1 });

      const retryAt = new Date(NOW.getTime() + 11 * 60_000);
      const [again] = await claim(trx, s, retryAt);
      expect(again?.type).toBe("move");
      expect((await applyAction(depsOf(s, trx, retryAt), s.ctx, again as ClaimedAction, s.fake)).kind).toBe("applied");

      expect(await s.fake.searchSinceIn(INBOX, SINCE)).toHaveLength(1);
      expect(await s.fake.searchSinceIn("AI/Info", SINCE)).toEqual([]);
      const rows = await trx
        .selectFrom("emails")
        .select(["id", "dedup_key"])
        .where("mailbox_id", "=", s.mailboxId)
        .execute();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.dedup_key.includes("#2")).toBe(false);
      expect(await actionState(trx, mail.actionIds[0] as string)).toMatchObject({ status: "undone" });
      expect(await emailState(trx, mail.emailId)).toMatchObject({ folder: INBOX, undo_pending_at: null });
    });
  });

  test("(11) an undo_pending_at older than 1 day gives the old rule (#2)", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx, { ...INTERIA, uidValidity: 7 });
      const mail = await stoppedReverse(trx, s);
      await trx
        .updateTable("emails")
        .set({ undo_pending_at: new Date(NOW.getTime() - 25 * HOUR) })
        .where("id", "=", mail.emailId)
        .execute();

      const result = await syncMailbox(syncDeps(trx, s, new Date(NOW.getTime() + 60_000)), s.ctx, s.mailboxId);

      expect(result).toMatchObject({ stored: 1, moveInFlight: 0 });
      const rows = await trx.selectFrom("emails").select("dedup_key").where("mailbox_id", "=", s.mailboxId).execute();
      expect(rows.some((row) => row.dedup_key.endsWith("#2"))).toBe(true);
    });
  });

  test("(12) a reverse that ends failed clears the flag", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx, { ...INTERIA, uidValidity: 7 });
      const mail = await movedMail(trx, s);
      await undo(trx, s.ctx, mail.emailId, opts(s));
      s.fake.remove("AI/Info", (await s.fake.searchSinceIn("AI/Info", SINCE))[0] as number);
      const [reverse] = await claim(trx, s, NOW);

      expect(await applyAction(depsOf(s, trx, NOW), s.ctx, reverse as ClaimedAction, s.fake)).toEqual({
        kind: "failed",
        reason: "mail_not_found",
      });

      expect((await emailState(trx, mail.emailId)).undo_pending_at).toBeNull();
    });
  });

  test("(13) a reverse that fails hard 3 times ends failed and clears the flag", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx, { ...INTERIA, uidValidity: 7 });
      const mail = await movedMail(trx, s);
      await undo(trx, s.ctx, mail.emailId, opts(s));
      s.fake.failOn("deleteMessage", new HardError("boom"), 3);

      const outcomes = [];
      for (const attempt of [0, 1, 2]) {
        const at = new Date(NOW.getTime() + attempt * 10 * 60_000);
        const [reverse] = await claim(trx, s, at);
        outcomes.push(await applyAction(depsOf(s, trx, at), s.ctx, reverse as ClaimedAction, s.fake));
      }

      expect(outcomes.at(-1)).toEqual({ kind: "failed", reason: "hard_error" });
      expect(await reverseRows(trx, s)).toMatchObject([{ status: "failed", status_reason: "hard_error" }]);
      expect((await emailState(trx, mail.emailId)).undo_pending_at).toBeNull();
    });
  });
});
