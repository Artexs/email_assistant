# F109 stage 13 — Escalation runs and the ship decision `[risky]`

Part of [`../plan.md`](../plan.md). Decisions P5, P10, D16. Needs stage 12. LLM spend: **cap $2.50 for the stage**: 2 dev runs (`--budget-usd 0.50` each) and at most 1 holdout run (`--budget-usd 1.50`; above the $1 default run cap, Q7). Review before the land.

## Step 1 — Dev runs

**Run (twice).** `bun run eval --sim lab-01 --part dev --provider openai --model gpt-6-luna --reasoning-effort none --escalate --escalation-model gpt-6.1-terra --budget-usd 0.50`, with the production classifier prompt after stage 11. Read the month ledger before each run.

**Dev rule (D16, default, owner to confirm, Q8; means of the two runs).** All must hold:

1. `H` of the cascade ≤ half of `H` of the first answers.
2. `spam` false positives of the cascade < those of the first answers.
3. No category loses more than 3 true positives or gains more than 3 false positives (cascade against first answers).
4. Triggered share ≤ 30% of the cases.
5. Classifier plus escalation cost per mailbox per month (the report's estimate at 200 mails a day) ≤ $3.00, so M7 stays under the $5 target with drafts and hosting (`E03-discovery-notes.md` §4).

Any rule fails → decision "no ship"; skip step 2.

## Step 2 — Holdout run (only after the dev rule passes)

**Run (once).** The same command with `--part holdout --budget-usd 1.50`.

**Holdout rule.** Rules 1–5 above on this one run, plus: no category that is `go` in the sim gate table of the first answers is `no-go` for the cascade; injection passes ≥ those of the first answers; the whitelist rule all correct. All hold → "ship"; the gate command writes the gate file for role `escalation` (`escalation-escalation-v1-gpt-6.1-terra-none-lab-01-v1.json`, provisional like the others). Else "no ship".

No rewrite and no second holdout run in this stage: a "no ship" ends the escalation line of F109 (rejected: tuning the trigger on the holdout).

## Output

- The run reports in `evals/results/f109-escalation/`.
- `evals/results/2026-MM-DD-f109-escalation-summary.md`: per run the first-answer and cascade values of `H`, `K`, `spam` precision, per-category precision and recall, triggered share, cost split; each rule line with its values; the line `Decision: ship` or `Decision: no ship`; total spend.
- Note in the summary: the `urgent` → `needs_reply` misses (26 of 220 on the v2 holdout) are outside the PD-060 trigger; escalation does not target them.

**Test.** No new product code. The stage 12 tests still pass.

**Check.** The stage 12 unit tests, then the Proof.

**Done when.** The summary with its `Decision:` line and the spend (≤ $2.50) is committed; the final message gives the decision and the five dev values; Proof `PROOF_OK`.

**Out of scope.** Triage wiring (stage 14), prompt changes.
