# Eval report: sim lab-01 dev

- date: 2026-11-19
- role: classifier
- model: gpt-6-luna
- provider: openai
- endpoint=standard host=api.openai.com
- reasoning effort: none
- prompt version: classifier-v4[profile]
- cases: 372 synthetic, 17 injection
- 389 of 389 cases done
- bar: 98.0%
- minimum support: 30 kept rows per category
- no generation settings: results can change between runs
- corpus: lab-01 v1 (dev), manifest bc4fc25c86d3, owner audit: pending
- cost: $0.0817 of cap $0.15

## Go/no-go

| category | threshold | precision | recall | kept | decision |
| --- | --- | --- | --- | --- | --- |
| urgent | n/a | 97.6% | 71.9% | 42 | no-go |
| needs_reply | n/a | 83.2% | 97.5% | 95 | no-go |
| info | 0.50 | 100.0% | 86.6% | 58 | go |
| notification | 0.50 | 98.4% | 100.0% | 64 | go |
| spam | n/a | 89.7% | 98.4% | 68 | no-go |

Minimum support: 30 kept rows per category (user 2026-11-04).

## Metrics per category

| category | precision | recall | support |
| --- | --- | --- | --- |
| urgent | 97.6% | 71.9% | 57 |
| needs_reply | 83.2% | 97.5% | 81 |
| delegation | 93.5% | 98.3% | 59 |
| info | 100.0% | 86.6% | 67 |
| notification | 98.4% | 100.0% | 63 |
| spam | 89.7% | 98.4% | 62 |
| unsure | n/a | n/a | 0 |

## Confusion matrix (rows: expected, columns: predicted)

| expected | urgent | needs_reply | delegation | info | notification | spam | unsure |
| --- | --- | --- | --- | --- | --- | --- | --- |
| urgent | 41 | 16 | 0 | 0 | 0 | 0 | 0 |
| needs_reply | 0 | 79 | 2 | 0 | 0 | 0 | 0 |
| delegation | 1 | 0 | 58 | 0 | 0 | 0 | 0 |
| info | 0 | 0 | 1 | 58 | 1 | 7 | 0 |
| notification | 0 | 0 | 0 | 0 | 63 | 0 | 0 |
| spam | 0 | 0 | 1 | 0 | 0 | 61 | 0 |
| unsure | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

## Threshold sweep

### urgent

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 97.6% | 71.9% | 42 |
| 0.55 | 97.6% | 71.9% | 42 |
| 0.60 | 97.6% | 71.9% | 42 |
| 0.65 | 97.6% | 71.9% | 42 |
| 0.70 | 97.6% | 71.9% | 42 |
| 0.75 | 97.6% | 71.9% | 42 |
| 0.80 | 97.6% | 71.9% | 42 |
| 0.85 | 97.6% | 71.9% | 42 |
| 0.90 | 97.6% | 70.2% | 41 |
| 0.95 | 97.4% | 64.9% | 38 |

### needs_reply

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 83.2% | 97.5% | 95 |
| 0.55 | 83.2% | 97.5% | 95 |
| 0.60 | 83.2% | 97.5% | 95 |
| 0.65 | 83.2% | 97.5% | 95 |
| 0.70 | 83.2% | 97.5% | 95 |
| 0.75 | 83.2% | 97.5% | 95 |
| 0.80 | 83.2% | 97.5% | 95 |
| 0.85 | 83.2% | 97.5% | 95 |
| 0.90 | 84.0% | 97.5% | 94 |
| 0.95 | 87.2% | 92.6% | 86 |

### info

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 100.0% | 86.6% | 58 |
| 0.55 | 100.0% | 86.6% | 58 |
| 0.60 | 100.0% | 86.6% | 58 |
| 0.65 | 100.0% | 86.6% | 58 |
| 0.70 | 100.0% | 86.6% | 58 |
| 0.75 | 100.0% | 86.6% | 58 |
| 0.80 | 100.0% | 86.6% | 58 |
| 0.85 | 100.0% | 86.6% | 58 |
| 0.90 | 100.0% | 86.6% | 58 |
| 0.95 | 100.0% | 77.6% | 52 |

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
| 0.85 | 98.4% | 98.4% | 63 |
| 0.90 | 98.4% | 98.4% | 63 |
| 0.95 | 98.4% | 95.2% | 61 |

### spam

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 89.7% | 98.4% | 68 |
| 0.55 | 89.7% | 98.4% | 68 |
| 0.60 | 89.7% | 98.4% | 68 |
| 0.65 | 89.7% | 98.4% | 68 |
| 0.70 | 89.7% | 98.4% | 68 |
| 0.75 | 89.7% | 98.4% | 68 |
| 0.80 | 89.7% | 98.4% | 68 |
| 0.85 | 89.7% | 98.4% | 68 |
| 0.90 | 89.6% | 96.8% | 67 |
| 0.95 | 90.0% | 87.1% | 60 |

## Confidence histogram

### urgent

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 1 | 1 |
| 0.90–0.94 | 3 | 3 |
| 0.95–1.00 | 38 | 37 |

### needs_reply

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 1 | 0 |
| 0.90–0.94 | 8 | 4 |
| 0.95–1.00 | 86 | 75 |

### info

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 0 | 0 |
| 0.90–0.94 | 6 | 6 |
| 0.95–1.00 | 52 | 52 |

### notification

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 1 | 1 |
| 0.90–0.94 | 2 | 2 |
| 0.95–1.00 | 61 | 60 |

### spam

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 1 | 1 |
| 0.90–0.94 | 7 | 6 |
| 0.95–1.00 | 60 | 54 |

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
| delegation | 93.5% | 98.3% | 62 |

delegate pick: 51/56
draft kind: 56/59

## Usage

- average tokens in / out: 1653 / 90
- latency p50 / p95: 1706 ms / 2745 ms
- cost per mail: $0.000210
- cost per mailbox per month at 200 mails per day: $1.260710
- price source gpt-6-luna: https://developers.openai.com/api/docs/pricing (checked 2026-11-06)

## Sim gate

| category | support | threshold | kept | precision | Wilson 95% lower | recall | decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| urgent | 57 | n/a | 42 | 97.6% | 87.7% | 71.9% | no-go: too few |
| needs_reply | 81 | n/a | 95 | 83.2% | 74.4% | 97.5% | no-go: too few |
| info | 67 | n/a | 58 | 100.0% | 93.8% | 86.6% | no-go: too few |
| notification | 63 | n/a | 64 | 98.4% | 91.7% | 100.0% | no-go: too few |
| spam | 62 | n/a | 68 | 89.7% | 80.2% | 98.4% | no-go: too few |

The sim gate reads the Wilson 95% lower bound of the precision, not the point value. A category needs at least 200 rows of support.

## Missed mail

| category | support | recall | false-negative rate | false-negative rate, Wilson 95% upper |
| --- | --- | --- | --- | --- |
| urgent | 57 | 71.9% | 28.1% | 40.8% |
| needs_reply | 81 | 97.5% | 2.5% | 8.6% |

## Urgent recall by source

| source | n | found | recall | Wilson 95% lower |
| --- | --- | --- | --- | --- |
| text | 31 | 29 | 93.5% | 79.3% |
| vip | 13 | 7 | 53.8% | 29.1% |
| context | 13 | 5 | 38.5% | 17.7% |

## By language

| language | n | accuracy | urgent recall | needs_reply recall |
| --- | --- | --- | --- | --- |
| pl | 236 | 92.4% | 77.1% | 98.0% |
| en | 150 | 92.7% | 63.6% | 96.8% |
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
| polish_diacritics | 3 | 2 | 66.7% |
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
