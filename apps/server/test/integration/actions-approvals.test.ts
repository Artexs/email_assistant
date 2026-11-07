import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import {
  approve,
  approveSet,
  countApprovals,
  listExpiredApprovals,
  listSendResultsToNotify,
  listSendsToNotify,
  listSetsToNotify,
  markResultNotified,
  noDelegationHooks,
  reject,
  rejectSet,
  sendAgain,
  type ApprovalDeps,
  type DelegationHooks,
} from "../../src/modules/actions";
import type { DB, TenantContext } from "../../src/platform/db";

import { addMember, createOrgWithMailbox, insertDraftAndSend } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const NOW = new Date("2026-11-07T12:00:00Z");
const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

function recordingHooks() {
  const calls: { delegationId: string; reason: string; at: Date }[] = [];
  const hooks: DelegationHooks = {
    ...noDelegationHooks,
    onCancelled: async (_trx, _ctx, input) => {
      calls.push(input);
      return true;
    },
  };
  return { hooks, calls };
}

function depsOf(trx: Transaction<DB>, hooks: DelegationHooks, uidplus = true): ApprovalDeps {
  return { db: trx, hooks, uidplus: async () => uidplus };
}

async function setup(trx: Transaction<DB>) {
  const org = await createOrgWithMailbox(trx);
  return { ...org, ctx: { orgId: org.orgId } as TenantContext };
}

type PairOpts = Parameters<typeof insertDraftAndSend>[3];

// A draft and a send; the default draft result lets `closeDraftOfSend` build a reverse row.
function pair(trx: Transaction<DB>, s: Awaited<ReturnType<typeof setup>>, opts: PairOpts = {}) {
  return insertDraftAndSend(trx, s.ctx, s.mailboxId, {
    createdAt: ago(HOUR),
    notifiedAt: ago(30 * MINUTE),
    draftProviderResult: { folder: "Drafts", uid: 7 },
    ...opts,
  });
}

async function row(trx: Transaction<DB>, id: string) {
  return trx.selectFrom("actions").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

async function auditRows(trx: Transaction<DB>, ctx: TenantContext, event: string) {
  return trx.selectFrom("audit_log").selectAll().where("org_id", "=", ctx.orgId).where("event", "=", event).execute();
}

async function reverseRows(trx: Transaction<DB>, draftId: string) {
  return trx.selectFrom("actions").selectAll().where("reverses_action_id", "=", draftId).execute();
}

const input = (userId: string, via: "telegram" | "cli" = "telegram") => ({ userId, via, now: NOW });

describe("approve", () => {
  test("awaiting_approval → approved with the approval fields and an audit row; a second tap → already_approved", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const other = await addMember(trx, s.orgId, "owner");
      const p = await pair(trx, s);
      const { hooks } = recordingHooks();

      expect(await approve(depsOf(trx, hooks), s.ctx, p.sendId, input(s.userId))).toEqual({ kind: "approved" });
      const send = await row(trx, p.sendId);
      expect(send).toMatchObject({ status: "approved", approved_by: s.userId, approved_via: "telegram" });
      expect(send.approved_at?.getTime()).toBe(NOW.getTime());
      const audit = await auditRows(trx, s.ctx, "action.approved");
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        action_id: p.sendId,
        email_id: p.emailId,
        actor: s.userId,
        data: { via: "telegram" },
      });

      const again = await approve(depsOf(trx, hooks), s.ctx, p.sendId, input(other, "cli"));
      expect(again).toEqual({ kind: "already_approved", at: NOW, byUserId: s.userId });
      expect(await auditRows(trx, s.ctx, "action.approved")).toHaveLength(1);
    });
  });

  test("a notified request older than 48 h is expired on the spot, never approved", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const delegationId = randomUUID();
      const p = await pair(trx, s, { notifiedAt: ago(49 * HOUR), delegationId });
      const { hooks, calls } = recordingHooks();

      expect(await approve(depsOf(trx, hooks), s.ctx, p.sendId, input(s.userId))).toEqual({ kind: "expired" });
      const send = await row(trx, p.sendId);
      expect(send).toMatchObject({ status: "expired", status_reason: "timeout", approved_by: null });
      const reverses = await reverseRows(trx, p.draftId);
      expect(reverses).toHaveLength(1);
      expect(reverses[0]).toMatchObject({ type: "create_draft", status: "ready" });
      expect(calls).toEqual([{ delegationId, reason: "expired", at: NOW }]);
      expect(await auditRows(trx, s.ctx, "action.approved")).toHaveLength(0);
    });
  });

  test("the other states, and not_found for a random id and for another organization", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const b = await setup(trx);
      const { hooks } = recordingHooks();
      const approvedBy = { userId: s.userId, at: ago(HOUR) };
      const run = (id: string, ctx = s.ctx) => approve(depsOf(trx, hooks), ctx, id, input(s.userId));

      const applied = await pair(trx, s, { sendStatus: "applied", approved: approvedBy });
      expect(await run(applied.sendId)).toEqual({ kind: "sent" });
      const applying = await pair(trx, s, { sendStatus: "applying", approved: approvedBy, lockedAt: ago(MINUTE) });
      expect(await run(applying.sendId)).toEqual({ kind: "sending" });
      const fresh = await pair(trx, s, { sendStatus: "approved", approved: approvedBy, lockedAt: ago(MINUTE) });
      expect(await run(fresh.sendId)).toEqual({ kind: "sending" });
      const stale = await pair(trx, s, { sendStatus: "approved", approved: approvedBy, lockedAt: ago(11 * MINUTE) });
      expect(await run(stale.sendId)).toEqual({ kind: "already_approved", at: approvedBy.at, byUserId: s.userId });
      const rejected = await pair(trx, s, { sendStatus: "rejected" });
      expect(await run(rejected.sendId)).toEqual({ kind: "rejected" });
      const expired = await pair(trx, s, { sendStatus: "expired" });
      expect(await run(expired.sendId)).toEqual({ kind: "expired" });
      const failed = await pair(trx, s, { sendStatus: "failed" });
      await trx
        .updateTable("actions")
        .set({ status_reason: "smtp_rejected" })
        .where("id", "=", failed.sendId)
        .execute();
      expect(await run(failed.sendId)).toEqual({ kind: "failed", reason: "smtp_rejected" });

      expect(await run(randomUUID())).toEqual({ kind: "not_found" });
      expect(await run(rejected.sendId, b.ctx)).toEqual({ kind: "not_found" });
    });
  });
});

