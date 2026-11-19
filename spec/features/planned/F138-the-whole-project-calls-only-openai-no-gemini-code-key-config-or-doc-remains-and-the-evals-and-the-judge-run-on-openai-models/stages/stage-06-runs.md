# F138 stage 06 — Runs on OpenAI

Part of [`../plan.md`](../plan.md). `[risky]` (real money, LLM evals, the production OpenAI project). Needs stages 03, 04 and 05 landed and owner step O1 done.

This stage finishes the work of F115 stage 02 step 3 (plan D11): the reply drafter holdout and the reply injection set, graded by the judge `gpt-6.1-terra`. It writes no product code.

## Step 1 — Acceptance grep

- Run the ticket grep of stage 05 § Allowed hits; save it to `/tmp/f138-s06/grep.log`. Every hit must be in an allowed group. A hit outside them: fix it in this stage when it is a one-line text fix, else stop and report.

## Step 2 — Real runs

- **Spend rules (D13):** every run uses `--budget-usd 1`. Before the first call, sum the November lines of the eval ledger (`eval-spend.jsonl`, path in `apps/server/src/platform/eval-ledger.ts`) and write the sum in the final message. The stage stops when its own spend reaches $2.50. An `http_429_quota` answer stops the stage at once: no retry, no other run (the key is the one of the production project). Exit code 2 (run cap reached) is not an error: run the same command again; it resumes from its state file.
- **Never** print the env, a key or `.env`. Never read `evals/sim/*/holdout/`; a report of a holdout run holds counts only.
- **Order and commands** (`<d>` = the UTC date of the run):
  1. `bun run llm:check` and `bun run llm:check --role judge`: both pass and show provider `openai`; the judge line shows `gpt-6.1-terra`.
  2. Classifier smoke (Q4): read the usage text of `bun run eval` first (N3). With `--limit` allowed: `bun run eval --sim lab-01 --part holdout --limit 20 --budget-usd 1 --out /tmp/f138-s06/classifier-smoke.md`. Without it: stop and ask (a full run costs about $0.30). Commit no file of this run; delete any gate file it wrote.
  3. Dev: `bun run eval --sim lab-01 --part dev --drafter --judge --model gpt-6-luna --reasoning-effort low --budget-usd 1 --out evals/results/<d>-sim-lab-01-dev-gpt-6-luna-judge-gpt-6.1-terra-drafter-v1-reply.md`. After it, read its cost per draft and judge call; if (spend so far) + 3.5 × (dev cost) > $2.50, stop and report the estimate.
  4. Holdout: the same with `--part holdout` and the name `<d>-sim-lab-01-holdout-gpt-6-luna-judge-gpt-6.1-terra-drafter-v1-reply.md`. It writes the gate file `evals/results/gate/drafter-drafter-v1-gpt-6-luna-low-lab-01-v1.json`.
  5. Injection: `bun run eval --set reply-injection --drafter --judge --model gpt-6-luna --reasoning-effort low --budget-usd 1 --out evals/results/<d>-reply-injection-gpt-6-luna-judge-gpt-6.1-terra-drafter-v1-reply.md`.
- **Decisions:** the drafter prompt stays `drafter-v1`, the judge prompt `judge-v1` (D14); no tuning in this stage. The old 2026-11-19 reports and the Gemini partial state stay untouched (history). If the judge answers errors on more than 10% of cases (exit 1), stop and report; do not switch the judge model.
- **Done when:** the three report files and the gate file exist; the holdout report has its "Second pass input" section (F115 stage 02 step 3) and the judge line names `openai gpt-6.1-terra`.

## Step 3 — Notes for the second pass

- Append a section "Resumed on the OpenAI judge (F138 stage 06)" to `notes/2026-11-19-f115-s02-prototype-run.md`: the commands, the costs of each run, the ledger sum before and after, and the PD-083 numbers of the holdout and injection reports against their bars. Add one line: the dev numbers of the Gemini judge and of the new judge are not comparable (another judge).
- Counts only. No case text, no draft text from the holdout.

## Check

`bun test apps/server/src/scripts` (nothing in code changed; it guards against a stray edit).

## Done when

- `/tmp/f138-s06/grep.log` holds only allowed hits.
- Both `llm:check` runs and the classifier smoke run passed (their output saved under `/tmp/f138-s06/`).
- The three reports, the gate file and the note section are committed.
- The Proof (`sNN` = `s06`) prints `PROOF_OK`.
- The final message gives: spend per run, the ledger sum, the PD-083 numbers, and "F115 G1 can start".

## Out of scope

A judge or drafter prompt change; a delegation judge rerun (the 2026-11-15 dev judge report is not a gate); the owner check of 20 drafts (F115 stage 18); any VPS step.
