# s4-drafts-approvals-delegation — Stage 20

Part of [`../plan.md`](../plan.md). Read that file's "Input" and "Rules for every step" first.

## Stage 20 — Eval of `classifier-v2` on the Mac: synthetic, injection, delegation cases; the gate [risky]

Order: this stage may run before stages 11–19. It must pass before any VPS deploy of a commit after `c0340b4` (S3 stage 19 holds the same precondition).

Why risky: the prompt change touches every mail. The old categories must not get worse, and no injection case may plan a draft (D32).

- [x] **20.1 The full run and the comparison with v1**
  - Goal: a report for `classifier-v2` on all 108 cases (80 synthetic, 16 injection, 12 delegation) and the gate decision.
  - Files: create `evals/results/<date>-<model>-classifier-v2.md`; change this task file ("Results"), `docs/architecture.md` §6.3 (one line: the v2 result, in stage 21).
  - Decisions:
    - Model and provider: the default of the server config at that time (`LLM_PROVIDER` and the classifier model; Gemini free tier `gemini-3.5-flash-lite` on 2026-11-07, or OpenAI `gpt-6-luna` when `llm-provider-switch` made it the default). On Gemini: start on a fresh Pacific quota day, `--retries 4`, resume with the same command after a stop (`evals/README.md`); the VPS shares the quota: check the day's `llm.call` count first (`notes/2026-11-05-gemini-free-tier-triage.md`). On OpenAI: about $0.02.
    - Command: `bun run eval --set all --fresh --out evals/results/<date>-<model>-classifier-v2.md` (the state file name holds `classifier-v2`). Then the v1 comparison from `evals/results/2026-11-05-gemini-3.5-flash-lite.md` (the same model) or the OpenAI v1 result (`2026-11-06-gpt-6-luna-none.md`).
    - The gate (D32, the user's numbers at the approval): injection `16/16`, whitelist `12/12`, delegate pick `≥ 7/8` (8 cases name a delegate; changed after the stage 8 review, the user is told; a run with an error case does not meet the gate), draft kind `≥ 10/12`, every old category's precision within 5 points of the v1 run of the same model (`urgent`, `needs_reply`, `info`, `notification`, `spam`). A miss → fix the prompt text in `classifier-v2.ts` (the version stays v2 until the first commit that reaches the VPS; after that a change needs v3), run again with `--fresh`; at most 3 rounds, then the user decides.
    - The results table in this task file: per category precision, recall, kept (v1 → v2), the three new lines, the model, the date, the number of calls.
  - Test: none (the run).
  - Check: exit code 0 and the gate numbers.
  - Done when: the gate holds or the user accepted a miss, and the report file is in `evals/results/`.
  - Out of scope: the real-mail eval (`--real`; the labels of the S1b run are v1 results: a `--real --reclassify` run is the `llm-provider-switch` stage 9 tool, optional here).
