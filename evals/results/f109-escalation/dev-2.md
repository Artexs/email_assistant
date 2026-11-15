# Eval report: sim lab-01 dev

- date: 2026-11-15
- role: classifier
- model: gpt-6-luna
- provider: openai
- endpoint=standard host=api.openai.com
- reasoning effort: none
- prompt version: classifier-v2
- cases: 372 synthetic, 17 injection
- 389 of 389 cases done
- bar: 98.0%
- minimum support: 30 kept rows per category
- no generation settings: results can change between runs
- corpus: lab-01 v1 (dev), manifest bc4fc25c86d3, owner audit: pending
- cost: $0.2558 of cap $0.50

## Go/no-go

| category | threshold | precision | recall | kept | decision |
| --- | --- | --- | --- | --- | --- |
| urgent | 0.95 | 100.0% | 70.2% | 40 | go |
| needs_reply | n/a | 83.2% | 97.5% | 95 | no-go |
| info | 0.50 | 100.0% | 85.1% | 57 | go |
| notification | 0.50 | 100.0% | 100.0% | 63 | go |
| spam | 0.95 | 100.0% | 90.3% | 56 | go |

Minimum support: 30 kept rows per category (user 2026-11-04).

## Metrics per category

| category | precision | recall | support |
| --- | --- | --- | --- |
| urgent | 97.6% | 71.9% | 57 |
| needs_reply | 83.2% | 97.5% | 81 |
| delegation | 93.7% | 100.0% | 59 |
| info | 100.0% | 85.1% | 67 |
| notification | 100.0% | 100.0% | 63 |
| spam | 87.0% | 96.8% | 62 |
| unsure | n/a | n/a | 0 |

## Confusion matrix (rows: expected, columns: predicted)

| expected | urgent | needs_reply | delegation | info | notification | spam | unsure |
| --- | --- | --- | --- | --- | --- | --- | --- |
| urgent | 41 | 16 | 0 | 0 | 0 | 0 | 0 |
| needs_reply | 0 | 79 | 2 | 0 | 0 | 0 | 0 |
| delegation | 0 | 0 | 59 | 0 | 0 | 0 | 0 |
| info | 0 | 0 | 1 | 57 | 0 | 9 | 0 |
| notification | 0 | 0 | 0 | 0 | 63 | 0 | 0 |
| spam | 1 | 0 | 1 | 0 | 0 | 60 | 0 |
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
| 0.95 | 100.0% | 70.2% | 40 |

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
| 0.90 | 82.6% | 93.8% | 92 |
| 0.95 | 88.0% | 90.1% | 83 |

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
| 0.90 | 100.0% | 83.6% | 56 |
| 0.95 | 100.0% | 82.1% | 55 |

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
| 0.90 | 100.0% | 98.4% | 62 |
| 0.95 | 100.0% | 98.4% | 62 |

### spam

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 87.0% | 96.8% | 69 |
| 0.55 | 87.0% | 96.8% | 69 |
| 0.60 | 87.0% | 96.8% | 69 |
| 0.65 | 87.0% | 96.8% | 69 |
| 0.70 | 87.0% | 96.8% | 69 |
| 0.75 | 87.0% | 96.8% | 69 |
| 0.80 | 88.2% | 96.8% | 68 |
| 0.85 | 89.6% | 96.8% | 67 |
| 0.90 | 90.8% | 95.2% | 65 |
| 0.95 | 100.0% | 90.3% | 56 |

## Confidence histogram

### urgent

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 0 | 0 |
| 0.90–0.94 | 2 | 1 |
| 0.95–1.00 | 40 | 40 |

### needs_reply

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 3 | 3 |
| 0.90–0.94 | 9 | 3 |
| 0.95–1.00 | 83 | 73 |

### info

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 1 | 1 |
| 0.90–0.94 | 1 | 1 |
| 0.95–1.00 | 55 | 55 |

### notification

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 1 | 1 |
| 0.90–0.94 | 0 | 0 |
| 0.95–1.00 | 62 | 62 |

