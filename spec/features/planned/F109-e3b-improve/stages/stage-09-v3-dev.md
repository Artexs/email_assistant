# F109 stage 09 — `classifier-v3` dev experiments `[risky]`

Part of [`../plan.md`](../plan.md). Decisions P3, D11, D12. Needs stage 08. LLM spend: **cap $2.00 for the stage**, at most 14 runs, each run `--budget-usd 0.30`. Review before the land.

## Step 1 — Ablation on the dev set

**Goal.** Each work-list part has a measured effect on the dev set, and one part list is chosen for the holdout (stage 11).

**Runs** (all `bun run eval --sim lab-01 --part dev --provider openai --model gpt-6-luna --reasoning-effort none`, the settings of the 2026-11-15 holdout run):

| # | Variant | Times |
| --- | --- | --- |
| R1 | `--prompt-version classifier-v2` | 2 |
| R2 | `classifier-v3`, parts `[]` (attachments only) | 2 |
| R3 | `classifier-v3`, `urgency` | 1 |
| R4 | `classifier-v3`, `history` | 1 |
| R5 | `classifier-v3`, `list` | 1 |
| R6 | `classifier-v3`, all winners of R3–R5 | 2 |

Up to 4 more runs for D12 rewrites. Before each run read the month spend ledger; if the run could pass the $20 month cap or the stage cap, stop and report.

**Decisions (D12, default, owner to confirm, Q5).**

- Key misses `K` of a run = `urgent` false negatives + `needs_reply` mail with a final category `info`, `notification`, `spam` or `unsure` + `spam` false positives (counts of the dev report).
- Noise `s` = the larger of `|K(R1a) − K(R1b)|` and `|K(R2a) − K(R2b)|`.
- R2 must not be worse than v2: mean `K(R2)` ≤ mean `K(R1)` + max(2, s). Else stop: attachments in the prompt is a decided input (P2), so the final message reports the loss and the coordinator decides.
- A part wins when `K(variant)` ≤ mean `K(R2)` − max(4, 2s), and no category loses more than 3 true positives or gains more than 3 false positives against mean R2, and injection passes are not fewer, and the whitelist rule stays all correct.
- A part that loses may get one rewrite of its rule lines (not of its input section) and one more run; at most 2 rewrites in the stage. A rewrite changes only the part's own text.
- R6 confirms: mean `K(R6)` must also meet the win margin against mean R2. If R6 fails while single parts won, choose the one part with the lowest `K`.
- No part wins → the chosen list is `[]` (attachments only).
- Never read `evals/sim/lab-01/holdout/` and never run `--part holdout` in this stage.

**Output.**

- Each run's report in `evals/results/f109-v3-dev/` (dev reports may list case ids).
- A summary `evals/results/2026-MM-DD-f109-v3-dev-summary.md`: per run `K`, per-category precision and recall, `urgent` recall per source (`text`, `vip`, `context`), average tokens, cost per mail; `s`; the verdict per part; the line `Chosen parts: [...]` (stages 10 and 11 read it); total spend.
- The rewrites (if any) are committed in `classifier-v3.ts` with the summary.

**Test.** No new product code except rewrites. The prompt unit tests of stage 08 still pass (update their fixture only for a rewritten rule line).

**Check.** The stage 08 prompt tests, then the Proof.

**Done when.** The summary is committed with `Chosen parts:` and the spend (≤ $2.00); the final message names the chosen parts, `K` per variant and `s`; Proof `PROOF_OK`.

**Out of scope.** The production pointer (stage 11), real-mail readers (stage 10), any holdout run.
