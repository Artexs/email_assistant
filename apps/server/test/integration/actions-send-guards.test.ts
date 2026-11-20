import { afterAll, describe, expect, test } from "bun:test";

import { applySend, sendOutcomeOf } from "../../src/modules/actions";
import { SEND_SOFT_CAP_MS } from "../../src/modules/actions/constants";
import { MailAuthError } from "../../src/modules/mail";
import { type FakeMailSender } from "../../src/modules/mail/fake/sender";

import {
  NOW,
  at,
  DELEGATION_ID,
  setup,
  recordingHooks,
  depsOf,
  claimWhere,
  claimOne,
  pair,
  row,
  reverses,
  applyOnce,
  smtp,
} from "./actions-send-helpers";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("applySend", () => {
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

  test("(8b) an auth error with a reason carries the reason in the outcome", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await pair(trx, s);
      s.sender.failNext(new MailAuthError("login", { reason: "protocol_disabled" }));

      expect(await applyOnce(trx, s, p.sendId)).toEqual({ kind: "auth_error", reason: "protocol_disabled" });
      expect(await row(trx, p.sendId)).toMatchObject({ status: "approved", locked_at: null });
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
      expect((await row(trx, p.sendId)).next_attempt_at).toEqual(at(5));
    });
  });

  test("a claimed send whose draft is no longer applied is released as approved with no count (P1 re-check)", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await pair(trx, s);
      const action = await claimOne(trx, s, p.sendId);
      await trx.updateTable("actions").set({ status: "ready" }).where("id", "=", p.draftId).execute();

      expect(await applySend(depsOf(s, trx), s.ctx, action, s.fake)).toEqual({ kind: "retry", soft: false });

      expect(await row(trx, p.sendId)).toMatchObject({ status: "approved", attempts: 0, locked_at: null });
      expect(s.sender.calls).toEqual([]);
    });
  });

  test("the row is committed as applying with the outgoing id before the SMTP call", async () => {
    const created = await db.transaction().execute((trx) => setup(trx));
    try {
      const p = await db.transaction().execute((trx) => pair(trx, created));
      const claimed = await db.transaction().execute((trx) => claimOne(trx, created, p.sendId));
      let seen: Awaited<ReturnType<typeof row>> | undefined;
      const sender = {
        ...created.sender,
        send: async (input: Parameters<FakeMailSender["send"]>[0]) => {
          seen = await row(db, p.sendId);
          return created.sender.send(input);
        },
      };

      expect(await applySend(depsOf(created, db, NOW, { sender }), created.ctx, claimed, created.fake)).toEqual({
        kind: "applied",
      });

      expect(seen).toMatchObject({ status: "applying" });
      expect(seen?.outgoing_message_id).toMatch(/^<.+>$/);
      expect(seen?.send_started_at).toEqual(NOW);
      expect(created.sender.sent).toHaveLength(1);
    } finally {
      await db.deleteFrom("organizations").where("id", "=", created.ctx.orgId).execute();
      await db.deleteFrom("users").where("id", "=", created.userId).execute();
    }
  });

  test("(12) sendOutcomeOf maps every error", () => {
    expect(sendOutcomeOf(new MailAuthError("x"), 0)).toEqual({ kind: "auth_error" });
    expect(sendOutcomeOf(new MailAuthError("x", { reason: "oauth_revoked" }), 0)).toEqual({
      kind: "auth_error",
      reason: "oauth_revoked",
    });
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
    expect(sendOutcomeOf(smtp("envelope", "EENVELOPE", 450, false, true), 0, SEND_SOFT_CAP_MS - 1)).toEqual({
      kind: "retry",
      soft: true,
      count: false,
    });
    expect(sendOutcomeOf(smtp("connect", "ECONNECTION", null, false, true), 0, SEND_SOFT_CAP_MS)).toEqual({
      kind: "failed",
      reason: "smtp_error",
      capped: true,
    });
    expect(sendOutcomeOf(smtp("connect", "ETLS", null, false, false), 0, SEND_SOFT_CAP_MS)).toEqual({
      kind: "retry",
      soft: false,
      count: true,
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
