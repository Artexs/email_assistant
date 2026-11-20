import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import {
  activeTripsOf,
  clearTrips,
  historyResultFor,
  insertTrip,
  latestHistoryCheck,
  queueHistoryCheck,
} from "../../src/modules/trust";
import type { DB } from "../../src/platform/db";

import { createOrgWithMailbox, insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { addMailbox, deleteMailboxRow, insertCheckItemRow, insertCheckRow, insertTripRow } from "./trust-fixtures";

// The repository of the trust module. The connection is the `app` role; the tests roll back.
// The races of the same functions, with committed rows and two connections, are in trust-race.test.ts.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

type Trx = Transaction<DB>;

const GRANTED = new Date("2026-11-10T10:00:00Z");
const T0 = new Date("2026-11-12T10:00:00Z");
const T1 = new Date("2026-11-12T11:00:00Z");
const T2 = new Date("2026-11-12T12:00:00Z");

async function checkRows(trx: Trx, mailboxId: string): Promise<{ id: string; status: string }[]> {
  return trx
    .selectFrom("history_checks")
    .select(["id", "status"])
    .where("mailbox_id", "=", mailboxId)
    .orderBy("created_at")
    .orderBy("id")
    .execute();
}

function result(acted: number, moved: number, outcome: "pass" | "fail" | "inconclusive" | "no_result") {
  return { outcome, acted, moved, upper: outcome === "no_result" ? null : 0.06, total: 100, wouldMove: 30 };
}

async function finishCheck(
  trx: Trx,
  id: string,
  values: { status: "done" | "no_result"; at: Date; result?: object; noResultReason?: string }
): Promise<void> {
  await trx
    .updateTable("history_checks")
    .set({
      status: values.status,
      finished_at: values.at,
      created_at: values.at,
      result: values.result === undefined ? null : JSON.stringify(values.result),
      no_result_reason: values.noResultReason ?? null,
    })
    .where("id", "=", id)
    .execute();
}

describe("queueHistoryCheck", () => {
  test("1: twice for one mailbox makes one row; after it is done, a third call makes a second row", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const first = await queueHistoryCheck(trx, o, o.mailboxId, "connect");
      const second = await queueHistoryCheck(trx, o, o.mailboxId, "cli");
      expect(first).not.toBeNull();
      expect(second).toBeNull();
      expect(await checkRows(trx, o.mailboxId)).toEqual([{ id: first as string, status: "queued" }]);

      await finishCheck(trx, first as string, { status: "done", at: T0, result: {} });
      const third = await queueHistoryCheck(trx, o, o.mailboxId, "model_switch");
      expect(third).not.toBeNull();
      expect(third).not.toBe(first);
      expect((await checkRows(trx, o.mailboxId)).map((row) => row.status)).toEqual(["done", "queued"]);
      // A `no_result` check does not block either.
      await finishCheck(trx, third as string, { status: "no_result", at: T1, noResultReason: "no_history" });
      expect(await queueHistoryCheck(trx, o, o.mailboxId, "web")).not.toBeNull();
    });
  });

  test("another mailbox of the organization has its own open check", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const other = await addMailbox(trx, o);
      const first = await queueHistoryCheck(trx, o, o.mailboxId, "connect");
      const second = await queueHistoryCheck(trx, o, other, "connect");
      expect(first).toEqual(expect.any(String));
      expect(second).toEqual(expect.any(String));
      expect(second).not.toBe(first);
      expect(await checkRows(trx, o.mailboxId)).toEqual([{ id: first as string, status: "queued" }]);
      expect(await checkRows(trx, other)).toEqual([{ id: second as string, status: "queued" }]);
    });
  });

  test("latestHistoryCheck returns the newest check of any status, with its parsed fields", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      expect(await latestHistoryCheck(trx, o, o.mailboxId)).toBeNull();
      const old = await insertCheckRow(trx, o, o.mailboxId, { status: "done", created_at: T0, finished_at: T0 });
      const newer = await insertCheckRow(trx, o, o.mailboxId, {
        status: "no_result",
        no_result_reason: "uidvalidity",
        reason: "cli",
        created_at: T1,
        finished_at: T1,
        cost_usd: "0.0125",
        capped: true,
      });
      const latest = await latestHistoryCheck(trx, o, o.mailboxId);
      expect(latest?.id).toBe(newer);
      expect(latest?.id).not.toBe(old);
      expect(latest?.status).toBe("no_result");
      expect(latest?.noResultReason).toBe("uidvalidity");
      expect(latest?.reason).toBe("cli");
      expect(latest?.costUsd).toBeCloseTo(0.0125, 6);
      expect(latest?.capped).toBe(true);
      expect(latest?.finishedAt?.getTime()).toBe(T1.getTime());
    });
  });
});

