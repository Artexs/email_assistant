# F109 stage 13: escalation runs and ship decision

**Decision: no ship** (dev rule 5 fails; the holdout run was not made)

Decision: no ship

## Setup

- Base prompt: `classifier-v2` (production pointer; stage 11 decided no ship for `classifier-v3`). `--prompt-parts` is not passed.
- First call: `openai gpt-6-luna`, effort none. Second call (role `escalation`, prompt `escalation-v1`): `openai gpt-6.1-terra`, effort none.
- Corpus: `lab-01` v1, part `dev` (389 cases per run). Command, per run (`<n>` = 1, 2):
  `bun run eval --sim lab-01 --part dev --provider openai --model gpt-6-luna --reasoning-effort none --prompt-version classifier-v2 --escalate --escalation-model gpt-6.1-terra --escalation-reasoning-effort none --budget-usd 0.50 --fresh --out evals/results/f109-escalation/dev-<n>.md`
- Reports: `evals/results/f109-escalation/dev-1.md`, `evals/results/f109-escalation/dev-2.md`. Both exit with code 1 (the rule exit of the old go/no-go table, not a crash).
- The spend rule of the owner (2026-11-15): cap $1 per run. The stage text allowed one holdout run at $1.50; the owner order limits it to $1.00. No holdout run was made, so that limit was never in play.

## Values per run

| value | run 1 first | run 1 cascade | run 2 first | run 2 cascade |
| --- | --- | --- | --- | --- |
| `H` | 1 | 0 | 0 | 0 |
| `K` (urgent missed + hidden needs_reply + spam FP) | 22 | 20 | 25 | 25 |
| urgent missed / hidden needs_reply / spam FP | 11 / 0 / 11 | 10 / 0 / 10 | 16 / 0 / 9 | 16 / 0 / 9 |
| `spam` precision | 84.7% | 85.7% | 87.1% | 87.0% |
| `spam` recall | 98.4% | 96.8% | 98.4% | 96.8% |
| urgent precision / recall | 97.9% / 80.7% | 95.9% / 82.5% | 100.0% / 71.9% | 97.6% / 71.9% |
| needs_reply precision / recall | 89.0% / 100.0% | 89.0% / 100.0% | 83.2% / 97.5% | 83.2% / 97.5% |
| delegation precision / recall | 96.6% / 98.3% | 95.0% / 98.3% | 93.7% / 100.0% | 93.7% / 100.0% |
| info precision / recall | 100.0% / 83.6% | 100.0% / 82.1% | 100.0% / 85.1% | 100.0% / 85.1% |
| notification precision / recall | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% / 100.0% |

| value | run 1 | run 2 |
| --- | --- | --- |
| answered cases | 388 (1 `bad_output` error, case `b-del-0222`) | 389 |
| triggered (second call) | 95 (24.5%) | 94 (24.2%) |
| changed final answers | 3 (info→delegation 1, spam→urgent 2) | 1 (spam→urgent 1) |
| cost classifier | $0.074080 ($0.000191 per mail) | $0.074445 ($0.000191 per mail) |
| cost escalation | $0.183406 ($0.000473 per mail) | $0.181324 ($0.000466 per mail) |
| cost cascade | $0.257486 ($0.000664 per mail) | $0.255769 ($0.000658 per mail) |
| cascade per mailbox per month at 200 mails a day | $3.98 | $3.95 |
| whitelist rule | 77 of 77 | 77 of 77 |
| injection | 17 of 17 | 15 of 17 |

## Dev rule D16 (means of the two runs)

| # | Rule | Value | Result |
| --- | --- | --- | --- |
| 1 | `H` cascade ≤ half of `H` first | first 0.5, cascade 0 | pass (the dev set has almost no `H` cases: 1 and 0, so this is weak evidence) |
| 2 | `spam` false positives cascade < first | first 10.0, cascade 9.5 | pass |
| 3 | No category loses more than 3 true positives or gains more than 3 false positives | largest change: `spam` TP −1.0 (mean), `urgent` FP +1.0, `urgent` TP +0.5, `delegation` FP +0.5, `info` TP −0.5 | pass |
| 4 | Triggered share ≤ 30% | 24.5% and 24.2% (mean 24.4%) | pass |
| 5 | Cascade cost per mailbox per month ≤ $3.00 | $3.98 and $3.95 (mean $3.96) | **FAIL** |

Rule 5 fails by $0.96 per month. The second call alone costs about $2.8 per month (0.000470 per mail × 200 × 30). A cheaper trigger (fewer than 24% of the cases) or a cheaper second model could pass it, but each needs a new prompt or trigger version and a new decision; this stage does not tune them (the dev rule is fixed). The gain is small: `K` falls by 2 in run 1 and by 0 in run 2.

**Decision: no ship.** Step 2 (the holdout run) is skipped by the stage rule: "Any rule fails → decision no ship; skip step 2." No gate file for role `escalation` is written. The holdout folder was not read. Stage 14 builds nothing (the ticket says it builds only on "ship").

## Notes

- The `urgent` → `needs_reply` misses (26 of 220 on the v2 holdout) are outside the PD-060 trigger: the first answer is `needs_reply`, so `shouldEscalate` is false. Escalation does not target them. Urgent misses on dev (10 to 16) stay almost the same after escalation (cascade urgent recall 82.5% and 71.9%).
- Escalation changes few answers (3 and 1 of about 95 triggered cases). The gain does not pay for the cost at this trigger.
- Carry-overs of the stage 12 review, done in this stage: `--escalate` with `--prompt-version classifier-v3` or `--prompt-parts` is now a usage error (the second call always uses the `classifier-v2` text); a test pins that a resumed escalation error runs the case again from the first call and the new result counts each call once; the `escalation-v1.ts` comment points to `eval-escalation.test.ts`.

## Spend (ledger)

Month ledger (`~/.local/state/email-assistant/eval-spend.jsonl`) before stage 13: $1.4259 (month cap $20).

| run | label | ledger line | usd |
| --- | --- | --- | --- |
| dev 1 | `lab-01-dev-gpt-6-luna` | runId `1b859ca1-53ff-4d92-a581-6c8b334fcdf2` | 0.2613 |
| dev 2 | `lab-01-dev-gpt-6-luna` | runId `1f3e55c2-3a25-4bff-9b43-ae58de290b72` | 0.2558 |
| holdout | not run | none | 0 |

Total spend of stage 13: **$0.5171** (stage cap $2.50; owner cap $1 per run). Month ledger after: $1.9430.
