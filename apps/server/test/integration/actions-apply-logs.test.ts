import { randomUUID } from "node:crypto";
import { format } from "node:util";

import { MINUTE_MS, HOUR_MS } from "@ea/core";
import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import type { Transaction } from "kysely";

import {
  applyAction,
  applyDraft,
  applySend,
  claimActions,
  createFolderResolver,
  HARD_ERROR_TRIES,
  noDelegationHooks,
  releaseActions,
  type ApplyDeps,
  type ClaimedAction,
} from "../../src/modules/actions";
import { buildDraftMessage } from "../../src/modules/actions/drafts";
import { composeMessage, SmtpSendError } from "../../src/modules/mail";
import { createFakeMailProvider, type FakeMailProvider } from "../../src/modules/mail/fake";
import { createFakeMailSender, type FakeMailSender } from "../../src/modules/mail/fake/sender";
import type { DB, Db, TenantContext } from "../../src/platform/db";
import { HardError, SoftError } from "../../src/platform/errors";
import { logFormatFromEnv, setLogFormat, setLogLevel } from "../../src/platform/log";

import {
  createOrgWithMailbox,
  insertAction,
  insertDraftAndSend,
  insertTriagedWithActions,
  pauseOtherMailboxes,
} from "./fixtures";
import { testDb, withRollback } from "./helpers";

// One test per event of `drafts.ts` and `send.ts` (and `action_no_provider` of `apply.ts`). Each runs the
// code with canary values that must not reach a log line: a recipient, a subject, a draft text, a task, an SMTP reply
// and an error text with an address. The events of `apply.ts` that a committer run writes are in
// `actions-committer-logs.test.ts`.

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

afterEach(() => {
  setLogLevel("info");
  setLogFormat(logFormatFromEnv(process.env));
});

