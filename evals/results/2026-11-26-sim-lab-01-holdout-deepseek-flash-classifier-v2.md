# Eval report: sim lab-01 holdout

- date: 2026-11-26
- role: classifier
- model: deepseek-flash
- provider: deepseek
- endpoint=standard host=api.deepseek.com
- reasoning effort: none
- prompt version: classifier-v2
- cases: 1382 synthetic, 31 injection
- 1409 of 1413 cases done
- 4 error cases: run again with the same command to retry them
- bar: 98.0%
- minimum support: 30 kept rows per category
- no generation settings: results can change between runs
- corpus: lab-01 v1 (holdout), manifest bc4fc25c86d3, owner audit: pending
- cost: $0.9036 of cap $2.00

## Go/no-go

| category | threshold | precision | recall | kept | decision |
| --- | --- | --- | --- | --- | --- |
| urgent | 0.50 | 100.0% | 66.4% | 146 | go |
| needs_reply | n/a | 78.5% | 84.6% | 279 | no-go |
| info | 0.50 | 99.0% | 85.1% | 208 | go |
| notification | 0.50 | 100.0% | 97.9% | 229 | go |
| spam | 0.85 | 100.0% | 77.8% | 182 | go |

Minimum support: 30 kept rows per category (user 2026-11-04).

## Metrics per category

| category | precision | recall | support |
| --- | --- | --- | --- |
| urgent | 100.0% | 66.4% | 220 |
| needs_reply | 79.0% | 84.2% | 259 |
| delegation | 79.7% | 100.0% | 220 |
| info | 99.5% | 85.1% | 242 |
| notification | 100.0% | 97.4% | 234 |
| spam | 90.9% | 98.3% | 234 |
| unsure | n/a | n/a | 0 |

## Confusion matrix (rows: expected, columns: predicted)

| expected | urgent | needs_reply | delegation | info | notification | spam | unsure |
| --- | --- | --- | --- | --- | --- | --- | --- |
| urgent | 146 | 55 | 15 | 0 | 0 | 0 | 4 |
| needs_reply | 0 | 218 | 33 | 0 | 0 | 0 | 8 |
| delegation | 0 | 0 | 220 | 0 | 0 | 0 | 0 |
| info | 0 | 2 | 4 | 206 | 0 | 23 | 7 |
| notification | 0 | 1 | 1 | 1 | 228 | 0 | 3 |
| spam | 0 | 0 | 3 | 0 | 0 | 230 | 1 |
| unsure | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

## Threshold sweep

### urgent

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 100.0% | 66.4% | 146 |
| 0.55 | 100.0% | 66.4% | 146 |
| 0.60 | 100.0% | 66.4% | 146 |
| 0.65 | 100.0% | 66.4% | 146 |
| 0.70 | 100.0% | 66.4% | 146 |
| 0.75 | 100.0% | 66.4% | 146 |
| 0.80 | 100.0% | 64.1% | 141 |
| 0.85 | 100.0% | 60.9% | 134 |
| 0.90 | 100.0% | 51.8% | 114 |
| 0.95 | 100.0% | 15.9% | 35 |

### needs_reply

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 78.5% | 84.6% | 279 |
| 0.55 | 78.5% | 84.6% | 279 |
| 0.60 | 78.4% | 84.2% | 278 |
| 0.65 | 78.7% | 84.2% | 277 |
| 0.70 | 79.0% | 84.2% | 276 |
| 0.75 | 79.2% | 80.7% | 264 |
| 0.80 | 79.1% | 77.2% | 253 |
| 0.85 | 80.0% | 66.4% | 215 |
| 0.90 | 80.4% | 45.9% | 148 |
| 0.95 | 63.6% | 2.7% | 11 |

### info

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 99.0% | 85.1% | 208 |
| 0.55 | 99.0% | 85.1% | 208 |
| 0.60 | 99.0% | 85.1% | 208 |
| 0.65 | 99.5% | 85.1% | 207 |
| 0.70 | 99.5% | 85.1% | 207 |
| 0.75 | 99.5% | 85.1% | 207 |
| 0.80 | 99.5% | 84.3% | 205 |
| 0.85 | 99.5% | 83.9% | 204 |
| 0.90 | 100.0% | 81.4% | 197 |
| 0.95 | 100.0% | 42.6% | 103 |

### notification

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 100.0% | 97.9% | 229 |
| 0.55 | 100.0% | 97.9% | 229 |
| 0.60 | 100.0% | 97.4% | 228 |
| 0.65 | 100.0% | 97.4% | 228 |
| 0.70 | 100.0% | 97.4% | 228 |
| 0.75 | 100.0% | 97.4% | 228 |
| 0.80 | 100.0% | 97.4% | 228 |
| 0.85 | 100.0% | 96.2% | 225 |
| 0.90 | 100.0% | 93.6% | 219 |
| 0.95 | 100.0% | 72.2% | 169 |

### spam

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 89.1% | 98.3% | 258 |
| 0.55 | 89.1% | 98.3% | 258 |
| 0.60 | 89.5% | 98.3% | 257 |
| 0.65 | 90.9% | 98.3% | 253 |
| 0.70 | 90.9% | 98.3% | 253 |
| 0.75 | 95.0% | 98.3% | 242 |
| 0.80 | 96.6% | 95.7% | 232 |
| 0.85 | 100.0% | 77.8% | 182 |
| 0.90 | 100.0% | 66.7% | 156 |
| 0.95 | 100.0% | 38.9% | 91 |

## Confidence histogram

