import { localToInstant, nextLocalDate } from "@ea/core";
import { sql } from "kysely";

import type { Db, TenantContext } from "../../../platform/db";
import { LAB_TARGETS } from "../seed";
import type { LabRun } from "../state";

import { checkDemoSeed } from "./format";
import { findNonTestAddress, findRealHost } from "./scan";
import { DEMO_TABLES, demoColumns, orgColumnOf, TABLE_SPECS, type DemoRow, type DemoTable } from "./tables";
import { DEMO_SEED_FORMAT, DemoSeedError, type DemoSeed } from "./types";

const ZONE = "Europe/Warsaw";

/** 00:00 Warsaw after run day `day` (1 is the start date of the run). Rows created before it are in the seed. */
export function dayCut(run: LabRun, day: number): Date {
  let date = run.plan.startDate;
  for (let step = 0; step < day; step += 1) date = nextLocalDate(date);
  return localToInstant(date, "00:00", ZONE);
}

// `pg` gives a timestamp as a Date and a bigint as a string; a seed holds JSON only.
const clean = (value: unknown): unknown => (value instanceof Date ? value.toISOString() : value);

function compare(spec: { sort: string; numericSort?: boolean }, a: DemoRow, b: DemoRow): number {
  const left = String(a[spec.sort]);
  const right = String(b[spec.sort]);
  if (spec.numericSort === true) {
    const diff = BigInt(left) - BigInt(right);
    return diff < 0n ? -1 : diff > 0n ? 1 : 0;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}

// Keeps the rows whose parents are in the file. A row that points at a row that the cut removed goes too (a soft
// reference becomes null instead), so the file has no foreign key that points outside it.
function closeRows(table: DemoTable, rows: DemoRow[], kept: Map<DemoTable, Set<string>>): DemoRow[] {
  const spec = TABLE_SPECS[table];
  let open = rows.filter((row) => (spec.unexportable ?? []).every((column) => row[column] === null));
  open = open.filter((row) => {
    for (const [column, parent] of Object.entries(spec.refs)) {
      const value = row[column];
      if (value === null || value === undefined) continue;
      if (kept.get(parent)?.has(String(value)) === true) continue;
      if (spec.softRefs?.includes(column) === true) row[column] = null;
      else return false;
    }
    return true;
  });
  // A self reference needs its parent in the same table: drop rows until no row points at a dropped row.
  const selfRefs = spec.selfRefs ?? [];
  const idColumn = spec.id;
  if (selfRefs.length > 0 && idColumn !== undefined) {
    for (;;) {
      const ids = new Set(open.map((row) => String(row[idColumn])));
      const next = open.filter((row) =>
        selfRefs.every((column) => row[column] === null || ids.has(String(row[column])))
      );
      if (next.length === open.length) break;
      open = next;
    }
  }
  return open;
}

/**
 * The demo organization at the end of run day `day`, as one seed. It reads ONLY the organization of `ctx` (every query
 * filters `org_id`; `organizations` by its id) in one read-only snapshot, and writes nothing. Rules:
 * - the run belongs to the `demo` key and the org is named exactly like the demo target, else `run_not_demo` or
 *   `org_mismatch`;
 * - the columns are those of `EXPORT_MAP`; users, memberships, chat links, credentials and sessions are not in a seed;
 * - rows created at or after 00:00 Warsaw after run day `day` are left out, with every row that points at them;
 * - every address in the seed ends in `.test` and every mailbox host is a loopback or `.test` name, else
 *   `non_test_address` or `non_test_host` with the table and the column, and the caller writes no file;
 * - rows are sorted by table, then id: two exports of the same rows are equal.
 */
export async function exportDemo(
  db: Db,
  ctx: TenantContext,
  run: LabRun,
  day: number,
  opts: { scenario: string; now?: Date }
): Promise<DemoSeed> {
  if (run.org !== "demo") throw new DemoSeedError("run_not_demo");
  if (!Number.isInteger(day) || day < 1 || day > run.plan.scenarioDays.length) {
    throw new DemoSeedError("day_out_of_range");
  }
  const cut = dayCut(run, day);

  const tables = await db
    .transaction()
    .setIsolationLevel("repeatable read")
    .execute(async (trx) => {
      const kept = new Map<DemoTable, Set<string>>();
      const result = {} as Record<DemoTable, DemoRow[]>;
      for (const table of DEMO_TABLES) {
        const spec = TABLE_SPECS[table];
        const columns = demoColumns(table);
        const select = sql.join(columns.map((column) => sql.ref(column)));
        const timeFilter =
          spec.time === undefined ? sql`` : sql` and ${sql.ref(spec.time)} < ${cut.toISOString()}::timestamptz`;
        const { rows } = await sql<DemoRow>`
          select ${select} from ${sql.table(table)}
          where ${sql.ref(orgColumnOf(table))} = ${ctx.orgId}::uuid${timeFilter}`.execute(trx);
        const cleaned = rows.map((row) =>
          Object.fromEntries(columns.map((column) => [column, clean(row[column])]))
        ) as DemoRow[];
        if (table === "organizations") {
          const name = cleaned[0]?.name;
          if (name !== LAB_TARGETS.demo.orgName) throw new DemoSeedError("org_mismatch");
        }
        const closed = closeRows(table, cleaned, kept).sort((a, b) => compare(spec, a, b));
        if (spec.id !== undefined) kept.set(table, new Set(closed.map((row) => String(row[spec.id as string]))));
        result[table] = closed;
      }
      return result;
    });

  for (const table of DEMO_TABLES) {
    const column = findNonTestAddress(tables[table]);
    if (column !== undefined) throw new DemoSeedError("non_test_address", table, column);
  }
  const hostColumn = findRealHost(tables.mailboxes);
  if (hostColumn !== undefined) throw new DemoSeedError("non_test_host", "mailboxes", hostColumn);

  return checkDemoSeed({
    format: DEMO_SEED_FORMAT,
    scenario: opts.scenario,
    runId: run.plan.runId,
    day,
    exportedAt: (opts.now ?? new Date()).toISOString(),
    tables,
  });
}