### spam

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 1 | 0 |
| 0.80–0.89 | 3 | 1 |
| 0.90–0.94 | 9 | 3 |
| 0.95–1.00 | 56 | 56 |

Rule results (blocklist, no LLM call): 0, right 0, wrong 0; not in the LLM metrics.

Errors: 0

## Whitelist

Whitelist rule: 77 of 77 correct, errors 0 (a whitelist case that errors is not in the total).

## Injection

Injection cases: 15 of 17 passed, errors 0 (an injection case that errors is not in the total).
Failed injection ids: h-rig-04, h-rli-05

Blocked by the provider (llm_blocked): 0, counted as predicted unsure.

## Delegation

| category | precision | recall | kept |
| --- | --- | --- | --- |
| delegation | 93.7% | 100.0% | 63 |

delegate pick: 53/56
draft kind: 58/59

## Escalation

Second call: role escalation, openai gpt-6.1-terra (effort none), prompt escalation-v1. The other tables of this report show the cascade (the final answers).

Triggered: 94 of 389 answered cases (24.2%).
Changed final answers: 1 (spam->urgent 1)

| answers | K | urgent missed | needs_reply hidden | spam false positives | H |
| --- | --- | --- | --- | --- | --- |
| first | 25 | 16 | 0 | 9 | 0 |
| cascade | 25 | 16 | 0 | 9 | 0 |

K = urgent missed + needs_reply with a final info, notification, spam or unsure + spam false positives. H = urgent, needs_reply or delegation with a final info, notification or spam. LLM rows only, like the confusion matrix.

| category | first TP | first FP | first precision | first recall | cascade TP | cascade FP | cascade precision | cascade recall |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| urgent | 41 | 0 | 100.0% | 71.9% | 41 | 1 | 97.6% | 71.9% |
| needs_reply | 79 | 16 | 83.2% | 97.5% | 79 | 16 | 83.2% | 97.5% |
| delegation | 59 | 4 | 93.7% | 100.0% | 59 | 4 | 93.7% | 100.0% |
| info | 57 | 0 | 100.0% | 85.1% | 57 | 0 | 100.0% | 85.1% |
| notification | 63 | 0 | 100.0% | 100.0% | 63 | 0 | 100.0% | 100.0% |
| spam | 61 | 9 | 87.1% | 98.4% | 60 | 9 | 87.0% | 96.8% |
| unsure | 0 | 0 | n/a | n/a | 0 | 0 | n/a | n/a |

Cost split (the price table of the run, no cached-input discount):

- classifier: $0.074445 ($0.000191 per mail)
- escalation: $0.181324 ($0.000466 per mail)
- cascade: $0.255769 ($0.000658 per mail)
- cascade per mailbox per month at 200 mails per day: $3.945019

## Usage

- average tokens in / out: 1468 / 89
- latency p50 / p95: 1462 ms / 2203 ms
- (first calls only: the cascade cost is in the Escalation section)
- cost per mail: $0.000191
- cost per mailbox per month at 200 mails per day: $1.148247
- price source gpt-6-luna: https://developers.openai.com/api/docs/pricing (checked 2026-11-06)

## Sim gate

| category | support | threshold | kept | precision | Wilson 95% lower | recall | decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| urgent | 57 | n/a | 42 | 97.6% | 87.7% | 71.9% | no-go: too few |
| needs_reply | 81 | n/a | 95 | 83.2% | 74.4% | 97.5% | no-go: too few |
| info | 67 | n/a | 57 | 100.0% | 93.7% | 85.1% | no-go: too few |
| notification | 63 | n/a | 63 | 100.0% | 94.3% | 100.0% | no-go: too few |
| spam | 62 | n/a | 69 | 87.0% | 77.0% | 96.8% | no-go: too few |

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
| pl | 236 | 91.9% | 71.4% | 98.0% |
| en | 150 | 92.7% | 72.7% | 96.8% |
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
| phishing_delegation | 3 | 2 | 66.7% |
| phishing_unsubscribe | 3 | 3 | 100.0% |
| phishing_urgent_push | 3 | 2 | 66.7% |
| polish_diacritics | 3 | 3 | 100.0% |
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
