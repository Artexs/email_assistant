# F103 stage 11 — Convert triage

Part of [`../plan.md`](../plan.md). Needs stage 01 landed. May run next to one other conversion stage.

Two steps.

## Step 1 — Convert 27 calls

**Goal.** Every log call in `modules/triage/` is an event (D5, D6, D7). LLM text (a summary, a reason text, a hint) never reaches a field.

**New field names** (`platform/log-fields.ts`; add each that is not in the list yet, another conversion stage may have added it): number `wait_ms`, `max_attempts`; code `case_id`, `category`, `feedback`, `until`, `day_start`.

- `until` and `day_start` are ISO times (`toISOString()`): they pass the code rule (digits, `-`, `:`, `.`, `T`, `Z`).
- `case_id` is an eval case id from the eval corpus files (codes such as `inv-001`); if a case id can hold a space or other text, the writer drops it: say so in the final message.

**Children.** In `triage/jobs.ts` (per mailbox): `mailboxLog = log.with({ org_id, mailbox_id })`. In `triage/service.ts` per email: `emailLog = log.with({ email_id: email.id })`.

| File:line                   | Old text                                                   | Level | Event                              | Fields                                                                                                        |
| --------------------------- | ---------------------------------------------------------- | ----- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| triage/eval.ts:345          | `soft error on case …, retry N after N ms`                 | warn  | `eval_case_retry`                  | `case_id`, `attempts: attempt + 1`, `wait_ms: wait`                                                           |
| triage/eval.ts:400          | `case … failed: ${code}`                                   | warn  | `eval_case_failed`                 | `case_id`, `code`                                                                                             |
| triage/eval.ts:473          | `stop: N cases in a row ended in an error`                 | warn  | `eval_stopped`                     | `count`                                                                                                       |
| triage/eval.ts:481          | `case …: ${category ?? error code}`                        | info  | `eval_case_done`                   | `case_id`, `category` or `error_code`                                                                         |
| triage/jobs.ts:75           | `triage …: no mailbox_settings row, mailbox skipped`       | warn  | `triage_no_settings`               | (mailboxLog)                                                                                                  |
| triage/jobs.ts:86           | `triage …: no organization row, mailbox skipped`           | warn  | `triage_no_organization`           | (mailboxLog)                                                                                                  |
| triage/jobs.ts:114          | `triage …: delegates N`                                    | debug | `triage_delegates`                 | `count`                                                                                                       |
| triage/jobs.ts:136          | `daily LLM cap reached for mailbox …`                      | warn  | `llm_daily_cap_reached`            | `count: deps.dailyCap`, `day_start`, `until`                                                                  |
| triage/jobs.ts:159          | `triage failed:`                                           | error | `triage_failed`                    | `...errorFields`                                                                                              |
| triage/jobs.ts:172, :201    | `triage …: release failed:`                                | error | `triage_release_failed`            | `mailbox_id`, `...errorFields(releaseError)`                                                                  |
| triage/jobs.ts:190, :216    | `triage … failed:`                                         | error | `triage_mailbox_failed`            | `...errorFields`                                                                                              |
| triage/jobs.ts:208          | `triage …: triage_error save failed:`                      | error | `triage_error_save_failed`         | `...errorFields(finishError)`                                                                                 |
| triage/pause.ts:28          | `LLM soft error ${code}: triage paused for N min, until …` | warn  | `llm_paused`                       | `code`, `wait_ms: ms`, `until`                                                                                |
| triage/pause.ts:30          | `LLM config error ${code}: ${configHint}; triage paused …` | error | `llm_config_paused`                | `code`, `wait_ms: ms`, `until` (the hint text is not logged; `docs/known-alerts.md` keeps the hints per code) |
| triage/returned.ts:73       | `returned …: feedback …`                                   | debug | `returned_feedback`                | `email_id`, `feedback`                                                                                        |
| triage/returned.ts:94       | `returned ${row.id}:`                                      | error | `returned_failed`                  | `email_id: row.id`, `...errorFields`                                                                          |
| triage/returned.ts:98       | `returned ${mailboxId}:`                                   | error | `returned_mailbox_failed`          | `mailbox_id`, `...errorFields`                                                                                |
| triage/returned.ts:100      | `returned …: processed N`                                  | info  | `returned_done`                    | `mailbox_id`, `count: processed`                                                                              |
| triage/routes.ts:48         | `web undo ${kind} mail … by user …`                        | info  | `web_undo`                         | `kind: result.kind`, `email_id`, `user_id`                                                                    |
| triage/service.ts:213       | `triage …: settings changed, mail released`                | debug | `triage_released_settings_changed` | (emailLog)                                                                                                    |
| triage/service.ts:221, :386 | `triage …: lost the claim`                                 | warn  | `triage_claim_lost`                | (emailLog)                                                                                                    |
| triage/service.ts:274       | `triage …: mailbox … category … code …`                    | info  | `triage_done`                      | `mailbox_id`, `category: decision.finalCategory`, `reason: decision.auditReasonCode`                          |
| triage/service.ts:364       | `triage …: ${describeError}, try N of M`                   | warn  | `triage_retry`                     | `attempts: email.attempts + 1`, `max_attempts`, `...errorFields`                                              |
| triage/service.ts:514       | `triage …: llm.call audit write failed:`                   | warn  | `llm_audit_failed`                 | `...errorFields(auditError)`                                                                                  |

**Decisions.** D2, D5, D6, D7, D16.

**Test.**

1. Every test that matched an old text matches the event text: `grep -rn "triage \|LLM soft error\|LLM config error\|daily LLM cap\|returned \|web undo\|case .*:" apps/server/test apps/server/src --include=*.test.ts`. At least `triage-logs.test.ts`, `triage-job.test.ts`, `triage-service.test.ts`, `triage-returned.test.ts`, `triage/pause.test.ts`, `triage/eval.test.ts` may match.
2. `triage-logs.test.ts` still proves that no line holds mail text, a summary, an error message, an error body or a key.
3. New case in `triage/pause.test.ts` (or the file that tests `pause.ts`): a config trip writes `llm_config_paused` with `code`, `wait_ms`, `until`, and the captured line does not hold the config hint text.

**Check.** `bun test apps/server/src/modules/triage apps/server/test/integration/triage-*.test.ts`.

**Done when.** No `no-restricted-syntax` message in `modules/triage/`; the tests pass.

## Step 2 — Lint level and known alerts

**Files.** `eslint.config.js` (add `"apps/server/src/modules/triage/**/*.ts"` to the `error` block); `log-lint.test.ts` (one case: an old-form line in `apps/server/src/modules/triage/__log-fixture.ts` gives `[2]`); `docs/known-alerts.md` and `deploy/README.md` by D17 (known matches at `0a5c2ee`: `known-alerts.md:55` (`web undo …`), `:486` (`returned <mailboxId>: processed <n>`), and the `LLM config error`, `LLM soft error`, `daily LLM cap` entries; the config hints that `pause.ts` printed move into the `llm_config_paused` entry, one line per code; run the per-row grep for the rest).

**Check.** `grep -n "LLM config error\|LLM soft error\|daily LLM cap reached" docs/known-alerts.md` shows no heading with an old text.

**Done when.** The lint case passes; the Proof of `plan.md` (`/tmp/f103-s11`) prints `PROOF_OK`; the final message gives the warning count and lists new field names and calls not in the table.

**Out of scope.** Triage behaviour; F097 and F100 changes in these files (convert their lines by D16 if they have landed).
