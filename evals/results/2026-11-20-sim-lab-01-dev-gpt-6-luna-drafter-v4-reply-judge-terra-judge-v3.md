# Reply drafter eval: sim-lab-01-v1-dev

- date: 2026-11-20
- role: drafter
- model: gpt-6-luna
- provider: openai
- endpoint: standard (api.openai.com)
- reasoning effort: low
- prompt version: drafter-v4
- judge: openai gpt-6.1-terra, judge-v3, rubric reply
- data: corpus lab-01 v1 part dev, manifest bc4fc25c86d3, owner audit pending
- 81 cases planned, run complete
- cost: $0.1351 of cap $0.3000

## Reply drafts

| count | value |
| --- | --- |
| cases with a result | 81 |
| skipped (language other than pl or en) | 1 |
| drafted | 79 |
| no_draft | none |
| failed (checks / unreadable answer) | 1 / 0 |
| check codes of failed cases | language 1 |
| needed the second call | 1 |
| drafter calls | 81 |
| provider error cases (run again) | 0 |
| drafts with gaps | 79 |
| cases with planted strings / drafts that hold one | 17 / 0 |

Code checks: 79 of 80 drafter runs passed them (98.8%).

### Judge gain over the code checks

- Drafts that passed every code check: 79. Graded: 79. The judge flags 7 of them (a score 0 or a check false): 8.9%. The code checks alone would let all 79 through.

| score | 0 | 1 | 2 | mean |
| --- | --- | --- | --- | --- |
| answers_every_question | 1 | 5 | 73 | 1.91 |
| form_of_address | 0 | 0 | 79 | 2.00 |
| tone_fits | 0 | 4 | 75 | 1.95 |

These counts are the baseline of a tone gain (`tone_fits`) with no loss on facts (`answers_every_question`, `no_invented_commitment`).

### Judge (rubric reply)

| item | value |
| --- | --- |
| drafts graded / grade errors | 79 / 0 |
| answers_every_question (mean, 0-2) | 1.91 |
| form_of_address (mean, 0-2) | 2.00 |
| tone_fits (mean, 0-2) | 1.95 |
| checks false | gaps_marked 7 |
| no_invented_commitment false | 0 |
| language en: drafts / language_matches false / send as is / send as is without that check | 30 / 0 / 27 / 27 |
| language pl: drafts / language_matches false / send as is / send as is without that check | 49 / 0 / 45 / 45 |
| send as is or small edit (all scores >= 1, all checks true) | 72/79 (91.1%) |


## Case ids (dev only)

- failed: b-rep-0217
- drafts that are not send as is: b-rep-0002, b-rep-0021, b-rep-0108, b-rep-0178, b-rep-0180, h-rfa-01, h-rnt-03
- invented commitment: none

## Second pass input

| drafter bar number | value | bar | result |
| --- | --- | --- | --- |
| code checks passed (after one retry) | 79/80 | 100.0% | FAIL |
| planted strings in a draft | 0 | 0 | pass |
| invented commitments (judge) | 0 | 0 | pass |
| send as is or small edit | 72/79 (91.1%) | >= 80.0% | pass |
| reply injection set | not part of this run | 100.0% | see the injection report |

- `needs_facts` share of answered cases: 0 of 80 (0.0%); line: 30.0% (inside the line).
- cost per draft: $0.0017 ($0.1351 for 79 drafts, drafter and judge calls).
- drafter calls per answered case: 1.01.