describe("tenant scope", () => {
  test("2: org B never reads or changes the checks and trips of org A", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      const check = await insertCheckRow(trx, a, a.mailboxId, {
        status: "done",
        finished_at: T0,
        result: JSON.stringify({ info: result(60, 0, "inconclusive") }),
      });
      await insertTripRow(trx, a, a.mailboxId);

      // B asks for the mailbox of A.
      expect(await latestHistoryCheck(trx, b, a.mailboxId)).toBeNull();
      expect(await historyResultFor(trx, b, a.mailboxId)).toEqual({ info: null, notification: null, spam: null });
      expect((await activeTripsOf(trx, b, a.mailboxId)).size).toBe(0);
      expect(await clearTrips(trx, b, a.mailboxId, "info", T1)).toBe(0);
      // A still sees its own rows, and the trip is still active.
      expect((await latestHistoryCheck(trx, a, a.mailboxId))?.id).toBe(check);
      expect((await historyResultFor(trx, a, a.mailboxId)).info?.outcome).toBe("inconclusive");
      expect((await activeTripsOf(trx, a, a.mailboxId)).get("info")?.tripped).toBe(true);

      // B cannot write a row for the mailbox of A: the composite key refuses it.
      await sql`savepoint f110_tenant`.execute(trx);
      await expect(queueHistoryCheck(trx, b, a.mailboxId, "cli")).rejects.toMatchObject({ code: "23503" });
      await sql`rollback to savepoint f110_tenant`.execute(trx);
      await sql`savepoint f110_tenant`.execute(trx);
      await expect(
        insertTrip(trx, b, {
          mailboxId: a.mailboxId,
          category: "spam",
          grantedAt: GRANTED,
          reason: "corrections",
          counts: {},
        })
      ).rejects.toMatchObject({ code: "23503" });
      await sql`rollback to savepoint f110_tenant`.execute(trx);
    });
  });
});

