# F092 · RLS safety net: plan input

> Written 2026-11-13 from the architecture review §3.9. Input of the `plan-task` session. Ticket: [ticket.md](ticket.md). Optional: the owner decides (review §8, decision 2). Runs after F087; one migration.

## Facts (2026-11-13)

- Tenant isolation is in code: every repository function takes `TenantContext` and filters by `org_id`; `docs/code-patterns.md` lists the exceptions (jobs that walk organizations, user-keyed auth tables). There is no RLS (ADR 0027 context).
- Roles: `migrator` owns the tables (bypasses RLS as owner unless `FORCE`), `app` is the server's role with `NOINHERIT` (`db/roles.sql`). Policies apply to `app`.
- Tables with `org_id` (migrations, 2026-11-13): `mailboxes`, `mailbox_folders`, `mailbox_credentials`, `mailbox_settings`, `emails`, `sender_rules`, `triage_results`, `triage_feedback`, `actions`, `audit_log`, `chat_links`, `chat_link_tokens`, `digests`, `outbox`, `delegates`, `delegations`, `memberships`, plus `org_features` (F087). `organizations` is keyed by `id`. `users`, `auth_*`, `auth_lockouts` are user-keyed.
- `platform/http.ts`: `requireTenant` resolves the organization from the session and sets `ctx` on the Hono context; routers get `db` through their deps at startup (`settingsRoutes(deps)` with `deps.db`), and most repository functions accept `Db | Transaction<DB>`.
- `pg` pools connections; a session-level `SET` would leak to the next request. `SET LOCAL` inside a transaction is safe.

## Design decisions

- **D1 Policy shape.** For each table: `ALTER TABLE t ENABLE ROW LEVEL SECURITY; CREATE POLICY tenant_rows ON t FOR ALL TO app USING (current_setting('app.org_id', true) IS NULL OR org_id = current_setting('app.org_id', true)::uuid) WITH CHECK (same)`. An unset setting admits every row (the jobs and CLIs path is unchanged); a set setting limits reads and writes to one organization. `organizations` gets the same policy on `id`.
- **D2 Request transaction.** `requireTenant` opens `db.transaction()` for the request, runs `SET LOCAL app.org_id = $1`, puts the transaction on the context as `c.var.db`, and commits after the handler (rolls back on a thrown error). Route deps that hold `db` from startup change to read `c.var.db`; the plan-task session lists the route files (`tenancy`, `mail`, `config`, `triage`, `reports`, `channels` routes) and the services they call. Long requests (mailbox connect runs an IMAP login, up to 90 s) hold a transaction open: acceptable at this scale, but the connect route may opt out and set the setting in its own short transactions instead; the plan decides per route.
- **D3 Operator exception.** `requireOperator` routes (F087) do not set the setting; the test that walks the route list knows this allow-list.
- **D4 Tests.** `apps/server/test/integration/rls.test.ts`: for each table from `information_schema.columns where column_name = 'org_id'`: the policy exists; a raw `select` under `SET LOCAL app.org_id = A` returns no B row. This is the same table walk as the E7 delete test and the DSR map, so later tables cannot escape it.
- **D5 Docs.** `docs/architecture.md` §5 Tenancy: "RLS is a safety net under the code filter; the web request sets `app.org_id`; jobs run unset." `docs/code-patterns.md` § Data access: the new-table checklist adds the policy. The E10 security page can cite the test.

## Stages

1. **Migration and policy test.** Files: `db/migrations/<day>100001_rls.sql` (every table from the facts list plus `org_features`), `apps/server/test/integration/rls.test.ts` (policy exists, unset admits all). Runs alone (migration).
2. **Request transaction.** Files: `platform/http.ts` (`requireTenant`, `c.var.db`), the route files and `web.ts` deps, the route tests; the isolation test (set A, no B rows) joins `rls.test.ts`.
3. **Docs.** `docs/architecture.md` §5 and §7, `docs/code-patterns.md`, ADR 0011 (amended: RLS).

Parallel: stage 1 alone; stage 2 after it; stage 3 with 2.

## Done when

- The four acceptance lines hold; the e2e suite passes on the request-transaction path.

## Open questions for the plan-task session

- Whether the connect and password-check routes (IMAP login inside the request) keep the request transaction or run their own short ones (D2). Default: their own, listed in the allow-list with a reason.
- Whether `audit_log` keeps `INSERT`-only for `app` under the policy (it should; the policy `WITH CHECK` must admit the insert with the set organization).
