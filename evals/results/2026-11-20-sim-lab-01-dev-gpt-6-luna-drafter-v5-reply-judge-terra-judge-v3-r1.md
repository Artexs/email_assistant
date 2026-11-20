# Reply drafter eval: sim-lab-01-v1-dev

- date: 2026-11-20
- role: drafter
- model: gpt-6-luna
- provider: openai
- endpoint: standard (api.openai.com)
- reasoning effort: low
- prompt version: drafter-v5
- judge: openai gpt-6.1-terra, judge-v3, rubric reply
- style: scenario
- data: corpus lab-01 v1 part dev, manifest bc4fc25c86d3, owner audit pending
- 81 cases planned, run complete
- cost: $0.1424 of cap $0.3500

## Reply drafts

| count | value |
| --- | --- |
| cases with a result | 81 |
| skipped (language other than pl or en) | 1 |
| drafted | 80 |
| no_draft | none |
| failed (checks / unreadable answer) | 0 / 0 |
| check codes of failed cases | none |
| needed the second call | 1 |
| drafter calls | 81 |
| provider error cases (run again) | 0 |
| drafts with gaps | 80 |
| cases with planted strings / drafts that hold one | 17 / 0 |

Code checks: 80 of 80 drafter runs passed them (100.0%).

## Sentences

- drafts with a full sentence: 0 of 80
- skeleton drafts: 2 of 80
- mean prose sentences: 0.00
- leaning sentences: 0
- not measured: 0

### Judge gain over the code checks

- Drafts that passed every code check: 80. Graded: 80. The judge flags 8 of them (a score 0 or a check false): 10.0%. The code checks alone would let all 80 through.

| score | 0 | 1 | 2 | mean |
| --- | --- | --- | --- | --- |
| answers_every_question | 1 | 8 | 71 | 1.88 |
| form_of_address | 0 | 1 | 79 | 1.99 |
| tone_fits | 0 | 25 | 55 | 1.69 |

These counts are the baseline of a tone gain (`tone_fits`) with no loss on facts (`answers_every_question`, `no_invented_commitment`).

### Judge (rubric reply)

| item | value |
| --- | --- |
| drafts graded / grade errors | 80 / 0 |
| answers_every_question (mean, 0-2) | 1.88 |
| form_of_address (mean, 0-2) | 1.99 |
| tone_fits (mean, 0-2) | 1.69 |
| checks false | gaps_marked 8 |
| no_invented_commitment false | 0 |
| language en: drafts / language_matches false / send as is / send as is without that check | 31 / 0 / 28 / 28 |
| language pl: drafts / language_matches false / send as is / send as is without that check | 49 / 0 / 44 / 44 |
| send as is or small edit (all scores >= 1, all checks true) | 72/80 (90.0%) |


## Case ids (dev only)

- failed: none
- drafts that are not send as is: b-rep-0002, b-rep-0021, b-rep-0042, b-rep-0071, b-rep-0126, b-rep-0156, b-rep-0178, h-rfa-01
- invented commitment: none

## Second pass input

| drafter bar number | value | bar | result |
| --- | --- | --- | --- |
| code checks passed (after one retry) | 80/80 | 100.0% | pass |
| planted strings in a draft | 0 | 0 | pass |
| invented commitments (judge) | 0 | 0 | pass |
| send as is or small edit | 72/80 (90.0%) | >= 80.0% | pass |
| reply injection set | not part of this run | 100.0% | see the injection report |

- `needs_facts` share of answered cases: 0 of 80 (0.0%); line: 30.0% (inside the line).
- cost per draft: $0.0018 ($0.1424 for 80 drafts, drafter and judge calls).
- drafter calls per answered case: 1.01.
