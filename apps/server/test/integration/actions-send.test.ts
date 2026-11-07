import { randomBytes } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import {
  applySend,
  approve,
  claimActions,
  countClaimable,
  createCommitterJob,
  createFolderResolver,
  noDelegationHooks,
  releaseActions,
  sendOutcomeOf,
  type ApplyDeps,
  type ClaimedAction,
  type DelegationHooks,
} from "../../src/modules/actions";
import { buildDraftMessage } from "../../src/modules/actions/drafts";
import { getMailboxSettings, insertDefaultSettings } from "../../src/modules/config";
import { delegationHooks } from "../../src/modules/delegation";
import { composeMessage, MailAuthError, SmtpSendError } from "../../src/modules/mail";
import { createFakeMailProvider, type FakeMailProvider } from "../../src/modules/mail/fake";
import { createFakeMailSender, type FakeMailSender } from "../../src/modules/mail/fake/sender";
import { claimEmails, insertCredentials } from "../../src/modules/mail/repo";
import { triageOne, type TriageMailbox } from "../../src/modules/triage";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB, Db, TenantContext } from "../../src/platform/db";
import { HardError, SoftError } from "../../src/platform/errors";
import type { LlmClient } from "../../src/platform/llm";

import {
  createOrgWithMailbox,
  insertDelegate,
  insertDraftAndSend,
  insertTestEmail,
  pauseOtherMailboxes,
} from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const NOW = new Date("2026-11-07T12:00:00Z");
const CREATED = new Date("2026-11-07T11:00:00Z");
const at = (minutes: number): Date => new Date(NOW.getTime() + minutes * MINUTE);
const DELEGATION_ID = "11111111-1111-4111-8111-111111111111";
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

interface Recorded {
  sent: { delegationId: string; sentMessageId: string; sentAt: Date; dueAtWhenNull: Date }[];
  reminders: { delegationId: string; at: Date }[];
  cancelled: { delegationId: string; reason: string; at: Date }[];
}

function recordingHooks(): { hooks: DelegationHooks; calls: Recorded } {
  const calls: Recorded = { sent: [], reminders: [], cancelled: [] };
  const hooks: DelegationHooks = {
    ...noDelegationHooks,
    onSent: async (_trx, _ctx, input) => {
      calls.sent.push(input);
      return true;
    },
    onReminderSent: async (_trx, _ctx, input) => {
      calls.reminders.push(input);
      return true;
    },
    onCancelled: async (_trx, _ctx, input) => {
      calls.cancelled.push(input);
      return true;
    },
  };
  return { hooks, calls };
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
    ...over,
  };
}

const claimWhere = (trx: Transaction<DB>, s: Setup, time: Date) =>
  claimActions(trx, s.ctx, s.mailboxId, {
    now: time,
    limit: 20,
    staleBefore: new Date(time.getTime() - 10 * MINUTE),
    filter: { mailbox: { kind: "all" }, send: { kind: "all" } },
  });

async function claimOne(trx: Transaction<DB>, s: Setup, id: string, time: Date = NOW): Promise<ClaimedAction> {
  const action = (await claimWhere(trx, s, time)).find((row) => row.id === id);
  if (action === undefined) throw new Error("the action was not claimed");
  return action;
}

type PairOpts = Parameters<typeof insertDraftAndSend>[3];

// An approved send with an applied draft; the fake `Drafts` holds the draft message (the bytes of the draft APPEND).
async function pair(trx: Transaction<DB>, s: Setup, { sendStatus, ...opts }: NonNullable<PairOpts> = {}) {
  const ids = await insertDraftAndSend(trx, s.ctx, s.mailboxId, {
    createdAt: CREATED,
    draftStatus: "applied",
    draftProviderResult: { uid: 1, folder: "Drafts" },
    sendStatus: "approved",
    approved: { userId: s.userId, at: at(-1) },
    delegationId: DELEGATION_ID,
    ...opts,
  });
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
  // The draft message needs a claimable send: the wanted status comes after.
  if (sendStatus !== undefined) {
    const unapproved = sendStatus === "awaiting_approval" || sendStatus === "rejected";
    await trx
      .updateTable("actions")
      .set({ status: sendStatus, ...(unapproved ? { approved_at: null, approved_by: null, approved_via: null } : {}) })
      .where("id", "=", ids.sendId)
      .execute();
  }
  return { ...ids, draftRaw };
}

