# Eval report: sim lab-01 dev

- date: 2026-11-14
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
- cost: $0.0944 of cap $1.00

## Go/no-go

| category | threshold | precision | recall | kept | decision |
| --- | --- | --- | --- | --- | --- |
| urgent | 0.50 | 100.0% | 75.4% | 43 | go |
| needs_reply | n/a | 84.9% | 97.5% | 93 | no-go |
| info | 0.50 | 100.0% | 85.1% | 57 | go |
| notification | 0.50 | 98.4% | 100.0% | 64 | go |
| spam | n/a | 87.1% | 98.4% | 70 | no-go |

Minimum support: 30 kept rows per category (user 2026-11-04).

## Metrics per category

| category | precision | recall | support |
| --- | --- | --- | --- |
| urgent | 100.0% | 75.4% | 57 |
| needs_reply | 84.9% | 97.5% | 81 |
| delegation | 95.2% | 100.0% | 59 |
| info | 100.0% | 85.1% | 67 |
| notification | 98.4% | 100.0% | 63 |
| spam | 87.1% | 98.4% | 62 |
| unsure | n/a | n/a | 0 |

## Confusion matrix (rows: expected, columns: predicted)

| expected | urgent | needs_reply | delegation | info | notification | spam | unsure |
| --- | --- | --- | --- | --- | --- | --- | --- |
| urgent | 43 | 13 | 0 | 0 | 0 | 1 | 0 |
| needs_reply | 0 | 79 | 2 | 0 | 0 | 0 | 0 |
| delegation | 0 | 0 | 59 | 0 | 0 | 0 | 0 |
| info | 0 | 1 | 0 | 57 | 1 | 8 | 0 |
| notification | 0 | 0 | 0 | 0 | 63 | 0 | 0 |
| spam | 0 | 0 | 1 | 0 | 0 | 61 | 0 |
| unsure | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

## Threshold sweep

### urgent

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 100.0% | 75.4% | 43 |
| 0.55 | 100.0% | 75.4% | 43 |
| 0.60 | 100.0% | 75.4% | 43 |
| 0.65 | 100.0% | 75.4% | 43 |
| 0.70 | 100.0% | 75.4% | 43 |
| 0.75 | 100.0% | 75.4% | 43 |
| 0.80 | 100.0% | 75.4% | 43 |
| 0.85 | 100.0% | 75.4% | 43 |
| 0.90 | 100.0% | 73.7% | 42 |
| 0.95 | 100.0% | 66.7% | 38 |

### needs_reply

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 84.9% | 97.5% | 93 |
| 0.55 | 84.9% | 97.5% | 93 |
| 0.60 | 84.9% | 97.5% | 93 |
| 0.65 | 84.9% | 97.5% | 93 |
| 0.70 | 84.9% | 97.5% | 93 |
| 0.75 | 84.9% | 97.5% | 93 |
| 0.80 | 84.9% | 97.5% | 93 |
| 0.85 | 84.9% | 97.5% | 93 |
| 0.90 | 85.7% | 96.3% | 91 |
| 0.95 | 90.0% | 88.9% | 80 |

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
| 0.85 | 100.0% | 83.6% | 56 |
| 0.90 | 100.0% | 82.1% | 55 |
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
| 0.95 | 98.4% | 100.0% | 64 |

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
| 0.85 | 91.0% | 98.4% | 67 |
| 0.90 | 92.3% | 96.8% | 65 |
| 0.95 | 95.1% | 93.5% | 61 |

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
| 0.95–1.00 | 38 | 38 |

### needs_reply

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 2 | 1 |
| 0.90–0.94 | 11 | 6 |
| 0.95–1.00 | 80 | 72 |

### info

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 2 | 2 |
| 0.90–0.94 | 2 | 2 |
| 0.95–1.00 | 53 | 53 |

### notification

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 0 | 0 |
| 0.90–0.94 | 0 | 0 |
| 0.95–1.00 | 64 | 63 |

### spam

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 5 | 1 |
| 0.90–0.94 | 4 | 2 |
| 0.95–1.00 | 61 | 58 |

Rule results (blocklist, no LLM call): 0, right 0, wrong 0; not in the LLM metrics.

Errors: 0

## Whitelist

Whitelist rule: 77 of 77 correct, errors 0 (a whitelist case that errors is not in the total).

## Injection

Injection cases: 16 of 17 passed, errors 0 (an injection case that errors is not in the total).
Failed injection ids: h-rig-03

Blocked by the provider (llm_blocked): 0, counted as predicted unsure.

## Delegation

| category | precision | recall | kept |
| --- | --- | --- | --- |
| delegation | 95.2% | 100.0% | 62 |

delegate pick: 52/56
draft kind: 57/59

## Draft judge

Judge: gemini gemini-3.5-flash-lite. The rubric scores and the pass rate are LLM-scored; the code checks are not.

Judged: 62, errors 0 (a judge error is not in the other counts).
Code checks passed: 57 of 62 (failed: recipient 5)

| rubric item | mean (0-2) |
| --- | --- |
| facts_kept | 1.95 |
| task_clear | 2.00 |
| tone_fits | 2.00 |

Pass: 57 of 62, rate 91.9%, Wilson lower bound 82.5%

## Usage

- average tokens in / out: 1468 / 89
- latency p50 / p95: 1444 ms / 2146 ms
- cost per mail: $0.000191
- cost per mailbox per month at 200 mails per day: $1.147157
- price source gpt-6-luna: https://developers.openai.com/api/docs/pricing (checked 2026-11-06)

## Sim gate

| category | support | threshold | kept | precision | Wilson 95% lower | recall | decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| urgent | 57 | n/a | 43 | 100.0% | 91.8% | 75.4% | no-go: too few |
| needs_reply | 81 | n/a | 93 | 84.9% | 76.3% | 97.5% | no-go: too few |
| info | 67 | n/a | 57 | 100.0% | 93.7% | 85.1% | no-go: too few |
| notification | 63 | n/a | 64 | 98.4% | 91.7% | 100.0% | no-go: too few |
| spam | 62 | n/a | 70 | 87.1% | 77.3% | 98.4% | no-go: too few |

The sim gate reads the Wilson 95% lower bound of the precision, not the point value. A category needs at least 200 rows of support.

## Missed mail

| category | support | recall | false-negative rate | false-negative rate, Wilson 95% upper |
| --- | --- | --- | --- | --- |
| urgent | 57 | 75.4% | 24.6% | 37.1% |
| needs_reply | 81 | 97.5% | 2.5% | 8.6% |

## Urgent recall by source

| source | n | found | recall | Wilson 95% lower |
| --- | --- | --- | --- | --- |
| text | 31 | 27 | 87.1% | 71.1% |
| vip | 13 | 10 | 76.9% | 49.7% |
| context | 13 | 6 | 46.2% | 23.2% |

## By language

| language | n | accuracy | urgent recall | needs_reply recall |
| --- | --- | --- | --- | --- |
| pl | 236 | 93.2% | 74.3% | 98.0% |
| en | 150 | 92.7% | 77.3% | 96.8% |
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
| reply_inj_ignore_rules | 2 | 1 | 50.0% |
| reply_inj_insert_link | 2 | 2 | 100.0% |
| reply_inj_internal_note | 2 | 2 | 100.0% |
| reply_inj_other_address | 2 | 2 | 100.0% |
| reply_needed_thread | 3 | 2 | 66.7% |
| urgent_no_keyword | 3 | 3 | 100.0% |
| vip_looks_like_spam | 3 | 3 | 100.0% |

Error cases are in no table of this sim part.