describe("reject", () => {
  test("awaiting_approval with an applied draft → rejected, a reverse draft row, the delegation cancelled", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const delegationId = randomUUID();
      const p = await pair(trx, s, { delegationId });
      const { hooks, calls } = recordingHooks();

      expect(await reject(depsOf(trx, hooks), s.ctx, p.sendId, input(s.userId))).toEqual({ kind: "rejected" });
      const send = await row(trx, p.sendId);
      expect(send).toMatchObject({ status: "rejected", status_reason: "rejected", result_notified_at: null });
      const audit = await auditRows(trx, s.ctx, "action.rejected");
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ action_id: p.sendId, actor: s.userId });
      const reverses = await reverseRows(trx, p.draftId);
      expect(reverses).toHaveLength(1);
      expect(reverses[0]).toMatchObject({
        type: "create_draft",
        status: "ready",
        payload: { kind: "delegation", folder: "Drafts", uid: 7, reason: "rejected" },
      });
      expect(calls).toEqual([{ delegationId, reason: "rejected", at: NOW }]);
    });
  });

  test("no delegation hook for a clarification or a reminder send", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const { hooks, calls } = recordingHooks();
      const clarification = await pair(trx, s, { kind: "clarification" });
      const reminder = await pair(trx, s, { reminder: 1, delegationId: randomUUID() });

      expect(await reject(depsOf(trx, hooks), s.ctx, clarification.sendId, input(s.userId))).toEqual({
        kind: "rejected",
      });
      expect(await reject(depsOf(trx, hooks), s.ctx, reminder.sendId, input(s.userId))).toEqual({ kind: "rejected" });
      expect(calls).toEqual([]);
    });
  });

  test("no UIDPLUS: no reverse row; a ready draft is expired", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const { hooks } = recordingHooks();
      const noUid = await pair(trx, s);
      expect(await reject(depsOf(trx, hooks, false), s.ctx, noUid.sendId, input(s.userId))).toEqual({
        kind: "rejected",
      });
      expect(await reverseRows(trx, noUid.draftId)).toEqual([]);

      const readyDraft = await pair(trx, s, { draftStatus: "ready", draftProviderResult: undefined });
      expect(await reject(depsOf(trx, hooks), s.ctx, readyDraft.sendId, input(s.userId))).toEqual({
        kind: "rejected",
      });
      expect(await row(trx, readyDraft.draftId)).toMatchObject({ status: "expired", status_reason: "send_closed" });
      expect(await reverseRows(trx, readyDraft.draftId)).toEqual([]);
    });
  });

  test("an approved send: rejected when unlocked or stale, already when a run holds it", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const { hooks } = recordingHooks();
      const approved = { userId: s.userId, at: ago(HOUR) };
      const run = (id: string) => reject(depsOf(trx, hooks), s.ctx, id, input(s.userId));

      const free = await pair(trx, s, { sendStatus: "approved", approved });
      expect(await run(free.sendId)).toEqual({ kind: "rejected" });
      const held = await pair(trx, s, { sendStatus: "approved", approved, lockedAt: ago(MINUTE) });
      expect(await run(held.sendId)).toEqual({ kind: "already", status: "approved" });
      expect((await row(trx, held.sendId)).status).toBe("approved");
      const stale = await pair(trx, s, { sendStatus: "approved", approved, lockedAt: ago(11 * MINUTE) });
      expect(await run(stale.sendId)).toEqual({ kind: "rejected" });

      const done = await pair(trx, s, { sendStatus: "applied", approved });
      expect(await run(done.sendId)).toEqual({ kind: "already", status: "applied" });
      expect(await run(randomUUID())).toEqual({ kind: "not_found" });
    });
  });
});