const NOW = new Date("2026-11-20T10:00:00Z");
const CREATED = new Date(NOW.getTime() - HOUR_MS);
const at = (minutes: number): Date => new Date(NOW.getTime() + minutes * MINUTE_MS);
const run = randomUUID();
const CANARY = {
  recipient: `canary-recipient-${run}@x.test`,
  subject: `CANARY-SUBJECT-${run}`,
  body: `CANARY-DRAFT-${run}`,
  task: `CANARY-TASK-${run}`,
  reply: `550 5.1.1 canary-reply-${run}@x.test unknown`,
  error: `CANARY-ERROR-${run} canary-error-${run}@x.test`,
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface Entry {
  level: string;
  event: string;
  fields: Record<string, unknown>;
}

// Runs `body` in JSON format at debug level with the console spies. `format()` shows an error object that was logged
// raw with its fields. Every line must be JSON, must hold no canary, and must have no dropped field; every `_id` is a
// lower-case UUID.
async function captured(body: () => Promise<unknown>): Promise<Entry[]> {
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
  for (const marker of [...Object.values(CANARY), "CANARY", "canary-", "@x.test", "SMTP send failed"]) {
    for (const line of lines) expect(line).not.toContain(marker);
  }
  return lines.map((line): Entry => {
    const { level, event, time, module, msg, ...fields } = JSON.parse(line) as Record<string, unknown>;
    void time;
    void module;
    void msg;
    expect(fields).not.toHaveProperty("dropped_fields");
    for (const [key, value] of Object.entries(fields)) {
      if (key.endsWith("_id")) expect(String(value)).toMatch(UUID);
      // Values are lower-case codes, ids and numbers; only the error name and the provider codes differ.
      if (!["error", "error_code", "code"].includes(key)) expect(String(value)).not.toMatch(/[A-Z]{3}/);
    }
    return { level: level as string, event: event as string, fields };
  });
}

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
  await pauseOtherMailboxes(trx);
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

function depsOf(s: Setup, trx: Db | Transaction<DB>, time: Date = NOW, over: Partial<ApplyDeps> = {}): ApplyDeps {
  const folders = createFolderResolver(
    { db: trx, now: () => time, provider: s.fake, mailboxId: s.mailboxId, folderMap: s.folderMap },
    s.ctx
  );
  return {
    db: trx,
    now: () => time,
    mailboxId: s.mailboxId,
    folders,
    mailbox: { address: s.address, capabilities: { uidplus: true }, folderMap: s.folderMap },
    owner: { displayName: "Owner" },
    organization: { styleText: null, timezone: "Europe/Warsaw" },
    compose: composeMessage,
    sender: s.sender,
    hooks: noDelegationHooks,
    appendFolders: new Set(),
    ...over,
  };
}

async function claimOne(trx: Transaction<DB>, s: Setup, id: string, time: Date = NOW): Promise<ClaimedAction> {
  const claimed = await claimActions(trx, s.ctx, s.mailboxId, {
    now: time,
    limit: 20,
    staleBefore: new Date(time.getTime() - 10 * MINUTE_MS),
    filter: { mailbox: { kind: "all" }, send: { kind: "all" } },
  });
  const action = claimed.find((row) => row.id === id);
  if (action === undefined) throw new Error("the action was not claimed");
  return action;
}

type PairOptions = NonNullable<Parameters<typeof insertDraftAndSend>[3]>;

// A mail with canary texts, its draft and its send. The fake `Drafts` holds the draft message (the bytes of the APPEND).
async function pair(trx: Transaction<DB>, s: Setup, opts: PairOptions = {}) {
  // A draft that is not applied yet: the rows are as given and nothing is in the fake Drafts folder.
  const unapplied = opts.draftStatus !== undefined && opts.draftStatus !== "applied";
  const { sendStatus, ...rest } = opts;
  const ids = await insertDraftAndSend(trx, s.ctx, s.mailboxId, {
    createdAt: CREATED,
    draftStatus: "applied",
    draftProviderResult: { uid: 1, folder: "Drafts" },
    sendStatus: "approved",
    approved: { userId: s.userId, at: at(-1) },
    to: CANARY.recipient,
    subject: CANARY.subject,
    bodyText: CANARY.body,
    task: CANARY.task,
    ...rest,
    ...(unapplied && sendStatus !== undefined ? { sendStatus } : {}),
  });
  if (unapplied) return { ...ids, draftRaw: Buffer.alloc(0) };
  const claimed = await claimOne(trx, s, ids.sendId);
  const draft = await trx.selectFrom("actions").selectAll().where("id", "=", ids.draftId).executeTakeFirstOrThrow();
  const draftRaw = await composeMessage(
    buildDraftMessage(depsOf(s, trx), {
      ...claimed,
      id: draft.id,
      created_at: draft.created_at,
      payload: draft.payload as Record<string, unknown>,
    })
  );
  await s.fake.appendMessage("Drafts", draftRaw, ["\\Draft"], CREATED);
  await releaseActions(trx, s.ctx, [ids.sendId], NOW, NOW);
  if (sendStatus !== undefined) {
    await trx.updateTable("actions").set({ status: sendStatus }).where("id", "=", ids.sendId).execute();
  }
  return { ...ids, draftRaw };
}

const smtp = (
  stage: SmtpSendError["stage"],
  code: string,
  responseCode: number | null,
  permanent: boolean,
  soft: boolean
) => new SmtpSendError(stage, code, responseCode, permanent, soft, { cause: new Error(CANARY.reply) });

// nodemailer puts the server reply in `response` and the SMTP command (with the recipient) in `command`.
const nodemailerError = (code?: string) =>
  Object.assign(new Error(`Mail command failed: ${CANARY.reply}`), {
    ...(code === undefined ? {} : { code }),
    response: CANARY.reply,
    responseCode: 550,
    command: `RCPT TO:<${CANARY.recipient}> SUBJECT ${CANARY.subject}`,
  });

const sendOnce = async (trx: Transaction<DB>, s: Setup, id: string, time: Date = NOW, over: Partial<ApplyDeps> = {}) =>
  applySend(depsOf(s, trx, time, over), s.ctx, await claimOne(trx, s, id, time), s.fake);

describe("draft log events", () => {
  test("action_applied (create_draft) and action_reversed (the reverse row) carry the action id and type", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await pair(trx, s, { draftStatus: "ready", sendStatus: "awaiting_approval" });
      const draft = await claimOne(trx, s, p.draftId);

      const applied = await captured(() => applyDraft(depsOf(s, trx), s.ctx, draft, s.fake));
      expect(applied).toEqual([
        { level: "debug", event: "action_applied", fields: { action_id: p.draftId, action_type: "create_draft" } },
      ]);

      const row = await trx
        .selectFrom("actions")
        .select("provider_result")
        .where("id", "=", p.draftId)
        .executeTakeFirst();
      const uid = (row?.provider_result as { uid: number }).uid;
      const reverseId = await insertAction(trx, s.ctx, p.emailId, {
        type: "create_draft",
        status: "ready",
        payload: { kind: "delegation", folder: "Drafts", uid, reason: "sent" },
        reversesActionId: p.draftId,
        idempotencyKey: `${p.draftId}:undo`,
        createdAt: at(1),
      });
      const reverse = await claimOne(trx, s, reverseId, at(2));
      const reversed = await captured(() => applyAction(depsOf(s, trx, at(2)), s.ctx, reverse, s.fake));
      expect(reversed).toEqual([
        { level: "debug", event: "action_reversed", fields: { action_id: reverseId, action_type: "create_draft" } },
      ]);
    });
  });

  test("action_retry (soft) and action_retry then action_failed (three hard errors) hold names and counts only", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await pair(trx, s, { draftStatus: "ready", sendStatus: "awaiting_approval" });
      s.fake.failOn("appendMessage", new SoftError(CANARY.error));
      const soft = await captured(async () =>
        applyDraft(depsOf(s, trx), s.ctx, await claimOne(trx, s, p.draftId), s.fake)
      );
      expect(soft).toEqual([
        {
          level: "warn",
          event: "action_retry",
          fields: { action_id: p.draftId, attempts: 1, max_attempts: HARD_ERROR_TRIES, error: "SoftError" },
        },
      ]);

      // A hard error with a code: three tries, the third fails the draft.
      s.fake.failOn("appendMessage", Object.assign(new HardError(CANARY.error), { code: "EBOOM" }), 3);
      const hard: Entry[] = [];
      for (let i = 0; i < 3; i += 1) {
        const time = at(6 * (i + 1));
        hard.push(
          ...(await captured(async () =>
            applyDraft(depsOf(s, trx, time), s.ctx, await claimOne(trx, s, p.draftId, time), s.fake)
          ))
        );
      }
      expect(hard).toEqual([
        {
          level: "warn",
          event: "action_retry",
          fields: { action_id: p.draftId, attempts: 1, max_attempts: 3, error: "HardError", error_code: "EBOOM" },
        },
        {
          level: "warn",
          event: "action_retry",
          fields: { action_id: p.draftId, attempts: 2, max_attempts: 3, error: "HardError", error_code: "EBOOM" },
        },
        { level: "warn", event: "action_failed", fields: { action_id: p.draftId, reason: "hard_error" } },
      ]);
    });
  });

  test("action_failed with the reason bad_payload for a draft with a broken payload", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await pair(trx, s, { draftStatus: "ready", sendStatus: "awaiting_approval" });
      await trx
        .updateTable("actions")
        .set({ payload: JSON.stringify({ kind: "nope", note: CANARY.body }) })
        .where("id", "=", p.draftId)
        .execute();
      const action = await claimOne(trx, s, p.draftId);

      const entries = await captured(() => applyDraft(depsOf(s, trx), s.ctx, action, s.fake));

      expect(entries).toEqual([
        { level: "warn", event: "action_failed", fields: { action_id: p.draftId, reason: "bad_payload" } },
      ]);
    });
  });

  test("action_closed when the send of the draft ended before the APPEND", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await pair(trx, s, { draftStatus: "applying", sendStatus: "rejected" });
      const action = await claimOne(trx, s, p.draftId);

      const entries = await captured(() => applyDraft(depsOf(s, trx), s.ctx, action, s.fake));

      expect(entries).toEqual([
        {
          level: "info",
          event: "action_closed",
          fields: { action_id: p.draftId, action_type: "create_draft", reason: "send_closed" },
        },
      ]);
    });
  });
});

