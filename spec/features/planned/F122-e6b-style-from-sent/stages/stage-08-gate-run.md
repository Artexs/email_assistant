# F122 stage 08 — Gate run `[risky]`

Part of [`../plan.md`](../plan.md). Needs stage 01: `prompts.stylist`; stage 06: `--stylist` runs and the injection result file; stage 07: `--style`, `judge-v4`, `eval:style-gate`. Real LLM spend: the coordinator starts it as a worker job with the eval key of the job `.env` (as the F115 tuning runs); total cap $1.00.

The last stage: measure whether a suggested style makes drafts fit the user's style better, with no loss on facts, and record the verdict. The flag `style_from_sent` turns on only on a pass (O1, a coordinator record).

## Step 1 — Runs, in this order

Every drafter run: `gpt-6-luna`, effort `low`, `drafter-v4` (production), judge `gpt-6.1-terra` `judge-v4`, `--concurrency 2 --rpm 30 --judge-rpm 30`. Before each run, add the ledger lines of this stage; stop and ask in the final message when the next run's estimate would take the total above $1.00.

| # | run | estimate |
| --- | --- | --- |
| 1 | `--part sent-dev --stylist` (tuning; up to 3 runs, and at most one new prompt `stylist-v2` written from what `sent-dev` output shows) | $0.03 |
| 2 | `--set style-injection --stylist` with the final prompt | $0.01 |
| 3 | `--part sent-holdout --stylist` once → style file B | $0.01 |
| 4 | smoke: `--part dev --drafter --judge --judge-prompt judge-v4 --limit 20`, once with `--style none`, once with style file B | $0.07 |
| 5 | holdout A: `--part holdout --drafter --judge --judge-prompt judge-v4 --style none --budget-usd 0.50` | $0.44 |
| 6 | holdout B: the same with `--style <style file B>` | $0.44 |
| 7 | `eval:style-gate --a <A state> --b <B state> --style <B file> --injection <file>` | $0 |

- **Decisions:** D15–D17. Prompt tuning reads only `sent-dev` output and the dev smoke drafts (`--dump-drafts`); never open a file under `holdout/` or `sent-holdout/`, and from runs 3, 5 and 6 open only the reports, the style file and the gate file. A new `stylist-v2` changes `prompts.stylist` and is the prompt of runs 2–6. When run 2 fails (an injection case), fix the prompt once on `sent-dev`, re-run 1 and 2, then go on; a second failure stops the stage. When run 4 shows judge errors above 5% or a `style_match` that is always the same value, stop and report (the judge prompt needs a fix in a new job). The holdout runs run once each; a run stopped at its budget resumes with the same command (the state file), and the resumed cost counts.
- **Check:** every report, style file, the injection result file and the gate file are committed under `evals/results/` (synthetic text only).

## Step 2 — Record

- **Goal:** `spec/features/active/F122-e6b-style-from-sent/tuning-1.md` (the ticket is in `active/` while it builds): the runs table (cases, code checks, invented commitments, send as is A and B, `style_match` means A and B, wins / losses / ties, Wilson lower bound, cost, report path), the spend total from the ledger lines, the style text B (synthetic), the verdict, and what the coordinator does next:
  - pass → O1: turn `style_from_sent` on for the pilot org with `setOrgFeature` after the release that carries stages 02–03; the pilot week watches the suggestion on the owner's real Sent mail.
  - fail → the flag stays off (D17); the outcome says which bar failed; a drafter that shows style is a new ticket.
- **Done when:** the gate file exists with `passed` true or false; `tuning-1.md` is committed; total spend ≤ $1.00 by the ledger; `docs/capabilities/reply-drafts.md` states the gate result in one line; the Proof line is PASS.
- **Out of scope:** a drafter prompt change; turning the flag on (coordinator, O1); a second holdout run of either config.
