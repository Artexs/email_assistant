# Reply drafter eval: sim-lab-01-v1-holdout

- date: 2026-11-19
- role: drafter
- model: gpt-6-luna
- provider: openai
- endpoint: standard (api.openai.com)
- reasoning effort: low
- prompt version: drafter-v3
- judge: openai gpt-6.1-terra, judge-v3, rubric reply
- data: corpus lab-01 v1 part holdout, manifest bc4fc25c86d3, owner audit pending
- 260 cases planned, run complete
- cost: $0.4287 of cap $1.0000

## Reply drafts

| count | value |
| --- | --- |
| cases with a result | 260 |
| skipped (language other than pl or en) | 3 |
| drafted | 256 |
| no_draft | needs_facts 1 |
| failed (checks / unreadable answer) | 0 / 0 |
| check codes of failed cases | none |
| needed the second call | 1 |
| drafter calls | 258 |
| provider error cases (run again) | 0 |
| drafts with gaps | 255 |
| cases with planted strings / drafts that hold one | 26 / 0 |

Code checks: 256 of 256 drafter runs passed them (100.0%).

### Judge gain over the code checks

- Drafts that passed every code check: 256. Graded: 256. The judge flags 20 of them (a score 0 or a check false): 7.8%. The code checks alone would let all 256 through.

| score | 0 | 1 | 2 | mean |
| --- | --- | --- | --- | --- |
| answers_every_question | 3 | 19 | 234 | 1.90 |
| form_of_address | 1 | 3 | 252 | 1.98 |
| tone_fits | 0 | 33 | 223 | 1.87 |

These counts are the baseline of a tone gain (`tone_fits`) with no loss on facts (`answers_every_question`, `no_invented_commitment`).

### Judge (rubric reply)

| item | value |
| --- | --- |
| drafts graded / grade errors | 256 / 0 |
| answers_every_question (mean, 0-2) | 1.90 |
| form_of_address (mean, 0-2) | 1.98 |
| tone_fits (mean, 0-2) | 1.87 |
| checks false | gaps_marked 18, injection_ignored 1, no_invented_commitment 1 |
| no_invented_commitment false | 1 |
| language en: drafts / language_matches false / send as is / send as is without that check | 101 / 0 / 95 / 95 |
| language pl: drafts / language_matches false / send as is / send as is without that check | 155 / 0 / 141 / 141 |
| send as is or small edit (all scores >= 1, all checks true) | 236/256 (92.2%) |


## Second pass input

| PD-083 number | value | bar | result |
| --- | --- | --- | --- |
| code checks passed (after one retry) | 256/256 | 100.0% | pass |
| planted strings in a draft | 0 | 0 | pass |
| invented commitments (judge) | 1 | 0 | FAIL |
| send as is or small edit | 236/256 (92.2%) | >= 80.0% | pass |
| reply injection set | not part of this run | 100.0% | see the injection report |

- `needs_facts` share of answered cases: 1 of 257 (0.4%); line: 30.0% (inside the line).
- cost per draft: $0.0017 ($0.4287 for 256 drafts, drafter and judge calls).
- drafter calls per answered case: 1.00.
