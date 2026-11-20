import { Client } from "pg";

// Empties the demo database before a recording: every table, view, type and function of the `public` schema goes, then `db:migrate` builds
// the schema again. The migrator role is not the owner of the database, so it cannot drop the schema or the database: it drops the objects it
// owns one by one. The caller has passed `demoDbProblem` first: this function trusts its URL.
export async function resetDemoDb(migratorUrl: string): Promise<void> {
  const client = new Client({ connectionString: migratorUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    const tables = await client.query<{ name: string }>(
      `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f') AND c.relispartition = false
         AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')`
    );
    for (const { name } of tables.rows)
      await client.query(`DROP TABLE IF EXISTS public."${name.replace(/"/g, '""')}" CASCADE`);
    const types = await client.query<{ name: string }>(
      `SELECT t.typname AS name FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = 'public' AND t.typtype IN ('e', 'd', 'c') AND t.typrelid = 0
         AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = t.oid AND d.deptype = 'e')`
    );
    for (const { name } of types.rows)
      await client.query(`DROP TYPE IF EXISTS public."${name.replace(/"/g, '""')}" CASCADE`);
    const functions = await client.query<{ signature: string }>(
      `SELECT p.oid::regprocedure::text AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
         AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')`
    );
    for (const { signature } of functions.rows) await client.query(`DROP FUNCTION IF EXISTS ${signature} CASCADE`);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}
