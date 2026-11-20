# F122 stage 09 — Gate run `[risky]`

Part of [`../plan.md`](../plan.md). Needs stage 01: `prompts.stylist`; stage 06: `--stylist` runs and the injection result file; stage 07: `--style`, `judge-v4`; stage 08: `eval:style-gate`. Real LLM spend (a worker job with the eval key of the job `.env`, as the F115 tuning runs); cap $1.00.

Measure whether a suggested style makes drafts fit the user's style better with no loss on facts, and record the verdict. The flag turns on only on a pass (O1).

## Step 1 — Runs, in this order

Every drafter run: `gpt-6-luna`, effort `low`, `drafter-v4` (production), judge `gpt-6.1-terra` `judge-v4`, `--concurrency 2 --rpm 30 --judge-rpm 30`. Keep a running total of the ledger lines of this stage (`spent`).

| # | run | estimate |
| --- | --- | --- |
| 1 | `--part sent-dev --stylist` (tuning; at most 2 runs, and at most one new prompt `stylist-v2` written from what `sent-dev` output shows) | $0.02, not measured |
| 2 | `--set style-injection --stylist` with the final prompt | $0.01, not measured |
| 3 | `--part sent-holdout --stylist` once → style file B | $0.01, not measured |
| 4 | smoke: `--part dev --drafter --judge --judge-prompt judge-v4 --limit 20 --dump-drafts …`, once with `--style none`, once with style file B | $0.07 (F7 rate) |
| 5 | holdout A: `--part holdout --drafter --judge --judge-prompt judge-v4 --style none --budget-usd <1.00 − spent − 0.44>` | $0.44 (F7) |
| 6 | holdout B: the same with `--style <style file B> --budget-usd <1.00 − spent>` | $0.44 (F7) |
| 7 | `eval:style-gate --a <A state> --b <B state> --style <B file> --injection <file>` | $0 |

- **Decisions:** D15–D17.
  - **Budget.** Every `--budget-usd` is the rest of the $1.00, as the table says, also on a resume (the per-run cap does not know the stage total). After run 1, replace the stylist estimates with the measured cost. A run that stops at its budget ends the runs: the verdict is `stopped`, no gate file, and the final message asks the owner for the extra spend (kind money) with the measured numbers.
  - **Futility stop (default, `questions.md` 13).** After run 4: when B's mean `style_match` on the 20 dev pairs is not above A's and B has no more wins than losses, stop. Verdict `fail (smoke)`, no holdout run, no gate file.
  - **Judge stop.** Run 4 with judge errors above 5%, or a `style_match` that is the same value in every case → stop and report (the judge prompt needs a fix in a new job).
  - **Tuning.** Read only `sent-dev` output and the dev smoke drafts. Never open a file under `holdout/` or `sent-holdout/`; from runs 3, 5 and 6 open only the reports, the style file and the gate file. A `stylist-v2` changes `prompts.stylist` and is the prompt of runs 2–6. When run 2 fails, fix the prompt once on `sent-dev`, re-run 1 and 2; a second failure stops the stage.
  - Runs 5 and 6 run once each; a resume uses the same command (the state file), and its cost counts.
- **Check:** every report, style file, injection result and gate file is committed under `evals/results/`.

## Step 2 — Record

- **Goal:** `tuning-1.md` in the ticket folder (in `active/` while it builds): the runs table (cases, code checks, invented commitments, send as is A and B, `style_match` means A and B, wins / losses / ties, Wilson lower bound, flips, cost, report path), the spend total from the ledger lines, the style text B (synthetic), the verdict (`pass`, `fail`, `fail (smoke)` or `stopped`), and the next step:
  - pass → O1: the coordinator turns `style_from_sent` on for the pilot org with `setOrgFeature` after the release that carries stages 02–03.
  - fail or `fail (smoke)` → the flag stays off (D17); the outcome names the failed bar.
  - `stopped` → the owner decides on more spend.
- **Done when:** `tuning-1.md` is committed with a verdict; total spend ≤ $1.00 by the ledger; `docs/capabilities/reply-drafts.md` states the result in one line; the Proof line is PASS.
- **Out of scope:** a drafter change; the flag (O1); a second holdout run.
