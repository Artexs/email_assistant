# s1b-shadow-triage — Stage 21

Part of [`../s1b-shadow-triage.md`](../s1b-shadow-triage.md). Read that file's "Input" and "Rules for every step" first.

## Stage 21 — Triage of one email: LLM error rules and the pause [risky]

- [x] **21.1 Soft, config, blocked and hard errors in `triageOne`; `createLlmPause`; `finishTriageError`**
  - Goal: a 429 / 503 / timeout or a config error never moves mail to `unsure` and pauses the LLM client; a safety block goes to `unsure` at once; hard errors retry and end in `unsure` after 3 tries.
  - Files: create `apps/server/src/modules/triage/pause.ts`, `apps/server/src/modules/triage/pause.test.ts`; change `apps/server/src/modules/triage/service.ts`, `triage/index.ts`; extend `apps/server/test/integration/triage-service.test.ts`.
  - Interfaces:
    - `interface LlmPause { trip(kind: "soft" | "config", code: string, now: Date): Date; isPaused(now: Date): boolean; reset(): void }`.
    - `createLlmPause(opts?: { baseMs?: number; maxMs?: number }): LlmPause` (defaults 5 min and 60 min).
    - `TriageDeps` gets `pause: LlmPause`. `TriageOutcome` gets `{ kind: "retry_later" }` and `{ kind: "paused"; until: Date }`.
    - `finishTriageError(deps: TriageDeps, ctx: TenantContext, mailbox: TriageMailbox, email: ClaimedEmail): Promise<TriageOutcome>` (exported; step 23.1 uses it too): `saveTriage` with the decision `{ finalCategory: "unsure", modelCategory: null, confidence: 0, reasonCode: "triage_error", reason: null, summary: null, fields: {}, vip, model: null, promptVersion: null, usage: null, auditReasonCode: "triage_error" }` (`vip` from `applyHardRules`).
  - Decisions (main-session decisions 2026-11-04, review findings 3, 4, 5):
    - The pause is per LLM client, in memory, in this process (the quota is per project). `trip` starts a pause of `min(baseMs × 2^(n − 1), maxMs)`, where `n` = trips since the last `reset` (5, 10, 20, 40, 60, 60 … min), and returns its end. `reset` (after a successful call) sets `n` back to 0. A restart clears the pause; the next tick tries one call.
    - Logs, one line per trip (no call runs while paused, so one line per pause): soft → `warn` \`LLM soft error ${code}: triage paused for ${minutes} min, until ${iso}\`; config → `error` \`LLM config error ${code}: check GEMINI_API_KEY, GEMINI_MODEL_CLASSIFIER and the Google project (billing, region); triage paused for ${minutes} min, until ${iso}\`.
    - `triageOne` after a call that got an answer (success or `LlmBlockedError`): `deps.pause.reset()`.
    - Error rules for an error from `classifyEmail`, in the `catch` of step 20.1, after the `llm.call` row. Checked in this order (`LlmConfigError` and `LlmBlockedError` extend `HardError`, so check them before the general rule):
      1. `instanceof SoftError` → `until = deps.pause.trip("soft", llmErrorCode(error), now)`; `releaseEmail(…, email.locked_at, { nextAttemptAt: until, countAttempt: false })`; return `{ kind: "paused", until }`. No `triage_results` row; `attempts` does not change. A 429 / 503 / timeout never moves mail to `unsure` (ADR 0012, done-when).
      2. `instanceof LlmConfigError` (codes `http_401`, `http_402`, `http_403`, `http_404`, `http_400_key`, `http_400_precondition`) → the same with `trip("config", …)`: no count, no result row.
      3. `instanceof LlmBlockedError` (user answer Q28) → no retry, no count, no pause: `deps.pause.reset()`, then `saveTriage` with the decision `{ finalCategory: "unsure", modelCategory: null, confidence: 0, reasonCode: "llm_blocked", reason: null, summary: null, fields: {}, vip, model: null, promptVersion: PROMPT_VERSION, usage: null, auditReasonCode: "llm_blocked" }`; return its outcome. `model` NULL keeps the row out of the token checks (no usage) and marks it as "no LLM answer" (`ruleReasonCodes`, step 1.1).
      4. Every other error from `classifyEmail` (`LlmHardError`, `LlmOutputError`, an unknown error): when `email.attempts + 1 < 3` → `releaseEmail(…, { nextAttemptAt: now + 5 min, countAttempt: true })`, log `warn` \`triage ${emailId}: ${describeError(error)}, try ${email.attempts + 1} of 3\`, return `{ kind: "retry_later" }`. On the 3rd hard error → `return finishTriageError(deps, ctx, mailbox, email)` (audit `email.triaged` `reason_code` `triage_error`).
      - A `releaseEmail` that returns `false` → return `{ kind: "lost" }`.
    - An error outside the `classifyEmail` call (`listThreadContext`, `saveTriage`, a DB error) is not caught in `triageOne`: it goes to the job, which counts it and ends the mail in `unsure` after 3 tries (step 23.1, review finding 7).
    - Every call attempt already has its `llm.call` row (step 20.1), so 3 hard errors count 3 calls for the cap.
    - The 5-minute wait after a hard error is fixed (no backoff); only the pause has a backoff. Stage 35 writes this in architecture §4.1 rule 7.
  - Test:
    - `pause.test.ts` (unit, fake times): trips give 5, 10, 20, 40, 60, 60 min; `isPaused` is true before the end and false at the end; `reset` gives 5 min again; a soft trip writes one `warn` line, a config trip one `error` line (spy on `console.error`).
    - `triage-service.test.ts`: `LlmSoftError` `http_429` → `{ kind: "paused" }`, `trip("soft", "http_429", …)` called once, the mail is `pending` with `attempts` 0 and `next_attempt_at` = the returned end, no `triage_results`, one `llm.call` row `http_429`; `LlmConfigError` `http_404` and `http_400_key` → `trip("config", …)`, mail `pending`, `attempts` 0, no result; `LlmBlockedError` → `{ kind: "triaged" }`, the fake LLM got 1 call, the mail is `triaged` with `attempts` 0, `triage_results` `unsure` / `llm_blocked` / confidence 0 / `model` NULL, audit `email.triaged` `reason_code` `llm_blocked`, one `llm.call` row `llm_blocked`, no `trip` call; `finishTriageError` called directly → `unsure` / `triage_error`; `LlmHardError` 3 times (move the fake clock past `next_attempt_at` and claim again each time) → `attempts` 1, then 2, then `triaged` as `unsure` / `triage_error` / confidence 0 / `model` NULL, and `countLlmCallsSince` for the mailbox = 3 (review finding 3); a success after a soft error calls `reset`.
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:unit && bun run test:int`
  - Done when: the tests pass.
  - Out of scope: the job loop and the release of the other claimed mails (stages 22–23), the cap and the 7-day rule (stage 24).

## Follow-up from the stage 20 review

- In `triageOne` (stage 20) the `llm.call` audit write sits inside the `catch`. If `recordAudit` fails there, its error replaces the LLM error and the error rules see a DB error. Decide here: wrap that audit write in its own `try`/`catch` (log `warn` with `describeError`), then rethrow the LLM error. Add a test.
