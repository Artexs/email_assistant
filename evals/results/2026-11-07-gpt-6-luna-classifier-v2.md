# Eval report: all set

- date: 2026-11-07
- model: gpt-6-luna
- provider: openai
- reasoning effort: none
- prompt version: classifier-v2
- cases: 92 synthetic, 16 injection
- 108 of 108 cases done
- bar: 98.0%
- minimum support: 30 kept rows per category
- no generation settings: results can change between runs

## Go/no-go

| category     | threshold | precision | recall | kept | decision       |
| ------------ | --------- | --------- | ------ | ---- | -------------- |
| urgent       | n/a       | 100.0%    | 93.8%  | 15   | no-go: too few |
| needs_reply  | n/a       | 95.0%     | 100.0% | 20   | no-go: too few |
| info         | n/a       | 64.3%     | 56.3%  | 14   | no-go: too few |
| notification | n/a       | 87.5%     | 82.4%  | 16   | no-go: too few |
| spam         | n/a       | 76.0%     | 86.4%  | 25   | no-go: too few |

Minimum support: 30 kept rows per category (user 2026-11-04).

## Metrics per category

| category     | precision | recall | support |
| ------------ | --------- | ------ | ------- |
| urgent       | 100.0%    | 93.8%  | 16      |
| needs_reply  | 95.0%     | 100.0% | 19      |
| delegation   | 100.0%    | 100.0% | 12      |
| info         | 69.2%     | 56.3%  | 16      |
| notification | 87.5%     | 82.4%  | 17      |
| spam         | 76.0%     | 86.4%  | 22      |
| unsure       | n/a       | n/a    | 0       |

## Confusion matrix (rows: expected, columns: predicted)

| expected     | urgent | needs_reply | delegation | info | notification | spam | unsure |
| ------------ | ------ | ----------- | ---------- | ---- | ------------ | ---- | ------ |
| urgent       | 15     | 0           | 0          | 1    | 0            | 0    | 0      |
| needs_reply  | 0      | 19          | 0          | 0    | 0            | 0    | 0      |
| delegation   | 0      | 0           | 12         | 0    | 0            | 0    | 0      |
| info         | 0      | 0           | 0          | 9    | 1            | 6    | 0      |
| notification | 0      | 1           | 0          | 2    | 14           | 0    | 0      |
| spam         | 0      | 0           | 0          | 1    | 1            | 19   | 1      |
| unsure       | 0      | 0           | 0          | 0    | 0            | 0    | 0      |

## Threshold sweep

### urgent

| threshold | precision | recall | kept |
| --------- | --------- | ------ | ---- |
| 0.50      | 100.0%    | 93.8%  | 15   |
| 0.55      | 100.0%    | 93.8%  | 15   |
| 0.60      | 100.0%    | 93.8%  | 15   |
| 0.65      | 100.0%    | 93.8%  | 15   |
| 0.70      | 100.0%    | 93.8%  | 15   |
| 0.75      | 100.0%    | 93.8%  | 15   |
| 0.80      | 100.0%    | 93.8%  | 15   |
| 0.85      | 100.0%    | 93.8%  | 15   |
| 0.90      | 100.0%    | 93.8%  | 15   |
| 0.95      | 100.0%    | 87.5%  | 14   |

### needs_reply

| threshold | precision | recall | kept |
| --------- | --------- | ------ | ---- |
| 0.50      | 95.0%     | 100.0% | 20   |
| 0.55      | 95.0%     | 100.0% | 20   |
| 0.60      | 95.0%     | 100.0% | 20   |
| 0.65      | 95.0%     | 100.0% | 20   |
| 0.70      | 95.0%     | 100.0% | 20   |
| 0.75      | 95.0%     | 100.0% | 20   |
| 0.80      | 95.0%     | 100.0% | 20   |
| 0.85      | 95.0%     | 100.0% | 20   |
| 0.90      | 95.0%     | 100.0% | 20   |
| 0.95      | 94.4%     | 89.5%  | 18   |

### info

| threshold | precision | recall | kept |
| --------- | --------- | ------ | ---- |
| 0.50      | 64.3%     | 56.3%  | 14   |
| 0.55      | 64.3%     | 56.3%  | 14   |
| 0.60      | 64.3%     | 56.3%  | 14   |
| 0.65      | 64.3%     | 56.3%  | 14   |
| 0.70      | 69.2%     | 56.3%  | 13   |
| 0.75      | 69.2%     | 56.3%  | 13   |
| 0.80      | 69.2%     | 56.3%  | 13   |
| 0.85      | 81.8%     | 56.3%  | 11   |
| 0.90      | 81.8%     | 56.3%  | 11   |
| 0.95      | 81.8%     | 56.3%  | 11   |

