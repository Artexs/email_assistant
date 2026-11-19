# F138 · Fixes for plan review 1

Review: [plan-review-1.md](plan-review-1.md) (FAIL at 5175a70f). One line per finding: the decision, and where it lives now.

- **B1** Claim ids must run with no gap. Decision: no claim row is deleted or renumbered. The rows of the removed registry row and the removed privacy sentence keep their ids; their claim starts `Removed by ADR 0037 (2026-11-19):` and their source is `ADR 0037`. The stage 04 grep and stage 05 § Allowed hits (group 8) allow those rows. Stage 04 step 3.
- **B2** Stage 05 runs after stages 03 and 04, never next to 04 (`capability-map.test.ts` needs the ADR file). Order: 01 → 02 → {03, 04} → 05 → 06. Plan § How to run, ticket § Slices, stages 03, 04, 05, 06 headers.
- **T1** Stage 06 step 2 starts with an env check: `grep -cE '^(GEMINI_|LLM_[A-Z_]*=gemini)' .env` in the job worktree must be 0. If it is not 0, the worker removes those lines from the worktree copy only. Log: `/tmp/f138-s06/env-check.log`. C1 also cleans the local `.env` before stage 06.
- **T2** The stage 04 Check runs `legal-papers.test.ts`, `own-model-docs.test.ts` and `capability-map.test.ts`. The 0035 README cell stays as is (it must end in `decision 6 waits`). The 0035 status line keeps its text and gets `; amended by 0037` at the end. The stage 05 Check runs `capability-map` and `own-model-docs`. The stage 02 Check adds `legal-papers`.
- **T3** Plan D15. Tests of a mechanism that needs two providers (per-provider limiter, a role on another provider, null effort) move to `twoProviderTable()` in `platform/llm/testing.ts`, with a test-only row `other`. Env tests that parse a second provider are deleted, because the enum has one value. The worker lists each moved and each deleted test. Stage 02 step 1, test 6.
- **N1** Plan D13 and the stage 06 "Exit 1" rule. A failed bar is a result: record it and go on. Only more than 10% judge errors stops the stage.
- **N2** C1 also deletes the other `LLM_<ROLE>_*` lines of a role whose provider was Gemini. `llm:check` runs in the new image after the deploy.
- **N3** Plan D4 and stage 01. The only trigger of the default judge is a missing judge model. Other judge keys and flags do not change the model. Stage 01 test 5 covers `LLM_JUDGE_RPM` alone; test 7 covers `--judge-provider` alone.
- **N4** The `TERMS_HISTORY` comment names no vendor: `// LLM sub-processor row removed (ADR 0037)`. Stage 02 step 3, plan D9.
- **N5** Stage 01 step 1 "Text". The usage text and the comments in `eval-args.ts`, `eval-drafter.ts` and `eval-sim.ts` that say "another provider" now state the model rule.
- **N6** Stage 01 now says ADR 0037 comes in stage 04.
- **N7** Stage 04 never edits `apps/` or `evals/`. If the ADR number differs, stage 05 fixes `JUDGE_SAME_MODEL` and `evals/README.md`.
- **N8** Plan C2 names F111 stage 07, F115 stage 17 and the F115 stage 02 text. The final message gives the exact edits.
- **N9** Plan D13 and stage 06. Every run uses `--concurrency 2 --rpm 30`. Any 429 (quota or rate) stops the stage.
- **N10** Accepted and recorded: plan D3, ADR 0037 point 3 (stage 04), questions.md item 7.
- **N11** The ticket Scope names `GEMINI_MODEL_CLASSIFIER` (default `gemini-3.5-flash-lite`). C1 deletes every `GEMINI_*` line, so the `GEMINI_MODEL=` line of the main `.env` goes too.
