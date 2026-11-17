import { dataCategories, NO_PERSONAL_DATA_TABLES, tableOfEntry } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import { DSR_ADDRESS_MAP } from "../../src/modules/privacy";
import { createDb, type Db } from "../../src/platform/db";

// F107 stage 01: every table of the database is in a data category or in `NO_PERSONAL_DATA_TABLES`. A new table fails here
// until the registry names it (the privacy page and the records of processing read the registry).
//
// The catalog is read as the migrator role: the `app` role sees only the tables it has a privilege on.
const migratorUrl = process.env.MIGRATOR_DATABASE_URL;
if (!migratorUrl) {
  throw new Error("MIGRATOR_DATABASE_URL is missing: the integration tests need it");
}
const db = createDb(migratorUrl);

afterAll(async () => {
  await db.destroy();
});

// The tables of the public schema that no category and no `NO_PERSONAL_DATA_TABLES` entry names.
async function uncoveredTables(executor: Db): Promise<string[]> {
  const { rows } = await sql<{ table_name: string }>`
    select c.relname as table_name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by 1`.execute(executor);
  const covered = new Set([
    ...dataCategories.flatMap((category) => category.columns.map(tableOfEntry)),
    ...Object.keys(NO_PERSONAL_DATA_TABLES),
  ]);
  return rows.map((row) => row.table_name).filter((table) => !covered.has(table));
}

describe("data categories and the database", () => {
  test("5. every table is in a category or in NO_PERSONAL_DATA_TABLES, and every named table exists", async () => {
    expect(await uncoveredTables(db)).toEqual([]);
    const { rows } = await sql<{ table_name: string }>`
      select c.relname as table_name from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'`.execute(db);
    const tables = new Set(rows.map((row) => row.table_name));
    const named = [
      ...dataCategories.flatMap((category) => category.columns.map(tableOfEntry)),
      ...Object.keys(NO_PERSONAL_DATA_TABLES),
    ];
    expect(named.filter((table) => !tables.has(table))).toEqual([]);
  });

  test("5b. every table.column entry is a column of the database", async () => {
    const { rows } = await sql<{ table_name: string; column_name: string }>`
      select c.relname as table_name, a.attname as column_name
      from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      where n.nspname = 'public' and c.relkind = 'r'`.execute(db);
    const columns = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`));
    const missing = dataCategories
      .flatMap((category) => category.columns)
      .filter((entry) => !entry.endsWith(".*") && !columns.has(entry));
    expect(missing).toEqual([]);
  });

  test("6. a new table is reported as missing, and the transaction leaves no trace", async () => {
    const seen = await db
      .transaction()
      .execute(async (trx) => {
        await sql`create table f107_probe (id int)`.execute(trx);
        const missing = await uncoveredTables(trx);
        throw Object.assign(new Error("rollback"), { missing });
      })
      .catch((error: Error & { missing?: string[] }) => {
        if (error.missing === undefined) throw error;
        return error.missing;
      });
    expect(seen).toContain("f107_probe");
    expect(await uncoveredTables(db)).toEqual([]);
  });

  test("7. every column of the DSR address map is in a category that covers people who are not members", () => {
    for (const [table, columns] of Object.entries(DSR_ADDRESS_MAP)) {
      for (const column of Object.keys(columns)) {
        const category = dataCategories.find(
          (candidate) => candidate.columns.includes(`${table}.${column}`) || candidate.columns.includes(`${table}.*`)
        );
        expect({ entry: `${table}.${column}`, category: category?.id }).toEqual({
          entry: `${table}.${column}`,
          category: expect.any(String),
        });
        expect({ entry: `${table}.${column}`, others: category?.subjects.includes("others") }).toEqual({
          entry: `${table}.${column}`,
          others: true,
        });
      }
    }
  });

  test("8b. defaultDays of an orgSetting category is the default of organizations.data_retention_days", async () => {
    const { rows } = await sql<{ column_default: string }>`
      select pg_get_expr(d.adbin, d.adrelid) as column_default
      from pg_attrdef d
        join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
        join pg_class c on c.oid = d.adrelid
        join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'organizations' and a.attname = 'data_retention_days'`.execute(db);
    const dbDefault = Number(rows[0]?.column_default);
    expect(Number.isInteger(dbDefault)).toBe(true);
    const settings = dataCategories.flatMap((category) =>
      category.kept.kind === "orgSetting" ? [category.kept.defaultDays] : []
    );
    expect(settings.length).toBeGreaterThan(0);
    for (const defaultDays of settings) expect(defaultDays).toBe(dbDefault);
  });
});