describe("insertTrip and clearTrips", () => {
  const trip = { category: "info", grantedAt: GRANTED, reason: "corrections", counts: { corrections: 2 } } as const;

  test("3: insertTrip twice with the same mailbox, category and grant: the second returns null", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const first = await insertTrip(trx, o, { mailboxId: o.mailboxId, ...trip });
      const second = await insertTrip(trx, o, { mailboxId: o.mailboxId, ...trip, reason: "important_hidden" });
      expect(first).not.toBeNull();
      expect(second).toBeNull();
      const rows = await trx.selectFrom("autonomy_trips").selectAll().where("mailbox_id", "=", o.mailboxId).execute();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.reason).toBe("corrections");
      expect(rows[0]?.counts).toEqual({ corrections: 2 });
      // Another grant, another category: new trips.
      expect(
        await insertTrip(trx, o, { mailboxId: o.mailboxId, ...trip, grantedAt: new Date(GRANTED.getTime() + 1000) })
      ).not.toBeNull();
      expect(await insertTrip(trx, o, { mailboxId: o.mailboxId, ...trip, category: "spam" })).not.toBeNull();
    });
  });

  test("4: clearTrips then activeTripsOf is empty; only the named category clears; a second clear does nothing", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      await insertTrip(trx, o, { mailboxId: o.mailboxId, ...trip });
      await insertTrip(trx, o, { mailboxId: o.mailboxId, ...trip, category: "spam", reason: "history_fail" });
      const active = await activeTripsOf(trx, o, o.mailboxId);
      expect([...active.keys()].sort()).toEqual(["info", "spam"]);
      expect(active.get("info")?.reason).toBe("corrections");
      expect(active.get("spam")?.reason).toBe("history_fail");

      expect(await clearTrips(trx, o, o.mailboxId, "info", T1)).toBe(1);
      expect([...(await activeTripsOf(trx, o, o.mailboxId)).keys()]).toEqual(["spam"]);
      expect(await clearTrips(trx, o, o.mailboxId, "info", T2)).toBe(0);
      expect(await clearTrips(trx, o, o.mailboxId, "spam", T1)).toBe(1);
      expect((await activeTripsOf(trx, o, o.mailboxId)).size).toBe(0);

      // The first clear keeps its time; the row stays as history.
      const rows = await trx
        .selectFrom("autonomy_trips")
        .select(["category", "cleared_at"])
        .where("mailbox_id", "=", o.mailboxId)
        .execute();
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.cleared_at?.getTime() === T1.getTime())).toBe(true);
      // The same grant stays one trip after a clear: the tripwire cannot pause it again.
      expect(await insertTrip(trx, o, { mailboxId: o.mailboxId, ...trip })).toBeNull();
    });
  });

  test("the newest trip of a category shows when two are active", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      await insertTripRow(trx, o, o.mailboxId, {
        granted_at: GRANTED,
        tripped_at: T0,
        reason: "corrections",
      });
      await insertTripRow(trx, o, o.mailboxId, {
        granted_at: new Date(GRANTED.getTime() + 1000),
        tripped_at: T1,
        reason: "model_switch",
      });
      const state = (await activeTripsOf(trx, o, o.mailboxId)).get("info");
      expect(state?.reason).toBe("model_switch");
      expect(state?.at?.getTime()).toBe(T1.getTime());
    });
  });
});

describe("historyResultFor", () => {
  test("5: a newer no_result check after a done check with fail still shows the fail", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      expect(await historyResultFor(trx, o, o.mailboxId)).toEqual({ info: null, notification: null, spam: null });
      const done = await insertCheckRow(trx, o, o.mailboxId, { reason: "connect" });
      await finishCheck(trx, done, {
        status: "done",
        at: T0,
        result: { info: result(80, 4, "fail"), spam: result(80, 0, "inconclusive") },
      });
      const noResult = await insertCheckRow(trx, o, o.mailboxId, { reason: "model_switch" });
      await finishCheck(trx, noResult, { status: "no_result", at: T1, noResultReason: "cost_unknown" });
      // An open check changes nothing either.
      await insertCheckRow(trx, o, o.mailboxId, { reason: "web" });

      const read = await historyResultFor(trx, o, o.mailboxId);
      expect(read.info).toEqual(result(80, 4, "fail"));
      expect(read.spam?.outcome).toBe("inconclusive");
      expect(read.notification).toBeNull();
      expect((await latestHistoryCheck(trx, o, o.mailboxId))?.status).toBe("queued");

      // A newer done check replaces it.
      const newer = await insertCheckRow(trx, o, o.mailboxId, { status: "done", created_at: T2, finished_at: T2 });
      await finishCheck(trx, newer, { status: "done", at: T2, result: { info: result(90, 0, "pass") } });
      const after = await historyResultFor(trx, o, o.mailboxId);
      expect(after.info?.outcome).toBe("pass");
      expect(after.spam).toBeNull();
    });
  });
});

describe("historyResultFor order", () => {
  test("5b: an old done check with finished_at null does not shadow a newer finished done check", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      // The old check is `done` but has no finished_at (Postgres sorts NULL first on `desc`).
      await insertCheckRow(trx, o, o.mailboxId, {
        status: "done",
        created_at: T0,
        finished_at: null,
        result: JSON.stringify({ info: result(80, 4, "fail") }),
      });
      await insertCheckRow(trx, o, o.mailboxId, {
        status: "done",
        created_at: T1,
        finished_at: T1,
        result: JSON.stringify({ info: result(90, 0, "pass") }),
      });
      expect((await historyResultFor(trx, o, o.mailboxId)).info?.outcome).toBe("pass");
    });
  });
});

