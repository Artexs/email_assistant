// The demo recording drops and migrates its database at each run, so the database must be its own: a name that ends in `_demo`,
// and a target that is none of the other databases of the checkout (`DATABASE_URL`, `E2E_DATABASE_URL`).
export const DEMO_DB_REFUSED = "demo_db_refused";

// host, port and database name; the user and the password do not make a database another one.
function targetOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
    if (name === "") return null;
    return `${parsed.hostname}:${parsed.port === "" ? "5432" : parsed.port}/${name}`;
  } catch {
    return null;
  }
}

// null: the URL may be used. `demo_db_refused`: the record command exits 1 with it, before any change.
export function demoDbProblem(url: string, others: readonly (string | undefined)[]): string | null {
  const target = targetOf(url);
  if (target === null) return DEMO_DB_REFUSED;
  if (!target.slice(target.lastIndexOf("/") + 1).endsWith("_demo")) return DEMO_DB_REFUSED;
  for (const other of others) {
    if (other === undefined || other === "") continue;
    if (targetOf(other) === target) return DEMO_DB_REFUSED;
  }
  return null;
}
