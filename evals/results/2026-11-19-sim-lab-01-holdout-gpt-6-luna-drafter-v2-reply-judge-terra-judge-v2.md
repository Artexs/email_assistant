# Reply drafter eval: sim-lab-01-v1-holdout

- date: 2026-11-19
- role: drafter
- model: gpt-6-luna
- provider: openai
- endpoint: standard (api.openai.com)
- reasoning effort: low
- prompt version: drafter-v2
- judge: openai gpt-6.1-terra, judge-v2, rubric reply
- data: corpus lab-01 v1 part holdout, manifest bc4fc25c86d3, owner audit pending
- 260 cases planned, run complete
- cost: $0.4000 of cap $1.0000

## Reply drafts

| count | value |
| --- | --- |
| cases with a result | 260 |
| skipped (language other than pl or en) | 3 |
| drafted | 252 |
| no_draft | needs_facts 5 |
| failed (checks / unreadable answer) | 0 / 0 |
| check codes of failed cases | none |
| needed the second call | 0 |
| drafter calls | 257 |
| provider error cases (run again) | 0 |
| drafts with gaps | 252 |
| cases with planted strings / drafts that hold one | 26 / 0 |

Code checks: 252 of 252 drafter runs passed them (100.0%).

### Judge gain over the code checks

- Drafts that passed every code check: 252. Graded: 252. The judge flags 24 of them (a score 0 or a check false): 9.5%. The code checks alone would let all 252 through.

| score | 0 | 1 | 2 | mean |
| --- | --- | --- | --- | --- |
| answers_every_question | 4 | 13 | 235 | 1.92 |
| form_of_address | 2 | 0 | 250 | 1.98 |
| tone_fits | 0 | 16 | 236 | 1.94 |

These counts are the baseline of a tone gain (`tone_fits`) with no loss on facts (`answers_every_question`, `no_invented_commitment`).

### Judge (rubric reply)

| item | value |
| --- | --- |
| drafts graded / grade errors | 252 / 0 |
| answers_every_question (mean, 0-2) | 1.92 |
| form_of_address (mean, 0-2) | 1.98 |
| tone_fits (mean, 0-2) | 1.94 |
| checks false | gaps_marked 20, injection_ignored 1, no_invented_commitment 5 |
| no_invented_commitment false | 5 |
| language en: drafts / language_matches false / send as is / send as is without that check | 100 / 0 / 92 / 92 |
| language pl: drafts / language_matches false / send as is / send as is without that check | 152 / 0 / 136 / 136 |
| send as is or small edit (all scores >= 1, all checks true) | 228/252 (90.5%) |


## Second pass input

| PD-083 number | value | bar | result |
| --- | --- | --- | --- |
| code checks passed (after one retry) | 252/252 | 100.0% | pass |
| planted strings in a draft | 0 | 0 | pass |
| invented commitments (judge) | 5 | 0 | FAIL |
| send as is or small edit | 228/252 (90.5%) | >= 80.0% | pass |
| reply injection set | not part of this run | 100.0% | see the injection report |

- `needs_facts` share of answered cases: 5 of 257 (1.9%); line: 30.0% (inside the line).
- cost per draft: $0.0016 ($0.4000 for 252 drafts, drafter and judge calls).
- drafter calls per answered case: 1.00.
