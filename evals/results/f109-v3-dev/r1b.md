# Eval report: sim lab-01 dev

- date: 2026-11-15
- role: classifier
- model: gpt-6-luna
- provider: openai
- reasoning effort: none
- prompt version: classifier-v2
- cases: 372 synthetic, 17 injection
- 389 of 389 cases done
- bar: 98.0%
- minimum support: 30 kept rows per category
- no generation settings: results can change between runs
- corpus: lab-01 v1 (dev), manifest bc4fc25c86d3, owner audit: pending
- cost: $0.0744 of cap $0.15

## Go/no-go

| category | threshold | precision | recall | kept | decision |
| --- | --- | --- | --- | --- | --- |
| urgent | 0.50 | 100.0% | 77.2% | 44 | go |
| needs_reply | n/a | 86.8% | 97.5% | 91 | no-go |
| info | 0.50 | 100.0% | 83.6% | 56 | go |
| notification | 0.50 | 98.4% | 100.0% | 64 | go |
| spam | n/a | 85.9% | 98.4% | 71 | no-go |

Minimum support: 30 kept rows per category (user 2026-11-04).

## Metrics per category

| category | precision | recall | support |
| --- | --- | --- | --- |
| urgent | 100.0% | 77.2% | 57 |
| needs_reply | 86.8% | 97.5% | 81 |
| delegation | 93.7% | 100.0% | 59 |
| info | 100.0% | 83.6% | 67 |
| notification | 98.4% | 100.0% | 63 |
| spam | 85.9% | 98.4% | 62 |
| unsure | n/a | n/a | 0 |

## Confusion matrix (rows: expected, columns: predicted)

| expected | urgent | needs_reply | delegation | info | notification | spam | unsure |
| --- | --- | --- | --- | --- | --- | --- | --- |
| urgent | 44 | 12 | 0 | 0 | 0 | 1 | 0 |
| needs_reply | 0 | 79 | 2 | 0 | 0 | 0 | 0 |
| delegation | 0 | 0 | 59 | 0 | 0 | 0 | 0 |
| info | 0 | 0 | 1 | 56 | 1 | 9 | 0 |
| notification | 0 | 0 | 0 | 0 | 63 | 0 | 0 |
| spam | 0 | 0 | 1 | 0 | 0 | 61 | 0 |
| unsure | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

## Threshold sweep

### urgent

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 100.0% | 77.2% | 44 |
| 0.55 | 100.0% | 77.2% | 44 |
| 0.60 | 100.0% | 77.2% | 44 |
| 0.65 | 100.0% | 77.2% | 44 |
| 0.70 | 100.0% | 77.2% | 44 |
| 0.75 | 100.0% | 77.2% | 44 |
| 0.80 | 100.0% | 77.2% | 44 |
| 0.85 | 100.0% | 77.2% | 44 |
| 0.90 | 100.0% | 77.2% | 44 |
| 0.95 | 100.0% | 73.7% | 42 |

### needs_reply

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 86.8% | 97.5% | 91 |
| 0.55 | 86.8% | 97.5% | 91 |
| 0.60 | 86.8% | 97.5% | 91 |
| 0.65 | 86.8% | 97.5% | 91 |
| 0.70 | 86.8% | 97.5% | 91 |
| 0.75 | 86.8% | 97.5% | 91 |
| 0.80 | 86.8% | 97.5% | 91 |
| 0.85 | 86.8% | 97.5% | 91 |
| 0.90 | 88.8% | 97.5% | 89 |
| 0.95 | 89.0% | 90.1% | 82 |

### info

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 100.0% | 83.6% | 56 |
| 0.55 | 100.0% | 83.6% | 56 |
| 0.60 | 100.0% | 83.6% | 56 |
| 0.65 | 100.0% | 83.6% | 56 |
| 0.70 | 100.0% | 83.6% | 56 |
| 0.75 | 100.0% | 83.6% | 56 |
| 0.80 | 100.0% | 83.6% | 56 |
| 0.85 | 100.0% | 83.6% | 56 |
| 0.90 | 100.0% | 83.6% | 56 |
| 0.95 | 100.0% | 79.1% | 53 |

### notification

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 98.4% | 100.0% | 64 |
| 0.55 | 98.4% | 100.0% | 64 |
| 0.60 | 98.4% | 100.0% | 64 |
| 0.65 | 98.4% | 100.0% | 64 |
| 0.70 | 98.4% | 100.0% | 64 |
| 0.75 | 98.4% | 100.0% | 64 |
| 0.80 | 98.4% | 100.0% | 64 |
| 0.85 | 98.4% | 100.0% | 64 |
| 0.90 | 98.4% | 100.0% | 64 |
| 0.95 | 98.4% | 96.8% | 62 |

