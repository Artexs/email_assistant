import { afterAll, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import { EXPORT_MAP } from "../../src/modules/privacy";

import { testDb } from "./helpers";

// F106 stage 05: `EXPORT_MAP` names every table and column of the database. A new table or column fails here until the
// map classifies it (D18).
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const SKIPPED = [
  "auth_accounts",
  "auth_lockouts",
  "auth_sessions",
  "auth_two_factors",
  "auth_verifications",
  "chat_link_tokens",
  "dsr_tombstones",
  "mailbox_credentials",
  "schema_migrations",
];

// The catalog tables, not `information_schema`: the `app` role sees there only the tables it has a privilege on, and it has
// none on `schema_migrations`.
async function catalog(): Promise<Map<string, string[]>> {
  const { rows } = await sql<{ table_name: string; column_name: string }>`
    select c.relname as table_name, a.attname as column_name
    from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where n.nspname = 'public' and c.relkind in ('r', 'p')
    order by 1, a.attnum`.execute(db);
  const tables = new Map<string, string[]>();
  for (const row of rows) tables.set(row.table_name, [...(tables.get(row.table_name) ?? []), row.column_name]);
  return tables;
}

describe("EXPORT_MAP", () => {
  test("1. every table of the public schema is a key, and every key is a table", async () => {
    const tables = [...(await catalog()).keys()].sort();
    expect(Object.keys(EXPORT_MAP).sort()).toEqual(tables);
  });

  test("2. for each exported table, columns and excluded columns make exactly the columns of the table", async () => {
    const tables = await catalog();
    for (const [name, spec] of Object.entries(EXPORT_MAP)) {
      if (!spec.export) continue;
      const mapped = [...spec.columns, ...Object.keys(spec.excluded)].sort();
      expect({ name, columns: mapped }).toEqual({ name, columns: [...(tables.get(name) ?? [])].sort() });
      for (const column of Object.keys(spec.excluded)) expect(spec.columns).not.toContain(column);
    }
  });

  test("3. no table of the skip list is exported, and no other table is skipped", () => {
    for (const name of SKIPPED) expect(EXPORT_MAP[name]).toMatchObject({ export: false });
    const notExported = Object.entries(EXPORT_MAP)
      .filter(([, spec]) => !spec.export)
      .map(([name]) => name)
      .sort();
    expect(notExported).toEqual([...SKIPPED].sort());
  });

  test("4. users is an allow-list without secrets, and no exported column is a secret", () => {
    const users = EXPORT_MAP.users;
    if (!users?.export) throw new Error("users must be exported");
    expect(users.via).toBe("members");
    expect(users.columns).toEqual([
      "id",
      "email",
      "display_name",
      "locale",
      "terms_version",
      "terms_accepted_at",
      "two_factor_enabled",
      "created_at",
    ]);
    for (const spec of Object.values(EXPORT_MAP)) {
      if (!spec.export) continue;
      for (const column of spec.columns) {
        expect(column).not.toMatch(/password|secret|token_hash|^token$|backup_codes|_token$/);
      }
    }
  });
});
