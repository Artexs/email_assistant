import { randomBytes, randomUUID } from "node:crypto";
import { format } from "node:util";

import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import type { Transaction } from "kysely";

import {
  createCommitterJob,
  createExpiryJob,
  listExpiredApprovals,
  noDelegationHooks,
} from "../../src/modules/actions";
import { MailAuthError, SmtpSendError } from "../../src/modules/mail";
import { createFakeMailProvider, type FakeMailProvider } from "../../src/modules/mail/fake";
import { createFakeMailSender } from "../../src/modules/mail/fake/sender";
import { insertCredentials } from "../../src/modules/mail/repo";
import { contentHash } from "../../src/modules/mail/sync-rules";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB } from "../../src/platform/db";
import { SoftError } from "../../src/platform/errors";
import { logFormatFromEnv, setLogFormat, setLogLevel } from "../../src/platform/log";

import { createOrgWithMailbox, insertDraftAndSend, insertTriagedWithActions, pauseOtherMailboxes } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// F103 stage 08: one test per event of `committer.ts` and `expiry.ts`. Each runs the job with canary values that must
// not reach a log line (a recipient, a subject, a draft text, an SMTP reply, an error text with an address).

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

afterEach(() => {
  setLogLevel("info");
  setLogFormat(logFormatFromEnv(process.env));
});

const HOUR = 3_600_000;
const MINUTE = 60_000;
const NOW = new Date("2026-11-20T10:00:00Z");
const run = randomUUID();
const CANARY = {
  recipient: `canary-recipient-${run}@x.test`,
  subject: `CANARY-SUBJECT-${run}`,
  body: `CANARY-DRAFT-${run}`,
  reply: `550 5.1.1 canary-reply-${run}@x.test unknown`,
  error: `CANARY-ERROR-${run} canary-error-${run}@x.test`,
};
const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface Entry {
  level: string;
  event: string;
  fields: Record<string, unknown>;
}

// Runs `body` in JSON format with the console spies. `format()` shows an error object that was logged raw with its
// fields. Every line must be JSON. The old-form lines of `apply.ts` (`legacy_text`, until its conversion) are dropped
// from `entries` but still checked for the canaries.
async function captured(body: () => Promise<void>) {
  const lines: string[] = [];
  const logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => void lines.push(format(...args)));
  const errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => void lines.push(format(...args)));
  setLogFormat("json");
  setLogLevel("debug");
  try {
    await body();
  } finally {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  }
  for (const marker of [...Object.values(CANARY), "CANARY", "@x.test", "canary-"]) {
    for (const line of lines) expect(line).not.toContain(marker);
  }
  const entries = lines.map((line): Entry => {
    const { level, event, time, module, msg, ...fields } = JSON.parse(line) as Record<string, unknown>;
    void time;
    void module;
    void msg;
    return { level: level as string, event: event as string, fields };
  });
  for (const entry of entries) {
    for (const [key, value] of Object.entries(entry.fields)) {
      if (key.endsWith("_id")) expect(String(value)).toMatch(UUID);
      // Values are lower-case codes, ids and numbers; only the error name, the error code and the config key differ.
      if (!["error", "error_code", "config_key"].includes(key)) expect(String(value)).not.toMatch(/[A-Z]{3}/);
    }
  }
  return { lines, entries: entries.filter((entry) => entry.event !== "legacy_text") };
}

interface Box {
  userId: string;
  orgId: string;
  mailboxId: string;
  address: string;
  fake: FakeMailProvider;
}

async function addBox(trx: Transaction<DB>): Promise<Box> {
  await pauseOtherMailboxes(trx);
  const address = `box-${randomUUID()}@x.test`;
  const { orgId, mailboxId, userId } = await createOrgWithMailbox(trx, { address });
  const secret = secrets.encrypt("pw", `mailbox:${mailboxId}`);
  await insertCredentials(
    trx,
    { orgId },
    { mailboxId, encryptedSecret: secret.ciphertext, secretKind: "password", keyVersion: secret.keyVersion }
  );
  return { userId, orgId, mailboxId, address, fake: createFakeMailProvider() };
}

// A mail with a canary subject and sender, delivered to the fake INBOX, with `count` flag actions.
async function addMail(trx: Transaction<DB>, box: Box, opts: { count?: number; ageMs?: number } = {}) {
  const receivedAt = new Date(NOW.getTime() - (opts.ageMs ?? HOUR));
  const messageId = `<${randomUUID()}@x.test>`;
  const uid = box.fake.deliver(
    "INBOX",
    { messageId, from: CANARY.recipient, to: [box.address], subject: CANARY.subject, date: receivedAt },
    { internalDate: receivedAt }
  );
  const meta = await box.fake.fetchMetaIn("INBOX", uid);
  return insertTriagedWithActions(trx, { orgId: box.orgId }, box.mailboxId, {
    category: "info",
    createdAt: receivedAt,
    receivedAt,
    from: CANARY.recipient,
    subject: CANARY.subject,
    messageId,
    uid,
    contentHash: contentHash(meta as NonNullable<typeof meta>),
    actions: Array.from({ length: opts.count ?? 1 }, () => ({ type: "flag" as const, status: "ready" })),
  });
}

