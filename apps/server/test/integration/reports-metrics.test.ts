import { afterAll, describe, expect, test } from "bun:test";

import { listUrgentNoticeTimes } from "../../src/modules/channels";
import { recentWeekStats, weekStats, type WeekStatsDeps } from "../../src/modules/reports";

import { testDb, withRollback } from "./helpers";
import { WEEK, WEEK_NOW, seedWeek } from "./metrics-fixtures";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const deps: WeekStatsDeps = { urgentNotices: listUrgentNoticeTimes, testMail: { senders: [] } };

const counts = async (trx: typeof db, orgId: string) => {
  const count = async (table: "audit_log" | "outbox") =>
    Number(
      (
        await trx
          .selectFrom(table)
          .select((eb) => eb.fn.countAll().as("n"))
          .where("org_id", "=", orgId)
          .executeTakeFirstOrThrow()
      ).n
    );
  return { audit: await count("audit_log"), outbox: await count("outbox") };
};

describe("weekStats", () => {
  test("1. the seeded week of organization A: every metric", async () => {
    await withRollback(db, async (trx) => {
      const { orgA } = await seedWeek(trx);
      const stats = await weekStats(trx, orgA.ctx, { weekStart: WEEK, mailboxId: null, now: WEEK_NOW }, deps);
      if (stats === "not_found") throw new Error("not_found");
      expect(stats.weekStart).toBe(WEEK);
      expect(stats.mailboxId).toBeNull();
      expect(stats.m1).toMatchObject({ important: 5, misses: 1, missesBySource: { correction: 1 } });
      expect(stats.m1.sample).toMatchObject({ labelled: 1, important: 1, misses: 0 });
      expect(stats.m2).toEqual({ due: 2, closedOnTime: 1, surfacedOnTime: 2, pending: 0 });
      expect(stats.m3).toEqual({
        hiddenImportant: 2,
        wrongPerson: 1,
        wrongContent: 0,
        sentMistake: 1,
        total: 4,
        notNeeded: 0,
        noReason: 1,
      });
      expect(stats.m4).toEqual({ triaged: 9, handled: 3, wouldHandle: 0 });
      expect(stats.m5).toEqual({ urgent: 2, noticed: 1, withoutNotice: 1, quietHours: 1, p90Minutes: 3 });
      expect(stats.m7.llmCalls).toBe(10);
      expect(stats.m7.mailboxes).toBe(1);
      expect(Math.abs(stats.m7.perMailboxMonthUsd - 0.4112)).toBeLessThan(0.001);
      expect(stats.m8).toHaveLength(5);
      expect(stats.m8.every((row) => row.mailboxId === orgA.mailboxId && !row.auto)).toBe(true);
    });
  });

  test("2. a whitelist rule counts for a move to ai_spam only", async () => {
    await withRollback(db, async (trx) => {
      const { orgA } = await seedWeek(trx);
      const addressOf = async (name: string) =>
        (
          await trx
            .selectFrom("emails")
            .select("from_address")
            .where("id", "=", orgA.ids[name] as string)
            .executeTakeFirstOrThrow()
        ).from_address as string;
      const input = { weekStart: WEEK, mailboxId: null, now: WEEK_NOW };
      const hidden = async () => {
        const stats = await weekStats(trx, orgA.ctx, input, deps);
        if (stats === "not_found") throw new Error("not_found");
        return stats.m3.hiddenImportant;
      };
      const whitelist = (pattern: string) =>
        trx.insertInto("sender_rules").values({ org_id: orgA.ctx.orgId, pattern, kind: "whitelist" }).execute();

      await whitelist(await addressOf("e1"));
      expect(await hidden()).toBe(2); // e1 moved to ai_info: no change
      await whitelist(await addressOf("e4"));
      expect(await hidden()).toBe(2); // e4 moved to ai_notifications: no change
      await trx
        .updateTable("actions")
        .set({ payload: JSON.stringify({ folder: "ai_spam" }) })
        .where("org_id", "=", orgA.ctx.orgId)
        .where("email_id", "=", orgA.ids.e4 as string)
        .where("type", "=", "move")
        .execute();
      expect(await hidden()).toBe(3);
    });
  });

  test("3. organization B sees its own numbers; a foreign mailbox is not_found", async () => {
    await withRollback(db, async (trx) => {
      const { orgA, orgB } = await seedWeek(trx);
      const input = { weekStart: WEEK, now: WEEK_NOW };
      expect(await weekStats(trx, orgB.ctx, { ...input, mailboxId: orgA.mailboxId }, deps)).toBe("not_found");
      const stats = await weekStats(trx, orgB.ctx, { ...input, mailboxId: null }, deps);
      if (stats === "not_found") throw new Error("not_found");
      expect(stats.m5.urgent).toBe(2);
      expect(stats.m1.important).toBe(2);
      expect(stats.m8.every((row) => row.mailboxId === orgB.mailboxId)).toBe(true);
      expect(stats.m3.total).toBe(0);
    });
  });

  test("4. recentWeekStats lists the finished weeks, newest first", async () => {
    await withRollback(db, async (trx) => {
      const { orgA } = await seedWeek(trx);
      const now = new Date("2026-11-24T10:00:00Z");
      const weeks = await recentWeekStats(trx, orgA.ctx, { weeks: 3, mailboxId: null, now }, deps);
      if (weeks === "not_found") throw new Error("not_found");
      expect(weeks.map((week) => week.weekStart)).toEqual(["2026-11-16", "2026-11-09", "2026-11-02"]);
      // 6. only the newest week carries the evidence of today
      expect(weeks.map((week) => week.m8.length)).toEqual([5, 0, 0]);
      expect(await recentWeekStats(trx, orgA.ctx, { weeks: 3, mailboxId: crypto.randomUUID(), now }, deps)).toBe(
        "not_found"
      );
    });
  });

  test("5. calling it twice gives the same numbers and writes nothing", async () => {
    await withRollback(db, async (trx) => {
      const { orgA } = await seedWeek(trx);
      const input = { weekStart: WEEK, mailboxId: null, now: WEEK_NOW };
      const before = await counts(trx, orgA.ctx.orgId);
      const first = await weekStats(trx, orgA.ctx, input, deps);
      const second = await weekStats(trx, orgA.ctx, input, deps);
      expect(second).toEqual(first);
      expect(await counts(trx, orgA.ctx.orgId)).toEqual(before);
    });
  });

  test("withEvidence false leaves M8 empty", async () => {
    await withRollback(db, async (trx) => {
      const { orgA } = await seedWeek(trx);
      const stats = await weekStats(
        trx,
        orgA.ctx,
        { weekStart: WEEK, mailboxId: null, now: WEEK_NOW, withEvidence: false },
        deps
      );
      if (stats === "not_found") throw new Error("not_found");
      expect(stats.m8).toEqual([]);
    });
  });
});