describe("approveSet and rejectSet", () => {
  test("approveSet approves the notified awaiting rows and skips the rest", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const { hooks } = recordingHooks();
      const setId = randomUUID();
      const one = await pair(trx, s, { setId, reminder: 1, delegationId: randomUUID() });
      const two = await pair(trx, s, { setId, reminder: 1, delegationId: randomUUID() });
      const gone = await pair(trx, s, { setId, reminder: 1, delegationId: randomUUID(), sendStatus: "rejected" });
      const unnotified = await pair(trx, s, {
        setId,
        reminder: 1,
        delegationId: randomUUID(),
        draftStatus: "failed",
        notifiedAt: null,
      });

      expect(await approveSet(depsOf(trx, hooks), s.ctx, setId, input(s.userId))).toEqual({ approved: 2, skipped: 2 });
      expect((await row(trx, one.sendId)).status).toBe("approved");
      expect((await row(trx, two.sendId)).status).toBe("approved");
      expect((await row(trx, gone.sendId)).status).toBe("rejected");
      expect((await row(trx, unnotified.sendId)).status).toBe("awaiting_approval");
      expect(await auditRows(trx, s.ctx, "action.approved")).toHaveLength(2);
    });
  });

  test("rejectSet rejects the notified awaiting rows and skips the rest", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const { hooks } = recordingHooks();
      const setId = randomUUID();
      const one = await pair(trx, s, { setId, reminder: 1, delegationId: randomUUID() });
      const two = await pair(trx, s, { setId, reminder: 1, delegationId: randomUUID() });
      const gone = await pair(trx, s, { setId, reminder: 1, delegationId: randomUUID(), sendStatus: "expired" });
      const unnotified = await pair(trx, s, {
        setId,
        reminder: 1,
        delegationId: randomUUID(),
        draftStatus: "failed",
        notifiedAt: null,
      });

      expect(await rejectSet(depsOf(trx, hooks), s.ctx, setId, input(s.userId))).toEqual({ rejected: 2, skipped: 2 });
      expect((await row(trx, one.sendId)).status).toBe("rejected");
      expect((await row(trx, two.sendId)).status).toBe("rejected");
      expect((await row(trx, gone.sendId)).status).toBe("expired");
      expect((await row(trx, unnotified.sendId)).status).toBe("awaiting_approval");
      expect(await auditRows(trx, s.ctx, "action.rejected")).toHaveLength(2);
      expect(await reverseRows(trx, one.draftId)).toHaveLength(1);
    });
  });

  test("approveSet applies the 48 h limit per row", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const { hooks } = recordingHooks();
      const setId = randomUUID();
      const old = await pair(trx, s, { setId, reminder: 1, delegationId: randomUUID(), notifiedAt: ago(49 * HOUR) });
      const fresh = await pair(trx, s, { setId, reminder: 1, delegationId: randomUUID() });

      expect(await approveSet(depsOf(trx, hooks), s.ctx, setId, input(s.userId))).toEqual({ approved: 1, skipped: 1 });
      expect((await row(trx, old.sendId)).status).toBe("expired");
      expect((await row(trx, fresh.sendId)).status).toBe("approved");
    });
  });
});

