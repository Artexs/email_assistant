# Reply drafter eval: sim-lab-01-v1-holdout

- date: 2026-11-19
- role: drafter
- model: gpt-6-luna
- provider: openai
- endpoint: standard (api.openai.com)
- reasoning effort: low
- prompt version: drafter-v1
- judge: openai gpt-6.1-terra, judge-v1, rubric reply
- data: corpus lab-01 v1 part holdout, manifest bc4fc25c86d3, owner audit pending
- 260 cases planned, run complete
- cost: $0.3356 of cap $2.0000

## Reply drafts

| count | value |
| --- | --- |
| cases with a result | 260 |
| skipped (language other than pl or en) | 3 |
| drafted | 246 |
| no_draft | needs_facts 11 |
| failed (checks / unreadable answer) | 0 / 0 |
| check codes of failed cases | none |
| needed the second call | 8 |
| drafter calls | 265 |
| provider error cases (run again) | 0 |
| drafts with gaps | 238 |
| cases with planted strings / drafts that hold one | 26 / 0 |

Code checks: 246 of 246 drafter runs passed them (100.0%).

### Judge gain over the code checks

- Drafts that passed every code check: 246. Graded: 246. The judge flags 140 of them (a score 0 or a check false): 56.9%. The code checks alone would let all 246 through.

| score | 0 | 1 | 2 | mean |
| --- | --- | --- | --- | --- |
| answers_every_question | 119 | 116 | 11 | 0.56 |
| form_of_address | 27 | 41 | 178 | 1.61 |
| tone_fits | 2 | 101 | 143 | 1.57 |

These counts are the baseline of a tone gain (`tone_fits`) with no loss on facts (`answers_every_question`, `no_invented_commitment`).

### Judge (rubric reply)

| item | value |
| --- | --- |
| drafts graded / grade errors | 246 / 0 |
| answers_every_question (mean, 0-2) | 0.56 |
| form_of_address (mean, 0-2) | 1.61 |
| tone_fits (mean, 0-2) | 1.57 |
| checks false | gaps_marked 12, no_invented_commitment 22 |
| no_invented_commitment false | 22 |
| language en: drafts / language_matches false / send as is / send as is without that check | 97 / 0 / 38 / 38 |
| language pl: drafts / language_matches false / send as is / send as is without that check | 149 / 0 / 68 / 68 |
| send as is or small edit (all scores >= 1, all checks true) | 106/246 (43.1%) |


## Second pass input

| PD-083 number | value | bar | result |
| --- | --- | --- | --- |
| code checks passed (after one retry) | 246/246 | 100.0% | pass |
| planted strings in a draft | 0 | 0 | pass |
| invented commitments (judge) | 22 | 0 | FAIL |
| send as is or small edit | 106/246 (43.1%) | >= 80.0% | FAIL |
| reply injection set | not part of this run | 100.0% | see the injection report |

- `needs_facts` share of answered cases: 11 of 257 (4.3%); line: 30.0% (inside the line).
- cost per draft: $0.0014 ($0.3356 for 246 drafts, drafter and judge calls).
- drafter calls per answered case: 1.03.
