import { randomUUID } from "node:crypto";

import { HOUR_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";

import { listUrgentNoticeTimes } from "../../src/modules/channels";
import { loopDueRows } from "../../src/modules/loops";
import { weekStats, type WeekStatsDeps } from "../../src/modules/reports";

import { testDb, withRollback } from "./helpers";
import { insertLoopActionPair, insertLoopRow } from "./loops-fixtures";
import { DUE, flagLoops, seedLoops } from "./loops-m2-fixtures";
import { WEEK, WEEK_NOW, seedWeek } from "./metrics-fixtures";

// The readers behind the loop metrics: the numbers over delegations and loops.

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

describe("loopDueRows", () => {
  test("reads the loops of the range, the mailbox and the organization, with the first applied send", async () => {
    await withRollback(db, async (trx) => {
      const { orgA } = await seedWeek(trx);
      const { ctx, mailboxId, ownerId } = orgA;
      const { delegated } = await seedLoops(trx, orgA);
      const range = { start: new Date("2026-11-15T23:00:00Z"), end: new Date("2026-11-22T23:00:00Z") };
      const all = await loopDueRows(trx, ctx, { range });
      // Seeded: 6 loops; the one with a synthetic Message-ID is out.
      expect(all).toHaveLength(5);
      const followed = all.find((row) => row.id === delegated);
      expect(followed?.kind).toBe("delegated");
      expect(followed?.firstFollowUpAt).toEqual(new Date(DUE.getTime() + 23 * HOUR_MS));
      expect(all.filter((row) => row.firstFollowUpAt !== null)).toHaveLength(1);
      expect(await loopDueRows(trx, ctx, { range, mailboxId })).toHaveLength(5);
      expect(await loopDueRows(trx, ctx, { range, mailboxId: randomUUID() })).toEqual([]);
      // A loop due outside the range is not read.
      await insertLoopRow(trx, ctx, mailboxId, { due_at: new Date("2026-11-25T09:00:00Z") });
      expect(await loopDueRows(trx, ctx, { range })).toHaveLength(5);
      expect(
        await loopDueRows(trx, ctx, { range: { start: range.end, end: new Date("2026-12-01T00:00:00Z") } })
      ).toHaveLength(1);
      // An undone send is no follow-up, even with a time in `applied_at`.
      const open = await insertLoopRow(trx, ctx, mailboxId, { due_at: DUE });
      await insertLoopActionPair(trx, ctx, open, {
        draftStatus: "applied",
        sendStatus: "undone",
        createdAt: new Date(DUE.getTime() - HOUR_MS),
        send: { approved_at: DUE, approved_by: ownerId, approved_via: "telegram" },
      });
      const row = (await loopDueRows(trx, ctx, { range })).find((r) => r.id === open);
      expect(row?.firstFollowUpAt).toBeNull();
    });
  });

  test("04-T7: a loop to a test sender is a test row by the one rule (İlker@Example.com, ilker@example.com)", async () => {
    await withRollback(db, async (trx) => {
      const { orgA } = await seedWeek(trx);
      const { ctx, mailboxId } = orgA;
      const range = { start: new Date("2026-11-15T23:00:00Z"), end: new Date("2026-11-22T23:00:00Z") };
      const id = await insertLoopRow(trx, ctx, mailboxId, { due_at: DUE, counterpart: "ilker@example.com" });
      expect((await loopDueRows(trx, ctx, { range })).some((row) => row.id === id)).toBe(true);
      const rows = await loopDueRows(trx, ctx, { range, testMail: { senders: ["İlker@Example.com"] } });
      expect(rows.some((row) => row.id === id)).toBe(false);
    });
  });
});
