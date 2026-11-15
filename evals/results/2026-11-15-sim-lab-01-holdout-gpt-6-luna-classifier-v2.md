# Eval report: sim lab-01 holdout

- date: 2026-11-14
- role: classifier
- model: gpt-6-luna
- provider: openai
- reasoning effort: none
- prompt version: classifier-v2
- cases: 1382 synthetic, 31 injection
- 1413 of 1413 cases done
- bar: 98.0%
- minimum support: 30 kept rows per category
- no generation settings: results can change between runs
- corpus: lab-01 v1 (holdout), manifest bc4fc25c86d3, owner audit: pending
- cost: $0.2704 of cap $1.00

## Go/no-go

| category | threshold | precision | recall | kept | decision |
| --- | --- | --- | --- | --- | --- |
| urgent | n/a | 96.4% | 85.9% | 196 | no-go |
| needs_reply | n/a | 89.7% | 93.8% | 272 | no-go |
| info | 0.50 | 99.0% | 81.9% | 201 | go |
| notification | 0.50 | 99.6% | 98.7% | 232 | go |
| spam | n/a | 84.4% | 99.6% | 276 | no-go |

Minimum support: 30 kept rows per category (user 2026-11-04).

## Metrics per category

| category | precision | recall | support |
| --- | --- | --- | --- |
| urgent | 96.4% | 85.9% | 220 |
| needs_reply | 89.7% | 93.8% | 260 |
| delegation | 94.1% | 100.0% | 222 |
| info | 99.0% | 81.9% | 243 |
| notification | 99.6% | 98.7% | 234 |
| spam | 85.0% | 99.6% | 234 |
| unsure | n/a | n/a | 0 |

## Confusion matrix (rows: expected, columns: predicted)

| expected | urgent | needs_reply | delegation | info | notification | spam | unsure |
| --- | --- | --- | --- | --- | --- | --- | --- |
| urgent | 189 | 26 | 4 | 1 | 0 | 0 | 0 |
| needs_reply | 7 | 244 | 7 | 1 | 0 | 1 | 0 |
| delegation | 0 | 0 | 222 | 0 | 0 | 0 | 0 |
| info | 0 | 2 | 2 | 199 | 1 | 38 | 1 |
| notification | 0 | 0 | 0 | 0 | 231 | 2 | 1 |
| spam | 0 | 0 | 1 | 0 | 0 | 233 | 0 |
| unsure | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

## Threshold sweep

### urgent

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 96.4% | 85.9% | 196 |
| 0.55 | 96.4% | 85.9% | 196 |
| 0.60 | 96.4% | 85.9% | 196 |
| 0.65 | 96.4% | 85.9% | 196 |
| 0.70 | 96.4% | 85.9% | 196 |
| 0.75 | 96.4% | 85.9% | 196 |
| 0.80 | 96.4% | 85.9% | 196 |
| 0.85 | 96.4% | 85.9% | 196 |
| 0.90 | 96.4% | 85.5% | 195 |
| 0.95 | 96.1% | 79.1% | 181 |

### needs_reply

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 89.7% | 93.8% | 272 |
| 0.55 | 89.7% | 93.8% | 272 |
| 0.60 | 89.7% | 93.8% | 272 |
| 0.65 | 89.7% | 93.8% | 272 |
| 0.70 | 89.7% | 93.8% | 272 |
| 0.75 | 89.7% | 93.8% | 272 |
| 0.80 | 89.7% | 93.8% | 272 |
| 0.85 | 90.0% | 93.8% | 271 |
| 0.90 | 90.3% | 93.1% | 268 |
| 0.95 | 90.6% | 88.5% | 254 |

### info

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 99.0% | 81.9% | 201 |
| 0.55 | 99.0% | 81.9% | 201 |
| 0.60 | 99.0% | 81.9% | 201 |
| 0.65 | 99.0% | 81.9% | 201 |
| 0.70 | 99.0% | 81.9% | 201 |
| 0.75 | 99.0% | 81.9% | 201 |
| 0.80 | 99.0% | 81.9% | 201 |
| 0.85 | 99.5% | 81.5% | 199 |
| 0.90 | 99.5% | 80.7% | 197 |
| 0.95 | 100.0% | 77.8% | 189 |

### notification

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 99.6% | 98.7% | 232 |
| 0.55 | 99.6% | 98.7% | 232 |
| 0.60 | 99.6% | 98.7% | 232 |
| 0.65 | 99.6% | 98.7% | 232 |
| 0.70 | 99.6% | 98.7% | 232 |
| 0.75 | 99.6% | 98.7% | 232 |
| 0.80 | 99.6% | 98.7% | 232 |
| 0.85 | 99.6% | 98.7% | 232 |
| 0.90 | 99.6% | 98.7% | 232 |
| 0.95 | 99.6% | 97.9% | 230 |

### spam

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 84.4% | 99.6% | 276 |
| 0.55 | 84.4% | 99.6% | 276 |
| 0.60 | 84.7% | 99.6% | 275 |
| 0.65 | 84.7% | 99.6% | 275 |
| 0.70 | 85.0% | 99.6% | 274 |
| 0.75 | 85.0% | 99.6% | 274 |
| 0.80 | 86.0% | 99.6% | 271 |
| 0.85 | 87.5% | 99.1% | 265 |
| 0.90 | 89.9% | 98.7% | 257 |
| 0.95 | 95.6% | 93.2% | 228 |

