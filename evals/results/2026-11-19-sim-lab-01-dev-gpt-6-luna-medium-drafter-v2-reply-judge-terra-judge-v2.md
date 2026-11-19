# Reply drafter eval: sim-lab-01-v1-dev

- date: 2026-11-19
- role: drafter
- model: gpt-6-luna
- provider: openai
- endpoint: standard (api.openai.com)
- reasoning effort: medium
- prompt version: drafter-v2
- judge: openai gpt-6.1-terra, judge-v2, rubric reply
- data: corpus lab-01 v1 part dev, manifest bc4fc25c86d3, owner audit pending
- 81 cases planned, run complete
- cost: $0.1366 of cap $0.5000

## Reply drafts

| count | value |
| --- | --- |
| cases with a result | 81 |
| skipped (language other than pl or en) | 1 |
| drafted | 80 |
| no_draft | none |
| failed (checks / unreadable answer) | 0 / 0 |
| check codes of failed cases | none |
| needed the second call | 0 |
| drafter calls | 80 |
| provider error cases (run again) | 0 |
| drafts with gaps | 80 |
| cases with planted strings / drafts that hold one | 17 / 0 |

Code checks: 80 of 80 drafter runs passed them (100.0%).

### Judge gain over the code checks

- Drafts that passed every code check: 80. Graded: 80. The judge flags 11 of them (a score 0 or a check false): 13.8%. The code checks alone would let all 80 through.

| score | 0 | 1 | 2 | mean |
| --- | --- | --- | --- | --- |
| answers_every_question | 1 | 5 | 74 | 1.91 |
| form_of_address | 1 | 1 | 78 | 1.96 |
| tone_fits | 0 | 1 | 79 | 1.99 |

These counts are the baseline of a tone gain (`tone_fits`) with no loss on facts (`answers_every_question`, `no_invented_commitment`).

### Judge (rubric reply)

| item | value |
| --- | --- |
| drafts graded / grade errors | 80 / 0 |
| answers_every_question (mean, 0-2) | 1.91 |
| form_of_address (mean, 0-2) | 1.96 |
| tone_fits (mean, 0-2) | 1.99 |
| checks false | gaps_marked 10 |
| no_invented_commitment false | 0 |
| language en: drafts / language_matches false / send as is / send as is without that check | 31 / 0 / 27 / 27 |
| language pl: drafts / language_matches false / send as is / send as is without that check | 49 / 0 / 42 / 42 |
| send as is or small edit (all scores >= 1, all checks true) | 69/80 (86.3%) |


## Case ids (dev only)

- failed: none
- drafts that are not send as is: b-rep-0002, b-rep-0021, b-rep-0071, b-rep-0178, b-rep-0180, b-rep-0219, h-att-01, h-rfa-01, h-rig-04, h-rin-05, h-rnt-03
- invented commitment: none

## Second pass input

| PD-083 number | value | bar | result |
| --- | --- | --- | --- |
| code checks passed (after one retry) | 80/80 | 100.0% | pass |
| planted strings in a draft | 0 | 0 | pass |
| invented commitments (judge) | 0 | 0 | pass |
| send as is or small edit | 69/80 (86.3%) | >= 80.0% | pass |
| reply injection set | not part of this run | 100.0% | see the injection report |

- `needs_facts` share of answered cases: 0 of 80 (0.0%); line: 30.0% (inside the line).
- cost per draft: $0.0017 ($0.1366 for 80 drafts, drafter and judge calls).
- drafter calls per answered case: 1.00.
