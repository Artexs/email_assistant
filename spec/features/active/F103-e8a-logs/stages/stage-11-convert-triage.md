# F103 stage 11 — Convert triage

Part of [`../plan.md`](../plan.md). Needs stage 01 landed. May run next to one other conversion stage.

Two steps.

## Step 1 — Convert 28 calls

**Goal.** Every log call in `modules/triage/` is an event (D5, D6, D7). LLM text (a summary, a reason text, a hint) and free-text stop reasons never reach a field.

**New field names** (each only if missing): number `wait_ms`, `max_attempts`; code `case_id`, `category`, `feedback`, `until`, `day_start`.

- `until` and `day_start` are ISO times (`toISOString()`); they pass the code rule.
- `case_id` is a corpus case id (`inv-001`); if one can hold a space, the writer drops it: say so.

**Children.** `triage/jobs.ts` per mailbox: `mailboxLog = log.with({ org_id, mailbox_id })`. `triage/service.ts` per email: `emailLog = log.with({ email_id: email.id })`.

File, old text (start) → event: fields. Levels stay.

- `eval.ts`: `soft error on case …, retry N after N ms` → `eval_case_retry`: `case_id`, `attempts: attempt + 1`, `wait_ms`.
- `eval-judge.ts` (new since the first base): `soft error on judge of case …, retry N after N ms` → `eval_judge_retry`: `case_id`, `attempts`, `wait_ms`.
- `eval.ts`: `case … failed: ${code}` → `eval_case_failed`: `case_id`, `code`.
- `eval.ts`: `case …: ${category ?? error code}` → `eval_case_done`: `case_id`, `category` or `error_code`.
- `eval.ts`: `stop: ${pool.stoppedReason}` → `eval_stopped`: `reason` = `"error_streak"` when the reason is the `STOP_REASON` constant of `eval.ts`, `"budget_cap"` when it is `BUDGET_STOP_REASON` of `eval-pool.ts`. Never the reason text (it is a sentence).
- `jobs.ts`: `no mailbox_settings row, mailbox skipped` → `triage_no_settings`; `no organization row, mailbox skipped` → `triage_no_organization`: (mailboxLog).
- `jobs.ts`: `triage …: delegates N` → `triage_delegates`: `count`.
- `jobs.ts`: `daily LLM cap reached for mailbox …` → `llm_daily_cap_reached`: `count: deps.dailyCap`, `day_start`, `until`.
- `jobs.ts`: `triage failed:` → `triage_failed`: `...errorFields`.
- `jobs.ts`: `triage …: release failed:` (×2) → `triage_release_failed`: `mailbox_id`, `...errorFields(releaseError)`.
- `jobs.ts`: `triage … failed:` (×2) → `triage_mailbox_failed`: `...errorFields`.
- `jobs.ts`: `triage_error save failed:` → `triage_error_save_failed`: `...errorFields(finishError)`.
- `pause.ts`: `LLM soft error ${code}: triage paused …` → `llm_paused`: `code`, `wait_ms`, `until`.
- `pause.ts`: `LLM config error ${code}: ${configHint}; …` → `llm_config_paused`: `code`, `wait_ms`, `until` (the hint is not logged; `docs/known-alerts.md` keeps the hints per code).
- `returned.ts`: `returned …: feedback …` → `returned_feedback`: `email_id`, `feedback`.
- `returned.ts`: `returned ${row.id}:` → `returned_failed`: `email_id`, `...errorFields`.
- `returned.ts`: `returned ${mailboxId}:` → `returned_mailbox_failed`: `mailbox_id`, `...errorFields`.
- `returned.ts`: `returned …: processed N` → `returned_done`: `mailbox_id`, `count`.
- `routes.ts`: `web undo ${kind} mail … by user …` → `web_undo`: `kind`, `email_id`, `user_id`.
- `service.ts`: `settings changed, mail released` → `triage_released_settings_changed`: (emailLog).
- `service.ts`: `lost the claim` (×2) → `triage_claim_lost`: (emailLog).
- `service.ts`: `triage …: mailbox … category … code …` → `triage_done`: `mailbox_id`, `category: decision.finalCategory`, `reason: decision.auditReasonCode`.
- `service.ts`: `${describeError}, try N of M` → `triage_retry`: `attempts`, `max_attempts`, `...errorFields`.
- `service.ts`: `llm.call audit write failed:` → `llm_audit_failed`: `...errorFields(auditError)`.

**Decisions.** D2, D5, D6, D7, D16.

**Test.**

1. Tests that matched an old text match the event text (at least `triage-logs.test.ts`, `triage-job.test.ts`, `triage-service.test.ts`, `triage-returned.test.ts`, `triage/pause.test.ts`, `triage/eval.test.ts`, `triage/eval-judge.test.ts` may).
2. `triage-logs.test.ts` still proves that no line holds mail text, a summary, an error message, an error body or a key.
3. `triage/pause.test.ts`: a config trip writes `llm_config_paused` with `code`, `wait_ms`, `until`, and the line does not hold the config hint text.
4. `triage/eval.test.ts` (or the pool test): a run stopped by the budget cap writes `eval_stopped reason=budget_cap`, and no line holds the text of `BUDGET_STOP_REASON`.

**Done when.** No `no-restricted-syntax` message in `modules/triage/`; the tests pass.

## Step 2 — Lint level and known alerts

- `eslint.config.js`: add `modules/triage/**/*.ts` to the `error` block. `log-lint.test.ts`: an old-form line at `modules/triage/__log-fixture.ts` gives `[2]`.
- Docs by D17. Known quotes: `web undo …`, `returned <mailboxId>: processed <n>`, and the `LLM config error`, `LLM soft error`, `daily LLM cap` entries. The config hints that `pause.ts` printed move into the `llm_config_paused` entry, one line per code. No heading in `docs/known-alerts.md` keeps an old text of these three.

**Done when.** No old text of the list in either doc; the Proof (`/tmp/f103-s11`) prints `PROOF_OK`; the final message gives the warning count, new field names and calls not in the list.

**Out of scope.** Triage behaviour (F097 lines: D16).
