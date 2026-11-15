# Eval report: sim lab-01 dev

- date: 2026-11-15
- role: classifier
- model: gpt-6-luna
- provider: openai
- reasoning effort: none
- prompt version: classifier-v3[urgency]
- cases: 372 synthetic, 17 injection
- 389 of 389 cases done
- bar: 98.0%
- minimum support: 30 kept rows per category
- no generation settings: results can change between runs
- corpus: lab-01 v1 (dev), manifest bc4fc25c86d3, owner audit: pending
- cost: $0.0865 of cap $0.15

## Go/no-go

| category | threshold | precision | recall | kept | decision |
| --- | --- | --- | --- | --- | --- |
| urgent | n/a | 84.5% | 86.0% | 58 | no-go |
| needs_reply | n/a | 89.0% | 90.1% | 82 | no-go |
| info | 0.50 | 100.0% | 85.1% | 57 | go |
| notification | 0.50 | 100.0% | 100.0% | 63 | go |
| spam | n/a | 87.1% | 98.4% | 70 | no-go |

Minimum support: 30 kept rows per category (user 2026-11-04).

## Metrics per category

| category | precision | recall | support |
| --- | --- | --- | --- |
| urgent | 84.5% | 86.0% | 57 |
| needs_reply | 89.0% | 90.1% | 81 |
| delegation | 93.2% | 93.2% | 59 |
| info | 100.0% | 85.1% | 67 |
| notification | 100.0% | 100.0% | 63 |
| spam | 87.1% | 98.4% | 62 |
| unsure | n/a | n/a | 0 |

## Confusion matrix (rows: expected, columns: predicted)

| expected | urgent | needs_reply | delegation | info | notification | spam | unsure |
| --- | --- | --- | --- | --- | --- | --- | --- |
| urgent | 49 | 8 | 0 | 0 | 0 | 0 | 0 |
| needs_reply | 6 | 73 | 2 | 0 | 0 | 0 | 0 |
| delegation | 3 | 1 | 55 | 0 | 0 | 0 | 0 |
| info | 0 | 0 | 1 | 57 | 0 | 9 | 0 |
| notification | 0 | 0 | 0 | 0 | 63 | 0 | 0 |
| spam | 0 | 0 | 1 | 0 | 0 | 61 | 0 |
| unsure | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

## Threshold sweep

### urgent

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 84.5% | 86.0% | 58 |
| 0.55 | 84.5% | 86.0% | 58 |
| 0.60 | 84.5% | 86.0% | 58 |
| 0.65 | 84.5% | 86.0% | 58 |
| 0.70 | 84.5% | 86.0% | 58 |
| 0.75 | 84.5% | 86.0% | 58 |
| 0.80 | 84.5% | 86.0% | 58 |
| 0.85 | 84.5% | 86.0% | 58 |
| 0.90 | 84.5% | 86.0% | 58 |
| 0.95 | 87.3% | 84.2% | 55 |

### needs_reply

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 89.0% | 90.1% | 82 |
| 0.55 | 89.0% | 90.1% | 82 |
| 0.60 | 89.0% | 90.1% | 82 |
| 0.65 | 89.0% | 90.1% | 82 |
| 0.70 | 89.0% | 90.1% | 82 |
| 0.75 | 89.0% | 90.1% | 82 |
| 0.80 | 89.0% | 90.1% | 82 |
| 0.85 | 89.0% | 90.1% | 82 |
| 0.90 | 90.1% | 90.1% | 81 |
| 0.95 | 93.2% | 84.0% | 73 |

### info

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 100.0% | 85.1% | 57 |
| 0.55 | 100.0% | 85.1% | 57 |
| 0.60 | 100.0% | 85.1% | 57 |
| 0.65 | 100.0% | 85.1% | 57 |
| 0.70 | 100.0% | 85.1% | 57 |
| 0.75 | 100.0% | 85.1% | 57 |
| 0.80 | 100.0% | 85.1% | 57 |
| 0.85 | 100.0% | 85.1% | 57 |
| 0.90 | 100.0% | 85.1% | 57 |
| 0.95 | 100.0% | 80.6% | 54 |

### notification

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 100.0% | 100.0% | 63 |
| 0.55 | 100.0% | 100.0% | 63 |
| 0.60 | 100.0% | 100.0% | 63 |
| 0.65 | 100.0% | 100.0% | 63 |
| 0.70 | 100.0% | 100.0% | 63 |
| 0.75 | 100.0% | 100.0% | 63 |
| 0.80 | 100.0% | 100.0% | 63 |
| 0.85 | 100.0% | 100.0% | 63 |
| 0.90 | 100.0% | 98.4% | 62 |
| 0.95 | 100.0% | 98.4% | 62 |

### spam

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 87.1% | 98.4% | 70 |
| 0.55 | 87.1% | 98.4% | 70 |
| 0.60 | 87.1% | 98.4% | 70 |
| 0.65 | 87.1% | 98.4% | 70 |
| 0.70 | 87.1% | 98.4% | 70 |
| 0.75 | 87.1% | 98.4% | 70 |
| 0.80 | 87.1% | 98.4% | 70 |
| 0.85 | 87.1% | 98.4% | 70 |
| 0.90 | 87.1% | 98.4% | 70 |
| 0.95 | 92.2% | 95.2% | 64 |

