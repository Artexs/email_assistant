# s1b-shadow-triage — Stage 23

Part of [`../s1b-shadow-triage.md`](../s1b-shadow-triage.md). Read that file's "Input" and "Rules for every step" first.

## Stage 23 — Triage job: stop on a pause, release on a mailbox error [risky]

- [x] **23.1 Pause stop, release of untried mail, per-mailbox error handling**
  - Goal: the job stops the whole run when the LLM client pauses, and one mailbox error never stops the others and never leaves a mail in a retry loop.
  - Files: change `apps/server/src/modules/triage/jobs.ts`; extend `apps/server/test/integration/triage-job.test.ts`.
  - Interfaces: none new (`finishTriageError` from step 21.1).
  - Decisions:
    - At the start of `run()`: `deps.pause.isPaused(now)` → return at once: no claim, no log line.
    - On `{ kind: "paused" }` from a mail: release every later claimed email of this batch with `releaseEmail(…, e.locked_at, { nextAttemptAt: e.next_attempt_at, countAttempt: false })` (untried mail keeps its old `next_attempt_at`), then return from `run()`: all mailboxes stop, because the quota is per project.
    - One mailbox error never stops the others: a `catch` per mailbox. The job knows the index of the mail that it was working on when the error came (none when the error came before the claim, for example a settings parse error). For the failing mail:
      - when `email.attempts + 1 >= 3` (review finding 7: the same rule as rule 4 in step 21.1) → `finishTriageError(…)` inside its own `try`; if that throws too, `releaseEmail(…, { nextAttemptAt: now + 5 min, countAttempt: true })` inside a `try` (a failure there is logged with `describeError` only);
      - else → `releaseEmail(…, { nextAttemptAt: now + 5 min, countAttempt: true })`.
      - The later claimed mails: `releaseEmail` with their old `next_attempt_at` and no count. `releaseEmail` returns `false` for a mail that is already finished, so this is safe.
      - Then log `error` \`triage ${mailboxId} failed: ${describeError(error)}\`. Never `error.message`.
    - `run()` itself never throws: a `listSyncTargets` error is caught too and logged with `describeError`.
  - Test (`triage-job.test.ts`, same setup as step 22.1):
    - `LlmSoftError` on the first of 3 claimed mails → the fake LLM got 1 call; mail 1 `pending`, `attempts` 0, `next_attempt_at` = now + 5 min; mails 2 and 3 `pending`, `attempts` 0, `next_attempt_at` still NULL; one `warn` line;
    - `run()` again at now + 1 min → 0 LLM calls, the mails stay `pending` with `locked_at` NULL; at now + 6 min → calls again; a second soft error → pause of 10 min and a second `warn` line; after a success the next pause is 5 min again;
    - `LlmConfigError` → one `error` line, mails `pending`, `attempts` 0;
    - 5 soft-error rounds (move the clock past each pause) → still `pending`, `attempts` 0, no `triage_results` row (done-when);
    - a mailbox whose `tool_switches` is `{"move": "yes"}` (parse error before the claim) → one `error` line with the class name only, its pending mail stays `pending` with `attempts` 0; the other mailbox is still triaged;
    - an injected `triageOne` that throws `new Error("MARKER-ERR")` for mail 1 of 3 (`attempts` 0) → mail 1 `pending`, `attempts` 1, `next_attempt_at` = now + 5 min; mails 2 and 3 `pending`, `attempts` 0, `next_attempt_at` unchanged; one `error` line that contains `Error` and not `MARKER-ERR`; `run()` resolves;
    - the same injected error for a mail with `attempts` 2 → the mail is `triaged` as `unsure` / `triage_error` (one `triage_results` row, audit `email.triaged` `reason_code` `triage_error`) (review finding 7).
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:unit && bun run test:int`
  - Done when: the tests pass.
  - Out of scope: the daily cap, the 7-day rule (stage 24), `main.ts` (stage 25).
