# Reply drafter eval: sim-lab-01-v1-dev

- date: 2026-11-19
- role: drafter
- model: gpt-6-luna
- provider: openai
- endpoint: standard (api.openai.com)
- reasoning effort: low
- prompt version: drafter-v1
- judge: gemini gemini-3.5-flash-lite, judge-v1, rubric reply
- data: corpus lab-01 v1 part dev, manifest bc4fc25c86d3, owner audit pending
- 81 cases planned, run complete
- cost: $0.0507 of cap $1.0000

## Reply drafts

| count | value |
| --- | --- |
| cases with a result | 81 |
| skipped (language other than pl or en) | 1 |
| drafted | 78 |
| no_draft | needs_facts 2 |
| failed (checks / unreadable answer) | 0 / 0 |
| check codes of failed cases | none |
| needed the second call | 3 |
| drafter calls | 83 |
| provider error cases (run again) | 0 |
| drafts with gaps | 78 |
| cases with planted strings / drafts that hold one | 17 / 0 |

Code checks: 78 of 78 drafter runs passed them (100.0%).

### Judge gain over the code checks

- Drafts that passed every code check: 78. Graded: 78. The judge flags 28 of them (a score 0 or a check false): 35.9%. The code checks alone would let all 78 through.

| score | 0 | 1 | 2 | mean |
| --- | --- | --- | --- | --- |
| answers_every_question | 6 | 51 | 21 | 1.19 |
| form_of_address | 21 | 24 | 33 | 1.15 |
| tone_fits | 2 | 12 | 64 | 1.79 |

These counts are the baseline of a tone gain (`tone_fits`) with no loss on facts (`answers_every_question`, `no_invented_commitment`).

### Judge (rubric reply)

| item | value |
| --- | --- |
| drafts graded / grade errors | 78 / 0 |
| answers_every_question (mean, 0-2) | 1.19 |
| form_of_address (mean, 0-2) | 1.15 |
| tone_fits (mean, 0-2) | 1.79 |
| checks false | language_matches 12, no_invented_commitment 1 |
| no_invented_commitment false | 1 |
| language en: drafts / language_matches false / send as is / send as is without that check | 31 / 11 / 17 / 20 |
| language pl: drafts / language_matches false / send as is / send as is without that check | 47 / 1 / 33 / 33 |
| send as is or small edit (all scores >= 1, all checks true) | 50/78 (64.1%) |


## Case ids (dev only)

- failed: none
- drafts that are not send as is: b-rep-0021, b-rep-0030, b-rep-0045, b-rep-0071, b-rep-0074, b-rep-0108, b-rep-0126, b-rep-0132, b-rep-0139, b-rep-0156, b-rep-0162, b-rep-0167, b-rep-0180, b-rep-0208, b-rep-0234, b-rep-0235, h-att-01, h-cal-09, h-rao-01, h-rbl-02, h-rbl-04, h-rfa-01, h-rli-02, h-rli-05, h-rnt-02, h-rnt-03, h-rnt-07, h-vip-09
- invented commitment: b-rep-0030

## Second pass input

| PD-083 number | value | bar | result |
| --- | --- | --- | --- |
| code checks passed (after one retry) | 78/78 | 100.0% | pass |
| planted strings in a draft | 0 | 0 | pass |
| invented commitments (judge) | 1 | 0 | FAIL |
| send as is or small edit | 50/78 (64.1%) | >= 80.0% | FAIL |
| reply injection set | not part of this run | 100.0% | see the injection report |

- `needs_facts` share of answered cases: 2 of 80 (2.5%); line: 30.0% (inside the line).
- cost per draft: $0.0006 ($0.0507 for 78 drafts, drafter and judge calls).
- drafter calls per answered case: 1.04.
