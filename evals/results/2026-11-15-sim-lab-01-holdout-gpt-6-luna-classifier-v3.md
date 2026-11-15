# Eval report: sim lab-01 holdout

- date: 2026-11-15
- role: classifier
- model: gpt-6-luna
- provider: openai
- endpoint=standard host=api.openai.com
- reasoning effort: none
- prompt version: classifier-v3[list]
- cases: 1382 synthetic, 31 injection
- 1412 of 1413 cases done
- 1 error cases: run again with the same command to retry them
- bar: 98.0%
- minimum support: 30 kept rows per category
- no generation settings: results can change between runs
- corpus: lab-01 v1 (holdout), manifest bc4fc25c86d3, owner audit: pending
- cost: $0.2797 of cap $0.60

## Go/no-go

| category | threshold | precision | recall | kept | decision |
| --- | --- | --- | --- | --- | --- |
| urgent | n/a | 95.4% | 85.5% | 197 | no-go |
| needs_reply | n/a | 88.9% | 93.1% | 271 | no-go |
| info | 0.50 | 99.6% | 97.9% | 239 | go |
| notification | 0.50 | 100.0% | 98.7% | 231 | go |
| spam | 0.50 | 99.6% | 99.6% | 234 | go |

Minimum support: 30 kept rows per category (user 2026-11-04).

## Metrics per category

| category | precision | recall | support |
| --- | --- | --- | --- |
| urgent | 95.4% | 85.5% | 220 |
| needs_reply | 88.9% | 93.1% | 259 |
| delegation | 92.9% | 100.0% | 222 |
| info | 99.6% | 97.9% | 243 |
| notification | 100.0% | 98.7% | 234 |
| spam | 99.6% | 99.6% | 234 |
| unsure | n/a | n/a | 0 |

## Confusion matrix (rows: expected, columns: predicted)

| expected | urgent | needs_reply | delegation | info | notification | spam | unsure |
| --- | --- | --- | --- | --- | --- | --- | --- |
| urgent | 188 | 28 | 4 | 0 | 0 | 0 | 0 |
| needs_reply | 8 | 241 | 9 | 0 | 0 | 1 | 0 |
| delegation | 0 | 0 | 222 | 0 | 0 | 0 | 0 |
| info | 0 | 2 | 3 | 238 | 0 | 0 | 0 |
| notification | 1 | 0 | 1 | 1 | 231 | 0 | 0 |
| spam | 0 | 0 | 0 | 0 | 0 | 233 | 1 |
| unsure | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

## Threshold sweep

### urgent

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 95.4% | 85.5% | 197 |
| 0.55 | 95.4% | 85.5% | 197 |
| 0.60 | 95.4% | 85.5% | 197 |
| 0.65 | 95.4% | 85.5% | 197 |
| 0.70 | 95.4% | 85.5% | 197 |
| 0.75 | 95.4% | 85.5% | 197 |
| 0.80 | 95.4% | 85.5% | 197 |
| 0.85 | 95.4% | 85.5% | 197 |
| 0.90 | 95.9% | 85.0% | 195 |
| 0.95 | 95.7% | 80.9% | 186 |

### needs_reply

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 88.9% | 93.1% | 271 |
| 0.55 | 88.9% | 93.1% | 271 |
| 0.60 | 88.9% | 93.1% | 271 |
| 0.65 | 88.9% | 93.1% | 271 |
| 0.70 | 88.9% | 93.1% | 271 |
| 0.75 | 88.9% | 93.1% | 271 |
| 0.80 | 88.9% | 93.1% | 271 |
| 0.85 | 88.9% | 93.1% | 271 |
| 0.90 | 89.6% | 92.7% | 268 |
| 0.95 | 93.0% | 87.3% | 243 |

### info

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 99.6% | 97.9% | 239 |
| 0.55 | 99.6% | 97.9% | 239 |
| 0.60 | 99.6% | 97.9% | 239 |
| 0.65 | 99.6% | 97.9% | 239 |
| 0.70 | 99.6% | 97.9% | 239 |
| 0.75 | 99.6% | 97.9% | 239 |
| 0.80 | 99.6% | 97.9% | 239 |
| 0.85 | 99.6% | 97.9% | 239 |
| 0.90 | 99.6% | 97.5% | 238 |
| 0.95 | 99.6% | 95.5% | 233 |

### notification

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 100.0% | 98.7% | 231 |
| 0.55 | 100.0% | 98.7% | 231 |
| 0.60 | 100.0% | 98.7% | 231 |
| 0.65 | 100.0% | 98.7% | 231 |
| 0.70 | 100.0% | 98.7% | 231 |
| 0.75 | 100.0% | 98.7% | 231 |
| 0.80 | 100.0% | 98.7% | 231 |
| 0.85 | 100.0% | 98.7% | 231 |
| 0.90 | 100.0% | 98.7% | 231 |
| 0.95 | 100.0% | 98.3% | 230 |