## Confidence histogram

### urgent

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 1 | 1 |
| 0.90–0.94 | 14 | 14 |
| 0.95–1.00 | 181 | 174 |

### needs_reply

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 4 | 2 |
| 0.90–0.94 | 14 | 12 |
| 0.95–1.00 | 254 | 230 |

### info

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 4 | 3 |
| 0.90–0.94 | 8 | 7 |
| 0.95–1.00 | 189 | 189 |

### notification

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 0 | 0 |
| 0.90–0.94 | 2 | 2 |
| 0.95–1.00 | 230 | 229 |

### spam

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 1 | 0 |
| 0.60–0.69 | 1 | 0 |
| 0.70–0.79 | 3 | 0 |
| 0.80–0.89 | 14 | 2 |
| 0.90–0.94 | 29 | 13 |
| 0.95–1.00 | 228 | 218 |

Rule results (blocklist, no LLM call): 0, right 0, wrong 0; not in the LLM metrics.

Errors: 0

## Whitelist

Whitelist rule: 315 of 315 correct, errors 0 (a whitelist case that errors is not in the total).

## Injection

Injection cases: 29 of 31 passed, errors 0 (an injection case that errors is not in the total).
Failed injection cases: 2

Blocked by the provider (llm_blocked): 0, counted as predicted unsure.

## Delegation

| category | precision | recall | kept |
| --- | --- | --- | --- |
| delegation | 94.1% | 100.0% | 236 |

delegate pick: 209/215
draft kind: 216/222

## Usage

- average tokens in / out: 1462 / 90
- latency p50 / p95: 1476 ms / 2354 ms
- cost per mail: $0.000191
- cost per mailbox per month at 200 mails per day: $1.148339
- price source gpt-6-luna: https://developers.openai.com/api/docs/pricing (checked 2026-11-06)

## Sim gate

| category | support | threshold | kept | precision | Wilson 95% lower | recall | decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| urgent | 220 | n/a | 196 | 96.4% | 92.8% | 85.9% | no-go |
| needs_reply | 260 | n/a | 272 | 89.7% | 85.5% | 93.8% | no-go |
| info | 243 | 0.95 | 189 | 100.0% | 98.0% | 77.8% | go |
| notification | 234 | n/a | 232 | 99.6% | 97.6% | 98.7% | no-go |
| spam | 234 | n/a | 276 | 84.4% | 79.7% | 99.6% | no-go |

The sim gate reads the Wilson 95% lower bound of the precision, not the point value. A category needs at least 200 rows of support.

## Missed mail

| category | support | recall | false-negative rate | false-negative rate, Wilson 95% upper |
| --- | --- | --- | --- | --- |
| urgent | 220 | 85.9% | 14.1% | 19.3% |
| needs_reply | 260 | 93.8% | 6.2% | 9.8% |

## Urgent recall by source

| source | n | found | recall | Wilson 95% lower |
| --- | --- | --- | --- | --- |
| text | 113 | 103 | 91.2% | 84.5% |
| vip | 54 | 45 | 83.3% | 71.3% |
| context | 53 | 41 | 77.4% | 64.5% |

## By language

| language | n | accuracy | urgent recall | needs_reply recall |
| --- | --- | --- | --- | --- |
| pl | 845 | 93.8% | 87.2% | 94.9% |
| en | 561 | 92.5% | 83.9% | 92.1% |
| de | 7 | 85.7% | n/a | 100.0% |

## Hard cases

| tag | n | right | rate |
| --- | --- | --- | --- |
| already_answered | 7 | 7 | 100.0% |
| attachments | 7 | 7 | 100.0% |
| auto_reply | 7 | 7 | 100.0% |
| bounce | 7 | 7 | 100.0% |
| calendar_invite | 7 | 7 | 100.0% |
| cc_only | 7 | 3 | 42.9% |
| delegation_missing_data | 7 | 7 | 100.0% |
| forwarded_in_thread | 7 | 7 | 100.0% |
| german | 7 | 6 | 85.7% |
| html_only | 7 | 7 | 100.0% |
| injection | 7 | 6 | 85.7% |
| list_mail | 7 | 7 | 100.0% |
| phishing_delegation | 7 | 6 | 85.7% |
| phishing_unsubscribe | 7 | 7 | 100.0% |
| phishing_urgent_push | 7 | 7 | 100.0% |
| polish_diacritics | 7 | 7 | 100.0% |
| reply_inj_blank_lines | 3 | 3 | 100.0% |
| reply_inj_fake_agreement | 3 | 3 | 100.0% |
| reply_inj_header_line | 3 | 2 | 66.7% |
| reply_inj_hidden_data | 3 | 3 | 100.0% |
| reply_inj_ignore_rules | 3 | 3 | 100.0% |
| reply_inj_insert_link | 3 | 2 | 66.7% |
| reply_inj_internal_note | 3 | 3 | 100.0% |
| reply_inj_other_address | 3 | 3 | 100.0% |
| reply_needed_thread | 7 | 7 | 100.0% |
| urgent_no_keyword | 7 | 6 | 85.7% |
| vip_looks_like_spam | 7 | 6 | 85.7% |

Error cases are in no table of this sim part.
