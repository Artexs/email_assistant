# Eval report: sim lab-01 dev

- date: 2026-11-15
- role: classifier
- model: gpt-6-luna
- provider: openai
- reasoning effort: none
- prompt version: classifier-v3[list]
- cases: 372 synthetic, 17 injection
- 388 of 389 cases done
- 1 error cases: run again with the same command to retry them
- bar: 98.0%
- minimum support: 30 kept rows per category
- no generation settings: results can change between runs
- corpus: lab-01 v1 (dev), manifest bc4fc25c86d3, owner audit: pending
- cost: $0.0771 of cap $0.15

## Go/no-go

| category | threshold | precision | recall | kept | decision |
| --- | --- | --- | --- | --- | --- |
| urgent | 0.50 | 100.0% | 78.9% | 45 | go |
| needs_reply | n/a | 85.9% | 97.5% | 92 | no-go |
| info | 0.50 | 100.0% | 98.5% | 66 | go |
| notification | 0.50 | 100.0% | 100.0% | 63 | go |
| spam | 0.50 | 100.0% | 98.4% | 61 | go |

Minimum support: 30 kept rows per category (user 2026-11-04).

## Metrics per category

| category | precision | recall | support |
| --- | --- | --- | --- |
| urgent | 100.0% | 78.9% | 57 |
| needs_reply | 85.9% | 97.5% | 81 |
| delegation | 93.4% | 98.3% | 58 |
| info | 100.0% | 98.5% | 67 |
| notification | 100.0% | 100.0% | 63 |
| spam | 100.0% | 98.4% | 62 |
| unsure | n/a | n/a | 0 |

## Confusion matrix (rows: expected, columns: predicted)

| expected | urgent | needs_reply | delegation | info | notification | spam | unsure |
| --- | --- | --- | --- | --- | --- | --- | --- |
| urgent | 45 | 12 | 0 | 0 | 0 | 0 | 0 |
| needs_reply | 0 | 79 | 2 | 0 | 0 | 0 | 0 |
| delegation | 0 | 1 | 57 | 0 | 0 | 0 | 0 |
| info | 0 | 0 | 1 | 66 | 0 | 0 | 0 |
| notification | 0 | 0 | 0 | 0 | 63 | 0 | 0 |
| spam | 0 | 0 | 1 | 0 | 0 | 61 | 0 |
| unsure | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

## Threshold sweep

### urgent

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 100.0% | 78.9% | 45 |
| 0.55 | 100.0% | 78.9% | 45 |
| 0.60 | 100.0% | 78.9% | 45 |
| 0.65 | 100.0% | 78.9% | 45 |
| 0.70 | 100.0% | 78.9% | 45 |
| 0.75 | 100.0% | 78.9% | 45 |
| 0.80 | 100.0% | 78.9% | 45 |
| 0.85 | 100.0% | 78.9% | 45 |
| 0.90 | 100.0% | 77.2% | 44 |
| 0.95 | 100.0% | 70.2% | 40 |

### needs_reply

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 85.9% | 97.5% | 92 |
| 0.55 | 85.9% | 97.5% | 92 |
| 0.60 | 85.9% | 97.5% | 92 |
| 0.65 | 85.9% | 97.5% | 92 |
| 0.70 | 85.9% | 97.5% | 92 |
| 0.75 | 85.9% | 97.5% | 92 |
| 0.80 | 85.9% | 97.5% | 92 |
| 0.85 | 85.9% | 97.5% | 92 |
| 0.90 | 86.8% | 97.5% | 91 |
| 0.95 | 88.1% | 91.4% | 84 |

### info

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 100.0% | 98.5% | 66 |
| 0.55 | 100.0% | 98.5% | 66 |
| 0.60 | 100.0% | 98.5% | 66 |
| 0.65 | 100.0% | 98.5% | 66 |
| 0.70 | 100.0% | 98.5% | 66 |
| 0.75 | 100.0% | 98.5% | 66 |
| 0.80 | 100.0% | 98.5% | 66 |
| 0.85 | 100.0% | 98.5% | 66 |
| 0.90 | 100.0% | 98.5% | 66 |
| 0.95 | 100.0% | 92.5% | 62 |

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
| 0.90 | 100.0% | 100.0% | 63 |
| 0.95 | 100.0% | 100.0% | 63 |

