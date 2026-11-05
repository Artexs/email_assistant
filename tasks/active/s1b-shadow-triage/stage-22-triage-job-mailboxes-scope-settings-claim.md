# s1b-shadow-triage — Stage 22

Part of [`../s1b-shadow-triage.md`](../s1b-shadow-triage.md). Read that file's "Input" and "Rules for every step" first.

## Stage 22 — Triage job: mailboxes, scope, settings, claim [risky]

- [ ] **22.1 `createTriageJob`: the loop over allowed mailboxes**
  - Goal: a job that runs `triageOne` on claimed mail of each allowed mailbox (the pause stop and the error release come in step 23.1).
  - Files: create `apps/server/src/modules/triage/jobs.ts`; export `createTriageJob`, `TriageJobDeps`, `TriageScope`, `createLlmPause` from `triage/index.ts`; change `apps/server/test/integration/fixtures.ts` (new `pauseOtherMailboxes`); create `apps/server/test/integration/triage-job.test.ts`.
  - Interfaces:
    - `type TriageScope = { kind: "synthetic" } | { kind: "all"; mailboxAddress: string }`.
    - `interface TriageJobDeps { db: Db | Transaction<DB>; llm: LlmClient; pause: LlmPause; scope: TriageScope; batchSize: number; now(): Date; triageOne?: typeof triageOne }` (`batchSize` 5 in `main.ts`; `triageOne` defaults to the real function and exists only so that step 23.1 can test an error outside the LLM call; stage 24 adds `dailyCap`).
    - `createTriageJob(deps: TriageJobDeps): { run(): Promise<void> }`.
    - Test fixture: `pauseOtherMailboxes(trx: Transaction<DB>): Promise<void>` = `UPDATE mailboxes SET status = 'paused' WHERE status = 'active'` (review finding 6). Call it first in the test, before the test mailboxes are created; the rollback brings the other rows back.
  - Decisions:
    - `run()`:
      1. For each `listSyncTargets(db)` row, with `ctx = { orgId }`:
         - `getMailbox`; missing → skip.
         - Scope `all`: skip every mailbox whose `address.toLowerCase()` differs from `scope.mailboxAddress.trim().toLowerCase()` (main-session decision 2026-11-04, review finding 21). No log line for the skip; never log the address.
         - `getMailboxSettings`; missing row (review finding 10: `createOrgWithMailbox` and `mailbox:connect` paths may have none) → skip the mailbox and log `warn` \`triage ${mailboxId}: no mailbox_settings row, mailbox skipped\` once per mailbox per process (a `Set` in the job).
         - `parseToolSwitches`, `parseCategoryPolicy`, mode through `z.enum(mailboxModes)`; `listSenderRules`; `movesSupported = capabilities.move === true || capabilities.uidplus === true` (capabilities can be `{}`).
         - `claimEmails(db, ctx, mailboxId, { now, limit: batchSize, staleBefore: now − 5 min, syntheticOnly: scope.kind === "synthetic" })`.
         - For each claimed email in order: `outcome = await (deps.triageOne ?? triageOne)(…)`. In this step every outcome goes on to the next mail (step 23.1 adds the stop on `paused` and the error handling).
    - The worker never changes the mailbox and never imports `mail/imap`.
  - Test (`triage-job.test.ts`, `withRollback`, `pauseOtherMailboxes` first, then `createOrgWithMailbox` + `insertDefaultSettings`, fake `LlmClient`, the real `createLlmPause`, a fake clock, spy on `console.error`):
    - 3 pending mails → one `run()` triages all 3, oldest first (the fake LLM got 3 calls in `received_at` order);
    - scope `all`: two mailboxes; only the one whose address equals the scope address (different case) is triaged; the other mailbox's pending mail is untouched;
    - scope `synthetic`: real mail untouched; `@ea-seed.test>` mail triaged;
    - a mailbox without a settings row is skipped with one `warn` line over two runs; another mailbox is still triaged;
    - a stale `processing` row (`locked_at` older than 5 min) is taken again.
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:unit && bun run test:int`
  - Done when: the tests pass.
  - Out of scope: the pause stop and the error release (stage 23), the daily cap, the 7-day rule (stage 24), `main.ts` (stage 25).

## Added at checkpoint 1 (group review, 2026-11-05)

- A stale `processing` row that the claim takes back does not count an attempt (stage 4). A mail that kills the process before the LLM call would then repeat every 5 minutes, and no `llm.call` row limits it. Decide in this stage: when `claimEmails` returns a row that was stale, count the attempt, so the `attempts >= 3` rule applies. Add a test.