describe("sendAgain", () => {
  async function failedPair(trx: Transaction<DB>, s: Awaited<ReturnType<typeof setup>>, reason: string, opts = {}) {
    const p = await pair(trx, s, {
      delegationId: randomUUID(),
      sendStatus: "failed",
      approved: { userId: s.userId, at: ago(2 * HOUR) },
      ...opts,
    });
    await trx.updateTable("actions").set({ status_reason: reason }).where("id", "=", p.sendId).execute();
    return p;
  }

  test("a failed send with an applied draft gets one new approved send; a second tap → already", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const other = await addMember(trx, s.orgId, "owner");
      const p = await failedPair(trx, s, "outcome_unknown");
      const old = await row(trx, p.sendId);

      const result = await sendAgain(trx, s.ctx, p.sendId, input(s.userId));
      expect(result.kind).toBe("created");
      const created = await row(trx, (result as { actionId: string }).actionId);
      expect(created).toMatchObject({
        type: "send",
        status: "approved",
        approved_by: s.userId,
        approved_via: "telegram",
        idempotency_key: `${p.sendId}:again`,
        depends_on_action_id: p.draftId,
        outgoing_message_id: null,
        payload: old.payload,
      });
      expect(created.approved_at?.getTime()).toBe(NOW.getTime());
      expect((created.payload as Record<string, unknown>).delegation_id).toBe(
        (old.payload as Record<string, unknown>).delegation_id
      );
      const audit = await auditRows(trx, s.ctx, "action.send_again");
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ action_id: created.id, data: { previous_action_id: p.sendId } });

      expect(await sendAgain(trx, s.ctx, p.sendId, input(other))).toEqual({ kind: "already" });
      const sends = await trx
        .selectFrom("actions")
        .select("id")
        .where("depends_on_action_id", "=", p.draftId)
        .where("type", "=", "send")
        .execute();
      expect(sends).toHaveLength(2);
    });
  });

  test("not_failed, draft_gone and not_found", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const rejectedByServer = await failedPair(trx, s, "smtp_rejected");
      expect(await sendAgain(trx, s.ctx, rejectedByServer.sendId, input(s.userId))).toEqual({ kind: "not_failed" });
      const awaiting = await pair(trx, s);
      expect(await sendAgain(trx, s.ctx, awaiting.sendId, input(s.userId))).toEqual({ kind: "not_failed" });
      const smtpError = await failedPair(trx, s, "smtp_error", { draftStatus: "undone" });
      expect(await sendAgain(trx, s.ctx, smtpError.sendId, input(s.userId))).toEqual({ kind: "draft_gone" });
      expect(await sendAgain(trx, s.ctx, randomUUID(), input(s.userId))).toEqual({ kind: "not_found" });
      const b = await setup(trx);
      const mine = await failedPair(trx, s, "smtp_error");
      expect(await sendAgain(trx, b.ctx, mine.sendId, input(s.userId))).toEqual({ kind: "not_found" });
    });
  });
});