function pairOf(trx: Transaction<DB>, box: Box, opts: Parameters<typeof insertDraftAndSend>[3] = {}) {
  return insertDraftAndSend(trx, { orgId: box.orgId }, box.mailboxId, {
    createdAt: new Date(NOW.getTime() - 30 * MINUTE),
    draftStatus: "applied",
    draftProviderResult: { uid: 1, folder: "Drafts" },
    sendStatus: "approved",
    approved: { userId: box.userId, at: new Date(NOW.getTime() - MINUTE) },
    to: CANARY.recipient,
    subject: CANARY.subject,
    bodyText: CANARY.body,
    ...opts,
  });
}

type CommitterOptions = Partial<Parameters<typeof createCommitterJob>[0]>;

function committerFor(trx: Transaction<DB>, box: Box, options: CommitterOptions = {}) {
  return createCommitterJob({
    db: trx,
    secrets,
    openProvider: async () => box.fake,
    scope: { kind: "all" },
    now: () => NOW,
    ...options,
  });
}

// A transaction whose calls fail on demand: the folder read, the second organizations read (the facts) and the
// updates of `actions` (the release). A failing step switches the updates on, so the release fails too.
function breakable(trx: Transaction<DB>, fail: { folders?: boolean; facts?: boolean; actions?: boolean }) {
  const state = { ...fail, organizationReads: 0 };
  const boom = () => new Error(CANARY.error);
  const proxy = new Proxy(trx, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target) as unknown;
      if (prop === "selectFrom") {
        return (table: string) => {
          if (table === "mailbox_folders" && state.folders === true) {
            state.actions = true;
            throw boom();
          }
          if (table === "organizations" && state.facts === true && ++state.organizationReads > 1) {
            state.actions = true;
            throw boom();
          }
          return (value as (name: string) => unknown).call(target, table);
        };
      }
      if (prop === "updateTable") {
        return (table: string) => {
          if (table === "actions" && state.actions === true) throw boom();
          return (value as (name: string) => unknown).call(target, table);
        };
      }
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
  return { db: proxy, state };
}

function senderOpener() {
  const sender = createFakeMailSender();
  return { sender, openSender: async () => sender };
}

