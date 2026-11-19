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
| urgent | 0.50 | 100.0% | 71.9% | 41 | go |
| needs_reply | n/a | 83.3% | 98.8% | 96 | no-go |
| info | 0.50 | 100.0% | 85.1% | 57 | go |
| notification | 0.50 | 98.4% | 96.8% | 62 | go |
| spam | n/a | 85.9% | 98.4% | 71 | no-go |

Minimum support: 30 kept rows per category (user 2026-11-04).

## Metrics per category

| category | precision | recall | support |
| --- | --- | --- | --- |
| urgent | 100.0% | 71.9% | 57 |
| needs_reply | 83.3% | 98.8% | 81 |
| delegation | 95.2% | 100.0% | 59 |
| info | 100.0% | 85.1% | 67 |
| notification | 98.4% | 96.8% | 63 |
| spam | 85.9% | 98.4% | 62 |
| unsure | n/a | n/a | 0 |

## Confusion matrix (rows: expected, columns: predicted)

| expected | urgent | needs_reply | delegation | info | notification | spam | unsure |
| --- | --- | --- | --- | --- | --- | --- | --- |
| urgent | 41 | 16 | 0 | 0 | 0 | 0 | 0 |
| needs_reply | 0 | 80 | 1 | 0 | 0 | 0 | 0 |
| delegation | 0 | 0 | 59 | 0 | 0 | 0 | 0 |
| info | 0 | 0 | 1 | 57 | 1 | 8 | 0 |
| notification | 0 | 0 | 0 | 0 | 61 | 2 | 0 |
| spam | 0 | 0 | 1 | 0 | 0 | 61 | 0 |
| unsure | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

## Threshold sweep

### urgent

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 100.0% | 71.9% | 41 |
| 0.55 | 100.0% | 71.9% | 41 |
| 0.60 | 100.0% | 71.9% | 41 |
| 0.65 | 100.0% | 71.9% | 41 |
| 0.70 | 100.0% | 71.9% | 41 |
| 0.75 | 100.0% | 71.9% | 41 |
| 0.80 | 100.0% | 71.9% | 41 |
| 0.85 | 100.0% | 71.9% | 41 |
| 0.90 | 100.0% | 71.9% | 41 |
| 0.95 | 100.0% | 66.7% | 38 |

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
| 0.90 | 83.2% | 97.5% | 95 |
| 0.95 | 88.1% | 91.4% | 84 |

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
| 0.90 | 100.0% | 83.6% | 56 |
| 0.95 | 100.0% | 76.1% | 51 |

### notification

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 98.4% | 96.8% | 62 |
| 0.55 | 98.4% | 96.8% | 62 |
| 0.60 | 98.4% | 96.8% | 62 |
| 0.65 | 98.4% | 96.8% | 62 |
| 0.70 | 98.4% | 96.8% | 62 |
| 0.75 | 98.4% | 96.8% | 62 |
| 0.80 | 98.4% | 96.8% | 62 |
| 0.85 | 98.4% | 96.8% | 62 |
| 0.90 | 98.4% | 96.8% | 62 |
| 0.95 | 98.4% | 95.2% | 61 |

### spam

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 85.9% | 98.4% | 71 |
| 0.55 | 85.9% | 98.4% | 71 |
| 0.60 | 85.9% | 98.4% | 71 |
| 0.65 | 85.9% | 98.4% | 71 |
| 0.70 | 85.9% | 98.4% | 71 |
| 0.75 | 85.9% | 98.4% | 71 |
| 0.80 | 85.9% | 98.4% | 71 |
| 0.85 | 87.1% | 98.4% | 70 |
| 0.90 | 89.7% | 98.4% | 68 |
| 0.95 | 90.6% | 93.5% | 64 |

## Confidence histogram

### urgent

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 0 | 0 |
| 0.90–0.94 | 3 | 3 |
| 0.95–1.00 | 38 | 38 |

### needs_reply

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 1 | 1 |
| 0.90–0.94 | 11 | 5 |
| 0.95–1.00 | 84 | 74 |

### info

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 1 | 1 |
| 0.90–0.94 | 5 | 5 |
| 0.95–1.00 | 51 | 51 |

### notification

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 0 | 0 |
| 0.90–0.94 | 1 | 1 |
| 0.95–1.00 | 61 | 60 |

### spam

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 3 | 0 |
| 0.90–0.94 | 4 | 3 |
| 0.95–1.00 | 64 | 58 |

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
| delegation | 95.2% | 100.0% | 62 |

delegate pick: 52/56
draft kind: 57/59

## Usage

- average tokens in / out: 1653 / 89
- latency p50 / p95: 1649 ms / 2584 ms
- cost per mail: $0.000210
- cost per mailbox per month at 200 mails per day: $1.259665
- price source gpt-6-luna: https://developers.openai.com/api/docs/pricing (checked 2026-11-06)

## Sim gate

| category | support | threshold | kept | precision | Wilson 95% lower | recall | decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| urgent | 57 | n/a | 41 | 100.0% | 91.4% | 71.9% | no-go: too few |
| needs_reply | 81 | n/a | 96 | 83.3% | 74.6% | 98.8% | no-go: too few |
| info | 67 | n/a | 57 | 100.0% | 93.7% | 85.1% | no-go: too few |
| notification | 63 | n/a | 62 | 98.4% | 91.4% | 96.8% | no-go: too few |
| spam | 62 | n/a | 71 | 85.9% | 76.0% | 98.4% | no-go: too few |

The sim gate reads the Wilson 95% lower bound of the precision, not the point value. A category needs at least 200 rows of support.

## Missed mail

| category | support | recall | false-negative rate | false-negative rate, Wilson 95% upper |
| --- | --- | --- | --- | --- |
| urgent | 57 | 71.9% | 28.1% | 40.8% |
| needs_reply | 81 | 98.8% | 1.2% | 6.7% |

## Urgent recall by source

| source | n | found | recall | Wilson 95% lower |
| --- | --- | --- | --- | --- |
| text | 31 | 27 | 87.1% | 71.1% |
| vip | 13 | 8 | 61.5% | 35.5% |
| context | 13 | 6 | 46.2% | 23.2% |

## By language

| language | n | accuracy | urgent recall | needs_reply recall |
| --- | --- | --- | --- | --- |
| pl | 236 | 92.8% | 77.1% | 100.0% |
| en | 150 | 91.3% | 63.6% | 96.8% |
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
| reply_needed_thread | 3 | 3 | 100.0% |
| urgent_no_keyword | 3 | 3 | 100.0% |
| vip_looks_like_spam | 3 | 3 | 100.0% |

Error cases are in no table of this sim part.
