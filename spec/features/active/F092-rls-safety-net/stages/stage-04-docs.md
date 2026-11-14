# F092 stage 04 — Docs and standards

Part of [`../plan.md`](../plan.md). Decisions D7, D8, D10–D12, D16–D21, D23. Read "Rules for every stage" in `plan.md` first.

Docs only. The rules must name only what stages 01–03 built: open the landed files (`db/migrations/*_rls_tenant_policies.sql`, `platform/db/tenant-scope.ts`, `platform/db/scoped-driver.ts`, `platform/http.ts`, `platform/scheduler.ts`, `test/integration/rls-policy.test.ts`, `web-tenant-scope.test.ts`) and copy names from them, not from this file. If a name differs from the plan, the code wins; say so in the final message.

Plain technical English, short sentences, active voice (the style of the files you edit). Two steps.

## Step 1 — architecture, ADRs, modules

**Goal.** A reader of the architecture and the ADRs learns that RLS is the second line under the code filter, how the web sets it, and which paths run without it.

**Files and changes.**

1. `docs/architecture.md` §5 "Tenancy" (the bullet list under the table):
   - Replace the last bullet "No client reads the DB directly. Option for S6: RLS for the server role with `set_config('app.org_id', …)` per transaction." with "No client reads the DB directly." and a new bullet after it:
     "**Row-level security (F092)** is a safety net under the code filter, not the filter. Every table with `org_id`, and `organizations` by `id`, has RLS on and one policy `tenant_rows` for `app`: a row is visible and writable when `app_current_org()` is null or equals its organization. `app_current_org()` reads the setting `app.org_id` (empty = null). A web request under `/api` runs in the tenant scope of the session's organization (`requireTenant` → `withTenantScope`); the scoped driver (`platform/db/scoped-driver.ts`) writes `app.org_id` on each connection acquire. Jobs, CLIs, the Telegram bot, `/api/auth/*`, `/health`, the pages and the operator routes run with the setting empty and see every row; `migrator` and `SECURITY DEFINER` functions bypass the policies (no `FORCE`), and `delete_mailbox` checks the scope itself. RLS is a safety net against a missed `org_id` filter, not a defence against SQL that runs as `app` and sets `app.org_id` itself (an empty value admits every row). Tests: `rls-policy.test.ts` (catalog walk and per-table isolation), `web-tenant-scope.test.ts` (route walk)."
2. `docs/architecture.md` §7:
   - "**Tenant isolation:**" bullet: append "Postgres row-level security is a safety net against a missed `org_id` filter: a query that forgets the filter returns no row of another organization on a web request (§5 Tenancy)."
   - "**Operator (ADR 0027, F087):**" bullet: append "Operator routes run without the tenant scope (F092), so RLS admits their cross-organization reads."
3. `docs/decisions/0011-self-hosted-postgres.md`, § Consequences: add a dated line at the end: "- <build day> (F092): the server runs under RLS, as a safety net against a missed `org_id` filter. The option of the Decision section is built with one difference: `app.org_id` is written on each connection acquire from the request's tenant scope, not per transaction, so services keep their own transactions. It needs a direct connection per pg client: a transaction-mode pooler (such as PgBouncer) between the server and Postgres would break it. Jobs and CLIs run with the setting empty (every row). `docs/architecture.md` §5 Tenancy has the rule." Do not edit the Decision section (it is the record of 2026-11-02).
4. `docs/decisions/0027-operator-role-and-feature-flags.md`, § Consequences: add "- <build day> (F092): row-level security exists now. The `/api/operator` routes run without the tenant scope (`requireOperator` → `withoutTenantScope`), so their cross-organization reads still work." The Context line "there is no row-level security" stays (history).
5. `docs/modules.md`, the platform table (the one with rows `config`, `db`, `http`): row `db`: add "tenant scope and the scoped driver (`app.org_id` for RLS)" to "Does"; row `http`: "session and tenant middleware" → "session and tenant middleware (the tenant scope of each `/api` request)"; row `scheduler`: add "a job tick runs without a tenant scope".

**Check.** `bunx prettier --check docs/architecture.md docs/decisions/0011-self-hosted-postgres.md docs/decisions/0027-operator-role-and-feature-flags.md docs/modules.md`.

**Done when.** The five edits are in; no other line of these files changes (prettier may re-pad the table rows it touches; run `bunx prettier --write` on these files only).

**Out of scope.** `docs/product/*`, `spec/build.md`, `docs/diagrams/*`.

