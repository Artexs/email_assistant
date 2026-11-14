# F092 stage 02 — Tenant scope and the scoped driver

Part of [`../plan.md`](../plan.md). `[risky]`: tenant isolation. Decisions D7, D14, D15, D16 (scheduler part), D18. Read "Rules for every stage" and "Facts checked" (K1–K8) in `plan.md` first.

The database layer learns the organization of the current call chain and writes it to `app.org_id` on each connection acquire. Nothing calls `withTenantScope` yet (stage 03 wires the web), so after this stage every acquire writes `''` or nothing: no behaviour change, the existing tests pass unchanged.

This stage may run next to stage 01 (D22). It does not need the policies: its integration test reads `current_setting('app.org_id', true)` only.

One `[risky]` step.

## Step 1 — scope, driver, `createDb`, job ticks `[risky]`

**Goal.** Every query and every transaction runs on a connection whose `app.org_id` is the scope of its call chain (`''` without a scope); the driver writes only when the value changes and never lets a query run after a failed write.

**Files.**

- `apps/server/src/platform/db/tenant-scope.ts` (new, about 30 lines).
- `apps/server/src/platform/db/scoped-driver.ts` (new, about 90 lines).
- `apps/server/src/platform/db/index.ts`: `createDb` uses `ScopedPostgresDialect`; new optional `opts`; re-export the scope functions and `ScopedPostgresDialect`.
- `apps/server/src/platform/scheduler.ts`: `runJobTick` runs in `withoutTenantScope`.
- Tests: `apps/server/src/platform/db/tenant-scope.test.ts`, `apps/server/src/platform/db/scoped-driver.test.ts` (unit, new), `apps/server/src/platform/scheduler.test.ts` (one test added), `apps/server/test/integration/db-tenant-scope.test.ts` (new).

**Interfaces.**

```ts
// platform/db/tenant-scope.ts — D14
import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage<string | null>();

/** Runs fn with app.org_id = orgId on every connection it uses (RLS safety net, ADR 0011). */
export function withTenantScope<T>(orgId: string, fn: () => T): T; // throws Error("withTenantScope needs an organization id") on ""
/** Runs fn with no scope (app.org_id = ''): jobs and the operator routes. Also clears an outer scope. */
export function withoutTenantScope<T>(fn: () => T): T; // storage.run(null, fn)
export function currentTenantScope(): string | null; // storage.getStore() ?? null
```

```ts
// platform/db/scoped-driver.ts — D15
import { CompiledQuery, PostgresDialect, type DatabaseConnection, type Driver, type TransactionSettings } from "kysely";

const UNKNOWN = Symbol("unknown"); // a write failed: the server value is not known
export const SET_SCOPE_SQL = "select set_config('app.org_id', $1, false)";

export class ScopedDriver implements Driver {
  constructor(inner: Driver, scopeOf: () => string | null);
  // acquireConnection(options?): 1) want = scopeOf() ?? "" (before the inner acquire); 2) conn = await inner.acquireConnection(options);
  // 3) have = state.get(conn) ?? "" (no entry = a fresh connection, unset = ""); 4) if have !== want (UNKNOWN never equals):
  //    try { await conn.executeQuery(CompiledQuery.raw(SET_SCOPE_SQL, [want])); state.set(conn, want) }
  //    catch (error) { state.set(conn, UNKNOWN); await inner.releaseConnection(conn); throw error }
  // 5) return conn.
  // init, beginTransaction, commitTransaction, rollbackTransaction, releaseConnection, destroy: forward with all arguments.
  // savepoint, rollbackToSavepoint, releaseSavepoint: forward when the inner driver has the method; else throw
  //   new Error("savepoints are not supported by the inner driver").
}

export class ScopedPostgresDialect extends PostgresDialect {
  override createDriver(): Driver; // new ScopedDriver(super.createDriver(), currentTenantScope)
}
```

If `releaseConnection` itself throws inside the `catch`, rethrow the original `set_config` error (wrap the release in its own `try`, ignore its error). Forward the `options` argument of `acquireConnection`, `releaseConnection`, `init` and `destroy` where the Kysely `Driver` interface has one (K8; read `node_modules/kysely/dist/driver/driver.d.ts`).

```ts
// platform/db/index.ts
export function createDb(databaseUrl: string, opts?: { max?: number }): Db;
// new Kysely<DB>({ dialect: new ScopedPostgresDialect({ pool: new Pool({ connectionString: databaseUrl, max: opts?.max ?? 10, connectionTimeoutMillis: 5000 }) }) })
export { currentTenantScope, withoutTenantScope, withTenantScope } from "./tenant-scope";
export { ScopedPostgresDialect } from "./scoped-driver";
```

```ts
// platform/scheduler.ts — D16: a job tick never inherits a scope
export async function runJobTick(name: string, fn: () => Promise<void>): Promise<void> {
  // the existing body, wrapped: await withoutTenantScope(() => withLogContext({ … }, async () => { … }));
}
```

Comments: one line on each new export, naming ADR 0011 or the rule ("RLS safety net"); no bare codes.

**Decisions.** D7 (why per acquire), D14 (scope functions, no UUID check), D15 (driver rules 1–5, `createDb`), D16 (only `runJobTick` here; `http.ts` is stage 03), D18 (tests set the value locally only).

**Test.** Unit tests use no DB. Values: `A = "aaaaaaaa-0000-4000-8000-000000000001"`, `B = "bbbbbbbb-0000-4000-8000-000000000002"`.

`tenant-scope.test.ts`:

