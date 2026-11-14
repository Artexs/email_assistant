import { unlink } from "node:fs/promises";

import { sql, type Transaction } from "kysely";

import type { DB, Db } from "../../platform/db";
import { auditEvents, recordAudit } from "../audit";

import { writeEncryptedFile } from "./encrypted-file";
import { EXPORT_MAP, type ExportTable } from "./export-map";

const BATCH_ROWS = 500;
const CURSOR = "org_export_rows";

export type OrgExportResult =
  | { kind: "written"; bytes: number; rows: Record<string, number> }
  | { kind: "not_found" }
  | { kind: "exists" };

type ExportedTable = Extract<ExportTable, { export: true }>;

function exportedTables(): [string, ExportedTable][] {
  return Object.entries(EXPORT_MAP).flatMap(([name, table]): [string, ExportedTable][] =>
    table.export ? [[name, table]] : []
  );
}

async function primaryKey(trx: Transaction<DB>, table: string): Promise<string[]> {
  const { rows } = await sql<{ attname: string }>`
    select a.attname from pg_index i
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = ${`public.${table}`}::regclass and i.indisprimary
    order by array_position(i.indkey::int2[], a.attnum)`.execute(trx);
  if (rows.length === 0) throw new Error(`table ${table} has no primary key`);
  return rows.map((row) => row.attname);
}

function whereOf(table: string, spec: ExportedTable, orgId: string) {
  if (spec.via === "members") {
    return sql`id in (select user_id from memberships where org_id = ${orgId}::uuid)`;
  }
  return table === "organizations" ? sql`id = ${orgId}::uuid` : sql`org_id = ${orgId}::uuid`;
}

// The JSON text of the export, one chunk per batch of rows. `pg` gives `bigint` as a string, dates as `Date` (ISO in
// JSON) and `jsonb` as a value, so `JSON.stringify` is the whole conversion.
async function* exportChunks(
  trx: Transaction<DB>,
  input: { orgId: string; now: Date },
  counts: Record<string, number>,
  onTable?: (table: string) => void
): AsyncGenerator<string> {
  yield `{"format":"ea-org-export","version":1,"org_id":${JSON.stringify(input.orgId)},"exported_at":${JSON.stringify(input.now.toISOString())},"tables":{`;
  let first = true;
  for (const [table, spec] of exportedTables()) {
    yield `${first ? "" : ","}${JSON.stringify(table)}:[`;
    first = false;
    const order = await primaryKey(trx, table);
    const select = sql.join(spec.columns.map((column) => sql.ref(column)));
    const orderBy = sql.join(order.map((column) => sql.ref(column)));
    await sql`
      declare ${sql.id(CURSOR)} no scroll cursor for
      select ${select} from ${sql.table(table)} where ${whereOf(table, spec, input.orgId)} order by ${orderBy}`.execute(
      trx
    );
    let count = 0;
    for (;;) {
      const { rows } = await sql<Record<string, unknown>>`fetch ${sql.lit(BATCH_ROWS)} from ${sql.id(CURSOR)}`.execute(
        trx
      );
      if (rows.length === 0) break;
      yield `${count > 0 ? "," : ""}${rows.map((row) => JSON.stringify(row)).join(",")}`;
      count += rows.length;
    }
    await sql`close ${sql.id(CURSOR)}`.execute(trx);
    counts[table] = count;
    yield "]";
    onTable?.(table);
  }
  yield "}}";
}

// Writes all data of one organization to an encrypted file (F106 stage 05, D6, D14, D17). One `REPEATABLE READ READ ONLY`
// transaction, so the file is one snapshot. The audit row comes after the file is complete; if it fails, the file goes
// too, so a file and its audit row exist together. The audit row holds counts only; the module logs nothing, because the CLI prints the result on stdout.
//
// `onTable` runs after each table; a test uses it to fail the export half way.
export async function exportOrganization(
  db: Db,
  input: { orgId: string; recipient: string; out: string; now: Date; onTable?: (table: string) => void }
): Promise<OrgExportResult> {
  const counts: Record<string, number> = {};
  const result = await db
    .transaction()
    .setIsolationLevel("repeatable read")
    .setAccessMode("read only")
    .execute(async (trx): Promise<{ kind: "written"; bytes: number } | { kind: "not_found" } | { kind: "exists" }> => {
      const org = await trx.selectFrom("organizations").select("id").where("id", "=", input.orgId).executeTakeFirst();
      if (!org) return { kind: "not_found" };
      return writeEncryptedFile(input.out, input.recipient, exportChunks(trx, input, counts, input.onTable));
    });
  if (result.kind !== "written") return result;

  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  try {
    await recordAudit(
      db,
      { orgId: input.orgId },
      {
        actor: "cli",
        event: auditEvents.orgExported,
        data: { tables: Object.keys(counts).length, rows: total },
        at: input.now,
      }
    );
  } catch (error) {
    await unlink(input.out).catch(() => undefined);
    throw error;
  }
  return { kind: "written", bytes: result.bytes, rows: counts };
}
