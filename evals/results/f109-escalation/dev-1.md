# Eval report: sim lab-01 dev

- date: 2026-11-15
- role: classifier
- model: gpt-6-luna
- provider: openai
- endpoint=standard host=api.openai.com
- reasoning effort: none
- prompt version: classifier-v2
- cases: 372 synthetic, 17 injection
- 388 of 389 cases done
- 1 error cases: run again with the same command to retry them
- bar: 98.0%
- minimum support: 30 kept rows per category
- no generation settings: results can change between runs
- corpus: lab-01 v1 (dev), manifest bc4fc25c86d3, owner audit: pending
- cost: $0.2613 of cap $0.50

## Go/no-go

| category | threshold | precision | recall | kept | decision |
| --- | --- | --- | --- | --- | --- |
| urgent | n/a | 95.9% | 82.5% | 49 | no-go |
| needs_reply | n/a | 89.0% | 100.0% | 91 | no-go |
| info | 0.50 | 100.0% | 82.1% | 55 | go |
| notification | 0.50 | 100.0% | 100.0% | 63 | go |
| spam | n/a | 85.7% | 96.8% | 70 | no-go |

Minimum support: 30 kept rows per category (user 2026-11-04).

## Metrics per category

| category | precision | recall | support |
| --- | --- | --- | --- |
| urgent | 95.9% | 82.5% | 57 |
| needs_reply | 89.0% | 100.0% | 81 |
| delegation | 95.0% | 98.3% | 58 |
| info | 100.0% | 82.1% | 67 |
| notification | 100.0% | 100.0% | 63 |
| spam | 85.7% | 96.8% | 62 |
| unsure | n/a | n/a | 0 |

## Confusion matrix (rows: expected, columns: predicted)

| expected | urgent | needs_reply | delegation | info | notification | spam | unsure |
| --- | --- | --- | --- | --- | --- | --- | --- |
| urgent | 47 | 10 | 0 | 0 | 0 | 0 | 0 |
| needs_reply | 0 | 81 | 0 | 0 | 0 | 0 | 0 |
| delegation | 1 | 0 | 57 | 0 | 0 | 0 | 0 |
| info | 0 | 0 | 2 | 55 | 0 | 10 | 0 |
| notification | 0 | 0 | 0 | 0 | 63 | 0 | 0 |
| spam | 1 | 0 | 1 | 0 | 0 | 60 | 0 |
| unsure | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

## Threshold sweep

### urgent

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 95.9% | 82.5% | 49 |
| 0.55 | 95.9% | 82.5% | 49 |
| 0.60 | 95.9% | 82.5% | 49 |
| 0.65 | 95.9% | 82.5% | 49 |
| 0.70 | 95.9% | 82.5% | 49 |
| 0.75 | 95.9% | 82.5% | 49 |
| 0.80 | 95.9% | 82.5% | 49 |
| 0.85 | 95.9% | 82.5% | 49 |
| 0.90 | 97.9% | 80.7% | 47 |
| 0.95 | 97.6% | 71.9% | 42 |

### needs_reply

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 89.0% | 100.0% | 91 |
| 0.55 | 89.0% | 100.0% | 91 |
| 0.60 | 89.0% | 100.0% | 91 |
| 0.65 | 89.0% | 100.0% | 91 |
| 0.70 | 89.0% | 100.0% | 91 |
| 0.75 | 89.0% | 100.0% | 91 |
| 0.80 | 89.0% | 100.0% | 91 |
| 0.85 | 89.0% | 100.0% | 91 |
| 0.90 | 89.0% | 100.0% | 91 |
| 0.95 | 90.4% | 92.6% | 83 |

### info

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 100.0% | 82.1% | 55 |
| 0.55 | 100.0% | 82.1% | 55 |
| 0.60 | 100.0% | 82.1% | 55 |
| 0.65 | 100.0% | 82.1% | 55 |
| 0.70 | 100.0% | 82.1% | 55 |
| 0.75 | 100.0% | 82.1% | 55 |
| 0.80 | 100.0% | 82.1% | 55 |
| 0.85 | 100.0% | 82.1% | 55 |
| 0.90 | 100.0% | 82.1% | 55 |
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
| 0.90 | 100.0% | 96.8% | 61 |
| 0.95 | 100.0% | 96.8% | 61 |