describe("notice queries", () => {
  test("listSendsToNotify: an applied draft and an active mailbox; not a set send", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const listed = await pair(trx, s, { notifiedAt: null });
      await pair(trx, s, { notifiedAt: null, draftStatus: "ready" });
      await pair(trx, s, { notifiedAt: null, setId: randomUUID(), reminder: 1, delegationId: randomUUID() });
      await pair(trx, s, { notifiedAt: ago(MINUTE) });
      const paused = await setup(trx);
      await pair(trx, paused, { notifiedAt: null });
      await trx.updateTable("mailboxes").set({ status: "paused" }).where("id", "=", paused.mailboxId).execute();

      const rows = await listSendsToNotify(trx, s.ctx, { limit: 10 });
      expect(rows.map((r) => r.id)).toEqual([listed.sendId]);
      expect(rows[0]?.email.subject).toBeDefined();
      expect(await listSendsToNotify(trx, paused.ctx, { limit: 10 })).toEqual([]);
    });
  });

  test("listSetsToNotify groups the sends of a set; a set with a pending draft waits", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const setId = randomUUID();
      const a = await pair(trx, s, { notifiedAt: null, setId, reminder: 1, delegationId: randomUUID() });
      const b = await pair(trx, s, { notifiedAt: null, setId, reminder: 1, delegationId: randomUUID() });
      const waiting = randomUUID();
      await pair(trx, s, { notifiedAt: null, setId: waiting, reminder: 1, delegationId: randomUUID() });
      await pair(trx, s, {
        notifiedAt: null,
        setId: waiting,
        reminder: 1,
        delegationId: randomUUID(),
        draftStatus: "ready",
      });

      const sets = await listSetsToNotify(trx, s.ctx, { limit: 10 });
      expect([...sets.keys()]).toEqual([setId]);
      expect((sets.get(setId) ?? []).map((r) => r.id).sort()).toEqual([a.sendId, b.sendId].sort());
    });
  });

  test("listSendResultsToNotify and markResultNotified", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const approved = { userId: s.userId, at: ago(2 * HOUR) };
      const failed = await pair(trx, s, { sendStatus: "failed" });
      const expired = await pair(trx, s, { sendStatus: "expired" });
      const rejected = await pair(trx, s, { sendStatus: "rejected" });
      const awaiting = await pair(trx, s);
      const appended = await pair(trx, s, { sendStatus: "applied", approved });
      const pendingFresh = await pair(trx, s, { sendStatus: "applied", approved });
      const pendingOld = await pair(trx, s, { sendStatus: "applied", approved });
      const notified = await pair(trx, s, { sendStatus: "failed" });
      const set = (id: string, patch: Record<string, unknown>) =>
        trx.updateTable("actions").set(patch).where("id", "=", id).execute();
      await set(appended.sendId, {
        provider_result: JSON.stringify({ sent_copy: "appended" }),
        applied_at: ago(MINUTE),
      });
      await set(pendingFresh.sendId, {
        provider_result: JSON.stringify({ sent_copy: "pending" }),
        applied_at: ago(MINUTE),
      });
      await set(pendingOld.sendId, {
        provider_result: JSON.stringify({ sent_copy: "pending" }),
        applied_at: ago(11 * MINUTE),
      });
      await set(notified.sendId, { result_notified_at: ago(MINUTE) });
      for (const [index, id] of [failed, expired, rejected, appended, pendingOld, pendingFresh].entries()) {
        await set(id.sendId, { updated_at: ago((10 - index) * MINUTE) });
      }

      const rows = await listSendResultsToNotify(trx, s.ctx, { limit: 50, now: NOW, pendingCopyMaxAgeMs: 10 * MINUTE });
      expect(rows.map((r) => r.id)).toEqual([
        failed.sendId,
        expired.sendId,
        rejected.sendId,
        appended.sendId,
        pendingOld.sendId,
      ]);
      expect(rows.map((r) => r.id)).not.toContain(awaiting.sendId);

      expect(await markResultNotified(trx, s.ctx, failed.sendId, NOW)).toBe(true);
      expect(await markResultNotified(trx, s.ctx, failed.sendId, NOW)).toBe(false);
    });
  });
});

