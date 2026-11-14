# F092 · RLS safety net: plan

> **Status 2026-11-14 — planned.** Four stages written. Cold review: the coordinator runs it (task rule of this planning job). Builds after F087 (closed). Nothing is built yet.

Ticket: [ticket.md](ticket.md). Open defaults for the owner: [questions.md](questions.md).

## Planning progress

- [x] Collect: ticket, plan input, review §3.9 and §6–§8, `07-foundation-plan.md`, `05-execution-plan.md` §2, ADR 0011 and 0027, `docs/architecture.md` §5 and §7, `docs/code-patterns.md`, the styleguide, the code of `platform/{http,scheduler}.ts`, `platform/db/`, `web.ts`, every `routes.ts`, `mail/remove.ts`, `config/rules.ts`, the migrations, the test helpers.
- [x] Facts checked (Postgres probes P1–P9, Kysely and Bun probes K1–K8, source reads).
- [x] Decisions D7–D22.
- [x] stage-01-policies [written]
- [x] stage-02-tenant-scope [written]
- [x] stage-03-web-scope [written]
- [x] stage-04-docs [written]
- [ ] Cold review: the coordinator runs it and files `plan-review-1.md`.

## Input

### Owner words (planning job task, 2026-11-14), word for word

> Use the plan-task skill to plan F092 (spec/features/planned/F092-rls-safety-net). The owner decision: RLS joins the foundation group (default yes), 4 stages as in docs/product/stage-2/06-architecture-review.md §3.9 / P7. It builds on F087 (closed). Read the CURRENT code. Write plan.md and stages/ in that folder. Do not edit spec/build.md, the §2.1 table or other epics' pages; report outside edits. One migration only.

Review §3.9 recommendation, word for word:

> Postgres RLS as a safety net, not as the filter: policies on every table with `org_id` that compare to `current_setting('app.org_id', true)`; `requireTenant` opens the request transaction with `SET LOCAL app.org_id`; jobs and the operator module run as today with a policy that admits a null setting only for the `jobs` path, or a second role. Existing repository code does not change. This turns "a missed `org_id` filter in one of 250 stages" from a data leak into a 0-row result, and it is a sentence an auditor understands (E10 security page). The `information_schema` test of E7 (every table with `org_id` joins delete, DSR and now RLS) is the guard that keeps it complete.

- **P1** RLS joins the foundation group (owner, 2026-11-14; review §8 decision 2).
- **P2** Four stages (owner, 2026-11-14; review §6 row P7).
- **P3** One migration (owner, 2026-11-14).

### Plan input of 2026-11-13 (the old `plan.md`), word for word

> Written 2026-11-13 from the architecture review §3.9. Input of the `plan-task` session. Ticket: [ticket.md](ticket.md). Optional: the owner decides (review §8, decision 2). Runs after F087; one migration.

Facts (2026-11-13), as written:

- Tenant isolation is in code: every repository function takes `TenantContext` and filters by `org_id`; `docs/code-patterns.md` lists the exceptions (jobs that walk organizations, user-keyed auth tables). There is no RLS (ADR 0027 context).
- Roles: `migrator` owns the tables (bypasses RLS as owner unless `FORCE`), `app` is the server's role with `NOINHERIT` (`db/roles.sql`). Policies apply to `app`.
- Tables with `org_id` (migrations, 2026-11-13): `mailboxes`, `mailbox_folders`, `mailbox_credentials`, `mailbox_settings`, `emails`, `sender_rules`, `triage_results`, `triage_feedback`, `actions`, `audit_log`, `chat_links`, `chat_link_tokens`, `digests`, `outbox`, `delegates`, `delegations`, `memberships`, plus `org_features` (F087). `organizations` is keyed by `id`. `users`, `auth_*`, `auth_lockouts` are user-keyed.
- `platform/http.ts`: `requireTenant` resolves the organization from the session and sets `ctx` on the Hono context; routers get `db` through their deps at startup (`settingsRoutes(deps)` with `deps.db`), and most repository functions accept `Db | Transaction<DB>`.
- `pg` pools connections; a session-level `SET` would leak to the next request. `SET LOCAL` inside a transaction is safe.

Design decisions, as written:

