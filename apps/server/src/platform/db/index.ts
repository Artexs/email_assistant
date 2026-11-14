import { Kysely, sql } from "kysely";
import { Pool } from "pg";

import type { DB } from "./schema";
import { ScopedPostgresDialect } from "./scoped-driver";

export type { DB } from "./schema";
export type { TenantContext } from "./tenant-context";

export { currentTenantScope, withoutTenantScope, withTenantScope } from "./tenant-scope";
export { ScopedPostgresDialect } from "./scoped-driver";

export type Db = Kysely<DB>;

/** One pool, one ScopedPostgresDialect: every connection carries the scope of its call chain (RLS safety net, ADR 0011). */
export function createDb(databaseUrl: string, opts?: { max?: number }): Db {
  return new Kysely<DB>({
    dialect: new ScopedPostgresDialect({
      pool: new Pool({ connectionString: databaseUrl, max: opts?.max ?? 10, connectionTimeoutMillis: 5000 }),
    }),
  });
}

export async function checkDb(db: Db): Promise<boolean> {
  try {
    await sql`select 1`.execute(db);
    return true;
  } catch {
    return false;
  }
}

export class DbRoleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DbRoleError";
  }
}

export async function assertAppRole(db: Db): Promise<void> {
  const result = await sql<{ role: string; rolsuper: boolean }>`
    select current_user as role, r.rolsuper
    from pg_roles r
    where r.rolname = current_user
  `.execute(db);
  const row = result.rows[0];
  if (row?.role !== "app" || row.rolsuper !== false) {
    throw new DbRoleError(`The server must connect as the DB role "app", not as "${row?.role ?? "unknown"}"`);
  }
}
