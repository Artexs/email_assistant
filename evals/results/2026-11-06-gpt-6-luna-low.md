# Eval report: all set

- date: 2026-11-06
- model: gpt-6-luna
- provider: openai
- reasoning effort: low
- prompt version: classifier-v1
- cases: 80 synthetic, 12 injection
- 92 of 92 cases done
- bar: 98.0%
- minimum support: 30 kept rows per category
- no generation settings: results can change between runs

## Go/no-go

| category | threshold | precision | recall | kept | decision |
| --- | --- | --- | --- | --- | --- |
| urgent | n/a | 100.0% | 100.0% | 16 | no-go: too few |
| needs_reply | n/a | 94.7% | 94.7% | 19 | no-go: too few |
| info | n/a | 69.2% | 56.3% | 13 | no-go: too few |
| notification | n/a | 93.3% | 82.4% | 15 | no-go: too few |
| spam | n/a | 69.6% | 88.9% | 23 | no-go: too few |

Minimum support: 30 kept rows per category (user 2026-11-04).

## Metrics per category

| category | precision | recall | support |
| --- | --- | --- | --- |
| urgent | 100.0% | 100.0% | 16 |
| needs_reply | 94.7% | 94.7% | 19 |
| delegation | n/a | n/a | 0 |
| info | 69.2% | 56.3% | 16 |
| notification | 93.3% | 82.4% | 17 |
| spam | 69.6% | 88.9% | 18 |
| unsure | n/a | n/a | 0 |

## Confusion matrix (rows: expected, columns: predicted)

| expected | urgent | needs_reply | delegation | info | notification | spam | unsure |
| --- | --- | --- | --- | --- | --- | --- | --- |
| urgent | 16 | 0 | 0 | 0 | 0 | 0 | 0 |
| needs_reply | 0 | 18 | 0 | 0 | 0 | 1 | 0 |
| delegation | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| info | 0 | 0 | 0 | 9 | 1 | 6 | 0 |
| notification | 0 | 1 | 0 | 2 | 14 | 0 | 0 |
| spam | 0 | 0 | 0 | 2 | 0 | 16 | 0 |
| unsure | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

## Threshold sweep

### urgent

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 100.0% | 100.0% | 16 |
| 0.55 | 100.0% | 100.0% | 16 |
| 0.60 | 100.0% | 100.0% | 16 |
| 0.65 | 100.0% | 100.0% | 16 |
| 0.70 | 100.0% | 100.0% | 16 |
| 0.75 | 100.0% | 100.0% | 16 |
| 0.80 | 100.0% | 100.0% | 16 |
| 0.85 | 100.0% | 100.0% | 16 |
| 0.90 | 100.0% | 100.0% | 16 |
| 0.95 | 100.0% | 81.3% | 13 |

### needs_reply

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 94.7% | 94.7% | 19 |
| 0.55 | 94.7% | 94.7% | 19 |
| 0.60 | 94.7% | 94.7% | 19 |
| 0.65 | 94.7% | 94.7% | 19 |
| 0.70 | 94.7% | 94.7% | 19 |
| 0.75 | 94.7% | 94.7% | 19 |
| 0.80 | 94.7% | 94.7% | 19 |
| 0.85 | 94.7% | 94.7% | 19 |
| 0.90 | 94.4% | 89.5% | 18 |
| 0.95 | 94.4% | 89.5% | 18 |

### info

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 69.2% | 56.3% | 13 |
| 0.55 | 69.2% | 56.3% | 13 |
| 0.60 | 69.2% | 56.3% | 13 |
| 0.65 | 69.2% | 56.3% | 13 |
| 0.70 | 69.2% | 56.3% | 13 |
| 0.75 | 69.2% | 56.3% | 13 |
| 0.80 | 69.2% | 56.3% | 13 |
| 0.85 | 69.2% | 56.3% | 13 |
| 0.90 | 69.2% | 56.3% | 13 |
| 0.95 | 80.0% | 50.0% | 10 |

### notification

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 93.3% | 82.4% | 15 |
| 0.55 | 93.3% | 82.4% | 15 |
| 0.60 | 93.3% | 82.4% | 15 |
| 0.65 | 93.3% | 82.4% | 15 |
| 0.70 | 93.3% | 82.4% | 15 |
| 0.75 | 93.3% | 82.4% | 15 |
| 0.80 | 93.3% | 82.4% | 15 |
| 0.85 | 93.3% | 82.4% | 15 |
| 0.90 | 92.3% | 70.6% | 13 |
| 0.95 | 91.7% | 64.7% | 12 |

### spam

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 69.6% | 88.9% | 23 |
| 0.55 | 69.6% | 88.9% | 23 |
| 0.60 | 69.6% | 88.9% | 23 |
| 0.65 | 69.6% | 88.9% | 23 |
| 0.70 | 69.6% | 88.9% | 23 |
| 0.75 | 69.6% | 88.9% | 23 |
| 0.80 | 69.6% | 88.9% | 23 |
| 0.85 | 72.7% | 88.9% | 22 |
| 0.90 | 70.0% | 77.8% | 20 |
| 0.95 | 86.7% | 72.2% | 15 |

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
| 0.95–1.00 | 13 | 13 |

### needs_reply

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 1 | 1 |
| 0.90–0.94 | 0 | 0 |
| 0.95–1.00 | 18 | 17 |

### info

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 0 | 0 |
| 0.90–0.94 | 3 | 1 |
| 0.95–1.00 | 10 | 8 |

### notification

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 2 | 2 |
| 0.90–0.94 | 1 | 1 |
| 0.95–1.00 | 12 | 11 |

### spam

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 3 | 2 |
| 0.90–0.94 | 5 | 1 |
| 0.95–1.00 | 15 | 13 |

Rule results (blocklist, no LLM call): 6, right 6, wrong 0; not in the LLM metrics.

Errors: 0

## Whitelist

Whitelist rule: 12 of 12 correct, errors 0 (a whitelist case that errors is not in the total).

## Injection

Injection cases: 12 of 12 passed, errors 0 (an injection case that errors is not in the total).
Failed injection ids: none

Blocked by the provider (llm_blocked): 0, counted as predicted unsure.

## Usage

- average tokens in / out: 773 / 79
- latency p50 / p95: 1366 ms / 2133 ms
- cost per mail: $0.000117
- cost per mailbox per month at 200 mails per day: $0.701540
- price source gpt-6-luna: https://developers.openai.com/api/docs/pricing (checked 2026-11-06)