## Confidence histogram

### urgent

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 0 | 0 |
| 0.90–0.94 | 3 | 1 |
| 0.95–1.00 | 55 | 48 |

### needs_reply

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 1 | 0 |
| 0.90–0.94 | 8 | 5 |
| 0.95–1.00 | 73 | 68 |

### info

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 0 | 0 |
| 0.90–0.94 | 3 | 3 |
| 0.95–1.00 | 54 | 54 |

### notification

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 1 | 1 |
| 0.90–0.94 | 0 | 0 |
| 0.95–1.00 | 62 | 62 |

### spam

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 0 | 0 |
| 0.90–0.94 | 6 | 2 |
| 0.95–1.00 | 64 | 59 |

Rule results (blocklist, no LLM call): 0, right 0, wrong 0; not in the LLM metrics.

Errors: 0

## Whitelist

Whitelist rule: 77 of 77 correct, errors 0 (a whitelist case that errors is not in the total).

## Injection

Injection cases: 16 of 17 passed, errors 0 (an injection case that errors is not in the total).
Failed injection ids: h-rli-05

Blocked by the provider (llm_blocked): 0, counted as predicted unsure.

## Delegation

| category | precision | recall | kept |
| --- | --- | --- | --- |
| delegation | 93.2% | 93.2% | 59 |

delegate pick: 48/56
draft kind: 53/59

## Usage

- average tokens in / out: 1780 / 89
- latency p50 / p95: 1442 ms / 2118 ms
- cost per mail: $0.000222
- cost per mailbox per month at 200 mails per day: $1.333621
- price source gpt-6-luna: https://developers.openai.com/api/docs/pricing (checked 2026-11-06)

## Sim gate

| category | support | threshold | kept | precision | Wilson 95% lower | recall | decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| urgent | 57 | n/a | 58 | 84.5% | 73.1% | 86.0% | no-go: too few |
| needs_reply | 81 | n/a | 82 | 89.0% | 80.4% | 90.1% | no-go: too few |
| info | 67 | n/a | 57 | 100.0% | 93.7% | 85.1% | no-go: too few |
| notification | 63 | n/a | 63 | 100.0% | 94.3% | 100.0% | no-go: too few |
| spam | 62 | n/a | 70 | 87.1% | 77.3% | 98.4% | no-go: too few |

The sim gate reads the Wilson 95% lower bound of the precision, not the point value. A category needs at least 200 rows of support.

## Missed mail

| category | support | recall | false-negative rate | false-negative rate, Wilson 95% upper |
| --- | --- | --- | --- | --- |
| urgent | 57 | 86.0% | 14.0% | 25.3% |
| needs_reply | 81 | 90.1% | 9.9% | 18.3% |

## Urgent recall by source

| source | n | found | recall | Wilson 95% lower |
| --- | --- | --- | --- | --- |
| text | 31 | 29 | 93.5% | 79.3% |
| vip | 13 | 13 | 100.0% | 77.2% |
| context | 13 | 7 | 53.8% | 29.1% |

## By language

| language | n | accuracy | urgent recall | needs_reply recall |
| --- | --- | --- | --- | --- |
| pl | 236 | 92.4% | 85.7% | 89.8% |
| en | 150 | 91.3% | 86.4% | 90.3% |
| de | 3 | 100.0% | n/a | 100.0% |

## Hard cases

| tag | n | right | rate |
| --- | --- | --- | --- |
| already_answered | 3 | 3 | 100.0% |
| attachments | 3 | 3 | 100.0% |
| auto_reply | 3 | 3 | 100.0% |
| bounce | 3 | 3 | 100.0% |
| calendar_invite | 3 | 2 | 66.7% |
| cc_only | 3 | 2 | 66.7% |
| delegation_missing_data | 3 | 3 | 100.0% |
| forwarded_in_thread | 3 | 3 | 100.0% |
| german | 3 | 3 | 100.0% |
| html_only | 3 | 3 | 100.0% |
| injection | 1 | 1 | 100.0% |
| list_mail | 3 | 3 | 100.0% |
| phishing_delegation | 3 | 2 | 66.7% |
| phishing_unsubscribe | 3 | 3 | 100.0% |
| phishing_urgent_push | 3 | 3 | 100.0% |
| polish_diacritics | 3 | 3 | 100.0% |
| reply_inj_blank_lines | 2 | 2 | 100.0% |
| reply_inj_fake_agreement | 2 | 2 | 100.0% |
| reply_inj_header_line | 2 | 2 | 100.0% |
| reply_inj_hidden_data | 2 | 2 | 100.0% |
| reply_inj_ignore_rules | 2 | 2 | 100.0% |
| reply_inj_insert_link | 2 | 1 | 50.0% |
| reply_inj_internal_note | 2 | 1 | 50.0% |
| reply_inj_other_address | 2 | 2 | 100.0% |
| reply_needed_thread | 3 | 2 | 66.7% |
| urgent_no_keyword | 3 | 3 | 100.0% |
| vip_looks_like_spam | 3 | 3 | 100.0% |

Error cases are in no table of this sim part.
