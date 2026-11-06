# Eval report: all set

- date: 2026-11-06
- model: gpt-6-luna
- provider: openai
- reasoning effort: none
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
| needs_reply | n/a | 95.0% | 100.0% | 20 | no-go: too few |
| info | n/a | 69.2% | 56.3% | 13 | no-go: too few |
| notification | n/a | 87.5% | 82.4% | 16 | no-go: too few |
| spam | n/a | 76.2% | 88.9% | 21 | no-go: too few |

Minimum support: 30 kept rows per category (user 2026-11-04).

## Metrics per category

| category | precision | recall | support |
| --- | --- | --- | --- |
| urgent | 100.0% | 100.0% | 16 |
| needs_reply | 95.0% | 100.0% | 19 |
| delegation | n/a | n/a | 0 |
| info | 75.0% | 56.3% | 16 |
| notification | 93.3% | 82.4% | 17 |
| spam | 76.2% | 88.9% | 18 |
| unsure | n/a | n/a | 0 |

## Confusion matrix (rows: expected, columns: predicted)

| expected | urgent | needs_reply | delegation | info | notification | spam | unsure |
| --- | --- | --- | --- | --- | --- | --- | --- |
| urgent | 16 | 0 | 0 | 0 | 0 | 0 | 0 |
| needs_reply | 0 | 19 | 0 | 0 | 0 | 0 | 0 |
| delegation | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| info | 0 | 0 | 0 | 9 | 1 | 5 | 1 |
| notification | 0 | 1 | 0 | 2 | 14 | 0 | 0 |
| spam | 0 | 0 | 0 | 1 | 0 | 16 | 1 |
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
| 0.85 | 100.0% | 93.8% | 15 |
| 0.90 | 100.0% | 93.8% | 15 |
| 0.95 | 100.0% | 81.3% | 13 |

### needs_reply

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 95.0% | 100.0% | 20 |
| 0.55 | 95.0% | 100.0% | 20 |
| 0.60 | 95.0% | 100.0% | 20 |
| 0.65 | 95.0% | 100.0% | 20 |
| 0.70 | 95.0% | 100.0% | 20 |
| 0.75 | 95.0% | 100.0% | 20 |
| 0.80 | 95.0% | 100.0% | 20 |
| 0.85 | 95.0% | 100.0% | 20 |
| 0.90 | 95.0% | 100.0% | 20 |
| 0.95 | 94.4% | 89.5% | 18 |

### info

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 69.2% | 56.3% | 13 |
| 0.55 | 69.2% | 56.3% | 13 |
| 0.60 | 69.2% | 56.3% | 13 |
| 0.65 | 69.2% | 56.3% | 13 |
| 0.70 | 75.0% | 56.3% | 12 |
| 0.75 | 81.8% | 56.3% | 11 |
| 0.80 | 81.8% | 56.3% | 11 |
| 0.85 | 81.8% | 56.3% | 11 |
| 0.90 | 81.8% | 56.3% | 11 |
| 0.95 | 90.0% | 56.3% | 10 |

### notification

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 87.5% | 82.4% | 16 |
| 0.55 | 87.5% | 82.4% | 16 |
| 0.60 | 93.3% | 82.4% | 15 |
| 0.65 | 93.3% | 82.4% | 15 |
| 0.70 | 93.3% | 82.4% | 15 |
| 0.75 | 93.3% | 82.4% | 15 |
| 0.80 | 93.3% | 82.4% | 15 |
| 0.85 | 93.3% | 82.4% | 15 |
| 0.90 | 93.3% | 82.4% | 15 |
| 0.95 | 91.7% | 64.7% | 12 |

### spam

| threshold | precision | recall | kept |
| --- | --- | --- | --- |
| 0.50 | 76.2% | 88.9% | 21 |
| 0.55 | 76.2% | 88.9% | 21 |
| 0.60 | 76.2% | 88.9% | 21 |
| 0.65 | 76.2% | 88.9% | 21 |
| 0.70 | 76.2% | 88.9% | 21 |
| 0.75 | 76.2% | 88.9% | 21 |
| 0.80 | 80.0% | 88.9% | 20 |
| 0.85 | 80.0% | 88.9% | 20 |
| 0.90 | 78.9% | 83.3% | 19 |
| 0.95 | 82.4% | 77.8% | 17 |

## Confidence histogram

### urgent

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 1 | 1 |
| 0.90–0.94 | 2 | 2 |
| 0.95–1.00 | 13 | 13 |

### needs_reply

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 0 | 0 |
| 0.90–0.94 | 2 | 2 |
| 0.95–1.00 | 18 | 17 |

### info

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 1 | 0 |
| 0.70–0.79 | 1 | 0 |
| 0.80–0.89 | 0 | 0 |
| 0.90–0.94 | 1 | 0 |
| 0.95–1.00 | 10 | 9 |

### notification

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 1 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 0 | 0 |
| 0.80–0.89 | 0 | 0 |
| 0.90–0.94 | 3 | 3 |
| 0.95–1.00 | 12 | 11 |

### spam

| bucket | total | correct |
| --- | --- | --- |
| 0.00–0.49 | 0 | 0 |
| 0.50–0.59 | 0 | 0 |
| 0.60–0.69 | 0 | 0 |
| 0.70–0.79 | 1 | 0 |
| 0.80–0.89 | 1 | 1 |
| 0.90–0.94 | 2 | 1 |
| 0.95–1.00 | 17 | 14 |

Rule results (blocklist, no LLM call): 6, right 6, wrong 0; not in the LLM metrics.

Errors: 0

## Whitelist

Whitelist rule: 12 of 12 correct, errors 0 (a whitelist case that errors is not in the total).

## Injection

Injection cases: 12 of 12 passed, errors 0 (an injection case that errors is not in the total).
Failed injection ids: none

Blocked by the provider (llm_blocked): 0, counted as predicted unsure.

## Usage

- average tokens in / out: 774 / 61
- latency p50 / p95: 1386 ms / 1911 ms
- cost per mail: $0.000108
- cost per mailbox per month at 200 mails per day: $0.648516
- price source gpt-6-luna: https://developers.openai.com/api/docs/pricing (checked 2026-11-06)
