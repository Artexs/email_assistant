import { weekRange, type WeekQuery } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";

import { listUrgentNoticeTimes } from "../../src/modules/channels";
import { listHandledRows, listTruthRows } from "../../src/modules/triage";

import { testDb, withRollback } from "./helpers";
import { WEEK, seedWeek } from "./metrics-fixtures";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const range = weekRange(WEEK, "Europe/Warsaw");
const query = (overrides: Partial<WeekQuery> = {}): WeekQuery => ({
  range,
  mailboxId: null,
  testMail: { senders: [] },
  ...overrides,
});

const idsOf = (rows: readonly { emailId: string }[]) => rows.map((row) => row.emailId).sort();
const expectIds = (rows: readonly { emailId: string }[], ids: Record<string, string>, names: string[]) =>
  expect(idsOf(rows)).toEqual(names.map((name) => ids[name] as string).sort());

describe("metric row readers", () => {
  test("listTruthRows: real mail of the week with a triage result; latest label", async () => {
    await withRollback(db, async (trx) => {
      const { orgA } = await seedWeek(trx);
      const rows = await listTruthRows(trx, orgA.ctx, query());
      expectIds(rows, orgA.ids, ["e1", "e2", "e3", "e4", "e5", "e6", "e7", "e10", "e13"]);
      expect(rows.find((row) => row.emailId === orgA.ids.e1)).toEqual({
        emailId: orgA.ids.e1 as string,
        predicted: "info",
        truth: "urgent",
        truthSource: "correction",
        wrongOnly: false,
      });
      expect(rows.find((row) => row.emailId === orgA.ids.e3)).toMatchObject({
        truth: "needs_reply",
        truthSource: "review",
        wrongOnly: false,
      });
      expect(rows.find((row) => row.emailId === orgA.ids.e2)).toMatchObject({ truth: null, truthSource: null });
    });
  });

  test("listHandledRows: the same mail; booleans of actions, feedback and delegations", async () => {
    await withRollback(db, async (trx) => {
      const { orgA } = await seedWeek(trx);
      const rows = await listHandledRows(trx, orgA.ctx, query());
      expectIds(rows, orgA.ids, ["e1", "e2", "e3", "e4", "e5", "e6", "e7", "e10", "e13"]);
      const byName = (name: string) => rows.find((row) => row.emailId === orgA.ids[name]);
      expect(byName("e1")).toMatchObject({ mailboxActionApplied: true, wrongWithin7Days: true, category: "info" });
      expect(byName("e4")).toMatchObject({ mailboxActionApplied: true, wrongWithin7Days: false });
      expect(byName("e5")).toMatchObject({ mailboxActionApplied: true });
      expect(byName("e7")).toMatchObject({
        mailboxActionApplied: false,
        delegationSendApplied: true,
        delegationCancelled: false,
      });
      expect(byName("e2")).toMatchObject({
        mailboxActionApplied: false,
        mailboxActionUndone: false,
        mailboxActionLogged: false,
        delegationSendApplied: false,
      });
      expect(byName("e13")).toMatchObject({ delegationSendApplied: false });
    });
  });

  test("listUrgentNoticeTimes: notice time per urgent mail; synthetic mail left out", async () => {
    await withRollback(db, async (trx) => {
      const { orgA } = await seedWeek(trx);
      const rows = await listUrgentNoticeTimes(trx, orgA.ctx, query());
      expectIds(rows, orgA.ids, ["e2", "e6", "e10"]);
      const noticeOf = (name: string) => rows.find((row) => row.emailId === orgA.ids[name])?.noticeAt;
      expect(noticeOf("e2")).toEqual(new Date("2026-11-17T10:03:00Z"));
      expect(noticeOf("e6")).toEqual(new Date("2026-11-20T06:00:00Z"));
      expect(noticeOf("e10")).toBeNull();
    });
  });

  test("tenants: organization B sees its own rows only; a foreign mailbox gives none", async () => {
    await withRollback(db, async (trx) => {
      const { orgA, orgB } = await seedWeek(trx);
      const own = await listTruthRows(trx, orgB.ctx, query());
      expect(own).toHaveLength(3);
      expect(own.map((row) => row.emailId).filter((id) => Object.values(orgA.ids).includes(id))).toEqual([]);
      expect(await listHandledRows(trx, orgB.ctx, query())).toHaveLength(3);
      expect(await listUrgentNoticeTimes(trx, orgB.ctx, query())).toHaveLength(2);

      const foreign = query({ mailboxId: orgA.mailboxId });
      expect(await listTruthRows(trx, orgB.ctx, foreign)).toEqual([]);
      expect(await listHandledRows(trx, orgB.ctx, foreign)).toEqual([]);
      expect(await listUrgentNoticeTimes(trx, orgB.ctx, foreign)).toEqual([]);
    });
  });

  test("mailboxId of the only mailbox gives the same rows as null", async () => {
    await withRollback(db, async (trx) => {
      const { orgA } = await seedWeek(trx);
      const one = query({ mailboxId: orgA.mailboxId });
      expect(await listTruthRows(trx, orgA.ctx, one)).toEqual(await listTruthRows(trx, orgA.ctx, query()));
      expect(await listHandledRows(trx, orgA.ctx, one)).toEqual(await listHandledRows(trx, orgA.ctx, query()));
      expect(await listUrgentNoticeTimes(trx, orgA.ctx, one)).toEqual(
        await listUrgentNoticeTimes(trx, orgA.ctx, query())
      );
    });
  });

  test("a test sender is left out of the truth, handled and urgent readers", async () => {
    await withRollback(db, async (trx) => {
      const { orgA } = await seedWeek(trx);
      const sender = await trx
        .selectFrom("emails")
        .select("from_address")
        .where("id", "=", orgA.ids.e2 as string)
        .executeTakeFirstOrThrow();
      const rule = query({ testMail: { senders: [(sender.from_address as string).toLowerCase()] } });
      expect(idsOf(await listTruthRows(trx, orgA.ctx, rule))).not.toContain(orgA.ids.e2);
      expect(idsOf(await listHandledRows(trx, orgA.ctx, rule))).not.toContain(orgA.ids.e2);
      expect(idsOf(await listUrgentNoticeTimes(trx, orgA.ctx, rule))).toEqual(
        [orgA.ids.e6, orgA.ids.e10].map(String).sort()
      );
      expect(await listTruthRows(trx, orgA.ctx, rule)).toHaveLength(8);
    });
  });
});
