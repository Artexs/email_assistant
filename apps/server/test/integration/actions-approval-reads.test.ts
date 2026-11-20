import { MINUTE_MS, HOUR_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";

import { countWaitingApprovals, listApprovalSends } from "../../src/modules/actions";

import { createOrgWithMailbox, insertDraftAndSend } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const NOW = new Date("2026-11-20T12:00:00Z");
const STALE_BEFORE = new Date(NOW.getTime() - 10 * MINUTE_MS);
const appr = (userId: string) => ({ userId, at: NOW });

describe("listApprovalSends and countWaitingApprovals (F102 stage 10)", () => {
  test("tenant filter: the context of organization B sees nothing of organization A", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      const ctxA = { orgId: a.orgId };
      const ctxB = { orgId: b.orgId };
      const waiting = await insertDraftAndSend(trx, ctxA, a.mailboxId, { createdAt: new Date(NOW.getTime() - 1000) });
      const held = await insertDraftAndSend(trx, ctxA, a.mailboxId, {
        sendStatus: "approved",
        approved: appr(a.userId),
        createdAt: NOW,
      });
      const mine = await insertDraftAndSend(trx, ctxB, b.mailboxId, { createdAt: NOW });

      const forA = await listApprovalSends(trx, ctxA, { staleBefore: STALE_BEFORE, limit: 100 });
      expect(forA.map((send) => send.id)).toEqual([held.sendId, waiting.sendId]);
      const forB = await listApprovalSends(trx, ctxB, { staleBefore: STALE_BEFORE, limit: 100 });
      expect(forB.map((send) => send.id)).toEqual([mine.sendId]);
      expect(await countWaitingApprovals(trx, ctxA)).toBe(1);
      expect(await countWaitingApprovals(trx, ctxB)).toBe(1);
      // A foreign organization with no row sees none.
      const c = await createOrgWithMailbox(trx);
      expect(await listApprovalSends(trx, { orgId: c.orgId }, { staleBefore: STALE_BEFORE, limit: 100 })).toEqual([]);
      expect(await countWaitingApprovals(trx, { orgId: c.orgId })).toBe(0);
    });
  });

  test("the list: waiting, and approved with no fresh lock; closed and in-flight sends are left out; the limit binds", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const ctx = { orgId: a.orgId };
      const make = (over: Parameters<typeof insertDraftAndSend>[3], minutes: number) =>
        insertDraftAndSend(trx, ctx, a.mailboxId, {
          createdAt: new Date(NOW.getTime() - minutes * MINUTE_MS),
          approved: appr(a.userId),
          ...over,
        });
      const waiting = await make({}, 1);
      const held = await make({ sendStatus: "approved" }, 2);
      const staleLock = await make({ sendStatus: "approved", lockedAt: new Date(NOW.getTime() - HOUR_MS) }, 3);
      const freshLock = await make({ sendStatus: "approved", lockedAt: new Date(NOW.getTime() - MINUTE_MS) }, 4);
      for (const status of ["applying", "applied", "rejected", "expired", "failed"])
        await make({ sendStatus: status }, 5);

      const all = await listApprovalSends(trx, ctx, { staleBefore: STALE_BEFORE, limit: 100 });
      expect(all.map((send) => send.id)).toEqual([waiting.sendId, held.sendId, staleLock.sendId]);
      expect(all.map((send) => send.id)).not.toContain(freshLock.sendId);
      expect(
        (await listApprovalSends(trx, ctx, { staleBefore: STALE_BEFORE, limit: 2 })).map((send) => send.id)
      ).toEqual([waiting.sendId, held.sendId]);
    });
  });

  test("the count wants an applied draft and the status awaiting_approval", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const ctx = { orgId: a.orgId };
      await insertDraftAndSend(trx, ctx, a.mailboxId, { draftStatus: "applied" });
      await insertDraftAndSend(trx, ctx, a.mailboxId, { draftStatus: "ready" });
      await insertDraftAndSend(trx, ctx, a.mailboxId, { draftStatus: "failed" });
      await insertDraftAndSend(trx, ctx, a.mailboxId, { sendStatus: "approved", approved: appr(a.userId) });
      expect(await countWaitingApprovals(trx, ctx)).toBe(1);
    });
  });
});
