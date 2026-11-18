import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { settingsDeps } from "../../src/composition";
import { listUrgentNoticeTimes } from "../../src/modules/channels";
import { recentWeekStats, weekStats, type WeekStatsDeps } from "../../src/modules/reports";
import { upsertOrgFeature } from "../../src/modules/tenancy";
import { trustEvidenceReader } from "../../src/modules/trust";
import type { DB } from "../../src/platform/db";

import { testDb, withRollback } from "./helpers";
import { WEEK, WEEK_NOW, seedWeek } from "./metrics-fixtures";
import { insertCheckRow, insertTripRow } from "./trust-fixtures";
import { gateFile, gateOf } from "./web-trust-kit";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const deps: WeekStatsDeps = { urgentNotices: listUrgentNoticeTimes, testMail: { senders: [] } };

const counts = async (trx: Transaction<DB>, orgId: string) => {
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

// The three sources of ADR 0028 on the M8 rows (tests 1 to 3 of the stage).
describe("M8 trust evidence", () => {
  // `info` is `go` but provisional; the other categories are `no-go`.
  const provisional = gateFile({ info: 0.8 });
  provisional.provisional = true;
  provisional.categories.info = { ...provisional.categories.info, provisional: true };
  const gate = gateOf(provisional);

  const depsOn = (trx: Transaction<DB>, withReader = true): WeekStatsDeps => ({
    ...deps,
    ...(withReader
      ? {
          trustEvidence: trustEvidenceReader({
            settings: { ...settingsDeps(db, () => WEEK_NOW, gate), db: trx },
            testMail: { senders: [] },
          }),
        }
      : {}),
  });
  const flag = (trx: Transaction<DB>, orgId: string, enabled: boolean) =>
    upsertOrgFeature(trx, { orgId }, { flag: "trust_ladder", enabled, setBy: "test", setAt: WEEK_NOW });

  async function seedTrust(trx: Transaction<DB>, orgId: string, mailboxId: string): Promise<void> {
    const result = { spam: { outcome: "fail", acted: 100, moved: 3, upper: 0.07, total: 300, wouldMove: 30 } };
    await insertCheckRow(trx, { orgId }, mailboxId, {
      status: "done",
      result: JSON.stringify(result),
      created_at: new Date("2026-11-20T10:00:00Z"),
      finished_at: new Date("2026-11-20T11:00:00Z"),
    });
    await insertTripRow(trx, { orgId }, mailboxId, { category: "notification", reason: "corrections" });
  }

  test("1. flag on: the rows show the global evidence, the newest done check and the trip", async () => {
    await withRollback(db, async (trx) => {
      const { orgA } = await seedWeek(trx);
      await flag(trx, orgA.ctx.orgId, true);
      await seedTrust(trx, orgA.ctx.orgId, orgA.mailboxId);
      const stats = await weekStats(trx, orgA.ctx, { weekStart: WEEK, mailboxId: null, now: WEEK_NOW }, depsOn(trx));
      if (stats === "not_found") throw new Error("not_found");
      const row = (category: string) => stats.m8.find((r) => r.category === category);
      expect(row("info")).toMatchObject({
        global: { decision: "go", provisional: true, cases: 200 },
        history: null,
        trip: { tripped: false, reason: null },
      });
      expect(row("spam")).toMatchObject({
        global: { decision: "no-go", provisional: false },
        history: { outcome: "fail", acted: 100, moved: 3 },
        trip: { tripped: false, reason: null },
      });
      expect(row("notification")).toMatchObject({ trip: { tripped: true, reason: "corrections" } });
      // Exact keys: the page must not get a field that the schema does not name.
      expect(Object.keys(row("spam")?.global ?? {}).sort()).toEqual([
        "cases",
        "decision",
        "provisional",
        "wilsonLower",
      ]);
      expect(Object.keys(row("spam")?.history ?? {}).sort()).toEqual(["acted", "moved", "outcome"]);
      expect(Object.keys(row("spam")?.trip ?? {}).sort()).toEqual(["reason", "tripped"]);
    });
  });

  test("2. flag off, or no reader: the three keys are null and the other keys are the same", async () => {
    await withRollback(db, async (trx) => {
      const { orgA } = await seedWeek(trx);
      await seedTrust(trx, orgA.ctx.orgId, orgA.mailboxId);
      const query = { weekStart: WEEK, mailboxId: null, now: WEEK_NOW };
      const base = await weekStats(trx, orgA.ctx, query, deps);
      // The flag is off (the default): a reader is given, and its data is not read.
      const off = await weekStats(trx, orgA.ctx, query, depsOn(trx));
      // The flag is on, but the root gave no reader.
      await flag(trx, orgA.ctx.orgId, true);
      const noReader = await weekStats(trx, orgA.ctx, query, depsOn(trx, false));
      for (const stats of [base, off, noReader]) {
        if (stats === "not_found") throw new Error("not_found");
        expect(stats.m8).toHaveLength(5);
        for (const row of stats.m8) expect([row.global, row.history, row.trip]).toEqual([null, null, null]);
      }
      expect(off).toEqual(base);
      expect(noReader).toEqual(base);
    });
  });

  test("3. a mailbox that is not the organization's reads null from the reader, not data", async () => {
    await withRollback(db, async (trx) => {
      const { orgA, orgB } = await seedWeek(trx);
      await flag(trx, orgA.ctx.orgId, true);
      await seedTrust(trx, orgA.ctx.orgId, orgA.mailboxId);
      const reader = depsOn(trx).trustEvidence;
      if (reader === undefined) throw new Error("reader");
      expect(await reader(orgB.ctx, orgA.mailboxId)).toBeNull();
      expect(await reader(orgA.ctx, orgB.mailboxId)).toBeNull();
      expect(await reader(orgA.ctx, orgA.mailboxId)).not.toBeNull();
    });
  });
});
