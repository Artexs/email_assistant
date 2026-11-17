import { afterAll, describe, expect, test } from "bun:test";

import { listUrgentNoticeTimes } from "../../src/modules/channels";
import { weekStats, type WeekStatsDeps } from "../../src/modules/reports";

import { testDb, withRollback } from "./helpers";
import { insertLoopActionPair, insertLoopRow } from "./loops-fixtures";
import { DUE, flagLoops, seedLoops } from "./loops-m2-fixtures";
import { WEEK, WEEK_NOW, seedWeek } from "./metrics-fixtures";

// F116 stage 23, T8 and the readers behind it: the M2 numbers over delegations and loops.

const db = testDb();
const deps: WeekStatsDeps = { urgentNotices: listUrgentNoticeTimes, testMail: { senders: [] } };
const input = { weekStart: WEEK, mailboxId: null as string | null, now: WEEK_NOW, withEvidence: false };

afterAll(async () => {
  await db.destroy();
});

async function m2Of(
  trx: Parameters<typeof seedWeek>[0],
  ctx: { orgId: string },
  over: Partial<typeof input> = {},
  d = deps
) {
  const stats = await weekStats(trx, ctx, { ...input, ...over }, d);
  if (stats === "not_found") throw new Error("not_found");
  return stats.m2;
}

describe("weekStats M2 with loops", () => {
  test("T8. one delegation and the loops: the totals and the split by kind", async () => {
    await withRollback(db, async (trx) => {
      const { orgA } = await seedWeek(trx);
      await flagLoops(trx, orgA, true);
      await seedLoops(trx, orgA);
      const m2 = await m2Of(trx, orgA.ctx);
      // Delegations of the seeded week: due 2, closed 1, surfaced 2. Loops: waiting 2 due (1 closed), promised 1 (surfaced),
      // delegated 1 (closed by the applied follow-up). The dropped loop and the synthetic one are out.
      expect(m2.byKind).toEqual({
        delegation: { due: 2, closedOnTime: 1, surfacedOnTime: 2, pending: 0 },
        waiting: { due: 2, closedOnTime: 1, surfacedOnTime: 1, pending: 0 },
        promised: { due: 1, closedOnTime: 0, surfacedOnTime: 1, pending: 0 },
        delegated: { due: 1, closedOnTime: 1, surfacedOnTime: 1, pending: 0 },
      });
      expect({ due: m2.due, closed: m2.closedOnTime, surfaced: m2.surfacedOnTime, pending: m2.pending }).toEqual({
        due: 6,
        closed: 3,
        surfaced: 5,
        pending: 0,
      });
    });
  });

  test("T10. the flag off: the loops are not read and there is no split", async () => {
    await withRollback(db, async (trx) => {
      const { orgA } = await seedWeek(trx);
      await seedLoops(trx, orgA);
      const m2 = await m2Of(trx, orgA.ctx);
      expect(m2).toEqual({ due: 2, closedOnTime: 1, surfacedOnTime: 2, pending: 0 });
      expect(m2.byKind).toBeUndefined();
      await flagLoops(trx, orgA, false);
      expect(await m2Of(trx, orgA.ctx)).toEqual(m2);
    });
  });

  test("a loop of another organization or mailbox does not count; a test sender is out", async () => {
    await withRollback(db, async (trx) => {
      const { orgA, orgB } = await seedWeek(trx);
      await flagLoops(trx, orgA, true);
      await flagLoops(trx, orgB, true);
      const ownerB = await trx
        .selectFrom("memberships")
        .select("user_id")
        .where("org_id", "=", orgB.ctx.orgId)
        .executeTakeFirstOrThrow();
      await seedLoops(trx, { ...orgB, ownerId: ownerB.user_id, ids: {} });
      const before = await m2Of(trx, orgA.ctx);
      expect(before.byKind?.waiting.due).toBe(0);
      expect(before.due).toBe(2);
      await seedLoops(trx, orgA);
      const one = await m2Of(trx, orgA.ctx, { mailboxId: orgA.mailboxId });
      expect(one.due).toBe(6);
      const other = await weekStats(trx, orgB.ctx, { ...input, mailboxId: orgA.mailboxId }, deps);
      expect(other).toBe("not_found");
      const test = await m2Of(
        trx,
        orgA.ctx,
        {},
        { ...deps, testMail: { senders: ["delegate-m2@x.test", "counterpart@x.test"] } }
      );
      expect(test.byKind?.waiting.due).toBe(0);
      expect(test.byKind?.delegated.due).toBe(0);
    });
  });

  test("only an applied send is a follow-up: a rejected one before the deadline does not close the loop", async () => {
    await withRollback(db, async (trx) => {
      const { orgA } = await seedWeek(trx);
      await flagLoops(trx, orgA, true);
      const { ctx, mailboxId, ownerId } = orgA;
      const approval = { approved_at: DUE, approved_by: ownerId, approved_via: "telegram" };
      const early = new Date("2026-11-19T08:00:00Z");
      const late = new Date("2026-11-19T12:00:00Z");
      const loop = await insertLoopRow(trx, ctx, mailboxId, { due_at: DUE });
      await insertLoopActionPair(trx, ctx, loop, { draftStatus: "applied", sendStatus: "rejected", createdAt: early });
      await insertLoopActionPair(trx, ctx, loop, {
        draftStatus: "applied",
        sendStatus: "applied",
        createdAt: late,
        send: approval,
      });
      const m2 = await m2Of(trx, ctx);
      expect(m2.byKind?.waiting).toEqual({ due: 1, closedOnTime: 0, surfacedOnTime: 0, pending: 0 });
      // The first applied send counts, not the newest: a second applied send after the deadline changes nothing.
      const second = await insertLoopRow(trx, ctx, mailboxId, { due_at: DUE });
      for (const at of [late, early]) {
        await insertLoopActionPair(trx, ctx, second, {
          draftStatus: "applied",
          sendStatus: "applied",
          createdAt: at,
          send: approval,
        });
      }
      expect((await m2Of(trx, ctx)).byKind?.waiting).toEqual({
        due: 2,
        closedOnTime: 1,
        surfacedOnTime: 1,
        pending: 0,
      });
    });
  });
});