- **D1 Policy shape.** For each table: `ALTER TABLE t ENABLE ROW LEVEL SECURITY; CREATE POLICY tenant_rows ON t FOR ALL TO app USING (current_setting('app.org_id', true) IS NULL OR org_id = current_setting('app.org_id', true)::uuid) WITH CHECK (same)`. An unset setting admits every row (the jobs and CLIs path is unchanged); a set setting limits reads and writes to one organization. `organizations` gets the same policy on `id`.
- **D2 Request transaction.** `requireTenant` opens `db.transaction()` for the request, runs `SET LOCAL app.org_id = $1`, puts the transaction on the context as `c.var.db`, and commits after the handler (rolls back on a thrown error). Route deps that hold `db` from startup change to read `c.var.db`; the plan-task session lists the route files (`tenancy`, `mail`, `config`, `triage`, `reports`, `channels` routes) and the services they call. Long requests (mailbox connect runs an IMAP login, up to 90 s) hold a transaction open: acceptable at this scale, but the connect route may opt out and set the setting in its own short transactions instead; the plan decides per route.
- **D3 Operator exception.** `requireOperator` routes (F087) do not set the setting; the test that walks the route list knows this allow-list.
- **D4 Tests.** `apps/server/test/integration/rls.test.ts`: for each table from `information_schema.columns where column_name = 'org_id'`: the policy exists; a raw `select` under `SET LOCAL app.org_id = A` returns no B row. This is the same table walk as the E7 delete test and the DSR map, so later tables cannot escape it.
- **D5 Docs.** `docs/architecture.md` §5 Tenancy: "RLS is a safety net under the code filter; the web request sets `app.org_id`; jobs run unset." `docs/code-patterns.md` § Data access: the new-table checklist adds the policy. The E10 security page can cite the test.

Stages, as written: 1. Migration and policy test. 2. Request transaction. 3. Docs. Open questions, as written: the connect and password-check routes in the request transaction (default: their own short ones); `audit_log` keeps `INSERT`-only for `app` under the policy.

### Design decisions of this plan (D7–D22)

D1, D3, D4 and D5 stay, made exact below. **D2 is replaced by D7** (reason there). "Default, owner to confirm" marks a small question that is also in [questions.md](questions.md); the stages do not change with its answer.

- **D7 A tenant scope per connection acquire, not a request transaction (replaces D2; default, owner to confirm, Q1).** `platform/db/tenant-scope.ts` keeps the organization id of the current async call chain in an `AsyncLocalStorage`. `platform/db/scoped-driver.ts` wraps the Kysely Postgres driver: on every connection acquire it reads the scope and, when the value differs from the one it last wrote on that connection, runs `select set_config('app.org_id', $1, false)` with the organization id, or with `''` when there is no scope. `requireTenant` runs the rest of the request inside `withTenantScope(orgId, …)`. Every query and every transaction of the request then runs with the setting of its organization, on any pooled connection; jobs, CLIs and the operator routes get `''`.
  - Reasons against D2: the server code has 40 `.transaction()` calls. Most web-path services already accept a caller's transaction (`db.isTransaction ? run(db) : db.transaction().execute(run)`), but `mail/remove.ts:44` and the `/me/terms` route (`tenancy/routes.ts:115`) call `db.transaction()` directly, and Kysely throws on `transaction()` of a `Transaction` (K1); D2 would have to change them. A request transaction also changes error semantics: `addSenderRule` maps a foreign-key error to `mailbox_not_found` only when it owns the transaction (`config/rules.ts:58-66`), and a Postgres error aborts the whole outer transaction, so the same race answers 500 and every later query of the request fails. The connect route would hold a transaction across an IMAP login (25 s deadline, `WEB_MAIL_TIMEOUTS`). The ticket keeps service and repository code unchanged.
  - Why a session-level value is safe here: every acquire writes the value of its own call chain before the first query, so a value left on a pooled connection is never read by the next user of the connection (K2, K5, K6). The value lives outside any transaction, so a rollback does not undo it (`set_config` runs before `begin`).
  - Rejected: Kysely's `onReserveConnection` hook (same idea, less code): when the hook throws, `PostgresDriver.acquireConnection` never releases the pg client (K3), so a failed `set_config` would leak a pool slot. Rejected: a second pool for the web (the jobs path still needs a reset, and two pools double the connections).
