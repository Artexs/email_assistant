import { randomBytes, randomUUID } from "node:crypto";
import { format } from "node:util";

import { MINUTE_MS, HOUR_MS, DAY_MS } from "@ea/core";
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
import { HardError, SoftError } from "../../src/platform/errors";
import { logFormatFromEnv, setLogFormat, setLogLevel } from "../../src/platform/log";

import { createOrgWithMailbox, insertDraftAndSend, insertTriagedWithActions, pauseOtherMailboxes } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// One test per event of `committer.ts` and `expiry.ts`. Each runs the job with canary values that must
// not reach a log line (a recipient, a subject, a draft text, an SMTP reply, an error text with an address).

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

afterEach(() => {
  setLogLevel("info");
  setLogFormat(logFormatFromEnv(process.env));
});

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
// fields. Every line must be JSON.
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
      if (!["error", "error_code", "config_key", "code"].includes(key)) expect(String(value)).not.toMatch(/[A-Z]{3}/);
    }
  }
  return { lines, entries };
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

// A mail with a canary subject and sender, delivered to the fake INBOX (unless `inFake` is false), with `count` flag
// actions or the actions of `types`.
async function addMail(
  trx: Transaction<DB>,
  box: Box,
  opts: {
    count?: number;
    ageMs?: number;
    types?: ("save_summary" | "mark_read" | "flag" | "move")[];
    inFake?: boolean;
  } = {}
) {
  const receivedAt = new Date(NOW.getTime() - (opts.ageMs ?? HOUR_MS));
  const messageId = `<${randomUUID()}@x.test>`;
  const delivered = opts.inFake !== false;
  const uid = delivered
    ? box.fake.deliver(
        "INBOX",
        { messageId, from: CANARY.recipient, to: [box.address], subject: CANARY.subject, date: receivedAt },
        { internalDate: receivedAt }
      )
    : 999;
  const meta = delivered ? await box.fake.fetchMetaIn("INBOX", uid) : null;
  return insertTriagedWithActions(trx, { orgId: box.orgId }, box.mailboxId, {
    category: "info",
    createdAt: receivedAt,
    receivedAt,
    from: CANARY.recipient,
    subject: CANARY.subject,
    messageId,
    uid,
    contentHash: meta === null ? "h" : contentHash(meta),
    actions: (opts.types ?? Array.from({ length: opts.count ?? 1 }, () => "flag" as const)).map((type) => ({
      type,
      status: "ready",
      ...(type === "move" ? { payload: { folder: "ai_info" } } : {}),
    })),
  });
}

function pairOf(trx: Transaction<DB>, box: Box, opts: Parameters<typeof insertDraftAndSend>[3] = {}) {
  return insertDraftAndSend(trx, { orgId: box.orgId }, box.mailboxId, {
    createdAt: new Date(NOW.getTime() - 30 * MINUTE_MS),
    draftStatus: "applied",
    draftProviderResult: { uid: 1, folder: "Drafts" },
    sendStatus: "approved",
    approved: { userId: box.userId, at: new Date(NOW.getTime() - MINUTE_MS) },
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
      await addMail(trx, box, { count: 2, ageMs: 25 * HOUR_MS });

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
      const first = await pairOf(trx, box);
      const ids = { org_id: box.orgId, mailbox_id: box.mailboxId };

      const sent = await captured(() =>
        committerFor(trx, box, { openSender: smtp.openSender, sendScope: { kind: "all" } }).run()
      );
      expect(sent.entries).toEqual([
        { level: "debug", event: "action_applied", fields: { action_id: first.sendId, action_type: "send" } },
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
      // The reverse row of the first send and the refused send run in one batch; their order is not fixed.
      expect(refused.entries.map((entry) => entry.event).sort()).toEqual([
        "action_reversed",
        "committer_done",
        "send_failed",
      ]);
      expect(refused.entries.find((entry) => entry.event === "send_failed")).toEqual({
        level: "warn",
        event: "send_failed",
        fields: { action_id: second.sendId, reason: "smtp_rejected", send_stage: "envelope", code: 550 },
      });
      expect(refused.entries.at(-1)).toEqual({
        level: "info",
        event: "committer_done",
        // `applied` 1: the reverse row that the first send left for its draft.
        fields: { ...ids, applied: 1, failed: 1, retry: 0, closed: 0, sent: 0 },
      });
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
      expect(entries.map((entry) => entry.event)).toEqual([
        "action_applied",
        "committer_done",
        "committer_close_failed",
      ]);
      expect(entries[2]).toEqual({
        level: "warn",
        event: "committer_close_failed",
        fields: { ...ids, error: "Error", error_code: 421 },
      });
    });
  });
});

