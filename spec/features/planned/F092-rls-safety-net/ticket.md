---
opened: 2026-11-13
needs-adam: Decide whether RLS joins the foundation group (06-architecture-review §8, decision 2)
needs-adam-on: 2026-11-13
---

# F092 · Row-level security is a safety net under the tenant filter for every table with `org_id`

## Outcome

A repository function that forgets its `org_id` filter returns no foreign row on a web request, because Postgres row-level security limits the `app` role to the organization of the request. The code filter stays the first line; RLS is the second. An auditor reads one sentence: tenant isolation is enforced in the database, not only in code. New tables join the policy through the same `information_schema` test that guards the organization delete and the DSR address map.

## Scope

- Starting seam: `db/migrations` (one migration: `ENABLE ROW LEVEL SECURITY` and one policy per table with `org_id`), `apps/server/src/platform/http.ts` (`requireTenant` opens a request transaction with `SET LOCAL app.org_id`), the route dependency shape (routes read the request-scoped `db` from the context).
- Jobs and CLIs run as today, with the setting unset; the policy admits an unset setting, so the jobs path is unchanged. The operator routes (F087) run with the setting unset by design and are the only web path that does.
- One integration test per table: a query without the code filter under a set `app.org_id` returns no row of another organization.

## Out of scope

- A second database role for jobs, `FORCE ROW LEVEL SECURITY`, policies on the Better Auth tables (keyed by user, no `org_id`).
- Changing any repository function.

## Acceptance

- Every table with an `org_id` column has RLS enabled and the tenant policy (`information_schema` test: a new table without the policy fails CI).
- Under a web session of organization A, a deliberately unfiltered query in a test returns zero rows of organization B; the same query in a job context returns both.
- Every `/api` route runs inside the request transaction with `app.org_id` set (a middleware test over the route list); the operator routes are the listed exception.
- `bun run test:int` and `bun run test:e2e` pass; `docs/architecture.md` §5 "Tenancy" and §7 state the RLS rule; `docs/code-patterns.md` adds the policy to the "new table" checklist.

## Notes

Design and stages: [plan.md](plan.md). Source: review §3.9, decision 2 of its §8. The operator routes of the feature-flags ticket (F087) are the one web path that runs with the setting unset, so this ticket builds on them.