### spam

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 85.9% | 98.4% | 71 |
| 0.55 | 85.9% | 98.4% | 71 |
| 0.60 | 85.9% | 98.4% | 71 |
| 0.65 | 85.9% | 98.4% | 71 |
| 0.70 | 85.9% | 98.4% | 71 |
| 0.75 | 85.9% | 98.4% | 71 |
| 0.80 | 87.1% | 98.4% | 70 |
| 0.85 | 89.7% | 98.4% | 68 |
| 0.90 | 90.9% | 96.8% | 66 |
| 0.95 | 96.7% | 95.2% | 61 |

## Confidence histogram

### urgent

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 0 | 0 |
| 0.90–0.94 | 2 | 2 |
| 0.95–1.00 | 42 | 42 |

### needs_reply

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 2 | 0 |
| 0.90–0.94 | 7 | 6 |
| 0.95–1.00 | 82 | 73 |

### info

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 0 | 0 |
| 0.90–0.94 | 3 | 3 |
| 0.95–1.00 | 53 | 53 |

### notification

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 0 | 0 |
| 0.90–0.94 | 2 | 2 |
| 0.95–1.00 | 62 | 61 |

### spam

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 1 | 0 |
| 0.80–0.89 | 4 | 1 |
| 0.90–0.94 | 5 | 1 |
| 0.95–1.00 | 61 | 59 |

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
| delegation | 93.7% | 100.0% | 63 |

delegate pick: 52/56
draft kind: 56/59

## Usage

- average tokens in / out: 1468 / 89
- latency p50 / p95: 1595 ms / 2328 ms
- cost per mail: $0.000191
- cost per mailbox per month at 200 mails per day: $1.147783
- price source gpt-6-luna: https://developers.openai.com/api/docs/pricing (checked 2026-11-06)

## Sim gate

| category | support | threshold | kept | precision | Wilson 95% lower | recall | decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| urgent | 57 | n/a | 44 | 100.0% | 92.0% | 77.2% | no-go: too few |
| needs_reply | 81 | n/a | 91 | 86.8% | 78.4% | 97.5% | no-go: too few |
| info | 67 | n/a | 56 | 100.0% | 93.6% | 83.6% | no-go: too few |
| notification | 63 | n/a | 64 | 98.4% | 91.7% | 100.0% | no-go: too few |
| spam | 62 | n/a | 71 | 85.9% | 76.0% | 98.4% | no-go: too few |

The sim gate reads the Wilson 95% lower bound of the precision, not the point value. A category needs at least 200 rows of support.

## Missed mail

| category | support | recall | false-negative rate | false-negative rate, Wilson 95% upper |
| --- | --- | --- | --- | --- |
| urgent | 57 | 77.2% | 22.8% | 35.2% |
| needs_reply | 81 | 97.5% | 2.5% | 8.6% |

## Urgent recall by source

| source | n | found | recall | Wilson 95% lower |
| --- | --- | --- | --- | --- |
| text | 31 | 28 | 90.3% | 75.1% |
| vip | 13 | 10 | 76.9% | 49.7% |
| context | 13 | 6 | 46.2% | 23.2% |

## By language

| language | n | accuracy | urgent recall | needs_reply recall |
| --- | --- | --- | --- | --- |
| pl | 236 | 94.1% | 82.9% | 98.0% |
| en | 150 | 91.3% | 68.2% | 96.8% |
| de | 3 | 100.0% | n/a | 100.0% |

## Hard cases

| tag | n | right | rate |
| --- | --- | --- | --- |
| already_answered | 3 | 3 | 100.0% |
| attachments | 3 | 3 | 100.0% |
| auto_reply | 3 | 3 | 100.0% |
| bounce | 3 | 3 | 100.0% |
| calendar_invite | 3 | 3 | 100.0% |
| cc_only | 3 | 2 | 66.7% |
| delegation_missing_data | 3 | 3 | 100.0% |
| forwarded_in_thread | 3 | 3 | 100.0% |
| german | 3 | 3 | 100.0% |
| html_only | 3 | 3 | 100.0% |
| injection | 1 | 1 | 100.0% |
| list_mail | 3 | 2 | 66.7% |
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
| reply_inj_internal_note | 2 | 2 | 100.0% |
| reply_inj_other_address | 2 | 2 | 100.0% |
| reply_needed_thread | 3 | 2 | 66.7% |
| urgent_no_keyword | 3 | 3 | 100.0% |
| vip_looks_like_spam | 3 | 3 | 100.0% |

Error cases are in no table of this sim part.
