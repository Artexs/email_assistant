# F138 stage 06 — Acceptance checks on OpenAI

Coordinator run (real money, production key; owner step O1 first). Needs stages 03 and 05: the files of the acceptance grep (`apps`, `packages`, `deploy`, `evals`, and `docs` through stage 05, which needs stage 04). Needs stage 02: one provider row, so `llm:check` can show only `openai`. Needs coordinator step C1 on the local `.env`.

Part of [`../plan.md`](../plan.md). `[risky]` (real money, LLM evals, production key).

This stage runs no drafter and no judge (plan D11: F115 stage 02 ran them on OpenAI). It writes no product code. Expected spend under $0.10; cap $2.50 (D13).

## Step 1 — Acceptance grep

- Run the ticket grep of stage 05 § Allowed hits; save it to `/tmp/f138-s06/grep.log`. Sort each hit by its path into a group; groups 2 (`evals/README.md`), 5 and 6 also need a read of the hit line. Write the per-group count. A hit outside every group: fix it here when it is a one-line text fix in a current file, else stop and report. Never edit a file of an allowed group (history).

## Step 2 — Checks on OpenAI

- **No Gemini key (T1), before any call:** `grep -cE '^(GEMINI_|LLM_[A-Z_]*=gemini)' .env` in this worktree. Not 0: remove those lines and the other `LLM_<ROLE>_*` lines of such a role from this worktree's `.env` only (`sed -i`; never the main checkout's file), then the count must be 0. Also `env | grep -c '^GEMINI_'` (must be 0). Save both counts to `/tmp/f138-s06/env-check.log`. Print counts only.
- **Spend and rate (D13, N9):** before the first call, write the November sum of the eval ledger (`eval-spend.jsonl`) in the final message. Any 429 (quota or rate) stops the stage at once: no retry, no other run; the key is the production project's.
- Never print the env, a key or `.env`. Never read `evals/sim/*/holdout/`.
- **Commands, in order** (save each output under `/tmp/f138-s06/`):
  1. `bun run llm:check`: passes and shows provider `openai`.
  2. `bun run llm:check --role judge`: passes, provider `openai`, model `gpt-6.1-terra`.
  3. Classifier smoke (Q4): `bun run eval --sim lab-01 --part holdout --limit 20 --budget-usd 1 --concurrency 2 --rpm 30 --out /tmp/f138-s06/classifier-smoke.md` (a `--limit` run writes no gate file). Pass = exit 0 or exit 1 on a bar; the output shows `state …: 0 earlier results` (the state name has no limit part, so an old holdout state would resume with no call: if it shows more, stop and report); 0 LLM errors; provider `openai` in the report; the eval ledger grew by more than $0. Commit nothing of it.
- **Exit 1 on a bar (N1):** 20 cases cannot hold a bar; it is a result. Record it and go on. An LLM error or a key error stops the stage.

## Step 3 — Pointer to the drafter evidence

- The ticket asks for "a drafter holdout report and gate file on the new models". F115 made them (plan D11, F11). List the files with `ls evals/results/*holdout*judge-terra* evals/results/*reply-injection*judge-terra* evals/results/gate/drafter-*` and give the list and each gate file's `passed` value in the final message. Do not run, edit or move them.
- A failed F115 gate is F115's result (its G1), not a failure of this stage.

## Check

`bun test apps/server/src/scripts`.

## Done when

- `/tmp/f138-s06/grep.log` holds only allowed hits; `/tmp/f138-s06/env-check.log` holds 0.
- Both `llm:check` runs and the classifier smoke run passed; their output is under `/tmp/f138-s06/`.
- The Proof (`sNN` = `s06`) prints `PROOF_OK` (only when the stage changed a file).
- The final message gives: the ledger sum before and after, the spend of the smoke run, the F115 file list with `passed` values, and the per-group hit counts of the grep.

## Out of scope

Drafter or judge runs; prompt changes; the owner check of 20 drafts (F115 stage 18); any VPS step; edits of F115 files or notes.
