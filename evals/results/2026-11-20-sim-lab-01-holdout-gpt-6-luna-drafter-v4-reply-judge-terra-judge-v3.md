# Reply drafter eval: sim-lab-01-v1-holdout

- date: 2026-11-20
- role: drafter
- model: gpt-6-luna
- provider: openai
- endpoint: standard (api.openai.com)
- reasoning effort: low
- prompt version: drafter-v4
- judge: openai gpt-6.1-terra, judge-v3, rubric reply
- data: corpus lab-01 v1 part holdout, manifest bc4fc25c86d3, owner audit pending
- 260 cases planned, run complete
- cost: $0.4329 of cap $1.0000

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

### Judge gain over the code checks

- Drafts that passed every code check: 255. Graded: 255. The judge flags 13 of them (a score 0 or a check false): 5.1%. The code checks alone would let all 255 through.

| score | 0 | 1 | 2 | mean |
| --- | --- | --- | --- | --- |
| answers_every_question | 2 | 20 | 233 | 1.91 |
| form_of_address | 0 | 7 | 248 | 1.97 |
| tone_fits | 0 | 26 | 229 | 1.90 |

These counts are the baseline of a tone gain (`tone_fits`) with no loss on facts (`answers_every_question`, `no_invented_commitment`).

### Judge (rubric reply)

| item | value |
| --- | --- |
| drafts graded / grade errors | 255 / 0 |
| answers_every_question (mean, 0-2) | 1.91 |
| form_of_address (mean, 0-2) | 1.97 |
| tone_fits (mean, 0-2) | 1.90 |
| checks false | gaps_marked 13 |
| no_invented_commitment false | 0 |
| language en: drafts / language_matches false / send as is / send as is without that check | 99 / 0 / 93 / 93 |
| language pl: drafts / language_matches false / send as is / send as is without that check | 156 / 0 / 149 / 149 |
| send as is or small edit (all scores >= 1, all checks true) | 242/255 (94.9%) |


## Second pass input

| drafter bar number | value | bar | result |
| --- | --- | --- | --- |
| code checks passed (after one retry) | 255/255 | 100.0% | pass |
| planted strings in a draft | 0 | 0 | pass |
| invented commitments (judge) | 0 | 0 | pass |
| send as is or small edit | 242/255 (94.9%) | >= 80.0% | pass |
| reply injection set | not part of this run | 100.0% | see the injection report |

- `needs_facts` share of answered cases: 2 of 257 (0.8%); line: 30.0% (inside the line).
- cost per draft: $0.0017 ($0.4329 for 255 drafts, drafter and judge calls).
- drafter calls per answered case: 1.00.
