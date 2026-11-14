---
opened: 2026-11-13
landed: 2026-11-14
---

# F092 · Row-level security is a safety net under the tenant filter for every table with `org_id`

## Outcome

A repository function that forgets its `org_id` filter returns no foreign row on a web request, because Postgres row-level security limits the `app` role to the organization of the request. The code filter stays the first line; RLS is the second. An auditor reads one sentence: the database is a safety net against a missed `org_id` filter, under the tenant filter in code. New tables join the policy through the same catalog test that later guards the organization delete and the DSR address map.

## Scope

- Starting seam: `db/migrations` (one migration: the function `app_current_org()`, `ENABLE ROW LEVEL SECURITY` and the policy `tenant_rows` on every table with `org_id` and on `organizations`, and a tenant check in `delete_mailbox`).
- `apps/server/src/platform/db`: a tenant scope (`AsyncLocalStorage`) and a Kysely driver that writes `app.org_id` on each connection acquire. `platform/http.ts`: `requireTenant` runs the request in the scope; `requireOperator` runs it without. Route files and repository functions do not change (plan D7).
- Jobs and CLIs run as today, with the setting empty; the policy admits an empty setting, so the jobs path is unchanged. The operator routes (F087) run without the scope by design.
- Tests: a catalog walk over every table with `org_id`, a per-table isolation test, a route walk over every `/api` route.

## Out of scope

- A second database role for jobs, `FORCE ROW LEVEL SECURITY`, policies on the Better Auth tables (keyed by user, no `org_id`).
- Changing any repository function or route file.

## Acceptance

- Every table with an `org_id` column has RLS enabled and the tenant policy (catalog test: a new table without the policy fails CI).
- Under a web session of organization A, a deliberately unfiltered query in a test returns zero rows of organization B; the same query in a job context returns both.
- Every `/api` route runs inside the tenant scope with `app.org_id` set (a test over the route list); the operator routes are the listed exception (`/api/auth/*` sits outside the tenant middleware).
- `bun run test:int` and `bun run test:e2e` pass; `docs/architecture.md` §5 "Tenancy" and §7 state the RLS rule; `docs/code-patterns.md` adds the policy to the "new table" checklist.

Detail: [plan.md](plan.md) § Done when.

## Slices

Four stages, one worker job each (plan § Stages, § How to run). Stages 01 and 02 may run in parallel; 03 after both land; 04 after 03. Stage 01 is the one migration: no other migration in build next to it. Checkpoint 1 after stage 03 (not a stop: board rule).

## Sequenced

- Plan after: the feature-flags ticket with the operator routes (F087; closed, has `stages/`).
- Build after: F087 in `spec/features/done/` (landed 2026-11-13).
- Gate: the owner's yes (given 2026-11-14: RLS joins the foundation group). Stage 01 starts only when no other migration is in build: the offline lab (F097 stage 03), the platform controls (F099 stages 02, 05) and the measure ticket (F100 stages 04, 16) have migrations.

## Notes

Design and stages: [plan.md](plan.md). Source: `docs/product/stage-2/06-architecture-review.md` §3.9 and §8 decision 2; `07-foundation-plan.md` row 8. Open defaults: [questions.md](questions.md).
