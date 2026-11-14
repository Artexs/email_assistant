import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { markSentMistake, MISTAKE_WINDOW_MS, recordRejectReason } from "../../src/modules/actions";
import type { DB, TenantContext } from "../../src/platform/db";

import { addMember, createOrgWithMailbox, insertDraftAndSend, insertTriagedWithActions } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const NOW = new Date("2026-11-14T12:00:00Z");
const DAY = 24 * 3_600_000;

type Trx = Transaction<DB>;

async function setup(trx: Trx) {
  const org = await createOrgWithMailbox(trx);
  const ctx: TenantContext = { orgId: org.orgId };
  const userId = await addMember(trx, org.orgId, "owner");
  return { ...org, ctx, userId };
}

// A send in the given status; an `applied` send gets its `applied_at`.
async function sendOf(trx: Trx, s: Awaited<ReturnType<typeof setup>>, status: string, appliedAt?: Date) {
  const approved = status === "applied" ? { userId: s.userId, at: NOW } : undefined;
  const { sendId, emailId } = await insertDraftAndSend(trx, s.ctx, s.mailboxId, { sendStatus: status, approved });
  if (appliedAt !== undefined) {
    await trx.updateTable("actions").set({ applied_at: appliedAt }).where("id", "=", sendId).execute();
  }
  return { sendId, emailId };
}

async function feedbackRows(trx: Trx, orgId: string, kind: string) {
  return trx
    .selectFrom("action_feedback")
    .selectAll()
    .where("org_id", "=", orgId)
    .where("kind", "=", kind)
    .orderBy("created_at")
    .execute();
}

async function auditRows(trx: Trx, orgId: string, event: string) {
  return trx.selectFrom("audit_log").selectAll().where("org_id", "=", orgId).where("event", "=", event).execute();
}

describe("recordRejectReason", () => {
  test("1. a rejected send: one row, one audit row; a later reason replaces the earlier one", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const { sendId, emailId } = await sendOf(trx, s, "rejected");
      const input = { actionId: sendId, userId: s.userId, via: "telegram", now: NOW } as const;

      expect(await recordRejectReason(trx, s.ctx, { ...input, reason: "wrong_person" })).toEqual({ kind: "saved" });
      const first = await feedbackRows(trx, s.orgId, "reject_reason");
      expect(first).toHaveLength(1);
      expect(first[0]).toMatchObject({ action_id: sendId, reason: "wrong_person", user_id: s.userId, via: "telegram" });
      const audit = await auditRows(trx, s.orgId, "action.reject_reason");
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        action_id: sendId,
        email_id: emailId,
        actor: s.userId,
        reason_code: "wrong_person",
        data: { via: "telegram" },
      });

      const later = new Date(NOW.getTime() + 60_000);
      expect(
        await recordRejectReason(trx, s.ctx, { ...input, reason: "wrong_content", via: "web", now: later })
      ).toEqual({ kind: "saved" });
      const second = await feedbackRows(trx, s.orgId, "reject_reason");
      expect(second).toHaveLength(1);
      expect(second[0]).toMatchObject({ reason: "wrong_content", via: "web" });
      expect(second[0]?.created_at).toEqual(NOW);
      expect(second[0]?.updated_at).toEqual(later);
    });
  });

  test("2. not_rejected for other statuses, not_found for a move and for a foreign organization", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const other = await setup(trx);
      const input = { userId: s.userId, via: "telegram", reason: "not_needed", now: NOW } as const;
      for (const status of ["awaiting_approval", "applied", "expired"]) {
        const { sendId } = await sendOf(trx, s, status, status === "applied" ? NOW : undefined);
        expect(await recordRejectReason(trx, s.ctx, { ...input, actionId: sendId })).toEqual({ kind: "not_rejected" });
      }
      expect(await feedbackRows(trx, s.orgId, "reject_reason")).toHaveLength(0);
      expect(await auditRows(trx, s.orgId, "action.reject_reason")).toHaveLength(0);

      const triaged = await insertTriagedWithActions(trx, s, s.mailboxId, {
        category: "info",
        createdAt: NOW,
        actions: [{ type: "move", status: "applied" }],
      });
      const moveId = triaged.actionIds[0] as string;
      expect(await recordRejectReason(trx, s.ctx, { ...input, actionId: moveId })).toEqual({ kind: "not_found" });

      const { sendId: rejectedId } = await sendOf(trx, s, "rejected");
      expect(await recordRejectReason(trx, other.ctx, { ...input, actionId: rejectedId })).toEqual({
        kind: "not_found",
      });
      expect(await feedbackRows(trx, s.orgId, "reject_reason")).toHaveLength(0);
      expect(await feedbackRows(trx, other.orgId, "reject_reason")).toHaveLength(0);
    });
  });
});

describe("markSentMistake", () => {
  test("3. an applied send within 7 days: saved once; older, failed and foreign sends are refused", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const other = await setup(trx);
      const input = { userId: s.userId, via: "telegram", now: NOW } as const;

      const recent = await sendOf(trx, s, "applied", new Date(NOW.getTime() - 2 * DAY));
      expect(await markSentMistake(trx, s.ctx, { ...input, actionId: recent.sendId })).toEqual({ kind: "saved" });
      expect(await markSentMistake(trx, s.ctx, { ...input, actionId: recent.sendId })).toEqual({ kind: "already" });
      const rows = await feedbackRows(trx, s.orgId, "mistake");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ action_id: recent.sendId, reason: null, user_id: s.userId, via: "telegram" });
      const audit = await auditRows(trx, s.orgId, "action.mistake");
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        action_id: recent.sendId,
        email_id: recent.emailId,
        actor: s.userId,
        reason_code: null,
        data: { via: "telegram" },
      });

      const old = await sendOf(trx, s, "applied", new Date(NOW.getTime() - 8 * DAY));
      expect(await markSentMistake(trx, s.ctx, { ...input, actionId: old.sendId })).toEqual({ kind: "too_late" });

      const edge = await sendOf(trx, s, "applied", new Date(NOW.getTime() - MISTAKE_WINDOW_MS));
      expect(await markSentMistake(trx, s.ctx, { ...input, actionId: edge.sendId })).toEqual({ kind: "saved" });

      const failed = await sendOf(trx, s, "failed");
      expect(await markSentMistake(trx, s.ctx, { ...input, actionId: failed.sendId })).toEqual({ kind: "not_sent" });

      expect(await markSentMistake(trx, other.ctx, { ...input, actionId: recent.sendId })).toEqual({
        kind: "not_found",
      });
      expect(await feedbackRows(trx, s.orgId, "mistake")).toHaveLength(2);
      expect(await feedbackRows(trx, other.orgId, "mistake")).toHaveLength(0);
    });
  });
});
