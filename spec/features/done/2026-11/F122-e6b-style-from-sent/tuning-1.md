# F122 · Style gate run 1 (stage 09)

Verdict: **`fail (smoke)`.** On the 20-case dev smoke, drafts with the suggested style (B) got the same mean `style_match` as drafts with no style (A), 1.85 against 1.85, with 1 win and 1 loss. The futility stop of `questions.md` item 13 applied, so the holdout runs 5 and 6 and the gate run 7 did not run. No gate file exists. The flag `style_from_sent` stays off (D17).

## Runs (2026-11-20)

Every drafter run: `gpt-6-luna`, effort `low`, `drafter-v4`, judge `gpt-6.1-terra` `judge-v4`, `--concurrency 2 --rpm 30 --judge-rpm 30`. Every stylist run: `gpt-6-luna`, effort `low`, `stylist-v1`. No provider error, no judge grade error.

| # | run | cases | code checks | invented commitments | send as is | `style_match` mean | cost | report |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | stylist `sent-dev` | 50 samples | style checks ok | – | – | – | $0.0009 | `evals/results/2026-11-20-sim-lab-01-sent-dev-gpt-6-luna-low-stylist-v1.md` |
| 2 | stylist `style-injection` | 4 | 4 of 4 passed | – | – | – | $0.0006 | `evals/results/2026-11-20-style-injection-gpt-6-luna-low-stylist-v1.md` |
| 3 | stylist `sent-holdout` → style file B | 100 samples | style checks ok | – | – | – | $0.0014 | `evals/results/2026-11-20-sim-lab-01-sent-holdout-gpt-6-luna-low-stylist-v1.md` |
| 4A | dev smoke, `--style none` | 20 | 20 of 20 | 0 | 17 of 20 (85%) | 1.85 (0 / 3 / 17) | $0.0382 | `evals/results/2026-11-20-sim-lab-01-dev-smoke20-gpt-6-luna-drafter-v4-judge-v4-style-none.md` |
| 4B | dev smoke, style file B | 20 | 20 of 20 | 0 | 16 of 20 (80%) | 1.85 (0 / 3 / 17) | $0.0386 | `evals/results/2026-11-20-sim-lab-01-dev-smoke20-gpt-6-luna-drafter-v4-judge-v4-style-sent-holdout-stylist-v1.md` |
| 5 | holdout A | not run (futility stop) | | | | | $0 | |
| 6 | holdout B | not run (futility stop) | | | | | $0 | |
| 7 | `eval:style-gate` | not run (no holdout states) | | | | | $0 | |

- Files: style file B `evals/results/styles/lab-01-sent-holdout-stylist-v1-gpt-6-luna-low.json`; the `sent-dev` style file `evals/results/styles/lab-01-sent-dev-stylist-v1-gpt-6-luna-low.json`; injection result `evals/results/styles/style-injection-stylist-v1-gpt-6-luna-low.json` (`passed` 4 of 4).
- Paired dev smoke (20 pairs, from the two dev dumps): `style_match` wins / losses / ties of B over A 1 / 1 / 18. `answers_every_question` mean A 1.75, B 1.65. Wilson lower bound and flips: not computed, because the gate tool reads only full holdout runs.
- Judge stop: did not apply. Grade errors 0 of 20 in each run; `style_match` takes the values 1 and 2.
- Tuning: no `stylist-v2`. The `sent-dev` text of `stylist-v1` held no name, contact or quote and passed its checks; run 2 passed on the first try.

## Why B does not differ from A (read in the dev dumps)

`drafter-v4` writes skeletons: a greeting and one "Regarding <topic>: [[gap]]." line per question. 19 of 20 B drafts differ from their A draft, mostly in the topic words, the gap labels, or a blank line after the greeting. The greeting differs in 2 pairs (B adds "Cześć" before the first name), and the count of gap lines differs in 3 pairs (B splits one question into two lines). The style text has no place to show in such a draft, and A already scores 1.85 on `style_match` with no style. A drafter that shows style is a new ticket (D17).

## Spend

Ledger lines of this stage (lines 71 to 75 of `~/.local/state/email-assistant/eval-spend.jsonl`): $0.0009 + $0.0006 + $0.0014 + $0.0382 + $0.0386 = **$0.0796** of the $1.00 cap.

## Style text B (synthetic, from `sent-holdout`)

> Zwraca się do odbiorców po imieniu w nieformalnej korespondencji, a wobec klientów i osób pełniących oficjalne funkcje używa form grzecznościowych. Zwykle zaczyna od powitania, często dopasowanego do liczby i statusu adresatów; w krótkich wiadomościach do współpracowników czasem pomija rozbudowany wstęp. Maile są przeważnie krótkie lub średniej długości, a dłuższe służą uporządkowanemu przedstawieniu kontekstu, danych i kolejnych kroków. Pisze rzeczowo, jasno i spokojnie, z uprzejmym, profesjonalnym tonem; okazjonalnie wyraża podziękowanie lub uznanie. Często precyzuje, czego oczekuje od odbiorcy i do kiedy, oraz wyjaśnia, dlaczego dana osoba jest w kopii lub czy wiadomość wymaga działania. Używa prostego języka biznesowego, krótkich akapitów i konkretnych informacji. Zwykle kończy konkretną informacją o dalszym kroku lub uprzejmą formułą, ale nie stosuje stałego rozbudowanego podpisu.

## Next step

The flag `style_from_sent` stays off (D17); the code stays. The failed bar: the futility stop of the dev smoke (B's mean `style_match` not above A's, and B wins no more pairs than it loses). The holdout is unused by this ticket, so a later gate run (after a drafter that shows style) can use it.
