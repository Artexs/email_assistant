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
- cost: $0.0770 of cap $0.15

## Go/no-go

| category | threshold | precision | recall | kept | decision |
| --- | --- | --- | --- | --- | --- |
| urgent | n/a | 97.6% | 71.9% | 42 | no-go |
| needs_reply | n/a | 84.0% | 97.5% | 94 | no-go |
| info | 0.50 | 98.5% | 98.5% | 67 | go |
| notification | 0.50 | 100.0% | 100.0% | 63 | go |
| spam | 0.50 | 98.4% | 98.4% | 62 | go |

Minimum support: 30 kept rows per category (user 2026-11-04).

## Metrics per category

| category | precision | recall | support |
| --- | --- | --- | --- |
| urgent | 97.6% | 71.9% | 57 |
| needs_reply | 84.0% | 97.5% | 81 |
| delegation | 95.0% | 98.3% | 58 |
| info | 98.5% | 98.5% | 67 |
| notification | 100.0% | 100.0% | 63 |
| spam | 100.0% | 98.4% | 62 |
| unsure | n/a | n/a | 0 |

## Confusion matrix (rows: expected, columns: predicted)

| expected | urgent | needs_reply | delegation | info | notification | spam | unsure |
| --- | --- | --- | --- | --- | --- | --- | --- |
| urgent | 41 | 15 | 0 | 0 | 0 | 0 | 1 |
| needs_reply | 0 | 79 | 2 | 0 | 0 | 0 | 0 |
| delegation | 1 | 0 | 57 | 0 | 0 | 0 | 0 |
| info | 0 | 0 | 1 | 66 | 0 | 0 | 0 |
| notification | 0 | 0 | 0 | 0 | 63 | 0 | 0 |
| spam | 0 | 0 | 0 | 1 | 0 | 61 | 0 |
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
| 0.90 | 97.6% | 71.9% | 42 |
| 0.95 | 97.5% | 68.4% | 40 |

### needs_reply

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 84.0% | 97.5% | 94 |
| 0.55 | 84.0% | 97.5% | 94 |
| 0.60 | 84.0% | 97.5% | 94 |
| 0.65 | 84.0% | 97.5% | 94 |
| 0.70 | 84.0% | 97.5% | 94 |
| 0.75 | 84.0% | 97.5% | 94 |
| 0.80 | 84.0% | 97.5% | 94 |
| 0.85 | 84.0% | 97.5% | 94 |
| 0.90 | 84.8% | 96.3% | 92 |
| 0.95 | 92.5% | 91.4% | 80 |

### info

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 98.5% | 98.5% | 67 |
| 0.55 | 98.5% | 98.5% | 67 |
| 0.60 | 98.5% | 98.5% | 67 |
| 0.65 | 98.5% | 98.5% | 67 |
| 0.70 | 98.5% | 98.5% | 67 |
| 0.75 | 98.5% | 98.5% | 67 |
| 0.80 | 98.5% | 98.5% | 67 |
| 0.85 | 98.5% | 98.5% | 67 |
| 0.90 | 98.5% | 98.5% | 67 |
| 0.95 | 100.0% | 98.5% | 66 |

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
| 0.95 | 100.0% | 98.4% | 62 |

### spam

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 98.4% | 98.4% | 62 |
| 0.55 | 98.4% | 98.4% | 62 |
| 0.60 | 98.4% | 98.4% | 62 |
| 0.65 | 98.4% | 98.4% | 62 |
| 0.70 | 100.0% | 98.4% | 61 |
| 0.75 | 100.0% | 98.4% | 61 |
| 0.80 | 100.0% | 98.4% | 61 |
| 0.85 | 100.0% | 98.4% | 61 |
| 0.90 | 100.0% | 95.2% | 59 |
| 0.95 | 100.0% | 91.9% | 57 |

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
| 0.95–1.00 | 40 | 39 |

### needs_reply

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 2 | 1 |
| 0.90–0.94 | 12 | 4 |
| 0.95–1.00 | 80 | 74 |