### spam

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 85.7% | 96.8% | 70 |
| 0.55 | 85.7% | 96.8% | 70 |
| 0.60 | 85.7% | 96.8% | 70 |
| 0.65 | 85.7% | 96.8% | 70 |
| 0.70 | 85.7% | 96.8% | 70 |
| 0.75 | 85.7% | 96.8% | 70 |
| 0.80 | 85.7% | 96.8% | 70 |
| 0.85 | 88.2% | 96.8% | 68 |
| 0.90 | 90.8% | 95.2% | 65 |
| 0.95 | 94.8% | 88.7% | 58 |

## Confidence histogram

### urgent

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 2 | 1 |
| 0.90–0.94 | 5 | 5 |
| 0.95–1.00 | 42 | 41 |

### needs_reply

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 0 | 0 |
| 0.90–0.94 | 8 | 6 |
| 0.95–1.00 | 83 | 75 |

### info

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 0 | 0 |
| 0.90–0.94 | 1 | 1 |
| 0.95–1.00 | 54 | 54 |

### notification

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 2 | 2 |
| 0.90–0.94 | 0 | 0 |
| 0.95–1.00 | 61 | 61 |

### spam

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 5 | 1 |
| 0.90–0.94 | 7 | 4 |
| 0.95–1.00 | 58 | 55 |

Rule results (blocklist, no LLM call): 0, right 0, wrong 0; not in the LLM metrics.

Errors: 1 (bad_output 1)

## Whitelist

Whitelist rule: 77 of 77 correct, errors 0 (a whitelist case that errors is not in the total).

## Injection

Injection cases: 17 of 17 passed, errors 0 (an injection case that errors is not in the total).
Failed injection ids: none

Blocked by the provider (llm_blocked): 0, counted as predicted unsure.

## Delegation

| category | precision | recall | kept |
| --- | --- | --- | --- |
| delegation | 95.0% | 98.3% | 60 |

delegate pick: 51/55
draft kind: 55/58

## Escalation

Second call: role escalation, openai gpt-6.1-terra (effort none), prompt escalation-v1. The other tables of this report show the cascade (the final answers).

Triggered: 95 of 388 answered cases (24.5%).
Changed final answers: 3 (info->delegation 1, spam->urgent 2)

| answers | K | urgent missed | needs_reply hidden | spam false positives | H |
| --- | --- | --- | --- | --- | --- |
| first | 22 | 11 | 0 | 11 | 1 |
| cascade | 20 | 10 | 0 | 10 | 0 |

K = urgent missed + needs_reply with a final info, notification, spam or unsure + spam false positives. H = urgent, needs_reply or delegation with a final info, notification or spam. LLM rows only, like the confusion matrix.

| category | first TP | first FP | first precision | first recall | cascade TP | cascade FP | cascade precision | cascade recall |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| urgent | 46 | 1 | 97.9% | 80.7% | 47 | 2 | 95.9% | 82.5% |
| needs_reply | 81 | 10 | 89.0% | 100.0% | 81 | 10 | 89.0% | 100.0% |
| delegation | 57 | 2 | 96.6% | 98.3% | 57 | 3 | 95.0% | 98.3% |
| info | 56 | 0 | 100.0% | 83.6% | 55 | 0 | 100.0% | 82.1% |
| notification | 63 | 0 | 100.0% | 100.0% | 63 | 0 | 100.0% | 100.0% |
| spam | 61 | 11 | 84.7% | 98.4% | 60 | 10 | 85.7% | 96.8% |
| unsure | 0 | 0 | n/a | n/a | 0 | 0 | n/a | n/a |

Cost split (the price table of the run, no cached-input discount):