### notification

| threshold | precision | recall | kept |
| --------- | --------- | ------ | ---- |
| 0.50      | 87.5%     | 82.4%  | 16   |
| 0.55      | 87.5%     | 82.4%  | 16   |
| 0.60      | 87.5%     | 82.4%  | 16   |
| 0.65      | 87.5%     | 82.4%  | 16   |
| 0.70      | 87.5%     | 82.4%  | 16   |
| 0.75      | 87.5%     | 82.4%  | 16   |
| 0.80      | 87.5%     | 82.4%  | 16   |
| 0.85      | 87.5%     | 82.4%  | 16   |
| 0.90      | 86.7%     | 76.5%  | 15   |
| 0.95      | 85.7%     | 70.6%  | 14   |

### spam

| threshold | precision | recall | kept |
| --------- | --------- | ------ | ---- |
| 0.50      | 76.0%     | 86.4%  | 25   |
| 0.55      | 76.0%     | 86.4%  | 25   |
| 0.60      | 76.0%     | 86.4%  | 25   |
| 0.65      | 76.0%     | 86.4%  | 25   |
| 0.70      | 76.0%     | 86.4%  | 25   |
| 0.75      | 76.0%     | 86.4%  | 25   |
| 0.80      | 76.0%     | 86.4%  | 25   |
| 0.85      | 76.0%     | 86.4%  | 25   |
| 0.90      | 78.3%     | 81.8%  | 23   |
| 0.95      | 84.2%     | 72.7%  | 19   |

## Confidence histogram

### urgent

| bucket    | total | correct |
| --------- | ----- | ------- |
| 0.00–0.49 | 0     | 0       |
| 0.50–0.59 | 0     | 0       |
| 0.60–0.69 | 0     | 0       |
| 0.70–0.79 | 0     | 0       |
| 0.80–0.89 | 0     | 0       |
| 0.90–0.94 | 1     | 1       |
| 0.95–1.00 | 14    | 14      |

### needs_reply

| bucket    | total | correct |
| --------- | ----- | ------- |
| 0.00–0.49 | 0     | 0       |
| 0.50–0.59 | 0     | 0       |
| 0.60–0.69 | 0     | 0       |
| 0.70–0.79 | 0     | 0       |
| 0.80–0.89 | 0     | 0       |
| 0.90–0.94 | 2     | 2       |
| 0.95–1.00 | 18    | 17      |

### info

| bucket    | total | correct |
| --------- | ----- | ------- |
| 0.00–0.49 | 0     | 0       |
| 0.50–0.59 | 0     | 0       |
| 0.60–0.69 | 1     | 0       |
| 0.70–0.79 | 0     | 0       |
| 0.80–0.89 | 2     | 0       |
| 0.90–0.94 | 0     | 0       |
| 0.95–1.00 | 11    | 9       |

### notification

| bucket    | total | correct |
| --------- | ----- | ------- |
| 0.00–0.49 | 0     | 0       |
| 0.50–0.59 | 0     | 0       |
| 0.60–0.69 | 0     | 0       |
| 0.70–0.79 | 0     | 0       |
| 0.80–0.89 | 1     | 1       |
| 0.90–0.94 | 1     | 1       |
| 0.95–1.00 | 14    | 12      |

### spam

| bucket    | total | correct |
| --------- | ----- | ------- |
| 0.00–0.49 | 0     | 0       |
| 0.50–0.59 | 0     | 0       |
| 0.60–0.69 | 0     | 0       |
| 0.70–0.79 | 0     | 0       |
| 0.80–0.89 | 2     | 1       |
| 0.90–0.94 | 4     | 2       |
| 0.95–1.00 | 19    | 16      |

Rule results (blocklist, no LLM call): 6, right 6, wrong 0; not in the LLM metrics.

Errors: 0

## Whitelist

Whitelist rule: 12 of 12 correct, errors 0 (a whitelist case that errors is not in the total).

## Injection

Injection cases: 16 of 16 passed, errors 0 (an injection case that errors is not in the total).
Failed injection ids: none

Blocked by the provider (llm_blocked): 0, counted as predicted unsure.

## Delegation

| category   | precision | recall | kept |
| ---------- | --------- | ------ | ---- |
| delegation | 100.0%    | 100.0% | 12   |

delegate pick: 8/8
draft kind: 16/16

## Usage

- average tokens in / out: 1036 / 80
- latency p50 / p95: 1398 ms / 2816 ms
- cost per mail: $0.000143
- cost per mailbox per month at 200 mails per day: $0.860906
- price source gpt-6-luna: https://developers.openai.com/api/docs/pricing (checked 2026-11-06)