1. Outside any scope: `currentTenantScope()` → `null`.
2. `withTenantScope(A, () => currentTenantScope())` → `A`; after it returns, `null`.
3. `withTenantScope(A, () => withoutTenantScope(() => currentTenantScope()))` → `null`; inside A after the inner call returns → `A`.
4. Async: `withTenantScope(A, async () => { await Promise.resolve(); await new Promise((r) => setTimeout(r, 1)); return currentTenantScope(); })` → `A`.
5. `withTenantScope("", () => 1)` throws `withTenantScope needs an organization id`.
6. `Promise.all` of 10 calls alternating A and B, each awaiting `setTimeout(r, i % 3)` before reading → each returns its own value.
7. Nested `withTenantScope(B, …)` inside A → `B` inside, `A` after.

`scoped-driver.test.ts` (a fake inner `Driver` that records calls; a fake `DatabaseConnection` whose `executeQuery` records `{ sql, parameters }` and can be told to throw once; `scopeOf` reads a test variable):

8. Fresh connection, scope `null` → `acquireConnection` makes no query.
9. Same connection, scope `A` → exactly one query: `sql = "select set_config('app.org_id', $1, false)"`, `parameters = [A]`.
10. Same connection, scope `A` again (three acquires) → no new query.
11. Same connection, scope `null` → one query with `parameters = [""]`.
12. Two connections from the fake inner (`c1`, `c2`): scope `A` on `c1`, then scope `A` on `c2` → one query on each (the memory is per connection).
13. The set query throws `Error("boom")` → `acquireConnection` rejects with that error; the fake inner's `releaseConnection` was called once with that connection; the next acquire of the same connection with scope `null` runs the set query with `[""]` (state `UNKNOWN`).
14. The set query throws and the inner `releaseConnection` throws too → the rejection is the `boom` error.
15. The scope is read before the inner acquire: the fake inner's `acquireConnection` changes the test variable from `A` to `B` before it resolves → the set query has `[A]`.
16. Forwarding: `beginTransaction(c, { isolationLevel: "serializable" })`, `commitTransaction(c)`, `rollbackTransaction(c)`, `releaseConnection(c)`, `init()`, `destroy()`, `savepoint(c, "sp", compile)`, `rollbackToSavepoint(…)`, `releaseSavepoint(…)` each reach the inner driver once with the same arguments.
17. An inner driver without `savepoint` → `savepoint(c, "sp", compile)` rejects with `savepoints are not supported by the inner driver`.

`scheduler.test.ts` (added):

18. `await withTenantScope(A, () => runJobTick("scope-probe", async () => { seen = currentTenantScope(); }))` → `seen === null`. (Mock `console.log` as the other scheduler tests do.)

`apps/server/test/integration/db-tenant-scope.test.ts` (real DB as `app`; each test builds its own `createDb(process.env.DATABASE_URL ?? "", { max })` and destroys it in `finally`; `setting(db)` = `select coalesce(current_setting('app.org_id', true), '') as s`: a fresh session returns `NULL`, a session after a driver write returns `''`, and both mean "no scope" for `app_current_org()` (plan P1, D15 rule 2); the helper maps both to `""`):

19. `max: 1`: `withTenantScope(A, () => setting(db))` → `A`; then `setting(db)` outside → `""` (the same connection, reset by the next acquire).
20. `max: 1`: inside `withTenantScope(A, …)`: `db.transaction().execute((trx) => setting(trx))` → `A`.
21. `max: 1`: inside `withTenantScope(B, …)`: `db.connection().execute((conn) => conn.transaction().execute((trx) => setting(trx)))` → `B`.
22. `max: 1`: inside `withTenantScope(A, …)`: `withoutTenantScope(() => setting(db))` → `""`.
23. `max: 1`, busy pool: `Promise.all([withTenantScope(A, async () => { await sql\`select pg_sleep(0.05)\`.execute(db); return setting(db); }), withTenantScope(B, () => setting(db))])` → `[A, B]`.
24. `max: 2`: 30 calls in `Promise.all`, scope `[A, B, null][i % 3]`, each returns `{ want: scope ?? "", got: await setting(db) }` (the `coalesce` helper above) → no call with `want !== got`. Run it twice: once as written, once with the scope list shifted to `[null, A, B][i % 3]` (the first acquires of the fresh pool are unscoped).
25. `max: 1`: a transaction inside scope A that rolls back (throw inside `execute`, catch it) → the next `setting(db)` in scope A reads `A` and the next one outside reads `""` (the value lives outside the transaction).
26. `max: 1`: `withTenantScope(A, () => db.selectFrom("organizations").select("id").limit(1).execute())` works (a Kysely builder query goes through the driver too), then `setting(db)` outside → `""`.
27. `max: 1`, a chain of two queries after a pool wait: `Promise.all([withTenantScope(B, async () => { await sql\`select pg_sleep(0.05)\`.execute(db); return setting(db); }), withTenantScope(A, async () => { const first = await setting(db); const second = await setting(db); return [first, second]; })])` → `[B, [A, A]]`. The first query of the A chain waits for the connection that B holds; the second query of the chain must still read its own scope.

**Check.**

```
bun test apps/server/src/platform/db apps/server/src/platform/scheduler.test.ts && bun test apps/server/test/integration/db-tenant-scope.test.ts && bun run typecheck && bun run lint
```

Then run the whole integration suite once (`bun run test:int:ci`, it is part of the Proof): every existing test must pass unchanged. A failure in an existing test is a finding: report it, do not change the test.

**Done when.** Tests 1–27 exist and pass; `createDb` keeps its old call shape for every caller (`createDb(url)`); no other file than the ones listed changes.

**Out of scope.** `platform/http.ts` (stage 03); any migration; any log line; a cache or a TTL for the scope; a UUID check in code (D14).

## Stage done when

Step 1 is done, and the Proof of `plan.md` for stages 01 and 02 passes with `NN = 02` (`/tmp/f092-s02`).