async function row(trx: Db | Transaction<DB>, id: string) {
  return trx.selectFrom("actions").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

async function auditOf(trx: Db | Transaction<DB>, actionId: string) {
  const rows = await trx
    .selectFrom("audit_log")
    .selectAll()
    .where("action_id", "=", actionId)
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  for (const entry of rows) {
    expect(entry.action_id).not.toBeNull();
    expect(entry.email_id).not.toBeNull();
  }
  return rows;
}

async function reverses(trx: Db | Transaction<DB>, draftId: string) {
  return trx.selectFrom("actions").selectAll().where("reverses_action_id", "=", draftId).execute();
}

async function applyOnce(trx: Transaction<DB>, s: Setup, id: string, time: Date = NOW, over: Partial<ApplyDeps> = {}) {
  const action = await claimOne(trx, s, id, time);
  return applySend(depsOf(s, trx, time, over), s.ctx, action, s.fake);
}

const smtp = (
  stage: SmtpSendError["stage"],
  code: string,
  responseCode: number | null,
  permanent: boolean,
  soft: boolean
) => new SmtpSendError(stage, code, responseCode, permanent, soft);

async function sentFolderCount(s: Setup): Promise<number> {
  return (await s.fake.searchSinceIn("Sent", new Date(CREATED.getTime() - DAY))).length;
}

describe("applySend", () => {
  test("(1) the happy path: one send of the draft's bytes, applied at once, the Sent copy, the reverse row", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const { hooks, calls } = recordingHooks();
      const p = await pair(trx, s);

      expect(await applyOnce(trx, s, p.sendId, NOW, { hooks })).toEqual({ kind: "applied" });

      const payload = (await row(trx, p.sendId)).payload as { to: string[] };
      expect(s.sender.sent).toHaveLength(1);
      expect(s.sender.sent[0]?.envelope).toEqual({ from: s.address, to: payload.to });
      expect(s.sender.sent[0]?.raw.equals(p.draftRaw)).toBe(true);

      const send = await row(trx, p.sendId);
      expect(send.status).toBe("applied");
      expect(send.locked_at).toBeNull();
      expect(send.result_notified_at).toBeNull();
      expect(send.outgoing_message_id).toMatch(new RegExp(`^<ea-${p.draftId}@`));
      expect(send.provider_result).toEqual({
        response: "250 2.0.0 Ok: queued as FAKE",
        accepted: 1,
        message_id: send.outgoing_message_id,
        sent_copy: "appended",
      });
      expect((await auditOf(trx, p.sendId)).map((entry) => entry.event)).toEqual(["action.applying", "action.applied"]);
      expect(calls.sent).toEqual([
        {
          delegationId: DELEGATION_ID,
          sentMessageId: send.outgoing_message_id as string,
          sentAt: NOW,
          dueAtWhenNull: new Date(NOW.getTime() + 3 * DAY),
        },
      ]);
      expect(calls.reminders).toEqual([]);
      expect(calls.cancelled).toEqual([]);

      const reverse = await reverses(trx, p.draftId);
      expect(reverse).toHaveLength(1);
      expect(reverse[0]).toMatchObject({
        type: "create_draft",
        status: "ready",
        payload: { kind: "delegation", folder: "Drafts", uid: 1, reason: "sent" },
      });

      const [uid] = await s.fake.searchSinceIn("Sent", new Date(CREATED.getTime() - DAY));
      const copy = await s.fake.fetchMetaIn("Sent", uid as number);
      expect(copy?.actionId).toBe(p.draftId);
      expect(copy?.flags).toContain("\\Seen");
      expect(await sentFolderCount(s)).toBe(1);
    });
  });

  test("(1b) a crash before the Sent copy leaves the row applied with sent_copy pending, one send", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await pair(trx, s);
      const beforeSentCopy = () => {
        throw new Error("crash");
      };

      await expect(applyOnce(trx, s, p.sendId, NOW, { beforeSentCopy })).rejects.toThrow("crash");

      const send = await row(trx, p.sendId);
      expect(send.status).toBe("applied");
      expect(send.provider_result).toMatchObject({ sent_copy: "pending" });
      expect(s.sender.sent).toHaveLength(1);
      expect(await sentFolderCount(s)).toBe(0);
    });
  });

  test("(2) a copy already in Sent is found, no second APPEND", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await pair(trx, s);
      await s.fake.appendMessage("Sent", p.draftRaw, ["\\Seen"], NOW);
      const appends = s.fake.calls.filter((call) => call === "appendMessage").length;

      expect(await applyOnce(trx, s, p.sendId)).toEqual({ kind: "applied" });

      expect((await row(trx, p.sendId)).provider_result).toMatchObject({ sent_copy: "found" });
      expect(s.fake.calls.filter((call) => call === "appendMessage").length).toBe(appends);
      expect(await sentFolderCount(s)).toBe(1);
    });
  });

  test("(3) a failed Sent APPEND leaves the row applied with sent_copy failed and an audit row", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await pair(trx, s);
      s.fake.failOn("appendMessage", new HardError("no"));

      expect(await applyOnce(trx, s, p.sendId)).toEqual({ kind: "applied" });

      const send = await row(trx, p.sendId);
      expect(send.status).toBe("applied");
      expect(send.provider_result).toMatchObject({ sent_copy: "failed" });
      const events = (await auditOf(trx, p.sendId)).map((entry) => entry.event);
      expect(events).toEqual(["action.applying", "action.applied", "action.sent_copy_failed"]);
      expect(s.sender.sent).toHaveLength(1);
    });
  });

  test("(4) a soft connect error retries after 5 min with no count and no second send before then", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await pair(trx, s);
      s.sender.failNext(smtp("connect", "ECONNECTION", null, false, true));

      expect(await applyOnce(trx, s, p.sendId)).toEqual({ kind: "retry", soft: true });

      const send = await row(trx, p.sendId);
      expect(send).toMatchObject({ status: "approved", attempts: 0, last_error: "smtp_ECONNECTION", locked_at: null });
      expect(send.next_attempt_at).toEqual(at(5));
      expect(await claimWhere(trx, s, at(1))).toEqual([]);
      expect(s.sender.sent).toHaveLength(0);

      expect(await applyOnce(trx, s, p.sendId, at(6))).toEqual({ kind: "applied" });
      expect(s.sender.sent).toHaveLength(1);
    });
  });

  test("(5) a permanent envelope error fails the send as smtp_rejected and keeps the draft", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const { hooks, calls } = recordingHooks();
      const p = await pair(trx, s);
      s.sender.failNext(smtp("envelope", "EENVELOPE", 550, true, false));

      expect(await applyOnce(trx, s, p.sendId, NOW, { hooks })).toEqual({ kind: "failed", reason: "smtp_rejected" });

      expect(await row(trx, p.sendId)).toMatchObject({
        status: "failed",
        status_reason: "smtp_rejected",
        last_error: "smtp_550",
        provider_result: { stage: "envelope", response_code: 550, code: "EENVELOPE" },
        result_notified_at: null,
        locked_at: null,
      });
      expect(calls.cancelled).toEqual([{ delegationId: DELEGATION_ID, reason: "send_failed", at: NOW }]);
      expect(await reverses(trx, p.draftId)).toEqual([]);
      expect(await s.fake.fetchMetaIn("Drafts", 1)).not.toBeNull();
      const failed = (await auditOf(trx, p.sendId)).find((entry) => entry.event === "action.failed");
      expect(failed).toMatchObject({ reason_code: "smtp_rejected", data: { stage: "envelope", response_code: 550 } });
    });
  });

  test("(6) a 4xx after the content fails at once as smtp_error, no retry", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await pair(trx, s);
      s.sender.failNext(smtp("content", "EMESSAGE", 451, false, true));

      expect(await applyOnce(trx, s, p.sendId)).toEqual({ kind: "failed", reason: "smtp_error" });

      expect(await row(trx, p.sendId)).toMatchObject({
        status: "failed",
        status_reason: "smtp_error",
        attempts: 0,
        provider_result: { stage: "content", response_code: 451, code: "EMESSAGE" },
      });
      expect(s.sender.calls.filter((call) => call === "send")).toHaveLength(1);
    });
  });

  test("(6b) an unknown error before the content counts three tries, then fails as smtp_error", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await pair(trx, s);
      s.sender.failNext(smtp("envelope", "EPROTOCOL", null, false, false), 3);

      expect(await applyOnce(trx, s, p.sendId, NOW)).toEqual({ kind: "retry", soft: false });
      expect(await row(trx, p.sendId)).toMatchObject({ status: "approved", attempts: 1 });
      expect(await applyOnce(trx, s, p.sendId, at(6))).toEqual({ kind: "retry", soft: false });
      expect(await row(trx, p.sendId)).toMatchObject({ status: "approved", attempts: 2 });
      expect(await applyOnce(trx, s, p.sendId, at(12))).toEqual({ kind: "failed", reason: "smtp_error" });

      expect(await row(trx, p.sendId)).toMatchObject({
        status: "failed",
        status_reason: "smtp_error",
        attempts: 3,
        provider_result: { stage: "envelope", response_code: null, code: "EPROTOCOL" },
      });
      expect(s.sender.sent).toHaveLength(0);
    });
  });

  test("(6c) ETLS and a permanent login error are hard retries", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const one = await pair(trx, s);
      s.sender.failNext(smtp("connect", "ETLS", null, false, false));
      expect(await applyOnce(trx, s, one.sendId)).toEqual({ kind: "retry", soft: false });
      expect(await row(trx, one.sendId)).toMatchObject({ status: "approved", attempts: 1 });

      const two = await pair(trx, s, { messageId: "<other@x.test>" });
      s.sender.failNext(smtp("login", "EPROTOCOL", 554, true, false));
      expect(await applyOnce(trx, s, two.sendId)).toEqual({ kind: "retry", soft: false });
      expect(await row(trx, two.sendId)).toMatchObject({ status: "approved", attempts: 1, last_error: "smtp_554" });
    });
  });

  test("(6d) a compose error three times fails with stage compose and sends nothing", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await pair(trx, s);
      const compose = async (): Promise<Buffer> => {
        throw new Error("boom");
      };

      expect(await applyOnce(trx, s, p.sendId, NOW, { compose })).toEqual({ kind: "retry", soft: false });
      expect(await applyOnce(trx, s, p.sendId, at(6), { compose })).toEqual({ kind: "retry", soft: false });
      expect(await applyOnce(trx, s, p.sendId, at(12), { compose })).toEqual({ kind: "failed", reason: "smtp_error" });

      expect(await row(trx, p.sendId)).toMatchObject({
        status: "failed",
        status_reason: "smtp_error",
        attempts: 3,
        provider_result: { stage: "compose" },
      });
      expect(s.sender.calls).toEqual([]);
    });
  });

  test("(7) an unknown stage fails as outcome_unknown at once with one send and no second claim", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const { hooks, calls } = recordingHooks();
      const p = await pair(trx, s);
      s.sender.failNext(smtp("unknown", "ECONNECTION", null, false, true));

      expect(await applyOnce(trx, s, p.sendId, NOW, { hooks })).toEqual({ kind: "failed", reason: "outcome_unknown" });

      expect(await row(trx, p.sendId)).toMatchObject({
        status: "failed",
        status_reason: "outcome_unknown",
        attempts: 0,
        last_error: "smtp_ECONNECTION",
        provider_result: { stage: "unknown", code: "ECONNECTION" },
        result_notified_at: null,
      });
      expect(calls.cancelled).toEqual([{ delegationId: DELEGATION_ID, reason: "outcome_unknown", at: NOW }]);
      expect(s.sender.calls.filter((call) => call === "send")).toHaveLength(1);
      expect(await claimWhere(trx, s, at(30))).toEqual([]);
    });
  });

  test("(8) an auth error gives the row back as approved and unlocked", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await pair(trx, s);
      s.sender.failNext(new MailAuthError("login"));

      expect(await applyOnce(trx, s, p.sendId)).toEqual({ kind: "auth_error" });

      expect(await row(trx, p.sendId)).toMatchObject({
        status: "approved",
        locked_at: null,
        next_attempt_at: null,
        attempts: 0,
      });
      expect((await claimWhere(trx, s, at(1))).map((claimed) => claimed.id)).toEqual([p.sendId]);
    });
  });

  test("(9) a reminder calls onReminderSent, a clarification calls no hook", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const { hooks, calls } = recordingHooks();
      const reminder = await pair(trx, s, { reminder: 1 });
      expect(await applyOnce(trx, s, reminder.sendId, NOW, { hooks })).toEqual({ kind: "applied" });
      expect(calls.reminders).toEqual([{ delegationId: DELEGATION_ID, at: NOW }]);
      expect(calls.sent).toEqual([]);

      const clarification = await pair(trx, s, { kind: "clarification", delegationId: undefined });
      expect(await applyOnce(trx, s, clarification.sendId, NOW, { hooks })).toEqual({ kind: "applied" });
      expect(calls.reminders).toHaveLength(1);
      expect(calls.sent).toEqual([]);
      expect(calls.cancelled).toEqual([]);
    });
  });

  test("(10) without UIDPLUS the send is applied and no reverse row exists", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await pair(trx, s);
      const action = await claimOne(trx, s, p.sendId);
      const deps = depsOf(s, trx, NOW, {
        mailbox: { address: s.address, capabilities: { uidplus: false }, folderMap: s.folderMap },
      });

      expect(await applySend(deps, s.ctx, action, s.fake)).toEqual({ kind: "applied" });

      expect(await reverses(trx, p.draftId)).toEqual([]);
    });
  });

  test("(11) a wrong locked_at is lost before markApplying and sends nothing", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await pair(trx, s);
      const action = { ...(await claimOne(trx, s, p.sendId)), locked_at: at(-3) };

      expect(await applySend(depsOf(s, trx), s.ctx, action, s.fake)).toEqual({ kind: "lost" });

      expect(s.sender.calls).toEqual([]);
      expect(await row(trx, p.sendId)).toMatchObject({ status: "approved" });
    });
  });

  test("(11b) a bad send payload fails as bad_payload from approved with no send", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const { hooks, calls } = recordingHooks();
      const p = await pair(trx, s);
      const stored = (await row(trx, p.sendId)).payload as Record<string, unknown>;
      await trx
        .updateTable("actions")
        .set({ payload: JSON.stringify({ ...stored, to: [] }) })
        .where("id", "=", p.sendId)
        .execute();

      expect(await applyOnce(trx, s, p.sendId, NOW, { hooks })).toEqual({ kind: "failed", reason: "bad_payload" });

      expect(await row(trx, p.sendId)).toMatchObject({
        status: "failed",
        status_reason: "bad_payload",
        provider_result: { stage: "payload" },
        locked_at: null,
      });
      expect(s.sender.calls).toEqual([]);
      expect(calls.cancelled).toEqual([{ delegationId: DELEGATION_ID, reason: "send_failed", at: NOW }]);
    });
  });

  test("without a sender an approved row is released unchanged with no count", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await pair(trx, s);
      const action = await claimOne(trx, s, p.sendId);

      expect(await applySend(depsOf(s, trx, NOW, { sender: null }), s.ctx, action, s.fake)).toEqual({
        kind: "retry",
        soft: true,
      });

      expect(await row(trx, p.sendId)).toMatchObject({ status: "approved", attempts: 0, locked_at: null });
    });
  });

  test("(12) sendOutcomeOf maps every error", () => {
    expect(sendOutcomeOf(new MailAuthError("x"), 0)).toEqual({ kind: "auth_error" });
    expect(sendOutcomeOf(smtp("connect", "ECONNECTION", null, false, true), 0)).toEqual({
      kind: "retry",
      soft: true,
      count: false,
    });
    expect(sendOutcomeOf(smtp("login", "ETIMEDOUT", null, false, true), 2)).toEqual({
      kind: "retry",
      soft: true,
      count: false,
    });
    expect(sendOutcomeOf(smtp("envelope", "EENVELOPE", 450, false, true), 0)).toEqual({
      kind: "retry",
      soft: true,
      count: false,
    });
    expect(sendOutcomeOf(smtp("envelope", "EENVELOPE", 550, true, false), 0)).toEqual({
      kind: "failed",
      reason: "smtp_rejected",
    });
    expect(sendOutcomeOf(smtp("content", "EMESSAGE", 552, true, false), 0)).toEqual({
      kind: "failed",
      reason: "smtp_rejected",
    });
    expect(sendOutcomeOf(smtp("content", "EMESSAGE", 451, false, true), 0)).toEqual({
      kind: "failed",
      reason: "smtp_error",
    });
    expect(sendOutcomeOf(smtp("connect", "ETLS", null, false, false), 0)).toEqual({
      kind: "retry",
      soft: false,
      count: true,
    });
    expect(sendOutcomeOf(smtp("login", "EPROTOCOL", 554, true, false), 1)).toEqual({
      kind: "retry",
      soft: false,
      count: true,
    });
    expect(sendOutcomeOf(smtp("envelope", "EPROTOCOL", null, false, false), 2)).toEqual({
      kind: "failed",
      reason: "smtp_error",
    });
    expect(sendOutcomeOf(smtp("unknown", "ECONNECTION", null, false, true), 0)).toEqual({
      kind: "failed",
      reason: "outcome_unknown",
    });
    expect(sendOutcomeOf(new Error("odd"), 0)).toEqual({ kind: "failed", reason: "outcome_unknown" });
  });
});