### spam

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 99.6% | 99.6% | 234 |
| 0.55 | 99.6% | 99.6% | 234 |
| 0.60 | 99.6% | 99.6% | 234 |
| 0.65 | 99.6% | 99.6% | 234 |
| 0.70 | 99.6% | 99.6% | 234 |
| 0.75 | 99.6% | 99.6% | 234 |
| 0.80 | 99.6% | 99.6% | 234 |
| 0.85 | 99.6% | 99.1% | 233 |
| 0.90 | 100.0% | 98.3% | 230 |
| 0.95 | 100.0% | 94.0% | 220 |

## Confidence histogram

### urgent

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 2 | 1 |
| 0.90–0.94 | 9 | 9 |
| 0.95–1.00 | 186 | 178 |

### needs_reply

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 3 | 1 |
| 0.90–0.94 | 25 | 14 |
| 0.95–1.00 | 243 | 226 |

### info

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 1 | 1 |
| 0.90–0.94 | 5 | 5 |
| 0.95–1.00 | 233 | 232 |

### notification

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 0 | 0 |
| 0.90–0.94 | 1 | 1 |
| 0.95–1.00 | 230 | 230 |

### spam

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 4 | 3 |
| 0.90–0.94 | 10 | 10 |
| 0.95–1.00 | 220 | 220 |

Rule results (blocklist, no LLM call): 0, right 0, wrong 0; not in the LLM metrics.

Errors: 1 (bad_output 1)

## Whitelist

Whitelist rule: 314 of 314 correct, errors 1 (a whitelist case that errors is not in the total).

## Injection

Injection cases: 29 of 30 passed, errors 1 (an injection case that errors is not in the total).
Failed injection cases: 1

Blocked by the provider (llm_blocked): 0, counted as predicted unsure.

## Delegation

| category | precision | recall | kept |
| --- | --- | --- | --- |
| delegation | 92.9% | 100.0% | 240 |

delegate pick: 209/215
draft kind: 217/222

## Usage

- average tokens in / out: 1520 / 92
- latency p50 / p95: 1599 ms / 2421 ms
- cost per mail: $0.000198
- cost per mailbox per month at 200 mails per day: $1.186973
- price source gpt-6-luna: https://developers.openai.com/api/docs/pricing (checked 2026-11-06)

## Sim gate

| category | support | threshold | kept | precision | Wilson 95% lower | recall | decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| urgent | 220 | n/a | 197 | 95.4% | 91.5% | 85.5% | no-go |
| needs_reply | 259 | n/a | 271 | 88.9% | 84.6% | 93.1% | no-go |
| info | 243 | n/a | 239 | 99.6% | 97.7% | 97.9% | no-go |
| notification | 234 | 0.50 | 231 | 100.0% | 98.4% | 98.7% | go |
| spam | 234 | 0.90 | 230 | 100.0% | 98.4% | 98.3% | go |

The sim gate reads the Wilson 95% lower bound of the precision, not the point value. A category needs at least 200 rows of support.

## Missed mail

| category | support | recall | false-negative rate | false-negative rate, Wilson 95% upper |
| --- | --- | --- | --- | --- |
| urgent | 220 | 85.5% | 14.5% | 19.8% |
| needs_reply | 259 | 93.1% | 6.9% | 10.7% |

## Urgent recall by source

| source | n | found | recall | Wilson 95% lower |
| --- | --- | --- | --- | --- |
| text | 113 | 104 | 92.0% | 85.6% |
| vip | 54 | 45 | 83.3% | 71.3% |
| context | 53 | 39 | 73.6% | 60.4% |

## By language

| language | n | accuracy | urgent recall | needs_reply recall |
| --- | --- | --- | --- | --- |
| pl | 844 | 96.3% | 90.2% | 92.9% |
| en | 561 | 95.0% | 78.2% | 93.1% |
| de | 7 | 100.0% | n/a | 100.0% |

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
| german | 7 | 7 | 100.0% |
| html_only | 7 | 7 | 100.0% |
| injection | 7 | 7 | 100.0% |
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
| reply_inj_insert_link | 2 | 2 | 100.0% |
| reply_inj_internal_note | 3 | 3 | 100.0% |
| reply_inj_other_address | 3 | 3 | 100.0% |
| reply_needed_thread | 7 | 7 | 100.0% |
| urgent_no_keyword | 7 | 6 | 85.7% |
| vip_looks_like_spam | 7 | 6 | 85.7% |

Error cases are in no table of this sim part.
