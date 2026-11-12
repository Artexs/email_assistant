import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { resumeHook } from "../../src/composition";
import {
  SENT_COPY_PENDING_MAX_AGE_MS,
  createExpiryJob,
  getSend,
  listSendResultsToNotify,
  noDelegationHooks,
} from "../../src/modules/actions";
import { SENDER_STALE_MS, cancelPendingOutboxOfOrg } from "../../src/modules/channels";
import { getOrgPlan, setOrgPlan } from "../../src/modules/tenancy";
import type { DB, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox, insertDraftAndSend, pauseOtherMailboxes } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// F079: at the resume of a suspended organization, a send whose approval request no owner saw ends as `not_seen`.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const HOUR = 3_600_000;
const pausedAt = new Date("2026-11-10T08:00:00Z");
const resumedAt = new Date(pausedAt.getTime() + 30 * HOUR);
const resumedAfter60h = () => new Date(pausedAt.getTime() + 72 * HOUR);
const APPLIED = { folder: "Drafts", uid: 7 };
const hooks = { onSuspended: cancelPendingOutboxOfOrg, onResumed: resumeHook(db) };

async function setup(trx: Transaction<DB>) {
  await pauseOtherMailboxes(trx);
  const org = await createOrgWithMailbox(trx);
  return { ...org, ctx: { orgId: org.orgId } };
}

async function waiting(
  trx: Transaction<DB>,
  s: Awaited<ReturnType<typeof setup>>,
  opts: Parameters<typeof insertDraftAndSend>[3] = {}
) {
  return insertDraftAndSend(trx, s.ctx, s.mailboxId, {
    draftProviderResult: APPLIED,
    createdAt: new Date(pausedAt.getTime() - 3 * HOUR),
    notifiedAt: new Date(pausedAt.getTime() - 2 * HOUR),
    ...opts,
  });
}

// The notifier's queue row of the request, as `detectApprovals` and `detectApprovalSets` write it.
async function queueRequest(
  trx: Transaction<DB>,
  s: Awaited<ReturnType<typeof setup>>,
  opts: { kind: "approval" | "approval_set"; key: string; emailId: string; status: "pending" | "sent" }
) {
  await trx
    .insertInto("outbox")
    .values({
      org_id: s.orgId,
      user_id: s.userId,
      kind: opts.kind,
      dedup_key: `${opts.kind}:${opts.key}`,
      email_id: opts.emailId,
      text: "Approve?",
      buttons: "[]",
      status: opts.status,
      created_at: new Date(pausedAt.getTime() - 2 * HOUR),
      next_attempt_at: new Date(pausedAt.getTime() - 2 * HOUR),
      sent_at: opts.status === "sent" ? new Date(pausedAt.getTime() - 2 * HOUR) : null,
    })
    .execute();
}

async function outboxStatus(trx: Transaction<DB>, ctx: TenantContext, dedupKey: string) {
  return trx
    .selectFrom("outbox")
    .select(["status", "error_code"])
    .where("org_id", "=", ctx.orgId)
    .where("dedup_key", "=", dedupKey)
    .executeTakeFirstOrThrow();
}

async function pauseAndResume(trx: Transaction<DB>, ctx: TenantContext) {
  await setOrgPlan(trx, ctx, { plan: "suspended", actor: "operator", now: pausedAt }, hooks);
  return setOrgPlan(trx, ctx, { plan: "active", actor: "operator", now: resumedAt }, hooks);
}