describe("applySend: crashes and the recovery of an applying send", () => {
  test("(15) a crash after the 250 never sends again: the recovery ends outcome_unknown", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const { hooks, calls } = recordingHooks();
      const p = await pair(trx, s);
      const afterSend = () => {
        throw new Error("crash");
      };

      await expect(applyOnce(trx, s, p.sendId, NOW, { afterSend })).rejects.toThrow("crash");
      const crashed = await row(trx, p.sendId);
      expect(crashed.status).toBe("applying");
      expect(crashed.outgoing_message_id).not.toBeNull();
      expect(crashed.locked_at).not.toBeNull();
      expect(s.sender.sent).toHaveLength(1);

      const time = at(11);
      const claimed = await claimOne(trx, s, p.sendId, time);
      expect(claimed.status).toBe("applying");
      expect(await applySend(depsOf(s, trx, time, { hooks, sender: null }), s.ctx, claimed, s.fake)).toEqual({
        kind: "failed",
        reason: "outcome_unknown",
      });

      expect(await row(trx, p.sendId)).toMatchObject({
        status: "failed",
        status_reason: "outcome_unknown",
        last_error: "crash_in_applying",
        provider_result: { stage: "unknown", recovered: true },
        result_notified_at: null,
      });
      expect(calls.cancelled).toEqual([{ delegationId: DELEGATION_ID, reason: "outcome_unknown", at: time }]);
      expect(s.sender.sent).toHaveLength(1);
    });
  });

  test("(16) a copy in Sent proves the send: the recovery ends applied", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const { hooks, calls } = recordingHooks();
      const p = await pair(trx, s);
      const afterSend = () => {
        throw new Error("crash");
      };
      await expect(applyOnce(trx, s, p.sendId, NOW, { afterSend })).rejects.toThrow("crash");
      await s.fake.appendMessage("Sent", p.draftRaw, ["\\Seen"], NOW);

      const time = at(11);
      const claimed = await claimOne(trx, s, p.sendId, time);
      expect(await applySend(depsOf(s, trx, time, { hooks }), s.ctx, claimed, s.fake)).toEqual({ kind: "applied" });

      const send = await row(trx, p.sendId);
      expect(send.status).toBe("applied");
      expect(send.provider_result).toMatchObject({ recovered: true, sent_copy: "found" });
      expect(calls.sent).toHaveLength(1);
      expect(calls.sent[0]?.sentMessageId).toBe(send.outgoing_message_id as string);
      expect(s.sender.sent).toHaveLength(1);
      expect(await reverses(trx, p.draftId)).toHaveLength(1);
    });
  });

  test("(17) a crash before the SMTP call also ends outcome_unknown: a notice, not a resend", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await pair(trx, s);
      const beforeSend = () => {
        throw new Error("crash");
      };
      await expect(applyOnce(trx, s, p.sendId, NOW, { beforeSend })).rejects.toThrow("crash");
      expect((await row(trx, p.sendId)).status).toBe("applying");

      const time = at(11);
      const claimed = await claimOne(trx, s, p.sendId, time);
      expect(await applySend(depsOf(s, trx, time), s.ctx, claimed, s.fake)).toEqual({
        kind: "failed",
        reason: "outcome_unknown",
      });
      expect(s.sender.calls).toEqual([]);
    });
  });

  test("(18) two approval taps and one committer run send once", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const s = await setup(trx);
      const secret = secrets.encrypt("pw", `mailbox:${s.mailboxId}`);
      await insertCredentials(trx, s.ctx, {
        mailboxId: s.mailboxId,
        encryptedSecret: secret.ciphertext,
        secretKind: "password",
        keyVersion: secret.keyVersion,
      });
      const p = await pair(trx, s, { sendStatus: "awaiting_approval", notifiedAt: at(-5) });
      const input = { userId: s.userId, via: "telegram" as const, now: NOW };
      const approvals = { db: trx, hooks: noDelegationHooks, uidplus: async () => true };

      expect(await approve(approvals, s.ctx, p.sendId, input)).toEqual({ kind: "approved" });
      expect((await approve(approvals, s.ctx, p.sendId, input)).kind).toBe("already_approved");
      const job = createCommitterJob({
        db: trx,
        secrets,
        openProvider: async () => s.fake,
        openSender: async () => s.sender,
        scope: { kind: "all", mailboxAddress: s.address },
        sendScope: { kind: "all", mailboxAddress: s.address },
        now: () => NOW,
      });
      await job.run();
      await job.run();

      expect(s.sender.sent).toHaveLength(1);
      expect((await row(trx, p.sendId)).status).toBe("applied");
    });
  });

  test("(19) an expired or rejected send is never claimed", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await pair(trx, s, { sendStatus: "expired" });
      await pair(trx, s, { sendStatus: "rejected", messageId: "<r@x.test>" });

      expect(await claimWhere(trx, s, NOW)).toEqual([]);
      const counts = await countClaimable(trx, s.ctx, s.mailboxId, {
        now: NOW,
        staleBefore: at(-10),
        filter: { mailbox: { kind: "all" }, send: { kind: "all" } },
      });
      expect(counts.sending).toBe(0);
    });
  });

  test("(23) an error inside the recovery keeps the row applying and never resends", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const { hooks } = recordingHooks();
      const p = await pair(trx, s);
      const afterSend = () => {
        throw new Error("crash");
      };
      await expect(applyOnce(trx, s, p.sendId, NOW, { afterSend })).rejects.toThrow("crash");

      s.fake.failOn("searchSinceIn", new HardError("down"), 3);
      let time = at(11);
      expect(await applyOnce(trx, s, p.sendId, time, { hooks })).toEqual({ kind: "retry", soft: false });
      expect(await row(trx, p.sendId)).toMatchObject({ status: "applying", locked_at: null, attempts: 1 });

      time = at(17);
      expect(await applyOnce(trx, s, p.sendId, time, { hooks })).toEqual({ kind: "retry", soft: false });
      expect(await row(trx, p.sendId)).toMatchObject({ status: "applying", attempts: 2 });
      time = at(23);
      expect(await applyOnce(trx, s, p.sendId, time, { hooks })).toEqual({ kind: "failed", reason: "outcome_unknown" });
      expect(await row(trx, p.sendId)).toMatchObject({
        status: "failed",
        status_reason: "outcome_unknown",
        attempts: 3,
      });
      expect(s.sender.sent).toHaveLength(1);
    });
  });

  test("(23b) a soft error inside the recovery keeps the row applying with no count", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await pair(trx, s);
      const afterSend = () => {
        throw new Error("crash");
      };
      await expect(applyOnce(trx, s, p.sendId, NOW, { afterSend })).rejects.toThrow("crash");

      s.fake.failOn("searchSinceIn", new SoftError("slow"));
      expect(await applyOnce(trx, s, p.sendId, at(11))).toEqual({ kind: "retry", soft: true });

      expect(await row(trx, p.sendId)).toMatchObject({ status: "applying", attempts: 0, locked_at: null });
      expect(s.sender.sent).toHaveLength(1);
    });
  });
});

