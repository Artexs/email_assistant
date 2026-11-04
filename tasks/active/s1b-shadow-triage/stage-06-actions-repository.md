# s1b-shadow-triage — Stage 6

Part of [`../s1b-shadow-triage.md`](../s1b-shadow-triage.md). Read that file's "Input" and "Rules for every step" first.

## Stage 6 — Actions repository [risky]

- [ ] **6.1 `createPlanned`, `listActionsForEmail`, `listSummaries`, with `org_id` filters**
  - Goal: typed queries for the `actions` table, with idempotent inserts and a tenant filter test.
  - Files: create `apps/server/src/modules/actions/repo.ts`, `apps/server/src/modules/actions/index.ts`; create `apps/server/test/integration/actions-repo.test.ts`.
  - Interfaces (all take `db: Db | Transaction<DB>, ctx: TenantContext` first):
    - `createPlanned(trx, ctx, emailId, items: { type: ActionType; payload: Record<string, string>; status: "ready" | "awaiting_approval" | "logged"; idempotencyKey: string }[]): Promise<{ id: string; type: ActionType; status: string }[]>` (`ON CONFLICT (org_id, idempotency_key) DO NOTHING`; returns only the inserted rows; an empty `items` returns `[]` without a query).
    - `listActionsForEmail(db, ctx, emailId): Promise<{ id: string; type: string; status: string; payload: unknown }[]>` (oldest first).
    - `listSummaries(db, ctx, emailIds: string[]): Promise<Map<string, string>>` (`payload->>'summary'` of `save_summary` actions; an empty `emailIds` returns an empty map without a query).
  - Decisions: one repository function = one clear query (Kysely). Every function filters by `ctx.orgId`. Actions own their payload: other modules read summaries only through `listSummaries`. `ActionType` comes from `@ea/core` (step 2.1). The status change of the email and the action rows go in one transaction (the caller passes `trx`, step 19.1).
  - Test (`actions-repo.test.ts`, two tenants, `insertTestEmail`): `createPlanned` stores the context org; twice with the same keys inserts once (the second call returns `[]`); the same key in the other org inserts (the key is unique per org); `listActionsForEmail` with the other org's context returns `[]`; `listSummaries` returns only `save_summary` payloads of the context org (a `move` action and the other org's summary are not in the map); `listSummaries([])` returns an empty map.
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:int`
  - Done when: the tests pass.
  - Out of scope: the committer (S3), status changes of actions, the triage tables (stages 7–8).