## Step 2 — code patterns, styleguide, alerts, capability page

**Goal.** The next ticket that adds a table, a definer function, a route or a test follows the RLS rules without reading this plan.

**Files and changes.**

1. `docs/code-patterns.md` § Data access:
   - The bullet "A new table with `org_id`, in the ticket of its migration: …": after "a `tenant filter` test for each new repository function (…);" add "the `tenant_rows` policy in the same migration (copy the block of `db/migrations/<the F092 file>`; `rls-policy.test.ts` fails without it) and the table in `TENANT_TABLES` and in its seed (`seedOrg`) of that test;".
   - New bullet after it: "A new view bypasses RLS (it runs as its owner): create it `WITH (security_invoker = true)`; no materialized view over tenant tables. `rls-policy.test.ts` checks both."
   - New bullet after it: "A new `SECURITY DEFINER` function bypasses RLS: its first statement refuses another organization when `app_current_org()` is set (as `delete_mailbox` does); `rls-policy.test.ts` checks that each one calls `app_current_org()`."
   - New bullet: "RLS (F092) is the second line, never the first: every repository function still filters by `org_id`. Only `platform/db/scoped-driver.ts` writes `app.org_id`. A test sets it only with `set_config('app.org_id', <id>, true)` inside a transaction, never with `SET` or a session-level `set_config`."
2. `docs/code-patterns.md` § HTTP routes, the operator paragraph: add "`requireTenant` runs the rest of each `/api` request in the tenant scope; `requireOperator` runs operator routes without it. Only `platform/http.ts` and `platform/scheduler.ts` call `withTenantScope` and `withoutTenantScope` (`tenant-scope-sites.test.ts`). Work that a request starts and that outlives it (a timer, a loop, a promise chain), and an object made in a request whose callbacks outlive it (an `EventEmitter`, an IMAP IDLE client, a stream: its callbacks run in the scope of the request), is made in `withoutTenantScope`, or it stays limited to that organization."
3. `.agents/limen/styleguide.md`, the "A new table with `org_id` …" line: "gets tenant-filter tests, retention (if it holds text) and a note for the organization delete and DSR map" → "gets tenant-filter tests, the `tenant_rows` RLS policy in its migration, retention (if it holds text) and a note for the organization delete and DSR map". One line; keep the file under its cap.
4. `docs/known-alerts.md`, a new entry at the top of the entries (after the `---`), in the template's form:
   - Heading: `` ### `new row violates row-level security policy for table "<table>"` (in `http_error`) ``
   - **First seen:** `<build day> (F092; not seen live)`.
   - **Source:** Postgres, through `http_error` of `platform/http.ts` (`route` field names the route). SQLSTATE `42501`.
   - **Cause:** a web request wrote a row whose `org_id` is not the organization of the session. The code filter missed it; RLS refused it. The request answered 500 and wrote nothing.
   - **Fix:** find the route and the repository function; fix the `org_id` it writes. Do not turn RLS off.
   - **Status:** won't fix (the refusal is the safety net working).
   - A second entry: `` ### `invalid input syntax for type uuid` on every query of a request `` — Cause: `app.org_id` holds a value that is not a UUID (only `scoped-driver.ts` writes it, from `requireTenant`); Fix: check the membership row and the scope call; Status: won't fix (fail closed).
5. `docs/capabilities/tenancy-and-plans.md`, if the file exists (the E1 ticket F095 writes it): in "Limits", delete the "RLS not in place" item; in "Rules", add one bullet: "Row-level security is the second line under the tenant filter (`docs/architecture.md` §5 Tenancy, F092)." and add `rls-policy.test.ts` and `web-tenant-scope.test.ts` to its test list. If the file does not exist, change nothing there and say so in the final message.

**Check.** `bunx prettier --check` on the changed files; `bun run lint`.

**Done when.** The edits are in; every name in them exists in the code (grep each one: `security_invoker`, `tenant_rows`, `app_current_org`, `withTenantScope`, `withoutTenantScope`, `scoped-driver.ts`, `rls-policy.test.ts`, `web-tenant-scope.test.ts`, `tenant-scope-sites.test.ts`, `TENANT_TABLES`, `seedOrg`).

**Out of scope.** Code changes; `docs/product/*`; the E10 security page (it does not exist yet).

## Stage done when

Steps 1 and 2 are done, and the stage 04 Proof of `plan.md` passes (`/tmp/f092-s04`), with `<files>` = every file this stage changed. In the final message: the list of files and whether the capability page existed.