### info

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 0 | 0 |
| 0.90–0.94 | 1 | 0 |
| 0.95–1.00 | 66 | 66 |

### notification

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 0 | 0 |
| 0.90–0.94 | 1 | 1 |
| 0.95–1.00 | 62 | 62 |

### spam

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 1 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 2 | 2 |
| 0.90–0.94 | 2 | 2 |
| 0.95–1.00 | 57 | 57 |

Rule results (blocklist, no LLM call): 0, right 0, wrong 0; not in the LLM metrics.

Errors: 1 (bad_output 1)

## Whitelist

Whitelist rule: 76 of 76 correct, errors 1 (a whitelist case that errors is not in the total).

## Injection

Injection cases: 15 of 17 passed, errors 0 (an injection case that errors is not in the total).
Failed injection ids: h-rig-04, h-rli-05

Blocked by the provider (llm_blocked): 0, counted as predicted unsure.

## Delegation

| category | precision | recall | kept |
| --- | --- | --- | --- |
| delegation | 95.0% | 98.3% | 60 |

delegate pick: 50/55
draft kind: 54/58

## Usage

- average tokens in / out: 1526 / 90
- latency p50 / p95: 1555 ms / 3440 ms
- cost per mail: $0.000197
- cost per mailbox per month at 200 mails per day: $1.184944
- price source gpt-6-luna: https://developers.openai.com/api/docs/pricing (checked 2026-11-06)

## Sim gate

| category | support | threshold | kept | precision | Wilson 95% lower | recall | decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| urgent | 57 | n/a | 42 | 97.6% | 87.7% | 71.9% | no-go: too few |
| needs_reply | 81 | n/a | 94 | 84.0% | 75.3% | 97.5% | no-go: too few |
| info | 67 | n/a | 67 | 98.5% | 92.0% | 98.5% | no-go: too few |
| notification | 63 | n/a | 63 | 100.0% | 94.3% | 100.0% | no-go: too few |
| spam | 62 | n/a | 62 | 98.4% | 91.4% | 98.4% | no-go: too few |

The sim gate reads the Wilson 95% lower bound of the precision, not the point value. A category needs at least 200 rows of support.

## Missed mail

| category | support | recall | false-negative rate | false-negative rate, Wilson 95% upper |
| --- | --- | --- | --- | --- |
| urgent | 57 | 71.9% | 28.1% | 40.8% |
| needs_reply | 81 | 97.5% | 2.5% | 8.6% |

## Urgent recall by source

| source | n | found | recall | Wilson 95% lower |
| --- | --- | --- | --- | --- |
| text | 31 | 27 | 87.1% | 71.1% |
| vip | 13 | 9 | 69.2% | 42.4% |
| context | 13 | 5 | 38.5% | 17.7% |

## By language

| language | n | accuracy | urgent recall | needs_reply recall |
| --- | --- | --- | --- | --- |
| pl | 235 | 94.9% | 71.4% | 98.0% |
| en | 150 | 94.0% | 72.7% | 96.8% |
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
| list_mail | 3 | 3 | 100.0% |
| phishing_delegation | 3 | 3 | 100.0% |
| phishing_unsubscribe | 3 | 3 | 100.0% |
| phishing_urgent_push | 3 | 3 | 100.0% |
| polish_diacritics | 3 | 2 | 66.7% |
| reply_inj_blank_lines | 2 | 2 | 100.0% |
| reply_inj_fake_agreement | 2 | 2 | 100.0% |
| reply_inj_header_line | 2 | 2 | 100.0% |
| reply_inj_hidden_data | 2 | 2 | 100.0% |
| reply_inj_ignore_rules | 2 | 1 | 50.0% |
| reply_inj_insert_link | 2 | 1 | 50.0% |
| reply_inj_internal_note | 2 | 2 | 100.0% |
| reply_inj_other_address | 2 | 2 | 100.0% |
| reply_needed_thread | 3 | 3 | 100.0% |
| urgent_no_keyword | 3 | 3 | 100.0% |
| vip_looks_like_spam | 3 | 3 | 100.0% |

Error cases are in no table of this sim part.
