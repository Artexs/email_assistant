# Reply drafter eval: sim-lab-01-v1-holdout

- date: 2026-11-26
- role: drafter
- model: deepseek-flash
- provider: deepseek
- endpoint: standard (api.deepseek.com)
- reasoning effort: low
- prompt version: drafter-v4
- judge: deepseek deepseek-v4-pro, judge-v3, rubric reply
- style: scenario
- data: corpus lab-01 v1 part holdout, manifest bc4fc25c86d3, owner audit pending
- 260 cases planned, run complete
- cost: $0.8075 of cap $2.0000

## Reply drafts

| count | value |
| --- | --- |
| cases with a result | 260 |
| skipped (language other than pl or en) | 3 |
| drafted | 255 |
| no_draft | needs_facts 2 |
| failed (checks / unreadable answer) | 0 / 0 |
| check codes of failed cases | none |
| needed the second call | 0 |
| drafter calls | 257 |
| provider error cases (run again) | 0 |
| drafts with gaps | 255 |
| cases with planted strings / drafts that hold one | 26 / 0 |

Code checks: 255 of 255 drafter runs passed them (100.0%).

## Sentences

- drafts with a full sentence: 3 of 255
- skeleton drafts: 243 of 255
- mean prose sentences: 0.01
- leaning sentences: 10
- leaning ids: b-rep-0017, b-rep-0072, b-rep-0086, b-rep-0153, b-rep-0157, b-rep-0223, b-rep-0251, b-rep-0257, b-rep-0262
- not measured: 0

### Judge gain over the code checks

- Drafts that passed every code check: 255. Graded: 255. The judge flags 65 of them (a score 0 or a check false): 25.5%. The code checks alone would let all 255 through.

| score | 0 | 1 | 2 | mean |
| --- | --- | --- | --- | --- |
| answers_every_question | 20 | 116 | 119 | 1.39 |
| form_of_address | 51 | 86 | 118 | 1.26 |
| tone_fits | 2 | 104 | 149 | 1.58 |

These counts are the baseline of a tone gain (`tone_fits`) with no loss on facts (`answers_every_question`, `no_invented_commitment`).

### Judge (rubric reply)

| item | value |
| --- | --- |
| drafts graded / grade errors | 255 / 0 |
| answers_every_question (mean, 0-2) | 1.39 |
| form_of_address (mean, 0-2) | 1.26 |
| tone_fits (mean, 0-2) | 1.58 |
| checks false | none |
| no_invented_commitment false | 0 |
| language en: drafts / language_matches false / send as is / send as is without that check | 100 / 0 / 87 / 87 |
| language pl: drafts / language_matches false / send as is / send as is without that check | 155 / 0 / 103 / 103 |
| send as is or small edit (all scores >= 1, all checks true) | 190/255 (74.5%) |


## Second pass input

| drafter bar number | value | bar | result |
| --- | --- | --- | --- |
| code checks passed (after one retry) | 255/255 | 100.0% | pass |
| planted strings in a draft | 0 | 0 | pass |
| invented commitments (judge) | 0 | 0 | pass |
| send as is or small edit | 190/255 (74.5%) | >= 80.0% | FAIL |
| reply injection set | not part of this run | 100.0% | see the injection report |

- `needs_facts` share of answered cases: 2 of 257 (0.8%); line: 30.0% (inside the line).
- cost per draft: $0.0032 ($0.8075 for 255 drafts, drafter and judge calls).
- drafter calls per answered case: 1.00.

