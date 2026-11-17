# F110 stage 07: history check classify step (notes for the next agent)

Branch: `limen/2026-11-17-f110-s07-history-classify-risky-86044b45`. Stage file: `spec/features/active/F110-e4-b-earn-trust/stages/stage-07-history-classify.md`.

## What the stage added

- `triage/classify-stored.ts`: `classifyStored(deps, ctx, emailId)` (hard rules, thread context, `classifyEmail`, `decideCategory`, would-do plan). It takes the mailbox snapshot in `deps.mailbox` (interfaces.md lists three arguments; the snapshot rides in `deps`). `wouldMoveOf(category, { vip })` is the one place that answers "would assist mode with `auto` on move this mail". `triage/classify-input.ts` is the part of `triageOne` that both paths share. `triage/mailbox-snapshot.ts` builds a `TriageMailbox` for a caller that is not the triage job.
- `trust/history-classify.ts` (the step), `history-items.ts` (item rows with cost, under the lock of the claim), `history-result.ts` (result per category), `history-ended.ts` (the `trust_report_ready` hook), `acted-on.ts` (`historyActedOn`, the seam for sent signals).
- `history-queue.ts`: `classifying` is a step status now; `completeCheck`, `endCheckKeyChanged`; `endCheck`, `failStep` and the stale-lock stop take an `onEnded` hook that runs in the same transaction.
- `LlmPause.pausedUntil(now)` (new method). `recordLlmCall` takes `historyCheckId`; `countLlmCallsSince` leaves those rows out.
- `mail/repo/history.ts`: candidates, stored mail, flag facts.

## Decisions taken (defaults; the coordinator may copy them to the owner log)

- Audit key name: `data.historyCheckId` (camel case, as the stage text says; the other `llm.call` keys are snake case).
- N8 (carry-over from stage 06): under `TRIAGE_LLM_SCOPE=synthetic` the history job still runs the backfill and the flag refresh (they make no model call and store mail with the normal retention, behind `trust_ladder`); only the classify sample is cut to test mail. A check that classified 0 mails under it ends `no_result` / `no_history` with no notice (review 7 N3): `countEarlierEndedChecks` skips such a check (`no_history` with `backfill_done_at` set), so the one notice is still free for a later check. Undo: skip the backfill in `backfillStep` when the scope is synthetic.
- N6 (carry-over): `refreshFlagsOfMailbox` (the history refresh) passes `touchGone: false`, so gone mail keeps its old `checked_at` and the regular refresh and its move finder still see it first. Cost: a history mail that vanished between backfill and refresh holds the flags wait until its 20-minute limit.
- N7 (carry-over): a run starts no new organization after 12 s (`HISTORY_RUN_MS`), and the organizations are listed longest-waiting first (`min(next_attempt_at)`), so none waits for ever. A deploy kill still leaves a stale lock that costs one attempt.
- A mail that the model cannot judge (blocked answer, invalid answer, other hard error) becomes an `unsure` item with `acted_on` false and reason `llm_blocked` or `classify_error`. Without an item the same mail would cost a call in every run. A failed call counts at the price of its tokens when the answer came back (a refused category), else at 0.002 USD (`HISTORY_FAILED_CALL_USD`), so the $0.25 cap sees it (review 7 N1). Five failed calls in a row end the check `no_result` / `model_failing` (new reason: migration `20261117120001_history_model_failing.sql`, `noResultReasonSchema`, texts in `interfaces.md`). The streak is kept per check in the job process; a restart starts it again.
- `total` in the result = all items of the check; `wouldMove` = items of the category that assist mode would move (acted on or not). `moved` and `acted` as in the stage text.
- `blocked` in the notice view = moving categories that are not recommended.
- An unpriced model that answers (price lost mid-check) ends the check `cost_unknown` without writing the item of that call.
- No `CHECK ((status in ('done','no_result')) = (finished_at is not null))` was added: no migration is open. The three writers (`endCheck`, `completeCheck`, `endCheckKeyChanged`) and the two stops (`claimNextCheck`, `failStep`) write both fields; tests assert it with `expectFinishedTogether`.

## For the next stages

- Stage 08/09 read `history_checks.result` through `historyResultFor` (unchanged). `readCategoryEvidence` in `trust/gate.ts` is the one reader of the evidence of a category; stage 11 `trustViewFor` should use it.
- The report notice view has `reportUrl` from `WEB_BASE_URL` (`webBaseUrl` in `HistoryJobDeps`).
- Stage 25 docs: `docs/capabilities/triage.md` has a bullet for the classify step; the capability pages `account-data.md` and `sync.md` still need the history check lines of review 5 N4.
