# s1b-shadow-triage — Stage 7

Part of [`../plan.md`](../plan.md). Read that file's "Input" and "Rules for every step" first.

## Stage 7 — Triage repository: writes [risky]

- [x] **7.1 `insertTriageResult`, `latestTriageResult`, `insertFeedback`**
  - Goal: typed writes and the latest-result read for triage results and labels, each with a tenant filter test.
  - Files: create `apps/server/src/modules/triage/repo.ts`, `apps/server/src/modules/triage/index.ts`; create `apps/server/test/integration/triage-repo.test.ts`.
  - Interfaces (all take `db: Db | Transaction<DB>, ctx: TenantContext` first):
    - `insertTriageResult(trx, ctx, row: { emailId: string; category: Category; vip: boolean; confidence: number; reasonCode: string; reason: string | null; fields: Record<string, unknown>; model: string | null; promptVersion: string | null; tokensIn: number | null; tokensOut: number | null; latencyMs: number | null }): Promise<string>`.
    - `latestTriageResult(db, ctx, emailId): Promise<{ id: string; category: Category; confidence: number; reason_code: string; model: string | null; fields: unknown } | undefined>`.
    - `insertFeedback(db, ctx, row: { emailId: string; verdict: "right" | "wrong"; trueCategory: Category | null; source: FeedbackSource; userId: string | null }): Promise<string>` (`FeedbackSource` from `@ea/core`, step 1.1, review finding 14).
  - Decisions:
    - "Latest": `ORDER BY created_at DESC, id DESC LIMIT 1`.
    - Every function filters by `ctx.orgId`. The composite foreign key `(email_id, org_id)` (step 3.1) stops a row for another org's email.
    - No summary here: the summary is in `actions.payload` (owned by `actions`); step 26.1 merges it through `listSummaries`.
  - Test (`triage-repo.test.ts`, two tenants, `insertTestEmail`): `insertTriageResult` stores the context org; with another org's `emailId` it fails the foreign key (inside a savepoint); `latestTriageResult` returns the newer of two rows (`created_at` 1 min apart) and `undefined` with the other org's context; `insertFeedback` stores `true_category` NULL when it gets `null`, and the given `source`.
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:int`
  - Done when: the tests pass.
  - Out of scope: list queries (stage 8), services.