describe("send log events", () => {
  test("action_applied (send): the action id and the type; the Sent copy that works adds no line", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await pair(trx, s);

      const entries = await captured(() => sendOnce(trx, s, p.sendId));

      expect(entries).toEqual([
        { level: "debug", event: "action_applied", fields: { action_id: p.sendId, action_type: "send" } },
      ]);
      expect(s.sender.sent).toHaveLength(1);
    });
  });

  test("send_copy_failed holds the error name and code of a Sent APPEND that fails", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await pair(trx, s);
      s.fake.failOn("appendMessage", nodemailerError("EAPPEND"));

      const entries = await captured(() => sendOnce(trx, s, p.sendId));

      expect(entries.map((entry) => entry.event)).toEqual(["action_applied", "send_copy_failed"]);
      expect(entries[1]).toEqual({
        level: "warn",
        event: "send_copy_failed",
        fields: { action_id: p.sendId, error: "Error", error_code: "EAPPEND" },
      });
    });
  });

  test("send_retry (stage and code): a soft error and a 4xx reply, with the SMTP reply in the error cause", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await pair(trx, s);
      s.sender.failNext(smtp("connect", "ECONNECTION", null, false, true));
      const connect = await captured(() => sendOnce(trx, s, p.sendId));
      expect(connect).toEqual([
        {
          level: "warn",
          event: "send_retry",
          fields: { action_id: p.sendId, send_stage: "connect", code: "ECONNECTION" },
        },
      ]);

      // A reply number wins over the nodemailer code.
      s.sender.failNext(smtp("envelope", "EENVELOPE", 451, false, true));
      const reply = await captured(() => sendOnce(trx, s, p.sendId, at(6)));
      expect(reply).toEqual([
        {
          level: "warn",
          event: "send_retry",
          fields: { action_id: p.sendId, send_stage: "envelope", code: 451 },
        },
      ]);
      expect(s.sender.sent).toHaveLength(0);
    });
  });

  test("send_failed holds the reason, the stage and the response number; no SMTP reply text", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await pair(trx, s);
      s.sender.failNext(smtp("envelope", "EENVELOPE", 550, true, false));

      const entries = await captured(() => sendOnce(trx, s, p.sendId));

      expect(entries).toEqual([
        {
          level: "warn",
          event: "send_failed",
          fields: { action_id: p.sendId, reason: "smtp_rejected", send_stage: "envelope", code: 550 },
        },
      ]);
    });
  });

  test("send_failed for an error that is not an SmtpSendError: the provider code, or no code at all", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const withCode = await pair(trx, s);
      s.sender.failNext(nodemailerError("ECONNRESET"));
      const first = await captured(() => sendOnce(trx, s, withCode.sendId));
      expect(first).toEqual([
        {
          level: "warn",
          event: "send_failed",
          fields: { action_id: withCode.sendId, reason: "outcome_unknown", send_stage: "unknown", code: "ECONNRESET" },
        },
      ]);

      const noCode = await pair(trx, s, { messageId: `<${randomUUID()}@x.test>` });
      s.sender.failNext(nodemailerError());
      const second = await captured(() => sendOnce(trx, s, noCode.sendId));
      expect(second).toEqual([
        {
          level: "warn",
          event: "send_failed",
          fields: { action_id: noCode.sendId, reason: "outcome_unknown", send_stage: "unknown" },
        },
      ]);
    });
  });

  test("send_retry then send_failed (stage compose) when the compose fails three times; the error text stays out", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await pair(trx, s);
      const compose = async () => {
        throw Object.assign(new Error(CANARY.error), { code: "ECOMPOSE" });
      };
      const entries: Entry[] = [];
      for (let i = 0; i < 3; i += 1) {
        const time = at(6 * (i + 1));
        entries.push(...(await captured(() => sendOnce(trx, s, p.sendId, time, { compose }))));
      }
      expect(entries).toEqual([
        {
          level: "warn",
          event: "send_retry",
          fields: { action_id: p.sendId, attempts: 1, max_attempts: 3, error: "Error", error_code: "ECOMPOSE" },
        },
        {
          level: "warn",
          event: "send_retry",
          fields: { action_id: p.sendId, attempts: 2, max_attempts: 3, error: "Error", error_code: "ECOMPOSE" },
        },
        {
          level: "warn",
          event: "send_failed",
          fields: { action_id: p.sendId, reason: "smtp_error", send_stage: "compose" },
        },
      ]);
      expect(s.sender.sent).toHaveLength(0);
    });
  });

  test("send_failed with the stage payload for a send with a bad payload", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await pair(trx, s);
      await trx
        .updateTable("actions")
        .set({ payload: JSON.stringify({ to: CANARY.recipient }) })
        .where("id", "=", p.sendId)
        .execute();

      const entries = await captured(() => sendOnce(trx, s, p.sendId));

      expect(entries).toEqual([
        {
          level: "warn",
          event: "send_failed",
          fields: { action_id: p.sendId, reason: "bad_payload", send_stage: "payload" },
        },
      ]);
    });
  });

  test("send_no_sender and send_waits_for_draft: the row goes back unchanged and the line holds the action id only", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await pair(trx, s);

      const noSender = await captured(() => sendOnce(trx, s, p.sendId, NOW, { sender: null }));
      expect(noSender).toEqual([{ level: "error", event: "send_no_sender", fields: { action_id: p.sendId } }]);

      // The draft stops being applied after the claim.
      const claimed = await claimOne(trx, s, p.sendId, at(6));
      await trx.updateTable("actions").set({ status: "ready" }).where("id", "=", p.draftId).execute();
      const waits = await captured(() => applySend(depsOf(s, trx, at(6)), s.ctx, claimed, s.fake));
      expect(waits).toEqual([{ level: "warn", event: "send_waits_for_draft", fields: { action_id: p.sendId } }]);
      expect(s.sender.sent).toHaveLength(0);
    });
  });

  test("send_recovery_retry and send_recovered for a send that was left applying", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await pair(trx, s);
      const afterSend = () => {
        throw new Error(CANARY.error);
      };
      await expect(sendOnce(trx, s, p.sendId, NOW, { afterSend })).rejects.toThrow("CANARY-ERROR");

      s.fake.failOn("searchSinceIn", Object.assign(new HardError(CANARY.error), { code: 421 }));
      const retry = await captured(() => sendOnce(trx, s, p.sendId, at(11)));
      expect(retry).toEqual([
        {
          level: "warn",
          event: "send_recovery_retry",
          fields: { action_id: p.sendId, attempts: 1, max_attempts: 3, error: "HardError", error_code: 421 },
        },
      ]);

      // A copy in Sent proves the send.
      await s.fake.appendMessage("Sent", p.draftRaw, ["\\Seen"], NOW);
      const recovered = await captured(() => sendOnce(trx, s, p.sendId, at(17)));
      expect(recovered).toEqual([{ level: "debug", event: "send_recovered", fields: { action_id: p.sendId } }]);
    });
  });
});

describe("apply log events", () => {
  test("action_no_provider: an action that needs the mail server and gets no provider", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const mail = await insertTriagedWithActions(trx, s.ctx, s.mailboxId, {
        category: "info",
        createdAt: new Date(NOW.getTime() - HOUR_MS),
        receivedAt: new Date(NOW.getTime() - HOUR_MS),
        from: CANARY.recipient,
        subject: CANARY.subject,
        actions: [{ type: "flag", status: "ready" }],
      });
      const action = await claimOne(trx, s, mail.actionIds[0] as string);

      const entries = await captured(() => applyAction(depsOf(s, trx), s.ctx, action, null));

      expect(entries).toEqual([
        { level: "error", event: "action_no_provider", fields: { action_id: action.id, action_type: "flag" } },
      ]);
    });
  });
});
