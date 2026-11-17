# F103 stage 11 review notes

Sonnet review of `a7c0919c`: PASS. Report: `/tmp/coord/f103s11-review.txt`. The follow-up commits close the test gap, resolve the master merge and keep the notes below open for later stages.

## Closed in the follow-up

- **TEST GAP.** `apps/server/test/integration/triage-event-logs.test.ts` pins `triage_no_organization`, `triage_delegates`, `triage_failed`, `triage_release_failed` (both sites), `returned_mailbox_failed`, `triage_released_settings_changed` and `triage_claim_lost` (both sites): event name, level, fields, no free text, no `dropped_fields`, read from the unfiltered capture of `console.log` and `console.error`. A level test shows that the two debug events write nothing at level info. Mutations (each alone, restored with `git checkout`): `/tmp/f103-s11/mutation2.log`. One mutation (settings-changed from debug to info) passed the first version of the tests, because both levels go to `console.log`; the level test now catches it.
- **Master merge (F109 stage 11).** Master added the model issue paths (`LlmOutputError.issues`, for example `fields.task:too_big`) to the old `case … failed` line. The log keeps the event `eval_case_failed {case_id, code}`: a comma list fails the value rule (D7) as a field. `runEval` has a new hook `onCaseFailed({ caseId, code, issues })`; `scripts/eval.ts` prints `case <id> failed: <code> (<paths>)` through `createCliOutput`. Test in `scripts/eval-streams.test.ts`: the paths are on stdout, and the unfiltered stderr holds only `eval_case_failed case_id=… code=bad_output`, no path and no `dropped_fields`. The comment on `LlmOutputError.issues` no longer says that a log line may carry the paths.
- `docs/known-alerts.md`: no new entries. The stage 11 docs rule asks only for the known quotes (`web undo`, `returned … processed`, `LLM config error`, `LLM soft error`, `daily LLM cap`). `triage_retry`, `triage_done`, `eval_*`, `returned_feedback` and `triage_delegates` had no heading before, so they get none.

## Notes (open)

- **N1 `web_undo` and `email_id`.** The route parses the body with `undoBodySchema` (`z.uuid()`), so a non-UUID `emailId` gets 400 before the log call. The logger accepts a lower-case UUID only. `z.uuid()` also accepts an upper-case UUID, which the logger would drop (counted in `dropped_fields`). No test pins this; the app writes lower-case ids. No change needed now.
- **N2 `missing_key` has no hint.** `llm_config_paused` in `docs/known-alerts.md` lists the hints per code, but the config code `missing_key` has none (the old log text had none either). Add a hint line when the code is next touched.
- **N3 (review-10 N2) still applies.** The lint does not check the second argument of a log call. Stage 13 may tighten it. The new triage calls pass `errorFields(error)` directly as the second argument at several sites; the runtime filter covers them, and the new tests show no dropped field.
- **N4** The triage calls use named children (`mailboxLog`, `emailLog`), so the lint selector sees them (review-10 N1 does not apply).

## Land advice for stage 12

`git merge-tree` of stage 11 and stage 12 conflicts in two files.

- `eslint.config.js`: adjacent lines in the `error` file list. Keep both: `apps/server/src/*.ts` and `apps/server/src/modules/triage/**/*.ts`.
- `apps/server/src/platform/log-fields.ts`: both sides add `"case_id"` to `codeFieldNames`. Keep ONE `"case_id"`, the stage 11 comment and the stage 12 `batch` line. A duplicate in the `as const` array does NOT fail `bun run typecheck` (checked: exit 0, `/tmp/f103-s11/dup/typecheck.log`). It fails the unit test "the field lists join, do not overlap, and give each name its kind" in `apps/server/src/platform/` (`/tmp/f103-s11/dup/platform-tests.log`).
- `log-lint.test.ts` and `docs/known-alerts.md` merge without conflict.

## Warnings left

26 `no-restricted-syntax` warnings: `web.ts` 10, `composition.ts` 6, `testmail` 6, `retention.ts` 4 (stage 12). Master did not add old-form lines to `modules/triage`.
