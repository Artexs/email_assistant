# F109 stage 11 — `classifier-v3` holdout gate and production switch `[risky]`

Part of [`../plan.md`](../plan.md). Decisions P3, P9, D13. Needs stages 09 and 10. LLM spend: **cap $0.60 for the stage**: one holdout run (`--budget-usd 0.60`; the v2 holdout cost $0.27). Review before the land. This stage changes the production prompt.

## Step 1 — Holdout run and the ship rule

**Goal.** One holdout run decides if `classifier-v3` with the chosen parts replaces `classifier-v2`.

**Run.** `bun run eval --sim lab-01 --part holdout --provider openai --model gpt-6-luna --reasoning-effort none --prompt-version classifier-v3 --prompt-parts <Chosen parts of the stage 09 summary, or none> --budget-usd 0.60`. Read the month ledger first.

**Ship rule (D13, default, owner to confirm, Q6).** Compare with the v2 holdout report `evals/results/2026-11-15-sim-lab-01-holdout-gpt-6-luna-classifier-v2.md`. v3 ships only when all hold:

1. No proven precision loss: for each category, the upper end of v3's Wilson 95% precision interval is at or above the lower end of v2's (review N8: `info`'s `go` sits exactly on 98.0%, so the go label alone would flip on one case).
2. Key misses `K` (stage 09 definition): `K(v3)` ≤ `K(v2)` − max(4, 2s), with `s` the dev noise of stage 09.
3. The `urgent` and the `needs_reply` false-negative rates of v3 are each at most 1 point above v2 (14.1%, 6.2%).
4. Injection passes ≥ 29 of 31; the whitelist rule is all correct.
5. Classifier cost per mailbox per month (report) ≤ $2.00.

All five → ship (step 2). Else no ship: `classifier-v2` stays, and stage 12 builds escalation on v2. No second holdout run (review N7: a change after a failed holdout is steered by the holdout); a later prompt is `classifier-v4` on a new corpus version.

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
2. The gate-evidence test also reads `promptParts` from the v3 gate file and asserts it equals `CLASSIFIER_V3_PARTS` (review N10), so a later edit of the constant fails CI.
3. Triage integration (fake LLM): a stored result has `prompt_version` `classifier-v3`.

**Output.** The holdout report(s) `evals/results/2026-MM-DD-sim-lab-01-holdout-gpt-6-luna-classifier-v3.md`, the gate file (on ship), and a short decision section at the end of the stage 09 summary: the five rule lines with v2 and v3 values, "ship" or "no ship", spend.

**Check.** The gate-evidence test and the triage tests, then the Proof.

**Done when.** The decision section is committed with the values; on ship tests 1–3 pass; on no ship the registry still points to v2 and the final message says so; Proof `PROOF_OK`.

**Rollback (review N11).** Revert = point the registry back to `classifier-v2` (its gate file stays). Trigger, read by the coordinator after 14 days of v3 on the pilot: `bun run eval --gap` with the v3 gate file says `gap` for `notification` or `spam`, or the weekly M1 shows more found misses than the mean of the last two v2 weeks. Stage 16 writes this rule into the triage page.

**Out of scope.** Deploy (the coordinator's normal release), the history check of ADR 0028 (E4-B), escalation.

## Carry-over from stage 09 review (coordinator)

- Decision for the stage 09 result: the literal injection side condition (not fewer than mean R2 = 16.5 of 17) gives `none`, but an integer count passes it only with 17 of 17, so R2b itself would fail its own baseline; case h-rli-05 fails in 9 of 10 runs. The coordinator reads it as noise, keeps `list`, and gives it this one holdout run (N7). Rule 4 keeps the absolute injection bar (at least 29 of 31) and the whitelist rule. If `list` fails the holdout, ship nothing and keep v2; do not run `classifier-v3[]` (on dev it cannot beat v2 by the margin).
- Before the holdout run: count `bad_output` errors in the report; an errored whitelist or VIP case counts as NOT correct for rule 4 (today the report leaves errored cases out of "N of N correct"). Dev run R6a and R6b each had one `bad_output` on the same VIP delegation case (about six tasks in one mail; likely a `task` over 300 characters or a `clarification` over 200). Log the Zod issue path (no mail text) on `LlmOutputError` (`platform/llm/client.ts` drops the raw text and the issues today) and decide whether the limit, or a cut instead of a throw, is the fix.
- Before the switch: pin a sha of `buildSystemPrompt(classifierCategories, CLASSIFIER_V3_PARTS)` in `classifier-v3.test.ts` (D11: a change of the text needs `classifier-v4`).
