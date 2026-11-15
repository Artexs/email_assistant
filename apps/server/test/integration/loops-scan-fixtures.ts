import { sql, type Transaction } from "kysely";

import type { DB } from "../../src/platform/db";

// Every table of the schema with a row that holds one of `needles` (the whole row as text, jsonb included).
export async function tablesHolding(trx: Transaction<DB>, needles: readonly string[]): Promise<string[]> {
  const { rows: tables } = await sql<{ table_name: string }>`
    select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`.execute(
    trx
  );
  const found: string[] = [];
  for (const { table_name: name } of tables) {
    for (const needle of needles) {
      const { rows } = await sql<{ n: string }>`
        select count(*) as n from ${sql.table(name)} t where t::text like ${`%${needle}%`}`.execute(trx);
      if (Number(rows[0]?.n ?? 0) > 0) {
        found.push(name);
        break;
      }
    }
  }
  return found.sort();
}
