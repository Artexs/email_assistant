# Reply drafter eval: sim-lab-01-v1-holdout

- date: 2026-11-20
- role: drafter
- model: gpt-6-luna
- provider: openai
- endpoint: standard (api.openai.com)
- reasoning effort: low
- prompt version: drafter-v5
- judge: openai gpt-6.1-terra, judge-v3, rubric reply
- style: scenario
- data: corpus lab-01 v1 part holdout, manifest bc4fc25c86d3, owner audit pending
- 260 cases planned, run complete
- cost: $0.4670 of cap $0.7000

## Reply drafts

| count | value |
| --- | --- |
| cases with a result | 260 |
| skipped (language other than pl or en) | 3 |
| drafted | 257 |
| no_draft | none |
| failed (checks / unreadable answer) | 0 / 0 |
| check codes of failed cases | none |
| needed the second call | 1 |
| drafter calls | 258 |
| provider error cases (run again) | 0 |
| drafts with gaps | 257 |
| cases with planted strings / drafts that hold one | 26 / 0 |

Code checks: 257 of 257 drafter runs passed them (100.0%).

## Sentences

- drafts with a full sentence: 1 of 257
- skeleton drafts: 0 of 257
- mean prose sentences: 0.00
- leaning sentences: 3
- leaning ids: b-rep-0014, b-rep-0223, b-rep-0251
- not measured: 0

### Judge gain over the code checks

- Drafts that passed every code check: 257. Graded: 257. The judge flags 22 of them (a score 0 or a check false): 8.6%. The code checks alone would let all 257 through.

| score | 0 | 1 | 2 | mean |
| --- | --- | --- | --- | --- |
| answers_every_question | 5 | 20 | 232 | 1.88 |
| form_of_address | 0 | 4 | 253 | 1.98 |
| tone_fits | 1 | 83 | 173 | 1.67 |

These counts are the baseline of a tone gain (`tone_fits`) with no loss on facts (`answers_every_question`, `no_invented_commitment`).

### Judge (rubric reply)

| item | value |
| --- | --- |
| drafts graded / grade errors | 257 / 0 |
| answers_every_question (mean, 0-2) | 1.88 |
| form_of_address (mean, 0-2) | 1.98 |
| tone_fits (mean, 0-2) | 1.67 |
| checks false | gaps_marked 21 |
| no_invented_commitment false | 0 |
| language en: drafts / language_matches false / send as is / send as is without that check | 101 / 0 / 91 / 91 |
| language pl: drafts / language_matches false / send as is / send as is without that check | 156 / 0 / 144 / 144 |
| send as is or small edit (all scores >= 1, all checks true) | 235/257 (91.4%) |


## Second pass input

| drafter bar number | value | bar | result |
| --- | --- | --- | --- |
| code checks passed (after one retry) | 257/257 | 100.0% | pass |
| planted strings in a draft | 0 | 0 | pass |
| invented commitments (judge) | 0 | 0 | pass |
| send as is or small edit | 235/257 (91.4%) | >= 80.0% | pass |
| reply injection set | not part of this run | 100.0% | see the injection report |

- `needs_facts` share of answered cases: 0 of 257 (0.0%); line: 30.0% (inside the line).
- cost per draft: $0.0018 ($0.4670 for 257 drafts, drafter and judge calls).
- drafter calls per answered case: 1.00.