describe("committer log events", () => {
  test("committer_actions_held and committer_sends_held log once per process and mailbox with the config key", async () => {
    await withRollback(db, async (trx) => {
      const box = await addBox(trx);
      await addMail(trx, box, { count: 2 });
      await pairOf(trx, box);
      const job = committerFor(trx, box, { scope: { kind: "off" }, sendScope: { kind: "off" } });

      const { entries } = await captured(async () => {
        await job.run();
        await job.run();
      });

      expect(entries).toEqual([
        {
          level: "info",
          event: "committer_actions_held",
          fields: {
            org_id: box.orgId,
            mailbox_id: box.mailboxId,
            count: 2,
            scope: "off",
            config_key: "ACTIONS_SCOPE",
          },
        },
        {
          level: "info",
          event: "committer_sends_held",
          fields: { org_id: box.orgId, mailbox_id: box.mailboxId, count: 1, scope: "off", config_key: "SEND_SCOPE" },
        },
      ]);
    });
  });

  test("committer_stale_expired counts the ready actions older than 24 h", async () => {
    await withRollback(db, async (trx) => {
      const box = await addBox(trx);
      await addMail(trx, box, { count: 2, ageMs: 25 * HOUR });

      const { entries } = await captured(() => committerFor(trx, box).run());

      expect(entries).toEqual([
        {
          level: "warn",
          event: "committer_stale_expired",
          fields: { org_id: box.orgId, mailbox_id: box.mailboxId, count: 2 },
        },
      ]);
    });
  });

  const openFailures: { name: string; error: Error; level: string; event: string; fields: object }[] = [
    {
      name: "a login failure",
      error: new MailAuthError(CANARY.error),
      level: "warn",
      event: "committer_auth_error",
      fields: {},
    },
    {
      name: "a soft error",
      error: new SoftError(CANARY.error),
      level: "warn",
      event: "committer_soft_error",
      fields: { error: "SoftError" },
    },
    {
      name: "another error",
      error: Object.assign(new Error(CANARY.error), { code: "E_TEST" }),
      level: "error",
      event: "committer_open_failed",
      fields: { error: "Error", error_code: "E_TEST" },
    },
  ];
  for (const failure of openFailures) {
    test(`${failure.name} while the provider opens logs ${failure.event} with ids and the error name only`, async () => {
      await withRollback(db, async (trx) => {
        const box = await addBox(trx);
        await addMail(trx, box);
        const job = committerFor(trx, box, {
          openProvider: async () => {
            throw failure.error;
          },
        });

        const { entries } = await captured(() => job.run());

        expect(entries).toEqual([
          {
            level: failure.level,
            event: failure.event,
            fields: { org_id: box.orgId, mailbox_id: box.mailboxId, ...failure.fields },
          },
        ]);
        const status = await trx
          .selectFrom("mailboxes")
          .select("status")
          .where("id", "=", box.mailboxId)
          .executeTakeFirstOrThrow();
        expect(status.status).toBe(failure.event === "committer_auth_error" ? "auth_error" : "active");
      });
    });
  }

  test("a login failure during the apply logs committer_auth_error once and releases the rest of the batch", async () => {
    await withRollback(db, async (trx) => {
      const box = await addBox(trx);
      await addMail(trx, box, { count: 2 });
      box.fake.failOn("setFlags", new MailAuthError(CANARY.error));

      const { entries } = await captured(() => committerFor(trx, box).run());

      expect(entries).toEqual([
        { level: "warn", event: "committer_auth_error", fields: { org_id: box.orgId, mailbox_id: box.mailboxId } },
      ]);
    });
  });

  test("committer_done carries the five counts; a send adds sent, a refused send adds failed", async () => {
    await withRollback(db, async (trx) => {
      const box = await addBox(trx);
      const smtp = senderOpener();
      await pairOf(trx, box);
      const ids = { org_id: box.orgId, mailbox_id: box.mailboxId };

      const sent = await captured(() =>
        committerFor(trx, box, { openSender: smtp.openSender, sendScope: { kind: "all" } }).run()
      );
      expect(sent.entries).toEqual([
        {
          level: "info",
          event: "committer_done",
          fields: { ...ids, applied: 1, failed: 0, retry: 0, closed: 0, sent: 1 },
        },
      ]);
      expect(smtp.sender.sent).toHaveLength(1);

      // The first run closed its sender: the second run opens a new one.
      const second = await pairOf(trx, box);
      const refusing = senderOpener();
      refusing.sender.failNext(
        new SmtpSendError("envelope", "EENVELOPE", 550, true, false, { cause: new Error(CANARY.reply) })
      );
      const refused = await captured(() =>
        committerFor(trx, box, { openSender: refusing.openSender, sendScope: { kind: "all" } }).run()
      );
      expect(refused.entries).toEqual([
        {
          level: "info",
          event: "committer_done",
          // `applied` 1: the reverse row that the first send left for its draft.
          fields: { ...ids, applied: 1, failed: 1, retry: 0, closed: 0, sent: 0 },
        },
      ]);
      const row = await trx
        .selectFrom("actions")
        .select("status")
        .where("id", "=", second.sendId)
        .executeTakeFirstOrThrow();
      expect(row.status).toBe("failed");
    });
  });

  test("committer_folders_failed and committer_release_failed: error names only, the batch is not applied", async () => {
    await withRollback(db, async (trx) => {
      const box = await addBox(trx);
      await addMail(trx, box);
      await trx
        .updateTable("actions")
        .set({ type: "move", payload: { folder: "ai_info" } })
        .execute();

      const { entries } = await captured(() =>
        committerFor(trx, box, { db: breakable(trx, { folders: true }).db }).run()
      );

      const ids = { org_id: box.orgId, mailbox_id: box.mailboxId };
      expect(entries).toEqual([
        { level: "error", event: "committer_folders_failed", fields: { ...ids, error: "Error" } },
        { level: "error", event: "committer_release_failed", fields: { ...ids, error: "Error" } },
      ]);
    });
  });

  test("committer_facts_failed and committer_release_failed: error names only", async () => {
    await withRollback(db, async (trx) => {
      const box = await addBox(trx);
      await pairOf(trx, box);

      const { entries } = await captured(() =>
        committerFor(trx, box, {
          db: breakable(trx, { facts: true }).db,
          openSender: senderOpener().openSender,
          sendScope: { kind: "all" },
        }).run()
      );

      const ids = { org_id: box.orgId, mailbox_id: box.mailboxId };
      expect(entries).toEqual([
        { level: "error", event: "committer_facts_failed", fields: { ...ids, error: "Error" } },
        { level: "error", event: "committer_release_failed", fields: { ...ids, error: "Error" } },
      ]);
    });
  });

  test("a throw in the batch logs committer_release_failed, then committer_failed from the run loop", async () => {
    await withRollback(db, async (trx) => {
      const box = await addBox(trx);
      await addMail(trx, box, { count: 2 });
      const broken = breakable(trx, {});

      const { entries } = await captured(() =>
        committerFor(trx, box, {
          db: broken.db,
          // The claim is done when the provider opens: from here every update of `actions` fails.
          openProvider: async () => {
            broken.state.actions = true;
            return box.fake;
          },
        }).run()
      );

      const ids = { org_id: box.orgId, mailbox_id: box.mailboxId };
      expect(entries).toEqual([
        { level: "error", event: "committer_release_failed", fields: { ...ids, error: "Error" } },
        { level: "error", event: "committer_failed", fields: { ...ids, error: "Error" } },
      ]);
    });
  });

  test("committer_close_failed: a failing close logs the error name only", async () => {
    await withRollback(db, async (trx) => {
      const box = await addBox(trx);
      await addMail(trx, box);
      box.fake.close = () => Promise.reject(Object.assign(new Error(CANARY.error), { code: 421 }));

      const { entries } = await captured(() => committerFor(trx, box).run());

      const ids = { org_id: box.orgId, mailbox_id: box.mailboxId };
      expect(entries.map((entry) => entry.event)).toEqual(["committer_done", "committer_close_failed"]);
      expect(entries[1]).toEqual({
        level: "warn",
        event: "committer_close_failed",
        fields: { ...ids, error: "Error", error_code: 421 },
      });
    });
  });
});

