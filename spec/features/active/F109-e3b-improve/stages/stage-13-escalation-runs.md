# F109 stage 13 — Escalation runs and the ship decision `[risky]`

Part of [`../plan.md`](../plan.md). Decisions P5, P10, D16. Needs stage 12. LLM spend: **cap $2.50 for the stage**: 2 dev runs (`--budget-usd 0.50` each) and at most 1 holdout run (`--budget-usd 1.50`; above the $1 default run cap, Q7). Review before the land.


> **Decision of stage 11 (2026-11-15): no ship.** `classifier-v3[list]` failed ship rule 4 (whitelist 314 of 315: one `bad_output` counts as not correct); rules 1, 2, 3 and 5 passed. `classifier-v2` stays in production. This stage builds on `classifier-v2`: the "production pointer" is `classifier-v2`, `--prompt-parts` is NOT passed (it counts only for v3), and the base of the escalation prompt is `classifier-v2`. Detail: end of `evals/results/2026-11-15-f109-v3-dev-summary.md`. If the coordinator overrides the decision and ships v3 first, this note no longer applies.

## Step 1 — Dev runs

**Run (twice).** `bun run eval --sim lab-01 --part dev --provider openai --model gpt-6-luna --reasoning-effort none --prompt-version <production pointer> [--prompt-parts <CLASSIFIER_V3_PARTS, or none>] --escalate --escalation-model gpt-6.1-terra --escalation-reasoning-effort none --budget-usd 0.50` (review N5: both prompt flags pinned to production; `--prompt-parts` only for v3). A run starts only when the spend so far plus its budget stays within the stage cap. Read the month ledger before each run.

**Dev rule (D16, default, owner to confirm, Q8; means of the two runs).** All must hold:

1. `H` of the cascade ≤ half of `H` of the first answers.
2. `spam` false positives of the cascade < those of the first answers.
3. No category loses more than 3 true positives or gains more than 3 false positives (cascade against first answers).
4. Triggered share ≤ 30% of the cases.
5. Classifier plus escalation cost per mailbox per month (the report's estimate at 200 mails a day) ≤ $3.00, so M7 stays under the $5 target with drafts and hosting (`E03-discovery-notes.md` §4).

Any rule fails → decision "no ship"; skip step 2.

## Step 2 — Holdout run (only after the dev rule passes)

**Run (once).** The same command with `--part holdout --budget-usd 1.50`.

**Holdout rule.** Rules 1–5 above on this one run, plus: for each category, the upper end of the cascade's Wilson 95% precision interval is at or above the lower end of the first answers' (review N8); injection passes ≥ those of the first answers; the whitelist rule all correct. All hold → "ship"; the gate command writes the gate file for role `escalation` (`escalation-escalation-v1-gpt-6.1-terra-none-lab-01-v1.json`, provisional like the others). Else "no ship".

No rewrite and no second holdout run in this stage: a "no ship" ends the escalation line of F109 (rejected: tuning the trigger on the holdout).

## Output

- The run reports in `evals/results/f109-escalation/`.
- `evals/results/2026-MM-DD-f109-escalation-summary.md`: per run the first-answer and cascade values of `H`, `K`, `spam` precision, per-category precision and recall, triggered share, cost split; each rule line with its values; the line `Decision: ship` or `Decision: no ship`; total spend.
- Note in the summary: the `urgent` → `needs_reply` misses (26 of 220 on the v2 holdout) are outside the PD-060 trigger; escalation does not target them.

**Test.** No new product code. The stage 12 tests still pass.

**Check.** The stage 12 unit tests, then the Proof.

**Done when.** The summary with its `Decision:` line and the spend (≤ $2.50) is committed; the final message gives the decision and the five dev values; Proof `PROOF_OK`.

**Out of scope.** Triage wiring (stage 14), prompt changes.

## Carry-over from the stage 12 review (coordinator, 2026-11-15)

- Check that `--escalate` with `--prompt-version classifier-v3` (or `--prompt-parts`) is refused or named in the report: the second call always uses the `classifier-v2` text. Stage 11 decided no ship, so production is v2; a v3 cascade run has no meaning.
- Both calls are reported for a resumed case: an escalation error re-runs the whole case, including the first call (stage 12 note). Do not count the first call twice in the budget.
- The `escalation-v1.ts` comment about the registry test points to the wrong test: fix it.
