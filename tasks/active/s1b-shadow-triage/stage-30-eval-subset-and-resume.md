# s1b-shadow-triage — Stage 30

Part of [`../s1b-shadow-triage.md`](../s1b-shadow-triage.md). Read that file's "Input" and "Rules for every step" first.

## Stage 30 — Eval subset and resume [risky]

- [ ] **30.1 Eval runner: subset and resume for a small daily quota**
  - Goal: an eval run can use a fixed subset and continue over several days, so the `gemini-3.8-flash` comparison fits its free-tier quota (about 20 requests per day [not verified]).
  - Files: change `apps/server/src/modules/triage/eval.ts`, `apps/server/src/modules/triage/eval.test.ts`, `apps/server/src/modules/triage/eval-report.ts`, `apps/server/src/scripts/eval.ts`, `evals/README.md`, `.gitignore` (add `evals/.runs/`).
  - Interfaces:
    - New CLI flags: `--per-category <n>` (subset through `selectCases`, step 12.1), `--state <file.jsonl>` (default `evals/.runs/<model>-<set>[-pc<n>].jsonl`), `--fresh` (delete the state file first).
    - `runEval` input gets `done?: CaseResult[]` (results read from the state) and deps get `onResult?(r: CaseResult): Promise<void>` (the CLI appends one JSON line per finished case).
    - `CasesEvalReport` (step 17.1) gets `complete: boolean`, `stoppedReason: string | null`, `doneCount: number`, `totalCount: number`. `RealEvalReport` does not change. `evalExitCode` returns `0 | 1 | 2`.
  - Decisions:
    - The state file holds per-case results only: id, kind, expected, model category, final category, confidence, source, blocked, usage, error code. No case text (the same rule as the logs). It is outside git (`evals/.runs/`).
    - On start, cases with a result without an error in the state are skipped (no LLM call); a blocked result (`blocked: true`) counts as done. Cases that ended in an error are tried again.
    - Stop rule: when 3 cases in a row end in `error` after their soft-error retries, stop the run, keep the state, set `stoppedReason: "soft errors in a row (quota or overload), resume later"`. A used-up daily quota gives 429 for every call; more retries only waste time and quota.
    - The report is made from all results (state + this run) and shows "N of M cases done". `evalExitCode` rules (review finding 15), checked in this order: `kind: "real"` → 0. `kind: "cases"`: 1 when the whitelist check is below 100% or an injection case failed (complete or not), or when the run is complete and `errors` is more than 10% of the cases; else 2 when the run is not complete (stopped or cases left), and the CLI prints "resume with the same command"; else 0.
    - Exact request counts (review finding 15): `--set all --per-category 3` = 18 cases (15 synthetic + 3 injection); with `--retries 1` at most 36 requests, 18 when no call fails. `--set all` without a subset ≈ 90 cases.
    - `evals/README.md`: the runner and the worker share one project quota; a full run is about 90 requests; with `TRIAGE_LLM_SCOPE=all` on the VPS, check the quota left for the day first; the 3.8 Flash comparison uses `--per-category 3 --retries 1` (18 cases, 18–36 requests per model) [not verified quota].
  - Test (`eval.test.ts`, fake `LlmClient`): a run with `done` for 2 cases makes no call for them and the report counts them; 3 soft-error cases in a row stop the run with `complete: false` and exit code 2; a stopped run with one failed injection case gives exit code 1; an error case in `done` is tried again; a blocked case in `done` is not tried again; the state line written through `onResult` has no `body` or `subject` field; `--per-category 3` on the real case files picks 18 cases (through `selectCases`).
  - Check: `bun run lint && bun run typecheck && bun run test:unit`
  - Done when: the tests pass.
  - Out of scope: real labels, any change to the classifier or the prompt.

## Follow-ups from the checkpoint 2 group review (2026-11-05)

- Extract one `toPrediction(CaseResult)` for both the live and the `done` path; `runEval` builds predictions inside the loop (rule rows: `modelCategory "spam"`, confidence 1, while `CaseResult` holds `null`). Either add `whitelisted: boolean` to `CaseResult` or recompute it from the case.
- Add the stop rule for a spent quota: without it a full run on a spent quota retries every case 4 times (about 130 s per case, about 3 h for 90 cases).
- Update `evals/README.md` "Run": it lacks the flags `--set`, `--limit`, `--model`, `--out`, `--bar`, `--min-kept`, `--retries`, and still says "Stage 18 adds `bun run eval`".
- Export one `DEFAULT_MAILS_PER_DAY = 200` from core `cost.ts`; `eval.ts` and `eval-report.ts` each define `MAILS_PER_DAY` (stage 27 needs it a third time). Optional: share the 500-character excerpt constant (`EXCERPT_LENGTH` in `eval.ts`, `EXCERPT_CHARS` in `prompts/classifier-v1.ts`).
