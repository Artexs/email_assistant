import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { getActiveAlert, listAlerts, markAlertSent, openAlert, resolveAlert } from "../../src/modules/operator";
import type { DB } from "../../src/platform/db";

import { testDb, withRollback } from "./helpers";

// F114 stage 01: the repository of `ops_alerts` (host-wide alert state, no org_id) and its schema rules.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

type Trx = Transaction<DB>;

const T0 = new Date("2026-11-20T10:00:00Z");
const T1 = new Date("2026-11-20T16:00:00Z");

// The test runs in a transaction that rolls back; it first hides the rows of other runs.
async function inRollback(fn: (trx: Trx) => Promise<void>): Promise<void> {
  await withRollback(db, async (trx) => {
    await trx.deleteFrom("ops_alerts").execute();
    await fn(trx);
  });
}

async function rowCount(trx: Trx, kind: string): Promise<number> {
  const { rows } = await sql<{ n: number }>`select count(*)::int as n from ops_alerts where kind = ${kind}`.execute(
    trx
  );
  return rows[0]?.n ?? 0;
}

describe("alerts repository", () => {
  test("1. openAlert twice for slo_disk makes one row with the same id", async () => {
    await inRollback(async (trx) => {
      const first = await openAlert(trx, { kind: "slo_disk", at: T0, facts: { free_gb: 2 } });
      const second = await openAlert(trx, { kind: "slo_disk", at: T1, facts: { free_gb: 1 } });
      expect(second.id).toBe(first.id);
      expect(second.openedAt.getTime()).toBe(T0.getTime());
      expect(second.facts).toEqual({ free_gb: 2 });
      expect(await rowCount(trx, "slo_disk")).toBe(1);
      expect((await getActiveAlert(trx, "slo_disk"))?.id).toBe(first.id);
      expect(await getActiveAlert(trx, "slo_sync_lag")).toBeNull();
    });
  });

  test("2. after a silent resolve, openAlert makes a second row", async () => {
    await inRollback(async (trx) => {
      const first = await openAlert(trx, { kind: "slo_disk", at: T0, facts: { free_gb: 2 } });
      await resolveAlert(trx, first.id, T1, { free_gb: 30 }, { silent: true });
      expect(await getActiveAlert(trx, "slo_disk")).toBeNull();
      const second = await openAlert(trx, { kind: "slo_disk", at: T1, facts: { free_gb: 1 } });
      expect(second.id).not.toBe(first.id);
      expect(await rowCount(trx, "slo_disk")).toBe(2);
    });
  });

  test("3. markAlertSent open then repeat gives notice_count 2 and the second time as last_sent_at", async () => {
    await inRollback(async (trx) => {
      const row = await openAlert(trx, { kind: "slo_llm_errors", at: T0, facts: { failures: 5 } });
      await markAlertSent(trx, row.id, "open", T0, { failures: 5 });
      const afterOpen = await getActiveAlert(trx, "slo_llm_errors");
      expect(afterOpen?.noticeCount).toBe(1);
      expect(afterOpen?.openSentAt?.getTime()).toBe(T0.getTime());
      expect(afterOpen?.lastSentAt?.getTime()).toBe(T0.getTime());
      await markAlertSent(trx, row.id, "repeat", T1, { failures: 7 });
      const after = await getActiveAlert(trx, "slo_llm_errors");
      expect(after?.noticeCount).toBe(2);
      expect(after?.openSentAt?.getTime()).toBe(T0.getTime());
      expect(after?.lastSentAt?.getTime()).toBe(T1.getTime());
      expect(after?.facts).toEqual({ failures: 7 });
    });
  });

  test("3b. markAlertSent resolved sets resolved_sent_at and keeps an earlier resolved_at", async () => {
    await inRollback(async (trx) => {
      const row = await openAlert(trx, { kind: "slo_backup_age", at: T0, facts: { age_h: 30 } });
      await markAlertSent(trx, row.id, "open", T0, { age_h: 30 });
      await markAlertSent(trx, row.id, "resolved", T1, { age_h: 2 });
      // Resolved with no earlier resolve: resolved_at gets the time too, and the row is history.
      expect(await getActiveAlert(trx, "slo_backup_age")).toBeNull();
      const next = await openAlert(trx, { kind: "slo_backup_age", at: T1, facts: { age_h: 31 } });
      await resolveAlert(trx, next.id, T0, { age_h: 3 }, { silent: false });
      await markAlertSent(trx, next.id, "resolved", T1, { age_h: 3 });
      const rows = await listAlerts(trx, { since: T0, limit: 10 });
      const resolved = rows.find((r) => r.id === next.id);
      expect(resolved?.resolvedAt?.getTime()).toBe(T0.getTime());
      expect(resolved?.resolvedSentAt?.getTime()).toBe(T1.getTime());
      const first = rows.find((r) => r.id === row.id);
      expect(first?.resolvedAt?.getTime()).toBe(T1.getTime());
      expect(first?.resolvedSentAt?.getTime()).toBe(T1.getTime());
    });
  });

  test("3c. a non-silent resolve keeps the incident active until the resolved notice is sent", async () => {
    await inRollback(async (trx) => {
      const row = await openAlert(trx, { kind: "slo_sync_lag", at: T0, facts: { late_mailboxes: 1 } });
      await resolveAlert(trx, row.id, T1, { late_mailboxes: 0 }, { silent: false });
      const active = await getActiveAlert(trx, "slo_sync_lag");
      expect(active?.id).toBe(row.id);
      expect(active?.resolvedAt?.getTime()).toBe(T1.getTime());
      expect(active?.resolvedSentAt).toBeNull();
    });
  });

  test("3d. resolveAlert on a closed (history) row changes nothing", async () => {
    await inRollback(async (trx) => {
      const row = await openAlert(trx, { kind: "slo_disk", at: T0, facts: { free_gb: 2 } });
      await resolveAlert(trx, row.id, T0, { free_gb: 30 }, { silent: true });
      await resolveAlert(trx, row.id, T1, { free_gb: 99 }, { silent: true });
      const { rows } = await sql<{ resolved_at: Date; resolved_sent_at: Date; facts: Record<string, number> }>`
        select resolved_at, resolved_sent_at, facts from ops_alerts where id = ${row.id}`.execute(trx);
      expect(rows[0]?.resolved_at.getTime()).toBe(T0.getTime());
      expect(rows[0]?.resolved_sent_at.getTime()).toBe(T0.getTime());
      expect(rows[0]?.facts).toEqual({ free_gb: 30 });
    });
  });

  test("4. facts with a text value throw and write no row", async () => {
    await inRollback(async (trx) => {
      const bad = { free_gb: "a" } as unknown as Record<string, number>;
      await expect(openAlert(trx, { kind: "slo_disk", at: T0, facts: bad })).rejects.toThrow("not a number");
      expect(await rowCount(trx, "slo_disk")).toBe(0);
      await expect(openAlert(trx, { kind: "slo_disk", at: T0, facts: { free_gb: Number.NaN } })).rejects.toThrow(
        "not a number"
      );
      await expect(openAlert(trx, { kind: "slo_disk", at: T0, facts: { "Bad Key": 1 } })).rejects.toThrow("snake_case");
      expect(await rowCount(trx, "slo_disk")).toBe(0);
      const row = await openAlert(trx, { kind: "slo_disk", at: T0, facts: { free_gb: 2 } });
      await expect(markAlertSent(trx, row.id, "repeat", T1, bad)).rejects.toThrow("not a number");
      await expect(resolveAlert(trx, row.id, T1, bad, { silent: true })).rejects.toThrow("not a number");
      const after = await getActiveAlert(trx, "slo_disk");
      expect(after?.noticeCount).toBe(0);
      expect(after?.facts).toEqual({ free_gb: 2 });
    });
  });

  test("5. listAlerts since 2026-11-19T00:00Z with limit 1 returns the newer of two rows", async () => {
    await inRollback(async (trx) => {
      const older = await openAlert(trx, {
        kind: "slo_disk",
        at: new Date("2026-11-19T08:00:00Z"),
        facts: { free_gb: 3 },
      });
      await resolveAlert(trx, older.id, T0, { free_gb: 30 }, { silent: true });
      const newer = await openAlert(trx, { kind: "slo_sync_lag", at: new Date("2026-11-20T08:00:00Z"), facts: {} });
      await openAlert(trx, { kind: "slo_llm_errors", at: new Date("2026-11-18T08:00:00Z"), facts: {} });
      const since = new Date("2026-11-19T00:00:00Z");
      const one = await listAlerts(trx, { since, limit: 1 });
      expect(one.map((row) => row.id)).toEqual([newer.id]);
      const all = await listAlerts(trx, { since, limit: 10 });
      expect(all.map((row) => row.id)).toEqual([newer.id, older.id]);
    });
  });
});

