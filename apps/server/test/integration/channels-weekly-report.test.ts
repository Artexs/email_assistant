import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { Transaction } from "kysely";

import { detectNotices, scheduleDigests } from "../../src/modules/channels";
import { failedAttemptKeys } from "../../src/modules/channels/notices/weekly-report";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { setDigestTimes, setOrgFeature } from "../../src/modules/tenancy";
import type { DB, TenantContext } from "../../src/platform/db";

import { addMember, createOrgWithMailbox, isolateChannels, linkChat, randomChatId, renderedOf } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { seedWeek } from "./metrics-fixtures";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

// Monday 2026-11-23, Europe/Warsaw (UTC+1): the report is for the week of 2026-11-16.
const MONDAY_0830 = new Date("2026-11-23T07:30:00Z");
const MONDAY_0900 = new Date("2026-11-23T08:00:00Z");
const NEXT_MONDAY_0900 = new Date("2026-11-30T08:00:00Z");
const TUESDAY = new Date("2026-11-24T08:00:00Z");
const MINUTE = 60_000;
const DEDUP = "weekly_report:2026-11-16";

let errorLines: string[] = [];
let logSpy: ReturnType<typeof spyOn>;
let errorSpy: ReturnType<typeof spyOn>;
let warnSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  logSpy = spyOn(console, "log").mockImplementation((): void => undefined);
  errorLines = [];
  errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errorLines.push(args.join(" "));
  });
  warnSpy = spyOn(console, "warn").mockImplementation((): void => undefined);
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
  warnSpy.mockRestore();
});

async function tick(trx: Transaction<DB>, now: Date, testMail = NO_TEST_SENDERS): Promise<void> {
  await detectNotices({ db: trx, now: () => now, startedAt: new Date(now.getTime() - 24 * 3_600_000), testMail });
}

async function weeklyRows(trx: Transaction<DB>, orgId: string) {
  const rows = await trx
    .selectFrom("outbox")
    .select(["user_id", "kind", "dedup_key", "text", "buttons", "view", "locale", "channel", "detail"])
    .where("org_id", "=", orgId)
    .where("kind", "=", "weekly_report")
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  return rows.map((row) => ({ ...row, ...renderedOf(row) }));
}

async function member(trx: Transaction<DB>, ctx: TenantContext, userId: string, linkedAt: Date, times: string[]) {
  await trx.updateTable("users").set({ locale: "en" }).where("id", "=", userId).execute();
  await setDigestTimes(trx, ctx, userId, times);
  await linkChat(trx, ctx, userId, randomChatId(), linkedAt);
}

async function flag(trx: Transaction<DB>, ctx: TenantContext, name: "weekly_report" | "handled_share", enabled = true) {
  await setOrgFeature(trx, ctx, { flag: name, enabled, actor: "cli", now: MONDAY_0830 });
}

// Org A of `seedWeek`: an owner and an assistant, both with the digest time 09:00, linked before the week ended.
async function orgA(trx: Transaction<DB>) {
  await isolateChannels(trx);
  const { orgA: a, orgB } = await seedWeek(trx);
  const linked = new Date("2026-11-01T10:00:00Z");
  const assistantId = await addMember(trx, a.ctx.orgId);
  await member(trx, a.ctx, a.ownerId, linked, ["09:00"]);
  await member(trx, a.ctx, assistantId, linked, ["09:00"]);
  return { ctx: a.ctx, ownerId: a.ownerId, assistantId, orgB };
}

