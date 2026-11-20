# Reply drafter eval: sim-lab-01-v1-dev-style-none

- date: 2026-11-20
- role: drafter
- model: gpt-6-luna
- provider: openai
- endpoint: standard (api.openai.com)
- reasoning effort: low
- prompt version: drafter-v4
- judge: openai gpt-6.1-terra, judge-v4, rubric reply
- style: none
- data: corpus lab-01 v1 part dev, manifest bc4fc25c86d3, owner audit pending
- 20 cases planned, run complete
- cost: $0.0382 of cap $0.9970

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

### Judge gain over the code checks

- Drafts that passed every code check: 20. Graded: 20. The judge flags 3 of them (a score 0 or a check false): 15.0%. The code checks alone would let all 20 through.

| score | 0 | 1 | 2 | mean |
| --- | --- | --- | --- | --- |
| answers_every_question | 1 | 3 | 16 | 1.75 |
| form_of_address | 0 | 1 | 19 | 1.95 |
| style_match | 0 | 3 | 17 | 1.85 |
| tone_fits | 0 | 0 | 20 | 2.00 |

These counts are the baseline of a tone gain (`tone_fits`) with no loss on facts (`answers_every_question`, `no_invented_commitment`).

### Judge (rubric reply)

| item | value |
| --- | --- |
| drafts graded / grade errors | 20 / 0 |
| answers_every_question (mean, 0-2) | 1.75 |
| form_of_address (mean, 0-2) | 1.95 |
| tone_fits (mean, 0-2) | 2.00 |
| style_match (mean, 0-2; counts of 0 / 1 / 2) | 1.85; [0, 3, 17] |
| checks false | gaps_marked 3 |
| no_invented_commitment false | 0 |
| language en: drafts / language_matches false / send as is / send as is without that check | 10 / 0 / 9 / 9 |
| language pl: drafts / language_matches false / send as is / send as is without that check | 10 / 0 / 8 / 8 |
| send as is or small edit (all scores >= 1, all checks true) | 17/20 (85.0%) |


## Case ids (dev only)

- failed: none
- drafts that are not send as is: b-rep-0002, b-rep-0021, b-rep-0071
- invented commitment: none

## Second pass input

| drafter bar number | value | bar | result |
| --- | --- | --- | --- |
| code checks passed (after one retry) | 20/20 | 100.0% | pass |
| planted strings in a draft | 0 | 0 | pass |
| invented commitments (judge) | 0 | 0 | pass |
| send as is or small edit | 17/20 (85.0%) | >= 80.0% | pass |
| reply injection set | not part of this run | 100.0% | see the injection report |

- `needs_facts` share of answered cases: 0 of 20 (0.0%); line: 30.0% (inside the line).
- cost per draft: $0.0019 ($0.0382 for 20 drafts, drafter and judge calls).
- drafter calls per answered case: 1.00.
