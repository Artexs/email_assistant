# Reply drafter eval: sim-lab-01-v1-week

- date: 2026-11-20
- role: drafter
- model: gpt-6-luna
- provider: openai
- endpoint: standard (api.openai.com)
- reasoning effort: low
- prompt version: drafter-v5
- judge: openai gpt-6.1-terra, judge-v3, rubric reply
- style: scenario
- data: corpus lab-01 v1 part week, manifest bc4fc25c86d3, owner audit pending
- 113 cases planned, run complete
- cost: $0.2122 of cap $0.5681

## Reply drafts

| count | value |
| --- | --- |
| cases with a result | 113 |
| skipped (language other than pl or en) | 0 |
| drafted | 113 |
| no_draft | none |
| failed (checks / unreadable answer) | 0 / 0 |
| check codes of failed cases | none |
| needed the second call | 0 |
| drafter calls | 113 |
| provider error cases (run again) | 0 |
| drafts with gaps | 113 |
| cases with planted strings / drafts that hold one | 0 / 0 |

Code checks: 113 of 113 drafter runs passed them (100.0%).

## Sentences

- drafts with a full sentence: 0 of 113
- skeleton drafts: 0 of 113
- mean prose sentences: 0.00
- leaning sentences: 7
- leaning ids: w-1-112, w-2-024, w-2-097, w-3-041, w-4-038
- not measured: 0

### Judge gain over the code checks

- Drafts that passed every code check: 113. Graded: 113. The judge flags 9 of them (a score 0 or a check false): 8.0%. The code checks alone would let all 113 through.

| score | 0 | 1 | 2 | mean |
| --- | --- | --- | --- | --- |
| answers_every_question | 1 | 7 | 105 | 1.92 |
| form_of_address | 1 | 3 | 109 | 1.96 |
| tone_fits | 0 | 15 | 98 | 1.87 |

These counts are the baseline of a tone gain (`tone_fits`) with no loss on facts (`answers_every_question`, `no_invented_commitment`).

### Judge (rubric reply)

| item | value |
| --- | --- |
| drafts graded / grade errors | 113 / 0 |
| answers_every_question (mean, 0-2) | 1.92 |
| form_of_address (mean, 0-2) | 1.96 |
| tone_fits (mean, 0-2) | 1.87 |
| checks false | gaps_marked 8 |
| no_invented_commitment false | 0 |
| language en: drafts / language_matches false / send as is / send as is without that check | 33 / 0 / 30 / 30 |
| language pl: drafts / language_matches false / send as is / send as is without that check | 80 / 0 / 74 / 74 |
| send as is or small edit (all scores >= 1, all checks true) | 104/113 (92.0%) |


## Second pass input

| drafter bar number | value | bar | result |
| --- | --- | --- | --- |
| code checks passed (after one retry) | 113/113 | 100.0% | pass |
| planted strings in a draft | 0 | 0 | pass |
| invented commitments (judge) | 0 | 0 | pass |
| send as is or small edit | 104/113 (92.0%) | >= 80.0% | pass |
| reply injection set | not part of this run | 100.0% | see the injection report |

- `needs_facts` share of answered cases: 0 of 113 (0.0%); line: 30.0% (inside the line).
- cost per draft: $0.0019 ($0.2122 for 113 drafts, drafter and judge calls).
- drafter calls per answered case: 1.00.
