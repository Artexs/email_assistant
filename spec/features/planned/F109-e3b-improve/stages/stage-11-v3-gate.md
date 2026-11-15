# F109 stage 11 — `classifier-v3` holdout gate and production switch `[risky]`

Part of [`../plan.md`](../plan.md). Decisions P3, P9, D13. Needs stages 09 and 10. LLM spend: **cap $1.50 for the stage**: at most 2 holdout runs (`--budget-usd 0.60` each) and at most 2 dev runs (`--budget-usd 0.30` each). Review before the land. This stage changes the production prompt.

## Step 1 — Holdout run and the ship rule

**Goal.** One holdout run decides if `classifier-v3` with the chosen parts replaces `classifier-v2`.

**Run.** `bun run eval --sim lab-01 --part holdout --provider openai --model gpt-6-luna --reasoning-effort none --prompt-version classifier-v3 --prompt-parts <Chosen parts of the stage 09 summary> --budget-usd 0.60`. Read the month ledger first.

**Ship rule (D13, default, owner to confirm, Q6).** Compare with the v2 holdout report `evals/results/2026-11-15-sim-lab-01-holdout-gpt-6-luna-classifier-v2.md`. v3 ships only when all hold:

1. No category that is `go` in the v2 sim gate table is `no-go` for v3.
2. Key misses `K` (stage 09 definition) of v3 < `K` of v2.
3. The `urgent` and the `needs_reply` false-negative rates of v3 are each at most 1 point above v2 (14.1%, 6.2%).
4. Injection passes ≥ 29 of 31; the whitelist rule is all correct.
5. Classifier cost per mailbox per month (report) ≤ $2.00.

All five → ship (step 2). Else: one dev-only change (a rule-line rewrite or dropping one part, decided from the dev reports, never from the holdout report), up to 2 dev runs that must meet the D12 win rule again, then one more holdout run against the same rule. Still failing → no ship: `classifier-v2` stays, and stage 12 builds escalation on v2.

The full sim gate (Wilson lower bound ≥ 98% for every category) is not the ship rule: v2 fails it for three categories, and a prompt that is better but not yet `go` still lowers M1 (P10). `auto` per category keeps its own gate (ADR 0028, P9).

## Step 2 — Switch (only on "ship")

**Decisions.**

- The gate command writes `evals/results/gate/classifier-classifier-v3-gpt-6-luna-none-lab-01-v1.json` (the existing naming); the report records the parts. It is provisional while the owner audit of lab-01 is pending, like the v2 file.
- The production pointer in `prompts/index.ts` becomes `classifier-v3` with a constant `CLASSIFIER_V3_PARTS` = the chosen list. A later change of the list or of the text is `classifier-v4` with its own gate.
- `triage_results.prompt_version` records `classifier-v3`; old rows keep `classifier-v2`.
- The service passes `CLASSIFIER_V3_PARTS` to `loadClassifierExtras` (stage 10).
- No flag: a prompt switch is not a new user-visible feature; the gate is its guard (PD-025). Rejected: an org flag per prompt version (two prompts in production, two evidence bases for ADR 0028).

**Test.**

1. The gate-evidence CI test passes for `classifier-v3` (the gate file exists and parses).
2. A unit test: the production pointer is `classifier-v3` and its parts equal `CLASSIFIER_V3_PARTS`.
3. Triage integration (fake LLM): a stored result has `prompt_version` `classifier-v3`.

**Output.** The holdout report(s) `evals/results/2026-MM-DD-sim-lab-01-holdout-gpt-6-luna-classifier-v3.md`, the gate file (on ship), and a short decision section at the end of the stage 09 summary: the five rule lines with v2 and v3 values, "ship" or "no ship", spend.

**Check.** The gate-evidence test and the triage tests, then the Proof.

**Done when.** The decision section is committed with the values; on ship tests 1–3 pass; on no ship the registry still points to v2 and the final message says so; Proof `PROOF_OK`.

**Out of scope.** Deploy (the coordinator's normal release), the history check of ADR 0028 (E4-B), escalation.
