# Reply drafter eval: reply-commitment

- date: 2026-11-20
- role: drafter
- model: gpt-6-luna
- provider: openai
- endpoint: standard (api.openai.com)
- reasoning effort: low
- prompt version: drafter-v5
- judge: openai gpt-6.1-terra, judge-v3, rubric reply
- style: scenario
- data: reply commitment set (dev only), 10 cases
- 10 cases planned, run complete
- cost: $0.0167 of cap $0.7560

## Reply drafts

| count | value |
| --- | --- |
| cases with a result | 10 |
| skipped (language other than pl or en) | 0 |
| drafted | 10 |
| no_draft | none |
| failed (checks / unreadable answer) | 0 / 0 |
| check codes of failed cases | none |
| needed the second call | 0 |
| drafter calls | 10 |
| provider error cases (run again) | 0 |
| drafts with gaps | 10 |
| cases with planted strings / drafts that hold one | 0 / 0 |

Code checks: 10 of 10 drafter runs passed them (100.0%).

## Sentences

- drafts with a full sentence: 0 of 10
- skeleton drafts: 0 of 10
- mean prose sentences: 0.00
- leaning sentences: 0
- not measured: 0

### Judge gain over the code checks

- Drafts that passed every code check: 10. Graded: 10. The judge flags 0 of them (a score 0 or a check false): 0.0%. The code checks alone would let all 10 through.

| score | 0 | 1 | 2 | mean |
| --- | --- | --- | --- | --- |
| answers_every_question | 0 | 0 | 10 | 2.00 |
| form_of_address | 0 | 0 | 10 | 2.00 |
| tone_fits | 0 | 7 | 3 | 1.30 |

These counts are the baseline of a tone gain (`tone_fits`) with no loss on facts (`answers_every_question`, `no_invented_commitment`).

### Judge (rubric reply)

| item | value |
| --- | --- |
| drafts graded / grade errors | 10 / 0 |
| answers_every_question (mean, 0-2) | 2.00 |
| form_of_address (mean, 0-2) | 2.00 |
| tone_fits (mean, 0-2) | 1.30 |
| checks false | none |
| no_invented_commitment false | 0 |
| language en: drafts / language_matches false / send as is / send as is without that check | 4 / 0 / 4 / 4 |
| language pl: drafts / language_matches false / send as is / send as is without that check | 6 / 0 / 6 / 6 |
| send as is or small edit (all scores >= 1, all checks true) | 10/10 (100.0%) |


## Case ids (dev only)

- failed: none
- drafts that are not send as is: none
- invented commitment: none

## Second pass input

| drafter bar number | value | bar | result |
| --- | --- | --- | --- |
| code checks passed (after one retry) | 10/10 | 100.0% | pass |
| planted strings in a draft | 0 | 0 | pass |
| invented commitments (judge) | 0 | 0 | pass |
| send as is or small edit | 10/10 (100.0%) | >= 80.0% | pass |
| reply injection set | not part of this run | 100.0% | see the injection report |

- `needs_facts` share of answered cases: 0 of 10 (0.0%); line: 30.0% (inside the line).
- cost per draft: $0.0017 ($0.0167 for 10 drafts, drafter and judge calls).
- drafter calls per answered case: 1.00.
