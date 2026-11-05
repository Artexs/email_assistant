# s1b-shadow-triage — Stage 28

Part of [`../s1b-shadow-triage.md`](../s1b-shadow-triage.md). Read that file's "Input" and "Rules for every step" first.

## Stage 28 — Real-label eval [risky]

- [x] **28.1 `bun run eval --real`**
  - Goal: precision and recall per category from real labels in the DB, without an LLM call.
  - Files: create `apps/server/src/modules/triage/eval-real.ts`; export from `triage/index.ts`; change `apps/server/src/scripts/eval.ts`; create `apps/server/test/integration/triage-eval-real.test.ts`. `eval-report.ts` needs no change: `renderEvalReport` and `evalExitCode` handle `kind: "real"` since step 18.1.
  - Interfaces:
    - `bun run eval --real --org-id <uuid> --mailbox-id <uuid> [--synthetic] [--bar 0.98] [--min-kept 30] [--out <file.md>]`.
    - `buildRealPredictions(rows: Awaited<ReturnType<typeof listLabeledResults>>): Prediction[]`.
    - `buildRealReport(rows, opts: { bar: number; minKept: number; mail: MailKind; now: Date }): RealEvalReport` (`kind: "real"`, `labeled` = the number of rows, `startedAt` = `now`; the type is from step 17.1).
  - Decisions:
    - Real labels live only in `triage_feedback` (never in git, architecture §4.4). `listLabeledResults(…, { mail: "real" })` (default; `--synthetic` for dev checks) never includes synthetic mail (review finding 2).
    - Expected = `true_category`; verdict `right` without a category → expected = the stored category; verdict `wrong` without a category → `wrongOnly`. `modelCategory` = `fields.model_category` (else the stored category); `confidence` = the stored confidence.
    - `source`: `model` NULL and `reason_code` `blocklist` → `rule`; `model` NULL and `reason_code` `triage_error` → `error`; `model` NULL and `reason_code` `llm_blocked` → `llm` with `predicted` and `modelCategory` `unsure` and `confidence` 0 (user answer Q28: a blocked mail counts as predicted `unsure`, not as an error); else `llm`. Rule and error rows stay out of the metrics, the sweep and go/no-go and show on their own lines.
    - The header (rendered by step 18.1 for `kind: "real"`) shows N, the rule count, the error count, and the under-100 line when N < 100.
    - With `--real` the CLI reads no case file from `evals/cases/` and needs no `GEMINI_API_KEY` (review finding 1). No LLM call, so no gate check is needed. Exit code 0 when the report prints, 1 on an error.
  - Test (`triage-eval-real.test.ts`, `withRollback`): rows → predictions for each verdict case; a blocklist row → `source: "rule"`, a `triage_error` row → `source: "error"`, an `llm_blocked` row → `source: "llm"`, predicted `unsure`, confidence 0; a synthetic labeled mail does not appear with the default; `buildRealReport` gives `kind: "real"` and `labeled` = N; `renderEvalReport` of it warns under 100 labels.
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:unit && bun run test:int`
  - Done when: the tests pass.
  - Out of scope: re-classifying real mail with a new model (that sends real mail to the LLM).

## Follow-ups from the checkpoint 2 group review (2026-11-05)

- Set `RealEvalReport.errors` = count of `source: "error"` rows and `errorCodes = { triage_error: n }`, so that the header and the "Errors:" line agree with `ruleSummary.error.total`.
- Decided (user 2026-11-05): both. In `thresholdSweep` a `wrongOnly` row counts as a false positive for its `modelCategory`; when the stored category was `unsure` (below the threshold), the "wrong" verdict is about `unsure`, not about the model guess. (1) Stage 26.2: `parseLabelInput` returns `ask_again` for `w` on an `unsure` row, so the CLI asks for a true category. (2) Here: `buildRealPredictions` drops a row with verdict `wrong`, no true category and stored category `unsure` (safety net for scripted labels, `--wrong`). Test: such a row gives no prediction.
