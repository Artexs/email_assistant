import { Client } from "pg";

// Reads the name the way `pg` does, so the guard and the connection agree. No connection is opened.
export function databaseNameOf(url: string): string | null {
  try {
    const { protocol } = new URL(url);
    if (protocol !== "postgres:" && protocol !== "postgresql:") return null;
    return new Client({ connectionString: url }).database ?? null;
  } catch {
    return null;
  }
}
// A seed database: `*_e2e` (the panel e2e run) or `*_demo` (the demo recording, `apps/web/e2e/demo/`). Both are throw-away databases
// that a script made for this use; the demo recording rebuilds its own at each run.
export function isE2eDatabaseName(name: string | null): boolean {
  return name !== null && /^[A-Za-z0-9_]+_(e2e|demo)$/.test(name);
}
export function seedTargetOk(
  appUrl: string,
  migratorUrl: string
): { ok: true; database: string } | { ok: false; reason: string } {
  const appName = databaseNameOf(appUrl);
  const migratorName = databaseNameOf(migratorUrl);
  if (!isE2eDatabaseName(appName)) {
    return { ok: false, reason: `DATABASE_URL is not an e2e database (${appName ?? "unparsable"})` };
  }
  if (!isE2eDatabaseName(migratorName)) {
    return { ok: false, reason: `MIGRATOR_DATABASE_URL is not an e2e database (${migratorName ?? "unparsable"})` };
  }
  if (appName !== migratorName) {
    return { ok: false, reason: `the two URLs name different databases (${appName}, ${migratorName})` };
  }
  return { ok: true, database: appName as string };
}
