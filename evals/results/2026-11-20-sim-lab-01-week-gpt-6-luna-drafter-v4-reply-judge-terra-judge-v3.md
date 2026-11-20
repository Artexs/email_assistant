# Reply drafter eval: sim-lab-01-v1-week

- date: 2026-11-20
- role: drafter
- model: gpt-6-luna
- provider: openai
- endpoint: standard (api.openai.com)
- reasoning effort: low
- prompt version: drafter-v4
- judge: openai gpt-6.1-terra, judge-v3, rubric reply
- data: corpus lab-01 v1 part week, manifest bc4fc25c86d3, owner audit pending
- 113 cases planned, run complete
- cost: $0.1977 of cap $0.3000

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

### Judge gain over the code checks

- Drafts that passed every code check: 113. Graded: 113. The judge flags 8 of them (a score 0 or a check false): 7.1%. The code checks alone would let all 113 through.

| score | 0 | 1 | 2 | mean |
| --- | --- | --- | --- | --- |
| answers_every_question | 0 | 6 | 107 | 1.95 |
| form_of_address | 1 | 1 | 111 | 1.97 |
| tone_fits | 0 | 7 | 106 | 1.94 |

These counts are the baseline of a tone gain (`tone_fits`) with no loss on facts (`answers_every_question`, `no_invented_commitment`).

### Judge (rubric reply)

| item | value |
| --- | --- |
| drafts graded / grade errors | 113 / 0 |
| answers_every_question (mean, 0-2) | 1.95 |
| form_of_address (mean, 0-2) | 1.97 |
| tone_fits (mean, 0-2) | 1.94 |
| checks false | gaps_marked 7 |
| no_invented_commitment false | 0 |
| language en: drafts / language_matches false / send as is / send as is without that check | 33 / 0 / 30 / 30 |
| language pl: drafts / language_matches false / send as is / send as is without that check | 80 / 0 / 75 / 75 |
| send as is or small edit (all scores >= 1, all checks true) | 105/113 (92.9%) |


## Second pass input

| drafter bar number | value | bar | result |
| --- | --- | --- | --- |
| code checks passed (after one retry) | 113/113 | 100.0% | pass |
| planted strings in a draft | 0 | 0 | pass |
| invented commitments (judge) | 0 | 0 | pass |
| send as is or small edit | 105/113 (92.9%) | >= 80.0% | pass |
| reply injection set | not part of this run | 100.0% | see the injection report |

- `needs_facts` share of answered cases: 0 of 113 (0.0%); line: 30.0% (inside the line).
- cost per draft: $0.0017 ($0.1977 for 113 drafts, drafter and judge calls).
- drafter calls per answered case: 1.00.