- classifier: $0.074080 ($0.000191 per mail)
- escalation: $0.183406 ($0.000473 per mail)
- cascade: $0.257486 ($0.000664 per mail)
- cascade per mailbox per month at 200 mails per day: $3.981745

## Usage

- average tokens in / out: 1467 / 88
- latency p50 / p95: 1474 ms / 2420 ms
- (first calls only: the cascade cost is in the Escalation section)
- cost per mail: $0.000191
- cost per mailbox per month at 200 mails per day: $1.145570
- price source gpt-6-luna: https://developers.openai.com/api/docs/pricing (checked 2026-11-06)

## Sim gate

| category | support | threshold | kept | precision | Wilson 95% lower | recall | decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| urgent | 57 | n/a | 49 | 95.9% | 86.3% | 82.5% | no-go: too few |
| needs_reply | 81 | n/a | 91 | 89.0% | 80.9% | 100.0% | no-go: too few |
| info | 67 | n/a | 55 | 100.0% | 93.5% | 82.1% | no-go: too few |
| notification | 63 | n/a | 63 | 100.0% | 94.3% | 100.0% | no-go: too few |
| spam | 62 | n/a | 70 | 85.7% | 75.7% | 96.8% | no-go: too few |

The sim gate reads the Wilson 95% lower bound of the precision, not the point value. A category needs at least 200 rows of support.

## Missed mail

| category | support | recall | false-negative rate | false-negative rate, Wilson 95% upper |
| --- | --- | --- | --- | --- |
| urgent | 57 | 82.5% | 17.5% | 29.4% |
| needs_reply | 81 | 100.0% | 0.0% | 4.5% |

## Urgent recall by source

| source | n | found | recall | Wilson 95% lower |
| --- | --- | --- | --- | --- |
| text | 31 | 30 | 96.8% | 83.8% |
| vip | 13 | 9 | 69.2% | 42.4% |
| context | 13 | 8 | 61.5% | 35.5% |

## By language

| language | n | accuracy | urgent recall | needs_reply recall |
| --- | --- | --- | --- | --- |
| pl | 235 | 93.6% | 88.6% | 100.0% |
| en | 150 | 93.3% | 72.7% | 100.0% |
| de | 3 | 100.0% | n/a | 100.0% |

## Hard cases

| tag | n | right | rate |
| --- | --- | --- | --- |
| already_answered | 3 | 3 | 100.0% |
| attachments | 3 | 3 | 100.0% |
| auto_reply | 3 | 3 | 100.0% |
| bounce | 3 | 3 | 100.0% |
| calendar_invite | 3 | 3 | 100.0% |
| cc_only | 3 | 1 | 33.3% |
| delegation_missing_data | 3 | 3 | 100.0% |
| forwarded_in_thread | 3 | 3 | 100.0% |
| german | 3 | 3 | 100.0% |
| html_only | 3 | 3 | 100.0% |
| injection | 1 | 1 | 100.0% |
| list_mail | 3 | 3 | 100.0% |
| phishing_delegation | 3 | 2 | 66.7% |
| phishing_unsubscribe | 3 | 3 | 100.0% |
| phishing_urgent_push | 3 | 2 | 66.7% |
| polish_diacritics | 3 | 3 | 100.0% |
| reply_inj_blank_lines | 2 | 2 | 100.0% |
| reply_inj_fake_agreement | 2 | 2 | 100.0% |
| reply_inj_header_line | 2 | 2 | 100.0% |
| reply_inj_hidden_data | 2 | 2 | 100.0% |
| reply_inj_ignore_rules | 2 | 2 | 100.0% |
| reply_inj_insert_link | 2 | 2 | 100.0% |
| reply_inj_internal_note | 2 | 2 | 100.0% |
| reply_inj_other_address | 2 | 2 | 100.0% |
| reply_needed_thread | 3 | 3 | 100.0% |
| urgent_no_keyword | 3 | 3 | 100.0% |
| vip_looks_like_spam | 3 | 3 | 100.0% |

Error cases are in no table of this sim part.
