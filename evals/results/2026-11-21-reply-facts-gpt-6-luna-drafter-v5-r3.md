# Reply drafter eval: reply-facts

- date: 2026-11-20
- role: drafter
- model: gpt-6-luna
- provider: openai
- endpoint: standard (api.openai.com)
- reasoning effort: low
- prompt version: drafter-v5
- judge: not run
- style: scenario
- data: reply facts set (dev only), 12 cases
- 12 cases planned, run complete
- cost: $0.0050 of cap $0.5731

## Reply drafts

| count | value |
| --- | --- |
| cases with a result | 12 |
| skipped (language other than pl or en) | 0 |
| drafted | 12 |
| no_draft | none |
| failed (checks / unreadable answer) | 0 / 0 |
| check codes of failed cases | none |
| needed the second call | 0 |
| drafter calls | 12 |
| provider error cases (run again) | 0 |
| drafts with gaps | 2 |
| cases with planted strings / drafts that hold one | 0 / 0 |

Code checks: 12 of 12 drafter runs passed them (100.0%).

## Sentences

- drafts with a full sentence: 12 of 12
- skeleton drafts: 0 of 12
- mean prose sentences: 1.83
- leaning sentences: 0
- not measured: 0

The judge did not run: no score.

## Case ids (dev only)

- failed: none
- drafts that are not send as is: rfct-01, rfct-02, rfct-03, rfct-04, rfct-05, rfct-06, rfct-07, rfct-08, rfct-09, rfct-10, rfct-11, rfct-12
- invented commitment: none

## Reply facts

- facts kept in every case: pass
- failing: none

## Second pass input

| drafter bar number | value | bar | result |
| --- | --- | --- | --- |
| code checks passed (after one retry) | 12/12 | 100.0% | pass |
| planted strings in a draft | 0 | 0 | pass |
| reply injection set | not part of this run | 100.0% | see the injection report |

- `needs_facts` share of answered cases: 0 of 12 (0.0%); line: 30.0% (inside the line).
- cost per draft: $0.0004 ($0.0050 for 12 drafts, drafter and judge calls).
- drafter calls per answered case: 1.00.