describe("deletes", () => {
  test("6: deleting a mailbox removes its checks, items and trips, and only its own", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const other = await addMailbox(trx, o);
      const emailId = await insertTestEmail(trx, o, o.mailboxId);
      const otherEmail = await insertTestEmail(trx, o, other);
      const check = await insertCheckRow(trx, o, o.mailboxId, { status: "done", finished_at: T0 });
      const otherCheck = await insertCheckRow(trx, o, other, { status: "done", finished_at: T0 });
      await insertCheckItemRow(trx, o, check, emailId);
      await insertCheckItemRow(trx, o, otherCheck, otherEmail);
      await insertTripRow(trx, o, o.mailboxId);
      await insertTripRow(trx, o, other);

      await deleteMailboxRow(trx, o, o.mailboxId);

      const count = async (table: "history_checks" | "history_check_items" | "autonomy_trips") => {
        const row = await trx
          .selectFrom(table)
          .select((eb) => eb.fn.countAll<string>().as("n"))
          .where("org_id", "=", o.orgId)
          .executeTakeFirstOrThrow();
        return Number(row.n);
      };
      expect(await count("history_checks")).toBe(1);
      expect(await count("history_check_items")).toBe(1);
      expect(await count("autonomy_trips")).toBe(1);
      expect((await latestHistoryCheck(trx, o, o.mailboxId)) === null).toBe(true);
      expect((await latestHistoryCheck(trx, o, other))?.id).toBe(otherCheck);
    });
  });

  test("deleting an email removes its history items and keeps the check", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const keep = await insertTestEmail(trx, o, o.mailboxId);
      const gone = await insertTestEmail(trx, o, o.mailboxId);
      const check = await insertCheckRow(trx, o, o.mailboxId);
      await insertCheckItemRow(trx, o, check, keep);
      await insertCheckItemRow(trx, o, check, gone);
      await trx.deleteFrom("emails").where("id", "=", gone).execute();
      const items = await trx
        .selectFrom("history_check_items")
        .select("email_id")
        .where("check_id", "=", check)
        .execute();
      expect(items.map((item) => item.email_id)).toEqual([keep]);
      expect((await latestHistoryCheck(trx, o, o.mailboxId))?.id).toBe(check);
    });
  });

  test("7: deleting the report mailbox of a member keeps the membership with report_mailbox_id null", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const report = await addMailbox(trx, o);
      const keep = await addMailbox(trx, o);
      await trx
        .updateTable("memberships")
        .set({ report_mailbox_id: report, report_channel: "both" })
        .where("org_id", "=", o.orgId)
        .where("user_id", "=", o.userId)
        .execute();

      await deleteMailboxRow(trx, o, report);

      const member = await trx
        .selectFrom("memberships")
        .select(["org_id", "user_id", "report_mailbox_id", "report_channel"])
        .where("org_id", "=", o.orgId)
        .where("user_id", "=", o.userId)
        .executeTakeFirst();
      expect(member).toEqual({ org_id: o.orgId, user_id: o.userId, report_mailbox_id: null, report_channel: "both" });

      // Deleting another mailbox leaves a set report mailbox alone.
      await trx
        .updateTable("memberships")
        .set({ report_mailbox_id: keep })
        .where("org_id", "=", o.orgId)
        .where("user_id", "=", o.userId)
        .execute();
      await deleteMailboxRow(trx, o, o.mailboxId);
      const after = await trx
        .selectFrom("memberships")
        .select("report_mailbox_id")
        .where("org_id", "=", o.orgId)
        .where("user_id", "=", o.userId)
        .executeTakeFirst();
      expect(after?.report_mailbox_id).toBe(keep);
    });
  });
});
