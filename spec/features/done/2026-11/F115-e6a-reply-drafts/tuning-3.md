# F115 · Drafter tuning 3 (gate G1 input, drafter-v4 runs)

Result: **stopped after run 1 (dev); no gate.** drafter-v4 failed the dev go-on bar of `tuning-2.md` § Runs to do, step 1: code checks 79 of 80 (bar 80 of 80). Invented commitments 0 of 79 (pass). Send as is 72 of 79, 91.1% (pass). Runs 2 to 5 (traps, week, holdout, injection) did not run, so the holdout is still at two uses and no gate file for drafter-v4 exists. Production `prompts.drafter` stays `drafter-v1` (step 6 needs gate `"passed": true` and injection 14 of 14).

## Run 1: dev (2026-11-20)

`bun run eval --sim lab-01 --part dev --drafter --judge --model gpt-6-luna --reasoning-effort low --drafter-prompt drafter-v4 --concurrency 2 --rpm 30 --judge-rpm 30 --budget-usd 0.3 --dump-drafts /tmp/f115v4/dumps/dev-v4.jsonl --out …`. No HTTP 429, no quota error.

| run | drafter | judge | drafts | code checks | invented commitments | send as is | cost | report |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dev (run 8) | drafter-v4 | judge-v3 | 79 (1 failed, 1 skipped `de`) | 79 of 80: **FAIL** (`b-rep-0217`, code `language`, both calls) | 0: pass | 72 of 79 (91.1%): pass | $0.1351 | `evals/results/2026-11-20-sim-lab-01-dev-gpt-6-luna-drafter-v4-reply-judge-terra-judge-v3.md` |
| dev (run 7, base) | drafter-v3 | judge-v3 | 80 | 80 of 80 | 0 | 72 of 80 (90.0%) | $0.1338 | `evals/results/2026-11-19-sim-lab-01-dev-gpt-6-luna-drafter-v3-reply-judge-terra-judge-v3.md` |

- Not send as is: `b-rep-0002` (answers 0 and gaps), `b-rep-0021`, `b-rep-0108`, `b-rep-0178`, `b-rep-0180`, `h-rfa-01`, `h-rnt-03` (all `gaps_marked` false). Four of them failed under drafter-v2 too (`tuning-1.md`).
- The closed list works on dev: of the 130 lines after the greeting in the 79 drafts, every line is one "Regarding <topic>: [[…]]." or "W sprawie <topic>: [[…]]." sentence. 0 free sentences (drafter-v3: 37 of 193 dev and week drafts had one). No thanks line, no extra text in a greeting.

## Cause of the code-check failure (verified on dev)

The closed list leaves almost no common English word outside a gap. The language check (`packages/core/src/replies/language.ts`, used by `checkReplyBody`) counts 30 common words per language. It removes the gaps first. With no hit, the text is `unknown`, and an `unknown` text of 80 characters or more fails `language`. A Polish draft always passes, because "W sprawie" holds "w". An English draft has only "Dear <name>, Regarding <topic>:" and no listed word unless the topic holds "the", "for" or "of".

Evidence:

- A scratch redraft of `b-rep-0217` (dev, drafter-v4, 11 calls, $0.0034 in the ledger as `drafter-redraft-scratch`): 6 of 11 drafts failed `language`. Every failed draft has the same shape, for example "Dear Karin Lindqvist,\nRegarding certificate responsibility: [[accept or decline]].\nRegarding shipment arrival: [[yes or no and date]]." Every passing draft has "the" or "for" in a topic ("Regarding the shipment arrival").
- On the 30 English dev drafts that passed: 1 has no listed word (it passed because it is under 80 characters) and 18 have exactly one. So most English drafts of drafter-v4 pass by one word. Each two-question English mail on the holdout is a coin flip for a code-check failure, and the gate bar is 100%.
- The retry does not help: the retry prompt names the code `language`, and the draft was already in English.

The draft is right; the check is wrong. This is a false positive of the check, made common by the shorter drafter-v4 shape. It is not a drafter-v4 commitment or tone fault.

## What the next run needs (best next idea)

1. Add the English-only words of the closed list to `ENGLISH_WORDS`: "dear", "regarding", "hi". None of them is a Polish word, so a hit stays one-sided. A draft "Dear X, Regarding …: [[…]]." then gives two English hits. Add a `checks.test.ts` case with the failed draft text above (it must pass as `en`), keep the test that both lists hold no shared word, and change its size check (`checks.test.ts` expects 30 English words). This changes the production check: an English draft can pass where it failed before; a Polish draft is not affected.
2. Then run `tuning-2.md` § Runs to do again from step 1 with drafter-v4 unchanged (the prompt is not at fault). Cost: about $0.81 for the five runs, more than the about $0.60 that the owner approved for this job; the spend is a coordinator or owner decision.
3. An alternative with no code change: a drafter-v5 that asks for "Regarding the <topic>". It is weaker (the model can drop the article) and it costs a dev rerun too. Not proposed.

Stage 18 (pilot) is not unblocked: G1 needs a passed holdout gate first.

## Spend of this job

$0.1385 (3 ledger lines: dev run $0.1351, scratch redrafts $0.0008 and $0.0026). The holdout, the injection set and the traps were not run. No holdout file was opened.