describe("apply log events in a committer run", () => {
  test("action_applied carries the action id and the type of a summary, a mark_read and a move", async () => {
    await withRollback(db, async (trx) => {
      const box = await addBox(trx);
      const mail = await addMail(trx, box, { types: ["save_summary", "mark_read", "move"] });

      const { entries } = await captured(() => committerFor(trx, box).run());

      expect(entries.map((entry) => entry.event)).toEqual([
        "action_applied",
        "action_applied",
        "action_applied",
        "committer_done",
      ]);
      const applied = entries.slice(0, 3).map((entry) => entry.fields);
      expect(applied).toHaveLength(3);
      for (const [index, type] of (["save_summary", "mark_read", "move"] as const).entries()) {
        expect(applied).toContainEqual({ action_id: mail.actionIds[index], action_type: type });
      }
      expect(entries.slice(0, 3).every((entry) => entry.level === "debug")).toBe(true);
    });
  });

  test("action_failed with the reason mail_not_found for a mail that is not on the server", async () => {
    await withRollback(db, async (trx) => {
      const box = await addBox(trx);
      const mail = await addMail(trx, box, { inFake: false });

      const { entries } = await captured(() => committerFor(trx, box).run());

      expect(entries[0]).toEqual({
        level: "warn",
        event: "action_failed",
        fields: { action_id: mail.actionIds[0], reason: "mail_not_found" },
      });
    });
  });

  test("action_retry for a soft and a hard error, then action_failed hard_error: names and counts only", async () => {
    await withRollback(db, async (trx) => {
      const box = await addBox(trx);
      const mail = await addMail(trx, box);
      const actionId = mail.actionIds[0] as string;
      const retry = (attempts: number, error: string, code?: string) => ({
        level: "warn",
        event: "action_retry",
        fields: {
          action_id: actionId,
          attempts,
          max_attempts: 3,
          error,
          ...(code === undefined ? {} : { error_code: code }),
        },
      });

      // A soft error does not count a try: the next run shows try 1 again.
      box.fake.failOn("setFlags", new SoftError(CANARY.error));
      const soft = await captured(() => committerFor(trx, box).run());
      expect(soft.entries[0]).toEqual(retry(1, "SoftError"));

      // Three hard errors with a code: the third fails the action.
      const hardError = () => Object.assign(new HardError(CANARY.error), { code: "EBOOM" });
      const seen = [];
      for (let attempt = 0; attempt < 3; attempt += 1) {
        box.fake.failOn("setFlags", hardError());
        await trx
          .updateTable("actions")
          .set({ next_attempt_at: null, locked_at: null })
          .where("id", "=", actionId)
          .execute();
        seen.push(...(await captured(() => committerFor(trx, box).run())).entries.slice(0, 1));
      }
      expect(seen).toEqual([
        retry(1, "HardError", "EBOOM"),
        retry(2, "HardError", "EBOOM"),
        { level: "warn", event: "action_failed", fields: { action_id: actionId, reason: "hard_error" } },
      ]);
    });
  });
});

describe("committer log events with a nodemailer-shaped error", () => {
  // nodemailer puts the server reply in `response`, the status in `responseCode` and the SMTP command (with the
  // recipient) in `command`. `util.format` prints all own fields of an error that is logged raw.
  const smtpError = () =>
    Object.assign(new Error(`Mail command failed: ${CANARY.reply}`), {
      code: "EENVELOPE",
      response: CANARY.reply,
      responseCode: 550,
      command: `RCPT TO:<${CANARY.recipient}> SUBJECT ${CANARY.subject}`,
    });

  test("at open, at send and at close no line holds the reply, the recipient or the subject", async () => {
    await withRollback(db, async (trx) => {
      const box = await addBox(trx);
      await pairOf(trx, box);
      const ids = { org_id: box.orgId, mailbox_id: box.mailboxId };

      // At open: the sender cannot open.
      const opened = await captured(() =>
        committerFor(trx, box, {
          openSender: async () => {
            throw smtpError();
          },
          sendScope: { kind: "all" },
        }).run()
      );
      expect(opened.entries).toEqual([
        {
          level: "error",
          event: "committer_open_failed",
          fields: { ...ids, error: "Error", error_code: "EENVELOPE" },
        },
      ]);

      // At send: the server refuses the mail; at close: the connection close fails.
      const smtp = senderOpener();
      smtp.sender.failNext(smtpError());
      smtp.sender.close = () => Promise.reject(smtpError());
      const sent = await captured(() =>
        committerFor(trx, box, { openSender: smtp.openSender, sendScope: { kind: "all" } }).run()
      );
      // The send fails with an error that is not an SmtpSendError: the outcome is unknown, the code is the provider code.
      expect(sent.entries.map((entry) => entry.event)).toEqual([
        "send_failed",
        "committer_done",
        "committer_close_failed",
      ]);
      expect(sent.entries[2]).toEqual({
        level: "warn",
        event: "committer_close_failed",
        fields: { ...ids, error: "Error", error_code: "EENVELOPE" },
      });
    });
  });
});

describe("expiry log events", () => {
  const waiting = (trx: Transaction<DB>, box: Box, opts: Parameters<typeof insertDraftAndSend>[3] = {}) =>
    insertDraftAndSend(trx, { orgId: box.orgId }, box.mailboxId, {
      delegationId: randomUUID(),
      draftProviderResult: { folder: "Drafts", uid: 7 },
      createdAt: new Date(NOW.getTime() - DAY_MS),
      notifiedAt: new Date(NOW.getTime() - 49 * HOUR_MS),
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

  test("expiry_done.count is the total of two reasons in one mailbox, not the timeout count", async () => {
    await withRollback(db, async (trx) => {
      const box = await addBox(trx);
      await waiting(trx, box);
      await waiting(trx, box, {
        sendStatus: "approved",
        approved: { userId: box.userId, at: new Date(NOW.getTime() - 49 * HOUR_MS) },
        lockedAt: null,
      });

      const { entries: all } = await captured(() => expiryFor(trx).run());

      expect(all.filter((entry) => entry.fields.mailbox_id === box.mailboxId)).toEqual([
        {
          level: "info",
          event: "expiry_done",
          fields: {
            org_id: box.orgId,
            mailbox_id: box.mailboxId,
            count: 2,
            expired_timeout: 1,
            expired_draft_missing: 0,
            expired_not_notified: 0,
            expired_not_seen: 0,
            expired_held_timeout: 1,
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
