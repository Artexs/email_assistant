# Eval report: sim lab-01 dev

- date: 2026-11-15
- role: classifier
- model: gpt-6-luna
- provider: openai
- reasoning effort: none
- prompt version: classifier-v3[]
- cases: 372 synthetic, 17 injection
- 389 of 389 cases done
- bar: 98.0%
- minimum support: 30 kept rows per category
- no generation settings: results can change between runs
- corpus: lab-01 v1 (dev), manifest bc4fc25c86d3, owner audit: pending
- cost: $0.0757 of cap $0.15

## Go/no-go

| category | threshold | precision | recall | kept | decision |
| --- | --- | --- | --- | --- | --- |
| urgent | 0.50 | 100.0% | 73.7% | 42 | go |
| needs_reply | n/a | 83.3% | 98.8% | 96 | no-go |
| info | 0.50 | 100.0% | 85.1% | 57 | go |
| notification | 0.50 | 98.4% | 100.0% | 64 | go |
| spam | n/a | 88.6% | 100.0% | 70 | no-go |

Minimum support: 30 kept rows per category (user 2026-11-04).

## Metrics per category

| category | precision | recall | support |
| --- | --- | --- | --- |
| urgent | 100.0% | 73.7% | 57 |
| needs_reply | 83.3% | 98.8% | 81 |
| delegation | 96.7% | 98.3% | 59 |
| info | 100.0% | 85.1% | 67 |
| notification | 98.4% | 100.0% | 63 |
| spam | 88.6% | 100.0% | 62 |
| unsure | n/a | n/a | 0 |

## Confusion matrix (rows: expected, columns: predicted)

| expected | urgent | needs_reply | delegation | info | notification | spam | unsure |
| --- | --- | --- | --- | --- | --- | --- | --- |
| urgent | 42 | 15 | 0 | 0 | 0 | 0 | 0 |
| needs_reply | 0 | 80 | 1 | 0 | 0 | 0 | 0 |
| delegation | 0 | 1 | 58 | 0 | 0 | 0 | 0 |
| info | 0 | 0 | 1 | 57 | 1 | 8 | 0 |
| notification | 0 | 0 | 0 | 0 | 63 | 0 | 0 |
| spam | 0 | 0 | 0 | 0 | 0 | 62 | 0 |
| unsure | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

## Threshold sweep

### urgent

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 100.0% | 73.7% | 42 |
| 0.55 | 100.0% | 73.7% | 42 |
| 0.60 | 100.0% | 73.7% | 42 |
| 0.65 | 100.0% | 73.7% | 42 |
| 0.70 | 100.0% | 73.7% | 42 |
| 0.75 | 100.0% | 73.7% | 42 |
| 0.80 | 100.0% | 73.7% | 42 |
| 0.85 | 100.0% | 73.7% | 42 |
| 0.90 | 100.0% | 73.7% | 42 |
| 0.95 | 100.0% | 70.2% | 40 |

### needs_reply

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 83.3% | 98.8% | 96 |
| 0.55 | 83.3% | 98.8% | 96 |
| 0.60 | 83.3% | 98.8% | 96 |
| 0.65 | 83.3% | 98.8% | 96 |
| 0.70 | 83.3% | 98.8% | 96 |
| 0.75 | 83.3% | 98.8% | 96 |
| 0.80 | 83.3% | 98.8% | 96 |
| 0.85 | 83.3% | 98.8% | 96 |
| 0.90 | 84.0% | 97.5% | 94 |
| 0.95 | 86.2% | 92.6% | 87 |

### info

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 100.0% | 85.1% | 57 |
| 0.55 | 100.0% | 85.1% | 57 |
| 0.60 | 100.0% | 85.1% | 57 |
| 0.65 | 100.0% | 85.1% | 57 |
| 0.70 | 100.0% | 85.1% | 57 |
| 0.75 | 100.0% | 85.1% | 57 |
| 0.80 | 100.0% | 83.6% | 56 |
| 0.85 | 100.0% | 83.6% | 56 |
| 0.90 | 100.0% | 83.6% | 56 |
| 0.95 | 100.0% | 80.6% | 54 |

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
| 0.50 | 88.6% | 100.0% | 70 |
| 0.55 | 88.6% | 100.0% | 70 |
| 0.60 | 88.6% | 100.0% | 70 |
| 0.65 | 88.6% | 100.0% | 70 |
| 0.70 | 88.6% | 100.0% | 70 |
| 0.75 | 88.6% | 100.0% | 70 |
| 0.80 | 88.6% | 100.0% | 70 |
| 0.85 | 88.4% | 98.4% | 69 |
| 0.90 | 88.2% | 96.8% | 68 |
| 0.95 | 95.0% | 91.9% | 60 |

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
| 0.95–1.00 | 40 | 40 |

### needs_reply

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 2 | 1 |
| 0.90–0.94 | 7 | 4 |
| 0.95–1.00 | 87 | 75 |

### info

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 1 | 1 |
| 0.80–0.89 | 0 | 0 |
| 0.90–0.94 | 2 | 2 |
| 0.95–1.00 | 54 | 54 |

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
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 2 | 2 |
| 0.90–0.94 | 8 | 3 |
| 0.95–1.00 | 60 | 57 |

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
| delegation | 96.7% | 98.3% | 60 |

delegate pick: 51/56
draft kind: 55/59

## Usage

- average tokens in / out: 1500 / 89
- latency p50 / p95: 1531 ms / 2260 ms
- cost per mail: $0.000194
- cost per mailbox per month at 200 mails per day: $1.166955
- price source gpt-6-luna: https://developers.openai.com/api/docs/pricing (checked 2026-11-06)

## Sim gate

| category | support | threshold | kept | precision | Wilson 95% lower | recall | decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| urgent | 57 | n/a | 42 | 100.0% | 91.6% | 73.7% | no-go: too few |
| needs_reply | 81 | n/a | 96 | 83.3% | 74.6% | 98.8% | no-go: too few |
| info | 67 | n/a | 57 | 100.0% | 93.7% | 85.1% | no-go: too few |
| notification | 63 | n/a | 64 | 98.4% | 91.7% | 100.0% | no-go: too few |
| spam | 62 | n/a | 70 | 88.6% | 79.0% | 100.0% | no-go: too few |

The sim gate reads the Wilson 95% lower bound of the precision, not the point value. A category needs at least 200 rows of support.

## Missed mail

| category | support | recall | false-negative rate | false-negative rate, Wilson 95% upper |
| --- | --- | --- | --- | --- |
| urgent | 57 | 73.7% | 26.3% | 39.0% |
| needs_reply | 81 | 98.8% | 1.2% | 6.7% |

## Urgent recall by source

| source | n | found | recall | Wilson 95% lower |
| --- | --- | --- | --- | --- |
| text | 31 | 27 | 87.1% | 71.1% |
| vip | 13 | 8 | 61.5% | 35.5% |
| context | 13 | 7 | 53.8% | 29.1% |

## By language

| language | n | accuracy | urgent recall | needs_reply recall |
| --- | --- | --- | --- | --- |
| pl | 236 | 93.6% | 74.3% | 100.0% |
| en | 150 | 92.0% | 72.7% | 96.8% |
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
| phishing_delegation | 3 | 3 | 100.0% |
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
| reply_needed_thread | 3 | 3 | 100.0% |
| urgent_no_keyword | 3 | 3 | 100.0% |
| vip_looks_like_spam | 3 | 3 | 100.0% |

Error cases are in no table of this sim part.