describe("expiry log events", () => {
  const waiting = (trx: Transaction<DB>, box: Box, opts: Parameters<typeof insertDraftAndSend>[3] = {}) =>
    insertDraftAndSend(trx, { orgId: box.orgId }, box.mailboxId, {
      delegationId: randomUUID(),
      draftProviderResult: { folder: "Drafts", uid: 7 },
      createdAt: new Date(NOW.getTime() - 24 * HOUR),
      notifiedAt: new Date(NOW.getTime() - 49 * HOUR),
      requestSent: true,
      to: CANARY.recipient,
      subject: CANARY.subject,
      bodyText: CANARY.body,
      task: CANARY.body,
      ...opts,
    });
  const expiryFor = (trx: Transaction<DB>, listExpired?: typeof listExpiredApprovals) =>
    createExpiryJob({ db: trx, now: () => NOW, hooks: noDelegationHooks, uidplus: async () => true, listExpired });

  test("expiry_done carries the total and the five counts", async () => {
    await withRollback(db, async (trx) => {
      const box = await addBox(trx);
      await waiting(trx, box);

      const { entries: all } = await captured(() => expiryFor(trx).run());

      const entries = all.filter((entry) => entry.fields.mailbox_id === box.mailboxId);
      expect(entries).toEqual([
        {
          level: "info",
          event: "expiry_done",
          fields: {
            org_id: box.orgId,
            mailbox_id: box.mailboxId,
            count: 1,
            expired_timeout: 1,
            expired_draft_missing: 0,
            expired_not_notified: 0,
            expired_not_seen: 0,
            expired_held_timeout: 0,
          },
        },
      ]);
    });
  });

  test("expiry_failed logs the error name only; the next mailbox still runs", async () => {
    await withRollback(db, async (trx) => {
      const box = await addBox(trx);
      await waiting(trx, box);

      // The job walks every mailbox of the database: only the mailbox of this test fails.
      const { entries } = await captured(() =>
        expiryFor(trx, (dbOrTrx, ctx, mailboxId, opts) => {
          if (mailboxId !== box.mailboxId) return listExpiredApprovals(dbOrTrx, ctx, mailboxId, opts);
          throw Object.assign(new Error(CANARY.error), { code: "E_TEST" });
        }).run()
      );

      expect(entries).toEqual([
        {
          level: "error",
          event: "expiry_failed",
          fields: { org_id: box.orgId, mailbox_id: box.mailboxId, error: "Error", error_code: "E_TEST" },
        },
      ]);
    });
  });

  test("draft_reverse_missing logs the draft id when an applied draft has no folder", async () => {
    await withRollback(db, async (trx) => {
      const box = await addBox(trx);
      const pair = await waiting(trx, box, { draftProviderResult: { uid: 7 } });

      const { entries: all } = await captured(() => expiryFor(trx).run());

      const entries = all.filter(
        (entry) => entry.fields.mailbox_id === box.mailboxId || entry.fields.action_id === pair.draftId
      );
      expect(entries[0]).toEqual({
        level: "warn",
        event: "draft_reverse_missing",
        fields: { action_id: pair.draftId },
      });
      expect(entries.map((entry) => entry.event)).toEqual(["draft_reverse_missing", "expiry_done"]);
    });
  });
});
