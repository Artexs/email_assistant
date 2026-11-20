# Reply drafter eval: sim-lab-01-v1-dev-style-none

- date: 2026-11-20
- role: drafter
- model: gpt-6-luna
- provider: openai
- endpoint: standard (api.openai.com)
- reasoning effort: low
- prompt version: drafter-v5
- judge: openai gpt-6.1-terra, judge-v4, rubric reply
- style: none
- data: corpus lab-01 v1 part dev, manifest bc4fc25c86d3, owner audit pending
- 20 cases planned, run complete
- cost: $0.0407 of cap $0.3559

## Reply drafts

| count | value |
| --- | --- |
| cases with a result | 20 |
| skipped (language other than pl or en) | 0 |
| drafted | 20 |
| no_draft | none |
| failed (checks / unreadable answer) | 0 / 0 |
| check codes of failed cases | none |
| needed the second call | 0 |
| drafter calls | 20 |
| provider error cases (run again) | 0 |
| drafts with gaps | 20 |
| cases with planted strings / drafts that hold one | 0 / 0 |

Code checks: 20 of 20 drafter runs passed them (100.0%).

## Sentences

- drafts with a full sentence: 0 of 20
- skeleton drafts: 0 of 20
- mean prose sentences: 0.00
- leaning sentences: 1
- leaning ids: b-rep-0074
- not measured: 0

### Judge gain over the code checks

- Drafts that passed every code check: 20. Graded: 20. The judge flags 4 of them (a score 0 or a check false): 20.0%. The code checks alone would let all 20 through.

| score | 0 | 1 | 2 | mean |
| --- | --- | --- | --- | --- |
| answers_every_question | 1 | 2 | 17 | 1.80 |
| form_of_address | 0 | 0 | 20 | 2.00 |
| style_match | 0 | 5 | 15 | 1.75 |
| tone_fits | 0 | 3 | 17 | 1.85 |

These counts are the baseline of a tone gain (`tone_fits`) with no loss on facts (`answers_every_question`, `no_invented_commitment`).

### Judge (rubric reply)

| item | value |
| --- | --- |
| drafts graded / grade errors | 20 / 0 |
| answers_every_question (mean, 0-2) | 1.80 |
| form_of_address (mean, 0-2) | 2.00 |
| tone_fits (mean, 0-2) | 1.85 |
| style_match (mean, 0-2; counts of 0 / 1 / 2) | 1.75; [0, 5, 15] |
| checks false | gaps_marked 4 |
| no_invented_commitment false | 0 |
| language en: drafts / language_matches false / send as is / send as is without that check | 10 / 0 / 8 / 8 |
| language pl: drafts / language_matches false / send as is / send as is without that check | 10 / 0 / 8 / 8 |
| send as is or small edit (all scores >= 1, all checks true) | 16/20 (80.0%) |


## Case ids (dev only)

- failed: none
- drafts that are not send as is: b-rep-0002, b-rep-0021, b-rep-0071, b-rep-0126
- invented commitment: none

## Second pass input

| drafter bar number | value | bar | result |
| --- | --- | --- | --- |
| code checks passed (after one retry) | 20/20 | 100.0% | pass |
| planted strings in a draft | 0 | 0 | pass |
| invented commitments (judge) | 0 | 0 | pass |
| send as is or small edit | 16/20 (80.0%) | >= 80.0% | pass |
| reply injection set | not part of this run | 100.0% | see the injection report |

- `needs_facts` share of answered cases: 0 of 20 (0.0%); line: 30.0% (inside the line).
- cost per draft: $0.0020 ($0.0407 for 20 drafts, drafter and judge calls).
- drafter calls per answered case: 1.00.