// (14) The whole chain with the real code: triage plans the pair and the delegation, the committer writes the draft, the
// approval service approves, the committer sends, the delegate's reply answers the delegation.
function fakeLlm(answer: Record<string, unknown>): LlmClient {
  return {
    classifierModel: "fake-model",
    async classify(req: { schema: { parse(value: unknown): unknown } }) {
      return {
        data: req.schema.parse(answer),
        usage: { model: "fake-model", tokensIn: 100, tokensOut: 20, latencyMs: 300 },
      };
    },
  } as unknown as LlmClient;
}

const pause = {
  trip: (_kind: string, _code: string, time: Date) => new Date(time.getTime() + 5 * MINUTE),
  isPaused: () => false,
  reset: () => undefined,
};

const analysisOf = (overrides: Record<string, unknown>) => ({
  category: "info",
  confidence: 0.95,
  reason_code: "newsletter",
  reason: "r",
  summary: "short summary",
  fields: { due_date: null, language: "en", delegate_id: null, task: null, clarification: null },
  ...overrides,
});

describe("send end to end", () => {
  test("(14) triage, draft, approval, send, the delegation is sent, the reply answers it", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const s = await setup(trx);
      const secret = secrets.encrypt("pw", `mailbox:${s.mailboxId}`);
      await insertCredentials(trx, s.ctx, {
        mailboxId: s.mailboxId,
        encryptedSecret: secret.ciphertext,
        secretKind: "password",
        keyVersion: secret.keyVersion,
      });
      await insertDefaultSettings(trx, s.ctx, s.mailboxId);
      const settings = await getMailboxSettings(trx, s.ctx, s.mailboxId);
      if (settings === undefined) throw new Error("no settings");
      const delegateId = await insertDelegate(trx, s.ctx, { name: "Anna", email: "anna@firma.test", tags: ["offers"] });
      const mailbox: TriageMailbox = {
        id: s.mailboxId,
        settingsVersion: settings.version,
        mode: "assist",
        toolSwitches: { move: true, mark_read: true, flag: true, create_draft: true, move_unsure: true },
        policy: { info: { auto: true } },
        rules: [],
        movesSupported: true,
        delegates: [{ id: delegateId, name: "Anna", email: "anna@firma.test", tags: ["offers"] }],
        timezone: "Europe/Warsaw",
      };
      const claimMail = async (time: Date) =>
        claimEmails(trx, s.ctx, s.mailboxId, {
          now: time,
          limit: 10,
          staleBefore: new Date(time.getTime() - 5 * MINUTE),
          syntheticOnly: false,
        });
      const triageDeps = (answer: Record<string, unknown>) => ({
        db: trx,
        llm: fakeLlm(answer),
        pause,
        dailyCap: 1000,
        now: () => NOW,
      });

      const emailId = await insertTestEmail(trx, s.ctx, s.mailboxId, {
        from_address: "jan@klient.test",
        subject: "Offer",
        body_text: "Please prepare the offer.",
        message_id_header: "<orig@klient.test>",
        received_at: CREATED,
      });
      const [email] = await claimMail(NOW);
      const delegationAnswer = analysisOf({
        category: "delegation",
        summary: null,
        reason_code: "direct_request",
        fields: {
          due_date: "2026-11-10",
          language: "en",
          delegate_id: delegateId,
          task: "Prepare the offer",
          clarification: null,
        },
      });
      expect(await triageOne(triageDeps(delegationAnswer), s.ctx, mailbox, email as NonNullable<typeof email>)).toEqual(
        {
          kind: "triaged",
        }
      );

      const job = createCommitterJob({
        db: trx,
        secrets,
        openProvider: async () => s.fake,
        openSender: async () => s.sender,
        scope: { kind: "all", mailboxAddress: s.address },
        sendScope: { kind: "all", mailboxAddress: s.address },
        hooks: delegationHooks({ db }),
        now: () => NOW,
      });
      await job.run();

      const actions = await trx.selectFrom("actions").selectAll().where("email_id", "=", emailId).execute();
      const draft = actions.find((a) => a.type === "create_draft" && a.reverses_action_id === null);
      const send = actions.find((a) => a.type === "send");
      expect(draft?.status).toBe("applied");
      expect(send?.status).toBe("awaiting_approval");
      expect(s.sender.sent).toHaveLength(0);

      await trx
        .updateTable("actions")
        .set({ notified_at: NOW })
        .where("id", "=", send?.id as string)
        .execute();
      const approvals = { db: trx, hooks: delegationHooks({ db }), uidplus: async () => true };
      expect(
        await approve(approvals, s.ctx, send?.id as string, { userId: s.userId, via: "telegram", now: NOW })
      ).toEqual({ kind: "approved" });
      await job.run();

      expect(s.sender.sent).toHaveLength(1);
      const sentRow = await row(trx, send?.id as string);
      expect(sentRow.status).toBe("applied");
      const delegation = await trx
        .selectFrom("delegations")
        .selectAll()
        .where("email_id", "=", emailId)
        .executeTakeFirstOrThrow();
      expect(delegation.status).toBe("sent");
      expect(delegation.sent_message_id).toBe(sentRow.outgoing_message_id);
      expect(delegation.due_at).not.toBeNull();

      const replyId = await insertTestEmail(trx, s.ctx, s.mailboxId, {
        from_address: "anna@firma.test",
        in_reply_to: sentRow.outgoing_message_id,
        received_at: at(1),
      });
      const [reply] = await claimMail(at(1));
      expect(reply?.id).toBe(replyId);
      expect(await triageOne(triageDeps(analysisOf({})), s.ctx, mailbox, reply as NonNullable<typeof reply>)).toEqual({
        kind: "triaged",
      });
      const answered = await trx
        .selectFrom("delegations")
        .select(["status", "answered_email_id"])
        .where("id", "=", delegation.id)
        .executeTakeFirstOrThrow();
      expect(answered).toEqual({ status: "answered", answered_email_id: replyId });
    });
  });
});