describe("expiry queries", () => {
  const STALE_BEFORE = ago(10 * MINUTE);
  const opts = { now: NOW, limit: 50, staleBefore: STALE_BEFORE };

  test("listExpiredApprovals gives the first reason that applies", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const approved = (hours: number) => ({ userId: s.userId, at: ago(hours * HOUR) });
      const timeout = await pair(trx, s, { notifiedAt: ago(49 * HOUR) });
      const both = await pair(trx, s, { notifiedAt: ago(49 * HOUR), draftStatus: "failed" });
      const missing = await pair(trx, s, { draftStatus: "failed" });
      const undone = await pair(trx, s, { draftStatus: "undone" });
      const unnotified = await pair(trx, s, { notifiedAt: null, createdAt: ago(8 * DAY) });
      const recent = await pair(trx, s, { notifiedAt: null, createdAt: ago(DAY) });
      const fresh = await pair(trx, s, { notifiedAt: ago(47 * HOUR) });
      const held = await pair(trx, s, { sendStatus: "approved", approved: approved(49) });
      const heldStale = await pair(trx, s, {
        sendStatus: "approved",
        approved: approved(49),
        lockedAt: ago(11 * MINUTE),
      });
      const young = await pair(trx, s, { sendStatus: "approved", approved: approved(47) });
      const inFlight = await pair(trx, s, {
        sendStatus: "approved",
        approved: approved(49),
        lockedAt: ago(MINUTE),
      });

      const found = await listExpiredApprovals(trx, s.ctx, s.mailboxId, opts);
      const byId = new Map(found.map((r) => [r.id, r.reason]));
      expect(byId.get(timeout.sendId)).toBe("timeout");
      expect(byId.get(both.sendId)).toBe("timeout");
      expect(byId.get(missing.sendId)).toBe("draft_missing");
      expect(byId.get(undone.sendId)).toBe("draft_missing");
      expect(byId.get(unnotified.sendId)).toBe("not_notified");
      expect(byId.get(held.sendId)).toBe("held_timeout");
      expect(byId.get(heldStale.sendId)).toBe("held_timeout");
      for (const p of [recent, fresh, young, inFlight]) expect(byId.has(p.sendId)).toBe(false);
      expect(found).toHaveLength(7);

      const limited = await listExpiredApprovals(trx, s.ctx, s.mailboxId, { ...opts, limit: 2 });
      expect(limited).toHaveLength(2);
    });
  });

  test("countApprovals", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const approved = { userId: s.userId, at: ago(HOUR) };
      await pair(trx, s, { sendStatus: "approved", approved, lockedAt: ago(11 * MINUTE) });
      await pair(trx, s, { sendStatus: "approved", approved, lockedAt: ago(MINUTE) });
      await pair(trx, s, { sendStatus: "approved", approved });
      await pair(trx, s, { notifiedAt: ago(2 * HOUR) });
      await pair(trx, s, { notifiedAt: ago(5 * HOUR) });
      await pair(trx, s, { notifiedAt: null });

      expect(await countApprovals(trx, s.ctx, { staleBefore: STALE_BEFORE })).toEqual({
        waiting: 3,
        oldestNotifiedAt: ago(5 * HOUR),
        approvedHeld: 2,
      });
    });
  });
});

describe("tenant isolation", () => {
  test("org B sees and changes nothing of org A", async () => {
    await withRollback(db, async (trx) => {
      const a = await setup(trx);
      const b = await setup(trx);
      const { hooks } = recordingHooks();
      const setId = randomUUID();
      const old = await pair(trx, a, { notifiedAt: ago(49 * HOUR) });
      const set = await pair(trx, a, { setId, reminder: 1, delegationId: randomUUID(), notifiedAt: null });
      const failed = await pair(trx, a, { sendStatus: "failed" });
      const held = await pair(trx, a, {
        sendStatus: "approved",
        approved: { userId: a.userId, at: ago(49 * HOUR) },
      });
      await trx.updateTable("actions").set({ status_reason: "smtp_error" }).where("id", "=", failed.sendId).execute();

      expect(await approve(depsOf(trx, hooks), b.ctx, old.sendId, input(b.userId))).toEqual({ kind: "not_found" });
      expect(await reject(depsOf(trx, hooks), b.ctx, old.sendId, input(b.userId))).toEqual({ kind: "not_found" });
      expect(await approveSet(depsOf(trx, hooks), b.ctx, setId, input(b.userId))).toEqual({ approved: 0, skipped: 0 });
      expect(await rejectSet(depsOf(trx, hooks), b.ctx, setId, input(b.userId))).toEqual({ rejected: 0, skipped: 0 });
      expect(await sendAgain(trx, b.ctx, failed.sendId, input(b.userId))).toEqual({ kind: "not_found" });
      expect(await listSendsToNotify(trx, b.ctx, { limit: 10 })).toEqual([]);
      expect((await listSetsToNotify(trx, b.ctx, { limit: 10 })).size).toBe(0);
      const results = await listSendResultsToNotify(trx, b.ctx, {
        limit: 10,
        now: NOW,
        pendingCopyMaxAgeMs: 10 * MINUTE,
      });
      expect(results).toEqual([]);
      expect(await markResultNotified(trx, b.ctx, failed.sendId, NOW)).toBe(false);
      const opts = { now: NOW, limit: 50, staleBefore: ago(10 * MINUTE) };
      expect(await listExpiredApprovals(trx, b.ctx, a.mailboxId, opts)).toEqual([]);
      expect(await countApprovals(trx, b.ctx, { staleBefore: opts.staleBefore })).toEqual({
        waiting: 0,
        oldestNotifiedAt: null,
        approvedHeld: 0,
      });
      expect((await row(trx, old.sendId)).status).toBe("awaiting_approval");
      expect((await row(trx, set.sendId)).status).toBe("awaiting_approval");
      expect((await row(trx, held.sendId)).status).toBe("approved");
    });
  });
});