describe("resume of a suspended organization (F079)", () => {
  test("pause, 30 h, resume: the unseen request ends the send as not_seen with an audit row, a result notice and a cancelled request", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await waiting(trx, s);
      await queueRequest(trx, s, { kind: "approval", key: p.sendId, emailId: p.emailId, status: "pending" });

      const result = await pauseAndResume(trx, s.ctx);

      expect(result).toMatchObject({ kind: "changed", expiredSends: 1 });
      expect(await getSend(trx, s.ctx, p.sendId)).toMatchObject({ status: "expired", status_reason: "not_seen" });
      expect(await outboxStatus(trx, s.ctx, `approval:${p.sendId}`)).toEqual({
        status: "failed",
        error_code: "outdated",
      });
      const audit = await trx
        .selectFrom("audit_log")
        .select(["actor", "reason_code", "created_at"])
        .where("org_id", "=", s.orgId)
        .where("action_id", "=", p.sendId)
        .where("event", "=", "action.expired")
        .execute();
      expect(audit).toEqual([{ actor: "operator", reason_code: "not_seen", created_at: resumedAt }]);
      const toNotify = await listSendResultsToNotify(trx, s.ctx, {
        limit: 10,
        now: resumedAt,
        pendingCopyMaxAgeMs: SENT_COPY_PENDING_MAX_AGE_MS,
      });
      expect(toNotify.map((row) => row.id)).toEqual([p.sendId]);
    });
  });

  test("a request that an owner received (outbox row sent) keeps its send waiting", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await waiting(trx, s);
      await queueRequest(trx, s, { kind: "approval", key: p.sendId, emailId: p.emailId, status: "sent" });

      const result = await pauseAndResume(trx, s.ctx);

      expect(result).toMatchObject({ kind: "changed", expiredSends: 0 });
      expect(await getSend(trx, s.ctx, p.sendId)).toMatchObject({ status: "awaiting_approval" });
    });
  });

  test("a send that the notifier did not queue yet (notified_at null) keeps waiting for its request", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await waiting(trx, s, { notifiedAt: null });

      const result = await pauseAndResume(trx, s.ctx);

      expect(result).toMatchObject({ expiredSends: 0 });
      expect(await getSend(trx, s.ctx, p.sendId)).toMatchObject({ status: "awaiting_approval", notified_at: null });
    });
  });

  test("an approved send and a waiting send of another organization stay as they are", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const other = await createOrgWithMailbox(trx);
      const approved = await waiting(trx, s, {
        sendStatus: "approved",
        approved: { userId: s.userId, at: new Date(pausedAt.getTime() - HOUR) },
      });
      const foreign = await insertDraftAndSend(trx, { orgId: other.orgId }, other.mailboxId, {
        draftProviderResult: APPLIED,
        createdAt: new Date(pausedAt.getTime() - 3 * HOUR),
        notifiedAt: new Date(pausedAt.getTime() - 2 * HOUR),
      });

      const result = await pauseAndResume(trx, s.ctx);

      expect(result).toMatchObject({ expiredSends: 0 });
      expect(await getSend(trx, s.ctx, approved.sendId)).toMatchObject({ status: "approved" });
      expect(await getSend(trx, { orgId: other.orgId }, foreign.sendId)).toMatchObject({ status: "awaiting_approval" });
      expect(approved.draftId).not.toBe(foreign.draftId);
    });
  });

  test("a request that the notifier queued after the resume is not touched by a later change", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await pauseAndResume(trx, s.ctx);
      const fresh = await waiting(trx, s, { notifiedAt: new Date(resumedAt.getTime() + HOUR) });
      await queueRequest(trx, s, { kind: "approval", key: fresh.sendId, emailId: fresh.emailId, status: "pending" });

      // active to trial is not a resume: no hook runs.
      await setOrgPlan(trx, s.ctx, { plan: "trial", trialDays: 5, actor: "operator", now: resumedAt }, hooks);

      expect(await getSend(trx, s.ctx, fresh.sendId)).toMatchObject({ status: "awaiting_approval" });
      expect(await outboxStatus(trx, s.ctx, `approval:${fresh.sendId}`)).toMatchObject({ status: "pending" });
    });
  });

  test("a reminder set: every send of the set ends as not_seen and its one request is cancelled", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const setId = randomUUID();
      const first = await waiting(trx, s, { reminder: 1, setId, delegationId: randomUUID() });
      const second = await waiting(trx, s, { reminder: 1, setId, delegationId: randomUUID() });
      await queueRequest(trx, s, { kind: "approval_set", key: setId, emailId: first.emailId, status: "pending" });

      const result = await pauseAndResume(trx, s.ctx);

      expect(result).toMatchObject({ expiredSends: 2 });
      for (const send of [first, second]) {
        expect(await getSend(trx, s.ctx, send.sendId)).toMatchObject({ status: "expired", status_reason: "not_seen" });
      }
      expect(await outboxStatus(trx, s.ctx, `approval_set:${setId}`)).toEqual({
        status: "failed",
        error_code: "outdated",
      });
    });
  });

  test("a pause of more than 48 h: the expiry job during the pause keeps an unseen send; the resume ends it as not_seen with a notice", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const unseen = await waiting(trx, s);
      // A request that an owner received before the pause still times out by the 48 h rule.
      const seen = await waiting(trx, s, { requestSent: true });
      await queueRequest(trx, s, { kind: "approval", key: unseen.sendId, emailId: unseen.emailId, status: "pending" });
      await setOrgPlan(trx, s.ctx, { plan: "suspended", actor: "operator", now: pausedAt }, hooks);

      const duringPause = new Date(pausedAt.getTime() + 60 * HOUR);
      const job = createExpiryJob({
        db: trx,
        now: () => duringPause,
        hooks: noDelegationHooks,
        uidplus: async () => true,
      });
      await job.run();

      expect(await getSend(trx, s.ctx, unseen.sendId)).toMatchObject({ status: "awaiting_approval" });
      expect(await getSend(trx, s.ctx, seen.sendId)).toMatchObject({ status: "expired", status_reason: "timeout" });

      const result = await setOrgPlan(trx, s.ctx, { plan: "active", actor: "operator", now: resumedAfter60h() }, hooks);

      expect(result).toMatchObject({ kind: "changed", expiredSends: 1 });
      expect(await getSend(trx, s.ctx, unseen.sendId)).toMatchObject({ status: "expired", status_reason: "not_seen" });
      const toNotify = await listSendResultsToNotify(trx, s.ctx, {
        limit: 10,
        now: resumedAfter60h(),
        pendingCopyMaxAgeMs: SENT_COPY_PENDING_MAX_AGE_MS,
      });
      expect(toNotify.map((row) => [row.id, row.status_reason]).sort()).toEqual(
        [
          [unseen.sendId, "not_seen"],
          [seen.sendId, "timeout"],
        ].sort()
      );
    });
  });

  test("outside a pause, a request that no owner received for 48 h ends as not_seen, not as timeout", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const unseen = await waiting(trx, s);
      const job = createExpiryJob({
        db: trx,
        now: () => new Date(pausedAt.getTime() + 60 * HOUR),
        hooks: noDelegationHooks,
        uidplus: async () => true,
      });

      await job.run();

      expect(await getSend(trx, s.ctx, unseen.sendId)).toMatchObject({ status: "expired", status_reason: "not_seen" });
    });
  });

  test("a throw in the resume hook rolls the resume back: the plan stays suspended and the send stays", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const unseen = await waiting(trx, s);
      await setOrgPlan(trx, s.ctx, { plan: "suspended", actor: "operator", now: pausedAt }, hooks);
      // The hook closes the send first, then throws: the savepoint of the failed change must undo both.
      const failing = {
        onResumed: async (...args: Parameters<typeof hooks.onResumed>) => {
          await hooks.onResumed(...args);
          throw new Error("hook failed");
        },
      };

      await sql`savepoint resume_try`.execute(trx);
      await expect(
        setOrgPlan(trx, s.ctx, { plan: "active", actor: "operator", now: resumedAt }, failing)
      ).rejects.toThrow("hook failed");
      await sql`rollback to savepoint resume_try`.execute(trx);

      expect(await getOrgPlan(trx, s.ctx)).toMatchObject({ plan: "suspended", resumedAt: null });
      expect(await getSend(trx, s.ctx, unseen.sendId)).toMatchObject({ status: "awaiting_approval" });
    });
  });

  test("a stale `sending` request of an ended send is cancelled; a fresh `sending` request is left to finish", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const stale = await waiting(trx, s);
      const live = await waiting(trx, s);
      await queueRequest(trx, s, { kind: "approval", key: stale.sendId, emailId: stale.emailId, status: "pending" });
      await queueRequest(trx, s, { kind: "approval", key: live.sendId, emailId: live.emailId, status: "pending" });
      await setOrgPlan(trx, s.ctx, { plan: "suspended", actor: "operator", now: pausedAt }, hooks);
      const claim = (key: string, lockedAt: Date) =>
        trx
          .updateTable("outbox")
          .set({ status: "sending", locked_at: lockedAt })
          .where("org_id", "=", s.orgId)
          .where("dedup_key", "=", `approval:${key}`)
          .execute();
      await claim(stale.sendId, new Date(resumedAt.getTime() - SENDER_STALE_MS - 60_000));
      await claim(live.sendId, new Date(resumedAt.getTime() - 60_000));

      await setOrgPlan(trx, s.ctx, { plan: "active", actor: "operator", now: resumedAt }, hooks);

      expect(await outboxStatus(trx, s.ctx, `approval:${stale.sendId}`)).toEqual({
        status: "failed",
        error_code: "outdated",
      });
      expect(await outboxStatus(trx, s.ctx, `approval:${live.sendId}`)).toMatchObject({ status: "sending" });
    });
  });
});
