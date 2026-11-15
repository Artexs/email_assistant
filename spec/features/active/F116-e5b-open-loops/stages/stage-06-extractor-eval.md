# F116 stage 06 — Extractor eval and gate

Part of [`../plan.md`](../plan.md). `[risky]` (LLM eval, real money). Needs stages 04 and 05. Checkpoint C1 follows.

## Step 1 — Runner

- **Goal:** `bun run eval --sim lab-01 --part sent-dev|sent-holdout --extractor [--budget-usd N]` runs the code filters and `extractSent` on every case of the part and scores them against the slot labels.
- **Decisions:**
  - Scoring per case: `expects_reply` (a skipped case counts as `false`); `promise` = a promise with a valid date (the product rule D7); `due` exact = the resolved local date equals the label date, counted only on cases whose label has a due; `promiseDue` the same.
  - Numbers: `expects_reply` recall and precision with the Wilson 95% lower bound (the PD-024 style of the existing gate code); `promise` precision (bound) and recall (reported, not gated); `due` exact share and `promiseDue` exact share; per language and per hard-case tag counts; injection cases: the share whose `ask` or `promise` holds a planted string (must be 0).
  - Gate bars (PD-123): `expects_reply` recall bound ≥ 0.90, precision bound ≥ 0.80; `promise` precision bound ≥ 0.90; `due` exact ≥ 0.90 (plain share); injection leak 0. The gate passes only on `sent-holdout`.
  - Spend: calls go through `eval-pool` under `--budget-usd` (default 1) and the $20 month cap; the extractor model needs an `llmPrices` row. A run that hits the budget exits 2 and resumes on the next run (the existing resume rule).
  - Gate file: `evals/results/gate/extractor-extractor-v1-<model>-<endpoint>-lab-01-sent-v1.json` (the F111 naming), with the numbers, the bars and `passed`.
  - Report: `evals/results/<date>-sim-lab-01-sent-holdout-<model>-extractor-v1.md`, counts and rates only; no case text for holdout. The dev report may name case ids.
- **Test (unit, fake LLM):** T1 three cases (a hit, a miss, a skip) → the expected confusion counts; T2 `due` exact with sent Fri 2026-11-20 18:00 Warsaw and answer `end_of_week` vs label 2026-11-27 → exact; T3 an injection case whose `ask` holds its planted string → leak 1, gate fails; T4 `--budget-usd 0.001` → exit 2 after the first call; T5 `--part sent-holdout` without `--extractor` → usage error (exit 1).

## Step 2 — Gate evidence test

- **Goal:** a test in `triage/gate-evidence.test.ts` (or a sibling) that a passing standard gate file exists for `prompts.extractor.version`, like the classifier check. Stage 12 does not start analysis without it (this CI test is the guard; there is no runtime check).
- **Test:** T6 the check fails on an empty temp folder and passes with a fixture file.

## Step 3 — The runs

- **Goal:** run `sent-dev`, tune the prompt on dev only, then one `sent-holdout` run, each with `--budget-usd 1`. Commit the reports and the gate file.
- **Decisions:**
  - Never read `sent-holdout/` for tuning (evals/README). A prompt change after the holdout run is `extractor-v2` and needs a new holdout run.
  - At most one rerun of each part (questions.md 7: ≤ $4 in total).
  - The report ends with a "Second pass input" section: the PD-123 numbers against their bars, the `promise` recall, the cost per sent mail, and the share of `expects_reply` true (it predicts the brief volume for G1).
- **Not run when:** no API key for the extractor provider in the worker env. Then stop after steps 1–2, say so; the coordinator runs step 3.
- **Gate fail:** C1. The coordinator may continue stages 07–11 (no LLM use) and starts a dev-only tuning job with `extractor-v2`.

## Check

`bun test apps/server/src/scripts apps/server/src/modules/triage`

## Done when

T1–T6 pass; the reports and the gate file are committed, or the final message says step 3 waits for the coordinator; the Proof prints `PROOF_OK` (`/tmp/f116-s06`).

## Out of scope

Product wiring, any DB change.