describe("ops_alerts schema", () => {
  test("6. the table has no org_id, the kind list is closed, and facts must be a JSON object", async () => {
    await inRollback(async (trx) => {
      const { rows } = await sql<{ n: number }>`
        select count(*)::int as n from information_schema.columns
        where table_schema = 'public' and table_name = 'ops_alerts' and column_name = 'org_id'`.execute(trx);
      expect(rows[0]?.n).toBe(0);
      await trx.executeQuery(sql`savepoint s1`.compile(trx));
      await expect(
        sql`insert into ops_alerts (kind, opened_at) values ('slo_other', now())`.execute(trx)
      ).rejects.toThrow();
      await trx.executeQuery(sql`rollback to savepoint s1`.compile(trx));
      await trx.executeQuery(sql`rollback to savepoint s1`.compile(trx));
      await expect(
        sql`insert into ops_alerts (kind, opened_at, facts) values ('slo_disk', now(), '[1]')`.execute(trx)
      ).rejects.toThrow();
      await trx.executeQuery(sql`rollback to savepoint s1`.compile(trx));
      await expect(
        sql`insert into ops_alerts (kind, opened_at, notice_count) values ('slo_disk', now(), -1)`.execute(trx)
      ).rejects.toThrow();
    });
  });

  test("7. the app role can insert, select, update and delete rows", async () => {
    await inRollback(async (trx) => {
      const row = await openAlert(trx, { kind: "slo_disk", at: T0, facts: { free_gb: 2 } });
      await markAlertSent(trx, row.id, "open", T0, { free_gb: 2 });
      expect((await getActiveAlert(trx, "slo_disk"))?.id).toBe(row.id);
      await trx.deleteFrom("ops_alerts").where("id", "=", row.id).execute();
      expect(await getActiveAlert(trx, "slo_disk")).toBeNull();
    });
  });
});