- **D8 Policy shape (D1 made exact).** One SQL function holds "unset": `app_current_org() RETURNS uuid LANGUAGE sql STABLE PARALLEL SAFE AS 'SELECT nullif(current_setting(''app.org_id'', true), '''')::uuid'`. Each table: `ALTER TABLE <t> ENABLE ROW LEVEL SECURITY; CREATE POLICY tenant_rows ON <t> FOR ALL TO app USING (app_current_org() IS NULL OR org_id = app_current_org()) WITH CHECK (app_current_org() IS NULL OR org_id = app_current_org());` and on `organizations` with `id`. Reasons: after a `SET LOCAL` or a `set_config(…, '')`, `current_setting('app.org_id', true)` is `''`, not `NULL` (P1), and `''::uuid` is an error; D1 as written would break every query of a connection that once had the setting. The function keeps the rule in one place; Postgres inlines it (P8: the plan still uses the `org_id` index). A value that is not a UUID raises `22P02` on the first query: fail closed (P7). No `FORCE` (ticket: out of scope): `migrator` and `SECURITY DEFINER` functions owned by it bypass the policies (P6).
- **D9 The table list.** 18 tables with `org_id` (checked against `platform/db/schema.ts`, 2026-11-14; every `org_id` is `NOT NULL`): `actions`, `audit_log`, `chat_link_tokens`, `chat_links`, `delegates`, `delegations`, `digests`, `emails`, `mailbox_credentials`, `mailbox_folders`, `mailbox_settings`, `mailboxes`, `memberships`, `org_features`, `outbox`, `sender_rules`, `triage_feedback`, `triage_results`; plus `organizations` on `id` = 19 policies. The migration names each table explicitly (greppable, reviewable). Stage 01 checks the job DB catalog first: a table with `org_id` that another ticket landed in between joins the migration the same way (the measure ticket F100 plans `email_headers`, `email_flags`, `action_feedback`).
- **D10 The catalog test (D4 made exact).** The walk reads `pg_catalog` (`pg_class`, `pg_namespace`, `pg_attribute`, `pg_policies`), not `information_schema.columns`: the latter shows only columns the role has a privilege on, so a table without a grant would escape. The walk fails when a table with `org_id` (or `organizations`) lacks RLS, has `FORCE`, has no `tenant_rows` policy or another policy text, or when a table without `org_id` has RLS on (an RLS table with no policy denies `app` everything). The expected policy text is the one Postgres stores (P9).
- **D11 Per-table isolation test.** The test seeds two organizations with at least one row in each of the 19 tables (in one rolled-back transaction), sets `app.org_id` locally and counts per table. A catalog table that is not in the seeded list still gets the policy text check of D10 (the same text gives the same behaviour); the new-table checklist asks for a seed row too (stage 04).
- **D12 `delete_mailbox` checks the scope (default, owner to confirm, Q2).** The function is `SECURITY DEFINER`, owned by `migrator`, so it bypasses RLS (P6). The migration replaces its body (the current one is in `20261113100001_outbox_view.sql`) with one new first statement: `IF public.app_current_org() IS NOT NULL AND p_org_id <> public.app_current_org() THEN RAISE EXCEPTION 'mailbox not found' USING ERRCODE = 'P0002'; END IF;`. Same error code as a missing mailbox, so `removeMailbox` answers `not_found` as today (`mail/remove.ts:21`). The catalog test checks that every `SECURITY DEFINER` function in `public` calls `app_current_org()`. Rejected: leave the definer path unguarded (it is the one web path that RLS would not cover).
- **D13 `audit_log` stays insert-only.** `app` keeps only `INSERT` and `SELECT` (`20261104000001_triage.sql:120`). The `FOR ALL` policy admits an insert with `RETURNING` for the scoped organization and refuses one for another organization (P3). No grant changes.
- **D14 Scope interfaces (`platform/db/tenant-scope.ts`).** `withTenantScope<T>(orgId: string, fn: () => T): T` (throws `Error("withTenantScope needs an organization id")` on `""`: an empty id would mean "all rows"); `withoutTenantScope<T>(fn: () => T): T` (runs `fn` with no scope, also inside a scope); `currentTenantScope(): string | null`. No UUID check in code: the `::uuid` cast in `app_current_org()` refuses a bad value at the first query (P7). Exported from `platform/db/index.ts`.
- **D15 The driver (`platform/db/scoped-driver.ts`).** `ScopedDriver implements Driver` wraps an inner `Driver` and a `scopeOf: () => string | null` function; `ScopedPostgresDialect extends PostgresDialect` returns `new ScopedDriver(super.createDriver(), currentTenantScope)` from `createDriver()`. Rules:
  1. Read the wanted value (`scopeOf() ?? ""`) before the inner acquire.
  2. Per connection, remember the last value written (`WeakMap<DatabaseConnection, string | typeof UNKNOWN>`). A connection with no entry is fresh: its value is unset, which equals `""` (P1). Kysely keeps one `PostgresConnection` object per pg client (K4), so the map key is stable.
  3. When the wanted value differs, run `CompiledQuery.raw("select set_config('app.org_id', $1, false)", [want])` on that connection, then remember it.
  4. When that query throws: remember `UNKNOWN`, release the connection to the inner driver, and rethrow the error (fail closed: no query runs with a wrong value). A later acquire of that connection always writes.
  5. Forward `init`, `beginTransaction`, `commitTransaction`, `rollbackTransaction`, `savepoint`, `rollbackToSavepoint`, `releaseSavepoint`, `releaseConnection` and `destroy` with all their arguments. A savepoint method that the inner driver lacks throws `Error("savepoints are not supported by the inner driver")`.
  - `createDb(databaseUrl, opts?: { max?: number })` uses `ScopedPostgresDialect`; `max` defaults to 10 (today's value); tests pass a small `max`.
- **D16 Where the scope is set and cleared.** Only three places call the scope functions (a unit test checks it, stage 03): `requireTenant` (`withTenantScope(first.org_id, () => next())`), `requireOperator` (`withoutTenantScope(() => next())` after the operator check passes), and `runJobTick` in `platform/scheduler.ts` (`withoutTenantScope` around the job tick, so a job can never inherit a scope even if a request started its timer). Everything else inherits.
- **D17 The web exceptions (D3 made exact; default, owner to confirm, Q3).** Unscoped web paths: `/api/operator/*` (by design, cross-organization reads), `/api/auth/*` (Better Auth, mounted on the app outside the `/api` tenant middleware; its hooks `auditWebEvent` and `termsAcceptedHandler` already name the organization of the user's oldest membership), `/health`, and the page paths (`/`, the static pages; `homePath` reads with the code filter). The membership lookup inside `requireTenant` itself runs before the scope (it finds the scope). The route-walk test lists `/api/operator/` as the one `/api` exception.
- **D18 Tests set the value only locally.** A test sets `app.org_id` with `select set_config('app.org_id', $1, true)` inside a transaction (it ends with the transaction), never with a session-level `SET` or `set_config(…, false)`: the driver's per-connection memory would then be wrong. Only the driver writes the session value.
- **D19 Deploy order does not matter.** Policies without the scope code admit every row (nothing sets the value); the scope code without the policies writes a setting nobody reads. So stage 01 may deploy before or after stages 02–03. A code rollback leaves the policies (admit all); `db:rollback` of the migration is safe too.
- **D20 Long-lived work started in a request.** No route starts background work today (grep for `void (`, `setTimeout`, `.start(` in `routes.ts`, `connect*.ts`, `remove.ts`, 2026-11-14). If a later feature starts long-lived work from a request, it runs it inside `withoutTenantScope` or it stays in the organization of that request. Stage 04 writes this rule.
- **D21 No start check.** The server does not check at start that the policies exist (a missing migration = admit all, today's behaviour). The deploy order in `deploy/README.md` runs `db:migrate` before the start. Default, owner to confirm (Q4).
- **D22 Stage order.** Stage 01 (migration, tests) and stage 02 (driver, scope) touch different files and do not depend on each other: they may run in parallel. Stage 03 needs both (its tests read the policies and the scope). Stage 04 (docs) names what 01–03 built.

## Differences found at collect (2026-11-14)

- The owner asked for 4 stages; the old input had 3. This plan has 4: policies, scope and driver, web wiring, docs.
- D2 (request transaction, `c.var.db`) does not fit the code: see D7. No route file and no route dependency changes.
- D1 as written breaks after the first `SET LOCAL` on a pooled connection (P1): D8 uses `nullif(…, '')`.
- D4 named `information_schema.columns`; D10 uses `pg_catalog` (reason there). No organization-delete test and no DSR map exist yet (E7-T3 builds them); F092 builds the first catalog walk.
- `delete_mailbox` (`SECURITY DEFINER`) was not in the input; it bypasses RLS: D12.
- `docs/architecture.md` §5 (line 305) and ADR 0011 (line 21) say "Option for S6: RLS … per transaction": stage 04 updates both.
- The tenancy capability page (`docs/capabilities/tenancy-and-plans.md`) is written by the E1 ticket (F095 stage 07) and lists "RLS not in place" as a limit. Stage 04 updates it if it exists then.
- The board's §2.1 table and the foundation plan say 3 stages for F092 (`07-foundation-plan.md` row 8): the coordinator corrects it (final message of this planning job).

## Facts checked (2026-11-14)

Probes ran in `.tmp-f092-probe/` of the planning worktree (deleted after): a throw-away Postgres 18.6 cluster (local `initdb`; the server image and CI use Postgres 17, and every behaviour used here exists since Postgres 9.6), roles as in `db/roles.sql` (`migrator` owns the tables, `app` with `NOINHERIT`), default privileges as in `20261103000001_app_grants.sql`, `audit_log` with `UPDATE`, `DELETE` revoked, and a `SECURITY DEFINER` `delete_mailbox` owned by `migrator`.

- **P1** A fresh session: `current_setting('app.org_id', true)` is `NULL`. After a committed transaction with `set_config('app.org_id', A, true)`: `''` (not `NULL`). After `set_config('app.org_id', '', false)`: `''`.
- **P2** Under `app.org_id = A`, a raw `select` returns only A rows of `mailboxes`, `emails`, `organizations`. An `INSERT` of a B row and an `UPDATE` that moves an A row to B fail with `new row violates row-level security policy for table "<t>"` (SQLSTATE `42501`). `UPDATE` and `DELETE` of a B row change 0 rows.
- **P3** `audit_log` (app: `INSERT`, `SELECT` only): an insert for A with `RETURNING` under A succeeds; one for B fails with `42501`.
- **P4** `INSERT … ON CONFLICT DO NOTHING` on a global unique key held by a hidden B row inserts nothing and raises nothing; a plain insert raises `23505` (the existence of a row is visible through a unique error, as without RLS). Every `onConflict` in `modules/` is `doNothing` or keyed by `org_id` (grep, 2026-11-14).
- **P5** Foreign-key checks and `ON DELETE CASCADE` ignore RLS: an insert under A that references an organization hidden by the policy passes the FK check; deleting an organization cascades to its rows. (Postgres docs, "Row Security Policies": referential integrity checks bypass row security.)
- **P6** A `SECURITY DEFINER` function owned by `migrator` deletes a B row while `app.org_id = A` (owner bypass without `FORCE`).
- **P7** `app.org_id = 'not-a-uuid'`: the next query on an RLS table fails with `invalid input syntax for type uuid` (`22P02`).
- **P8** `app_current_org()` (`LANGUAGE sql STABLE`) is inlined: `EXPLAIN` of `where org_id = $A and address = $x` under the policy shows `Index Scan … Index Cond: (org_id = …) AND (address = …)` with the policy as a `Filter`; an `ILIKE` predicate still uses the `org_id` index (bitmap scan).
- **P9** `pg_policies` as `app`: `policyname = tenant_rows`, `permissive = PERMISSIVE`, `roles = {app}`, `cmd = ALL`, `qual` and `with_check` = `((app_current_org() IS NULL) OR (org_id = app_current_org()))` (for `organizations`: `id` instead of `org_id`). `pg_class.relrowsecurity = t`, `relforcerowsecurity = f`. `app` can read `pg_policies` and `pg_class`.
- **K1** Kysely 0.29.8 (`node_modules/kysely/dist/kysely.js:567`): `Transaction.transaction()` throws `calling the transaction method for a Transaction is not supported`.
- **K2** Bun 1.4.4 (the `.bun-version` of CI and the image) with Kysely 0.29.8 and `pg` 8.23.1 (probe `ts/probe.ts`, a `ScopedDriver` as D15): scope A → 51 rows of A; then an unscoped query on the same one-connection pool → all rows and setting `''`.
- **K3** `PostgresDriver.acquireConnection` (`dialect/postgres/postgres-driver.js:22-46`) awaits `onReserveConnection` after `pool.connect()` with no `try`: a throw there leaves the pg client checked out.
- **K4** `PostgresDriver` keeps one `PostgresConnection` per pg client in a `WeakMap` (`#connections`, same file).
- **K5** Three queries in one scope on one connection: one `set_config` call in total. A transaction in scope A reads A inside. `db.connection().execute` with a nested `transaction()` in scope B reads B. `withoutTenantScope` inside A reads `''`.
- **K6** One-connection pool: a slow query in scope A (`pg_sleep(0.2)`) and a waiting query in scope B: each reads its own value. Thirty queries over A, B and no scope on a two-connection pool: 0 mismatches.
- **K7** Hono 4.13.16: a middleware `(c, next) => scope.run(orgId, () => next())` on `/api/*` → the handler reads A and 51 rows; a later `scope.run(null, () => next())` on `/api/operator/*` → `''` and all rows; after the requests the scope is empty.
- **K8** Kysely's `Driver` interface (0.29.8, `driver/driver.d.ts`): `init`, `acquireConnection`, `beginTransaction`, `commitTransaction`, `rollbackTransaction`, optional `savepoint`, `rollbackToSavepoint`, `releaseSavepoint`, `releaseConnection`, `destroy`, each with an optional `options` argument where the interface has one.
- **Code facts:** `apiRouters` (`web.ts:240-289`) mounts every router with the startup `db`; `createApp` (`platform/http.ts`) registers `requireSession`, `requireTenant`, `requireOperator` on `/operator/*`, `refuseSuspendedWrites`, then `web.routers`; `/api/auth/*` is on the app, outside `api`. Better Auth uses its own `pg` pool (`platform/auth.ts:487`) on the `auth_*` tables and `users` (no RLS). `runJobTick` (`platform/scheduler.ts:16`) is the one job entry of the server process. The test helpers `webTestApp`, `webOrg`, `as` (`test/integration/web-helpers.ts`), `withRollback` (`helpers.ts`), `fillMailbox` (`mailbox-rows.ts`), `createOrgWithMailbox`, `linkChat` (`fixtures.ts`), `insertDigest` (`reports/repo.ts`), `insertLinkToken` (`channels/repo.ts`), `upsertOrgFeature` (`tenancy/repo.ts`) exist. `web-suspended.test.ts` already walks `app.routes`. Int tests connect as `app` (`helpers.ts` `testDb`).

## Not verified

- The probes ran on Postgres 18.6, not 17. Stage 01 runs every policy test on the job DB (the Postgres of the dev stack and CI): the stage proof is the check.
- The e2e suite on the scoped path: stage 03 runs `bun run test:e2e` in its proof.
- Kysely's `controlledTransaction()` and `.stream()` under the scope: no code uses them (grep, 2026-11-14); both acquire through the same driver call, so D15 covers them. No stage tests them.

## Done when

1. Every table with `org_id` and `organizations` has RLS on, no `FORCE`, and exactly the `tenant_rows` policy of D8; no other table has RLS on; every `SECURITY DEFINER` function calls `app_current_org()`. Shown by: `apps/server/test/integration/rls-policy.test.ts` (catalog walk, stage 01).
2. Under `app.org_id = A`, every one of the 19 tables shows no B row; with `''` both. A write of a B row under A fails with `42501`; `delete_mailbox` refuses B's mailbox under A. Shown by: `rls-policy.test.ts` (isolation and write cases, stage 01).
3. The scoped driver writes the scope of the call chain on each acquire, only when it changes, and fails closed. Shown by: `apps/server/src/platform/db/scoped-driver.test.ts`, `tenant-scope.test.ts` (unit) and `apps/server/test/integration/db-tenant-scope.test.ts` (stage 02).
4. Under a web session of organization A, a deliberately unfiltered query returns zero rows of B; the same query in a job context (no scope) returns both; an operator route returns both. Shown by: `apps/server/test/integration/web-tenant-scope.test.ts` (stage 03).
5. Every `/api` route runs in the scope of the session's organization; `/api/operator/*` runs without. Shown by: the route walk in `web-tenant-scope.test.ts` (stage 03). Only `http.ts`, `scheduler.ts` and `tenant-scope.ts` call the scope functions. Shown by: `apps/server/src/platform/tenant-scope-sites.test.ts` (stage 03).
6. `bun run test:int:ci` and `bun run test:e2e` pass on the scoped path. Shown by: the stage 03 proof logs.
7. `docs/architecture.md` §5 and §7, `docs/code-patterns.md` (new-table checklist, routes, tests), the styleguide, ADR 0011 and ADR 0027 state the RLS rule. Shown by: stage 04 diff.

## Rules for every stage

- Read `CLAUDE.md`, `.agents/limen/styleguide.md`, `docs/code-patterns.md`, the ticket, this file and your stage file first. Build only your stage.
- Format only the files of your stage: `bunx prettier --write <files>`. Never the whole repo (S2 incident: a builder ran the repo-wide formatter).
- Log lines are events (`docs/code-patterns.md` § Logs). This ticket adds no log line. Never log an organization id together with a query text, a setting value or an error text from `set_config`; errors go through `errorFields`.
- The repo is public: no real name, address or user id in a file. Test addresses end in `@x.test`.
- Template literals for strings with variables; `const` / `let` only. Comments name a rule or an ADR, not a bare code (`docs/code-patterns.md` § Style).
- A test sets `app.org_id` only with `set_config('app.org_id', $1, true)` inside a transaction (D18). Never `SET app.org_id`, `RESET`, or `set_config(…, false)` in a test or in app code; only `scoped-driver.ts` writes the session value.
- All test files of one `bun test` call run in one process, one file after another; other tests commit rows too. A test that reads across organizations asserts on its own organization ids, never on a total count. Committed rows are deleted in `afterAll` (`webOrg().cleanup()`).
- A stage that changes a type or a required field fixes every caller and test in the same stage, so all checks pass at its commit.
- Commit by explicit path (`git add <paths>`), never `git add -A`.
- Only stage 01 adds a migration, and exactly one file. No stage changes `bun.lock` or the dependencies of a `package.json`. If you think you need a dependency, stop and ask.
- No stage changes a repository function or a `routes.ts` file (ticket: out of scope).
- Do not edit `spec/build.md`, `docs/product/stage-2/*` or another ticket.
- A gap or a deviation is a question in your final message, not a choice.

## Proof

Run after the last commit, as one bash call with nothing after it; read the logs in a separate call. In the final message list as proven only what a saved log shows. `test:int:ci` needs no lock: each job has its own DB (`CLAUDE.md`). Only stage 03 runs `test:e2e`, under the shared lock.

Stages 01 and 02 (NN = the stage number):

```
mkdir -p /tmp/f092-sNN && bun run lint > /tmp/f092-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f092-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f092-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f092-sNN/int.log 2>&1 && echo PROOF_OK
```

Stage 03 (the e2e set-up of the stage file first):

```
mkdir -p /tmp/f092-s03 && bun run lint > /tmp/f092-s03/lint.log 2>&1 && bun run typecheck > /tmp/f092-s03/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f092-s03/unit.log 2>&1 && bun run test:int:ci > /tmp/f092-s03/int.log 2>&1 && bun run web:build > /tmp/f092-s03/web.log 2>&1 && flock /tmp/email-assistant-shared-tests.lock env CHROMIUM_PATH=/usr/bin/chromium bun run test:e2e > /tmp/f092-s03/e2e.log 2>&1 && echo PROOF_OK
```

Stage 04 (docs only; `<files>` = the files the stage changed):

```
mkdir -p /tmp/f092-s04 && bunx prettier --check <files> > /tmp/f092-s04/prettier.log 2>&1 && bun run lint > /tmp/f092-s04/lint.log 2>&1 && bun run test:unit:ci > /tmp/f092-s04/unit.log 2>&1 && echo PROOF_OK
```

## User checkpoints

- **Checkpoint 1 (after stage 03 lands, before stage 04):** the coordinator sends the owner the review results of stages 01–03 and the U1 result. Board rule (`spec/build.md`, owner decision 2026-11-13): a checkpoint is not a stop; after the review PASS of stage 03, stage 04 builds with the plan defaults.

## User steps

| #   | Step | When |
| --- | ---- | ---- |
| U1  | `bun run db:migrate` on the shared dev database (main checkout, no other migration running). Then, as `app`: `select count(*) from pg_policies where policyname = 'tenant_rows'` → 19 (or more if another ticket's table joined, stage 01 final message). | after stage 01 lands |
| U2  | VPS: the next deploy after stage 03 lands carries the migration and the scope (`deploy/README.md`: backup first, `db:migrate` before the start, name the rollback target). Check after: the panel signs in, `/activity` and `/settings` load, the log has no `http_error` with `row-level security` in the first hour. Board rule: the coordinator does it (pre-approved). | after stage 03 lands |

## Review

- A review job before the land for stages 01 (migration, tenant isolation), 02 (driver, tenant isolation) and 03 (web wiring, tenant isolation). Model: the board's reviewer (`spec/build.md` § TRACK: `claude-sonnet-5-5`, high). Stage 04 lands on the worker's proof.
- Review spawn (after the worker job is done; `<B>` = the job's branch, `NN` and `<slug>` from the stage list):

```
limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
  --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
  --review --detached --branch <B> --label "review s<NN> · F092" \
  "Review F092 stage NN on <B> against spec/features/active/F092-rls-safety-net/plan.md and stages/stage-NN-<slug>.md. Check that every numbered test exists and asserts what the stage says, and every decision the stage cites. Stage 01: compare the migration with the D8 text and the delete_mailbox body with 20261113100001_outbox_view.sql. Stage 02: find a path where a query runs with the value of another call chain. Stage 03: find an /api route that runs without the scope. Quote file and line for each finding."
```

## Stages

| #   | Stage | Size | Mark |
| --- | ----- | ---- | ---- |
| 01  | [Policies and the catalog test](stages/stage-01-policies.md) — the migration (`app_current_org`, 19 policies, `delete_mailbox` guard), `rls-policy.test.ts` | ~330 lines | `[risky]` migration, tenant isolation |
| 02  | [Tenant scope and the scoped driver](stages/stage-02-tenant-scope.md) — `tenant-scope.ts`, `scoped-driver.ts`, `createDb`, `runJobTick`, unit and int tests | ~330 lines | `[risky]` tenant isolation |
| 03  | [Web requests run in the scope](stages/stage-03-web-scope.md) — `requireTenant`, `requireOperator`, route walk, call-site test, e2e | ~250 lines | `[risky]` tenant isolation, auth |
| 04  | [Docs and standards](stages/stage-04-docs.md) — architecture §5 and §7, code patterns, styleguide, ADR 0011 and 0027, modules, known alerts, capability page | ~90 lines | |

Order: 01 ∥ 02 → 03 → checkpoint 1 → 04 (D22).

## How to run (coordinator)

1. Before the first spawn: F087 is in `spec/features/done/` (ticket § Sequenced). Move the ticket: `git mv spec/features/planned/F092-rls-safety-net spec/features/active/`, commit (worktrees see only committed files). Stage 01 starts only when no other migration is in build (ticket § Sequenced gate).
2. Spawn one stage (NN = two digits, `<slug>` from the stage list):

   ```
   limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
     --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
     --prepare 'bash scripts/limen-prepare.sh' --label "F092-sNN <slug> · F092" \
     "Implement F092 stage NN. Read spec/features/active/F092-rls-safety-net/ticket.md, plan.md and stages/stage-NN-<slug>.md; build every step of that stage. Final proof: the Proof command of plan.md for your stage (/tmp/f092-sNN), one bash call with nothing after it, run after the last commit; read the logs in a separate call. In the final message, list as proven only what a saved log shows."
   ```

3. Stages 01 and 02 may run at the same time (D22). Stage 03 starts after both landed.
4. When a job finishes: read its final message and `/tmp/f092-sNN/*.log`. For stages 01–03, spawn the review job (§ Review); a finding → `limen continue <job-id> "<fix>"` with the same engine flags, then review again (at most 2 rounds, then the owner decides).
5. Land: `limen land <job-id> --yes --keep-open` (stage 04: without `--keep-open`; it closes the ticket). Drop the job DB from the main checkout: `bun run db:worktree <YYYY-MM-DD>-<hash> --drop`; for stage 03 also its e2e DB (`f092_s03_e2e`).
6. After stage 01 lands: U1. After stage 03 lands: checkpoint 1 (send, do not wait) and U2; then spawn stage 04.
7. Workers often break the one-`&&` proof form. Accept a check when its saved log shows the pass. A check with no proof at all → `limen continue`.

## Cold review

Not run by the planning job (task rule: the coordinator starts it). File the result as `plan-review-1.md` and log the fixes here.

## Log

- 2026-11-14: plan written (planning job `2026-11-14-f092-plan-rls-bc12f1b0`).