describe("weekly report detector", () => {
  test("(2) one row per member at the slot, none before it, none again", async () => {
    await withRollback(db, async (trx) => {
      const o = await orgA(trx);
      await flag(trx, o.ctx, "weekly_report");

      await tick(trx, MONDAY_0830);
      expect(await weeklyRows(trx, o.ctx.orgId)).toHaveLength(0);

      await tick(trx, MONDAY_0900);
      const rows = await weeklyRows(trx, o.ctx.orgId);
      expect(rows.map((row) => row.user_id).sort()).toEqual([o.ownerId, o.assistantId].sort());
      for (const row of rows) {
        expect(row.dedup_key).toBe(DEDUP);
        expect((row.view as { week: { m3: { total: number } } }).week.m3.total).toBe(4);
      }

      await tick(trx, new Date(MONDAY_0900.getTime() + MINUTE));
      expect(await weeklyRows(trx, o.ctx.orgId)).toHaveLength(2);
    });
  });

  test("(3) on Tuesday the week is skipped", async () => {
    await withRollback(db, async (trx) => {
      const o = await orgA(trx);
      await flag(trx, o.ctx, "weekly_report");
      await tick(trx, TUESDAY);
      expect(await weeklyRows(trx, o.ctx.orgId)).toHaveLength(0);
    });
  });

  test("(4) flag off: no row; organization B gets its own numbers", async () => {
    await withRollback(db, async (trx) => {
      const o = await orgA(trx);
      const ownerB = await addMember(trx, o.orgB.ctx.orgId, "owner");
      await member(trx, o.orgB.ctx, ownerB, new Date("2026-11-01T10:00:00Z"), ["09:00"]);
      await flag(trx, o.orgB.ctx, "weekly_report");

      await tick(trx, MONDAY_0900);
      expect(await weeklyRows(trx, o.ctx.orgId)).toHaveLength(0);
      const rowsB = await weeklyRows(trx, o.orgB.ctx.orgId);
      expect(rowsB).toHaveLength(1);
      expect(rowsB[0]?.user_id).toBe(ownerB);
      const week = (rowsB[0]?.view as { week: { m3: { total: number }; m5: { urgent: number } } }).week;
      expect(week.m3.total).toBe(0);
      expect(week.m5.urgent).toBe(2);
    });
  });

  test("(5) the row renders; the text starts with the week", async () => {
    await withRollback(db, async (trx) => {
      const o = await orgA(trx);
      await flag(trx, o.ctx, "weekly_report");
      await tick(trx, MONDAY_0900);
      const rows = await weeklyRows(trx, o.ctx.orgId);
      expect(rows).toHaveLength(2);
      for (const row of rows) expect(row.text.startsWith("📈 Week Mon 16 Nov – Sun 22 Nov")).toBe(true);
    });
  });

  test("(6) a member linked after the slot gets the row at the next tick", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const { orgA: a } = await seedWeek(trx);
      await flag(trx, a.ctx, "weekly_report");
      await member(trx, a.ctx, a.ownerId, new Date("2026-11-01T10:00:00Z"), ["09:00"]);
      await tick(trx, MONDAY_0900);
      expect(await weeklyRows(trx, a.ctx.orgId)).toHaveLength(1);

      const late = await addMember(trx, a.ctx.orgId);
      await member(trx, a.ctx, late, new Date(MONDAY_0900.getTime() + 5 * MINUTE), ["09:00"]);
      await tick(trx, new Date(MONDAY_0900.getTime() + 10 * MINUTE));
      const rows = await weeklyRows(trx, a.ctx.orgId);
      expect(rows.map((row) => row.user_id).sort()).toEqual([a.ownerId, late].sort());
    });
  });

  test("a member with no digest time gets the report at 08:00 local", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const { orgA: a } = await seedWeek(trx);
      await flag(trx, a.ctx, "weekly_report");
      await member(trx, a.ctx, a.ownerId, new Date("2026-11-01T10:00:00Z"), []);
      await tick(trx, new Date("2026-11-23T06:59:00Z"));
      expect(await weeklyRows(trx, a.ctx.orgId)).toHaveLength(0);
      await tick(trx, new Date("2026-11-23T07:00:00Z"));
      expect(await weeklyRows(trx, a.ctx.orgId)).toHaveLength(1);
    });
  });

  test("a failing run does not run again within 15 minutes, and a success after it sends", async () => {
    await withRollback(db, async (trx) => {
      const o = await orgA(trx);
      await flag(trx, o.ctx, "weekly_report");
      let reads = 0;
      const broken = {
        get senders(): string[] {
          reads += 1;
          throw new Error("test failure");
        },
      };

      await tick(trx, MONDAY_0900, broken);
      expect(reads).toBeGreaterThan(0);
      expect(await weeklyRows(trx, o.ctx.orgId)).toHaveLength(0);
      const readsAfterFirst = reads;

      // Within the window the detector does not read the week at all.
      await tick(trx, new Date(MONDAY_0900.getTime() + 14 * MINUTE), broken);
      expect(reads).toBe(readsAfterFirst);
      await tick(trx, new Date(MONDAY_0900.getTime() + 14 * MINUTE));
      expect(await weeklyRows(trx, o.ctx.orgId)).toHaveLength(0);

      await tick(trx, new Date(MONDAY_0900.getTime() + 15 * MINUTE));
      expect(await weeklyRows(trx, o.ctx.orgId)).toHaveLength(2);
    });
  });

  test("a later week's failure logs again, with the week in the log id", async () => {
    await withRollback(db, async (trx) => {
      const o = await orgA(trx);
      await flag(trx, o.ctx, "weekly_report");
      const broken = {
        get senders(): string[] {
          throw new Error("test failure");
        },
      };
      const warnings = () => errorLines.filter((line) => line.includes(`weekly_report ${o.ctx.orgId}:`));

      await tick(trx, MONDAY_0900, broken);
      // The retry after the window fails again: the same week and the same id log once only.
      await tick(trx, new Date(MONDAY_0900.getTime() + 20 * MINUTE), broken);
      expect(warnings()).toHaveLength(1);
      expect(warnings()[0]).toContain(`${o.ctx.orgId}:2026-11-16`);

      await tick(trx, NEXT_MONDAY_0900, broken);
      expect(warnings()).toHaveLength(2);
      expect(warnings()[1]).toContain(`${o.ctx.orgId}:2026-11-23`);
    });
  });

  test("the failure record holds one week per organization: a later week drops the earlier one", async () => {
    await withRollback(db, async (trx) => {
      const o = await orgA(trx);
      await flag(trx, o.ctx, "weekly_report");
      const broken = {
        get senders(): string[] {
          throw new Error("test failure");
        },
      };
      const mine = () => failedAttemptKeys().filter((key) => key.startsWith(`${o.ctx.orgId}:`));

      await tick(trx, MONDAY_0900, broken);
      expect(mine()).toEqual([`${o.ctx.orgId}:2026-11-16`]);
      await tick(trx, TUESDAY, broken);
      expect(mine()).toEqual([`${o.ctx.orgId}:2026-11-16`]);

      await tick(trx, NEXT_MONDAY_0900, broken);
      expect(mine()).toEqual([`${o.ctx.orgId}:2026-11-23`]);
      // A later tick on a day that is not Monday drops the old key too.
      await tick(trx, new Date("2026-12-08T08:00:00Z"));
      expect(mine()).toEqual([]);
    });
  });

  test("both flags off: no weekly row and no handled line in the digest", async () => {
    await withRollback(db, async (trx) => {
      const o = await orgA(trx);
      await tick(trx, MONDAY_0900);
      await scheduleDigests({ db: trx, now: () => MONDAY_0900, testMail: NO_TEST_SENDERS });
      expect(await weeklyRows(trx, o.ctx.orgId)).toHaveLength(0);
      const digests = await trx
        .selectFrom("outbox")
        .select(["kind", "view"])
        .where("org_id", "=", o.ctx.orgId)
        .where("kind", "=", "digest")
        .execute();
      expect(digests.length).toBeGreaterThan(0);
      for (const row of digests) expect(JSON.stringify(row.view)).not.toContain("Handled in the last 7 days");
      // The same run with the report flag on sends the report: the off result above is the flag, not the setup.
      await flag(trx, o.ctx, "weekly_report");
      await tick(trx, MONDAY_0900);
      expect(await weeklyRows(trx, o.ctx.orgId)).toHaveLength(2);
    });
  });

  test("an organization with no linked member gets no row", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const created = await createOrgWithMailbox(trx);
      await flag(trx, { orgId: created.orgId }, "weekly_report");
      await tick(trx, MONDAY_0900);
      expect(await weeklyRows(trx, created.orgId)).toHaveLength(0);
    });
  });
});