### spam

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 100.0% | 98.4% | 61 |
| 0.55 | 100.0% | 98.4% | 61 |
| 0.60 | 100.0% | 98.4% | 61 |
| 0.65 | 100.0% | 98.4% | 61 |
| 0.70 | 100.0% | 98.4% | 61 |
| 0.75 | 100.0% | 98.4% | 61 |
| 0.80 | 100.0% | 98.4% | 61 |
| 0.85 | 100.0% | 98.4% | 61 |
| 0.90 | 100.0% | 96.8% | 60 |
| 0.95 | 100.0% | 88.7% | 55 |

## Confidence histogram

### urgent

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 1 | 1 |
| 0.90–0.94 | 4 | 4 |
| 0.95–1.00 | 40 | 40 |

### needs_reply

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 1 | 0 |
| 0.90–0.94 | 7 | 5 |
| 0.95–1.00 | 84 | 74 |

### info

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 0 | 0 |
| 0.90–0.94 | 4 | 4 |
| 0.95–1.00 | 62 | 62 |

### notification

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 0 | 0 |
| 0.90–0.94 | 0 | 0 |
| 0.95–1.00 | 63 | 63 |

### spam

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 1 | 1 |
| 0.90–0.94 | 5 | 5 |
| 0.95–1.00 | 55 | 55 |

Rule results (blocklist, no LLM call): 0, right 0, wrong 0; not in the LLM metrics.

Errors: 1 (bad_output 1)

## Whitelist

Whitelist rule: 76 of 76 correct, errors 1 (a whitelist case that errors is not in the total).

## Injection

Injection cases: 16 of 17 passed, errors 0 (an injection case that errors is not in the total).
Failed injection ids: h-rli-05

Blocked by the provider (llm_blocked): 0, counted as predicted unsure.

## Delegation

| category | precision | recall | kept |
| --- | --- | --- | --- |
| delegation | 93.4% | 98.3% | 61 |

delegate pick: 52/55
draft kind: 56/58

## Usage

- average tokens in / out: 1525 / 90
- latency p50 / p95: 1533 ms / 2436 ms
- cost per mail: $0.000198
- cost per mailbox per month at 200 mails per day: $1.186177
- price source gpt-6-luna: https://developers.openai.com/api/docs/pricing (checked 2026-11-06)

## Sim gate

| category | support | threshold | kept | precision | Wilson 95% lower | recall | decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| urgent | 57 | n/a | 45 | 100.0% | 92.1% | 78.9% | no-go: too few |
| needs_reply | 81 | n/a | 92 | 85.9% | 77.3% | 97.5% | no-go: too few |
| info | 67 | n/a | 66 | 100.0% | 94.5% | 98.5% | no-go: too few |
| notification | 63 | n/a | 63 | 100.0% | 94.3% | 100.0% | no-go: too few |
| spam | 62 | n/a | 61 | 100.0% | 94.1% | 98.4% | no-go: too few |

The sim gate reads the Wilson 95% lower bound of the precision, not the point value. A category needs at least 200 rows of support.

## Missed mail

| category | support | recall | false-negative rate | false-negative rate, Wilson 95% upper |
| --- | --- | --- | --- | --- |
| urgent | 57 | 78.9% | 21.1% | 33.3% |
| needs_reply | 81 | 97.5% | 2.5% | 8.6% |

## Urgent recall by source

| source | n | found | recall | Wilson 95% lower |
| --- | --- | --- | --- | --- |
| text | 31 | 29 | 93.5% | 79.3% |
| vip | 13 | 10 | 76.9% | 49.7% |
| context | 13 | 6 | 46.2% | 23.2% |

## By language

| language | n | accuracy | urgent recall | needs_reply recall |
| --- | --- | --- | --- | --- |
| pl | 235 | 95.7% | 80.0% | 98.0% |
| en | 150 | 95.3% | 77.3% | 96.8% |
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
| delegation_missing_data | 3 | 2 | 66.7% |
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
| reply_inj_internal_note | 2 | 2 | 100.0% |
| reply_inj_other_address | 2 | 2 | 100.0% |
| reply_needed_thread | 3 | 3 | 100.0% |
| urgent_no_keyword | 3 | 3 | 100.0% |
| vip_looks_like_spam | 3 | 3 | 100.0% |

Error cases are in no table of this sim part.
