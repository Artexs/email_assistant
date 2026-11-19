# F138 stage 06 — Runs on OpenAI

Part of [`../plan.md`](../plan.md). `[risky]` (real money, LLM evals, production key). Needs stage 05 landed and owner step O1 done.

This stage finishes the work of F115 stage 02 step 3 (plan D11): the reply drafter holdout and the reply injection set, graded by the judge `gpt-6.1-terra`. It writes no product code.

## Step 1 — Acceptance grep

- Run the ticket grep of stage 05 § Allowed hits; save it to `/tmp/f138-s06/grep.log`. Every hit must be in an allowed group. A hit outside them: fix it in this stage when it is a one-line text fix, else stop and report.

## Step 2 — Real runs

- **No Gemini key (T1), before any call:** `grep -cE '^(GEMINI_|LLM_[A-Z_]*=gemini)' .env` in this worktree. Not 0: remove those lines and the other `LLM_<ROLE>_*` lines of such a role from this worktree's `.env` only (`sed -i`; never the main checkout's file), then the count must be 0. Save the count to `/tmp/f138-s06/env-check.log`. Print counts only.
- **Spend and rate (D13, N9):** every run uses `--budget-usd 1 --concurrency 2 --rpm 30`. Before the first call, write the November sum of the eval ledger (`eval-spend.jsonl`) in the final message. Stop the stage when its own spend reaches $2.50. Any 429 (quota or rate) stops the stage at once: end the run (SIGTERM; the state file keeps the work), no retry, no other run; the key is the production project's. Exit 2 (run cap reached): run the same command again; it resumes.
- **Exit 1 (N1):** read the report. More than 10% judge errors: stop and report; do not switch the judge model. A failed bar (send as is, invented commitment, injection under 100%) is a result, not an error: record it and go on to the next run.
- Never print the env, a key or `.env`. Never read `evals/sim/*/holdout/`.
- **Order and commands** (`<d>` = the UTC date; `<flags>` = `--budget-usd 1 --concurrency 2 --rpm 30`):
  1. `bun run llm:check` and `bun run llm:check --role judge`: both pass and show provider `openai`; the judge line shows `gpt-6.1-terra`.
  2. Classifier smoke (Q4): `bun run eval --sim lab-01 --part holdout --limit 20 --budget-usd 1 --concurrency 2 --rpm 30 --out /tmp/f138-s06/classifier-smoke.md` (a `--limit` run writes no gate file). Commit nothing of it.
  3. Dev: `bun run eval --sim lab-01 --part dev --drafter --judge --model gpt-6-luna --reasoning-effort low <flags> --out evals/results/<d>-sim-lab-01-dev-gpt-6-luna-judge-gpt-6.1-terra-drafter-v1-reply.md`. After it, read its cost per draft and judge call; if (spend so far) + 3.5 × (dev cost) > $2.50, stop and report the estimate.
  4. Holdout: the same with `--part holdout` and the name `<d>-sim-lab-01-holdout-gpt-6-luna-judge-gpt-6.1-terra-drafter-v1-reply.md`. It writes the gate file `evals/results/gate/drafter-drafter-v1-gpt-6-luna-low-lab-01-v1.json`.
  5. Injection: `bun run eval --set reply-injection --drafter --judge --model gpt-6-luna --reasoning-effort low <flags> --out evals/results/<d>-reply-injection-gpt-6-luna-judge-gpt-6.1-terra-drafter-v1-reply.md`.
- **Decisions:** the drafter prompt stays `drafter-v1`, the judge prompt `judge-v1` (D14); no tuning in this stage. The old 2026-11-19 reports and the Gemini partial state stay untouched (history).
- **Done when:** the three report files and the gate file exist; the holdout report has its "Second pass input" section (F115 stage 02 step 3) and the judge line names `openai gpt-6.1-terra`.

## Step 3 — Notes for the second pass

- Append a section "Resumed on the OpenAI judge (F138 stage 06)" to `notes/2026-11-19-f115-s02-prototype-run.md`: the commands, the costs of each run, the ledger sum before and after, and the PD-083 numbers of the holdout and injection reports against their bars. Add one line: the dev numbers of the Gemini judge and of the new judge are not comparable (another judge).
- Counts only; no case or draft text.

## Check

`bun test apps/server/src/scripts`.

## Done when

- `/tmp/f138-s06/grep.log` holds only allowed hits; `/tmp/f138-s06/env-check.log` holds 0.
- Both `llm:check` runs and the classifier smoke run passed (their output saved under `/tmp/f138-s06/`).
- The three reports, the gate file and the note section are committed.
- The Proof (`sNN` = `s06`) prints `PROOF_OK`.
- The final message gives: spend per run, the ledger sum, the PD-083 numbers, and "F115 G1 can start".

## Out of scope

Prompt changes; a delegation judge rerun; the owner check of 20 drafts (F115 stage 18); any VPS step.