### urgent

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 5 | 5 |
| 0.80–0.89 | 27 | 27 |
| 0.90–0.94 | 79 | 79 |
| 0.95–1.00 | 35 | 35 |

### needs_reply

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 2 | 1 |
| 0.50–0.59 | 1 | 1 |
| 0.60–0.69 | 2 | 0 |
| 0.70–0.79 | 23 | 18 |
| 0.80–0.89 | 105 | 81 |
| 0.90–0.94 | 137 | 112 |
| 0.95–1.00 | 11 | 7 |

### info

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 1 | 0 |
| 0.70–0.79 | 2 | 2 |
| 0.80–0.89 | 8 | 7 |
| 0.90–0.94 | 94 | 94 |
| 0.95–1.00 | 103 | 103 |

### notification

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 1 | 1 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 9 | 9 |
| 0.90–0.94 | 50 | 50 |
| 0.95–1.00 | 169 | 169 |

### spam

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 1 | 0 |
| 0.60–0.69 | 4 | 0 |
| 0.70–0.79 | 21 | 6 |
| 0.80–0.89 | 76 | 68 |
| 0.90–0.94 | 65 | 65 |
| 0.95–1.00 | 91 | 91 |

Rule results (blocklist, no LLM call): 0, right 0, wrong 0; not in the LLM metrics.

Errors: 4 (bad_output 4)

## Whitelist

Whitelist rule: 313 of 313 correct, errors 2 (a whitelist case that errors is not in the total).

## Injection

Injection cases: 27 of 31 passed, errors 0 (an injection case that errors is not in the total).
Failed injection cases: 4

Blocked by the provider (llm_blocked): 0, counted as predicted unsure.

## Delegation

| category | precision | recall | kept |
| --- | --- | --- | --- |
| delegation | 79.7% | 100.0% | 287 |

delegate pick: 207/213
draft kind: 216/220

## Usage

- average tokens in / out: 1695 / 108
- latency p50 / p95: 1175 ms / 1617 ms
- cost per mail: $0.000639
- cost per mailbox per month at 200 mails per day: $3.831540
- price source deepseek-flash: https://api-docs.deepseek.com/quick_start/pricing (checked 2026-11-19)

## Sim gate

| category | support | threshold | kept | precision | Wilson 95% lower | recall | decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| urgent | 220 | n/a | 146 | 100.0% | 97.4% | 66.4% | no-go |
| needs_reply | 259 | n/a | 279 | 78.5% | 73.3% | 84.6% | no-go |
| info | 242 | 0.90 | 197 | 100.0% | 98.1% | 81.4% | go |
| notification | 234 | 0.50 | 229 | 100.0% | 98.4% | 97.9% | go |
| spam | 234 | n/a | 258 | 89.1% | 84.8% | 98.3% | no-go |

The sim gate reads the Wilson 95% lower bound of the precision, not the point value. A category needs at least 200 rows of support.

## Missed mail

| category | support | recall | false-negative rate | false-negative rate, Wilson 95% upper |
| --- | --- | --- | --- | --- |
| urgent | 220 | 66.4% | 33.6% | 40.1% |
| needs_reply | 259 | 84.2% | 15.8% | 20.8% |

## Urgent recall by source

| source | n | found | recall | Wilson 95% lower |
| --- | --- | --- | --- | --- |
| text | 113 | 73 | 64.6% | 55.4% |
| vip | 54 | 43 | 79.6% | 67.1% |
| context | 53 | 30 | 56.6% | 43.3% |

## By language

| language | n | accuracy | urgent recall | needs_reply recall |
| --- | --- | --- | --- | --- |
| pl | 843 | 89.0% | 72.9% | 82.1% |
| en | 561 | 87.9% | 56.3% | 87.1% |
| de | 5 | 100.0% | n/a | 100.0% |

## Hard cases

| tag | n | right | rate |
| --- | --- | --- | --- |
| already_answered | 7 | 7 | 100.0% |
| attachments | 7 | 7 | 100.0% |
| auto_reply | 7 | 7 | 100.0% |
| bounce | 7 | 5 | 71.4% |
| calendar_invite | 7 | 5 | 71.4% |
| cc_only | 7 | 1 | 14.3% |
| delegation_missing_data | 7 | 7 | 100.0% |
| forwarded_in_thread | 7 | 7 | 100.0% |
| german | 5 | 5 | 100.0% |
| html_only | 7 | 7 | 100.0% |
| injection | 7 | 6 | 85.7% |
| list_mail | 7 | 7 | 100.0% |
| phishing_delegation | 7 | 4 | 57.1% |
| phishing_unsubscribe | 7 | 7 | 100.0% |
| phishing_urgent_push | 7 | 7 | 100.0% |
| polish_diacritics | 7 | 6 | 85.7% |
| reply_inj_blank_lines | 3 | 1 | 33.3% |
| reply_inj_fake_agreement | 3 | 2 | 66.7% |
| reply_inj_header_line | 3 | 2 | 66.7% |
| reply_inj_hidden_data | 3 | 2 | 66.7% |
| reply_inj_ignore_rules | 3 | 3 | 100.0% |
| reply_inj_insert_link | 3 | 0 | 0.0% |
| reply_inj_internal_note | 3 | 3 | 100.0% |
| reply_inj_other_address | 3 | 3 | 100.0% |
| reply_needed_thread | 7 | 5 | 71.4% |
| urgent_no_keyword | 7 | 5 | 71.4% |
| vip_looks_like_spam | 7 | 7 | 100.0% |

Error cases are in no table of this sim part.

