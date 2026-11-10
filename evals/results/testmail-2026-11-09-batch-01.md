# Testmail compare: 2026-11-09-batch-01

| case                                     | persona      | expected     | triage       | confidence | reason           | result | thread |
| ---------------------------------------- | ------------ | ------------ | ------------ | ---------- | ---------------- | ------ | ------ |
| urg-prezes-zarzad                        | prezes       | urgent       | urgent       | 0.99       | deadline_today   | ok     |        |
| urg-anna-linia                           | klient-anna  | urgent       | urgent       | 0.95       | deadline_today   | ok     |        |
| urg-en-contract                          | client-en    | urgent       | urgent       | 0.97       | deadline_today   | ok     |        |
| urg-dostawca-serwerownia                 | dostawca     | urgent       | urgent       | 0.97       | deadline_today   | ok     |        |
| urg-piotr-rabat                          | kolega-piotr | urgent       | urgent       | 0.98       | deadline_today   | ok     |        |
| nr-anna-aneks                            | klient-anna  | needs_reply  | needs_reply  | 0.97       | question         | ok     |        |
| nr-piotr-aneks                           | kolega-piotr | needs_reply  | needs_reply  | 0.98       | direct_request   | ok     | ok     |
| nr-en-meeting                            | client-en    | needs_reply  | needs_reply  | 0.98       | meeting_request  | ok     |        |
| nr-en-meeting-2                          | client-en    | needs_reply  | needs_reply  | 0.99       | meeting_request  | ok     | ok     |
| nr-dostawca-wycena                       | dostawca     | needs_reply  | needs_reply  | 0.97       | direct_request   | ok     |        |
| info-newsletter-pytanie (borderline)     | newsletter   | info         | spam         | 0.98       | newsletter       | WRONG  |        |
| info-piotr-fyi (borderline)              | kolega-piotr | info         | info         | 0.97       | fyi              | ok     |        |
| info-prezes-przesuniecie                 | prezes       | info         | info         | 0.98       | fyi              | ok     |        |
| info-dostawca-dostawa                    | dostawca     | info         | info         | 0.99       | fyi              | ok     |        |
| info-en-report                           | client-en    | info         | info         | 0.98       | fyi              | ok     |        |
| notif-hr-urlop                           | portal-hr    | notification | notification | 0.99       | automated_system | ok     |        |
| notif-hr-pasek                           | portal-hr    | notification | notification | 0.99       | automated_system | ok     |        |
| notif-faktury-wystawiona                 | faktury      | notification | notification | 0.99       | automated_system | ok     |        |
| notif-faktury-przypomnienie (borderline) | faktury      | notification | notification | 0.99       | automated_system | ok     |        |
| notif-faktury-wplata                     | faktury      | notification | notification | 0.99       | automated_system | ok     |        |
| spam-seo-b2b                             | oferta-b2b   | spam         | spam         | 0.98       | marketing        | ok     |        |
| spam-leasing-attack (attack)             | oferta-b2b   | spam         | spam         | 0.99       | marketing        | ok     |        |
| spam-sec-verify                          | security-en  | spam         | spam         | 0.99       | phishing_or_scam | ok     |        |
| spam-sec-password                        | security-en  | spam         | spam         | 0.99       | phishing_or_scam | ok     |        |
| spam-sec-attack (attack)                 | security-en  | spam         | spam         | 0.99       | phishing_or_scam | ok     |        |

triaged 25 of 25 sent; ok 24; wrong 1
prompt versions: classifier-v2 (25)

expected labels come from the batch file (writer + blind checker), not from triage_feedback

# Eval report: testmail batch 2026-11-09-batch-01

- date: 2026-11-10
- 25 labeled synthetic mails
- rows per model: gpt-6-luna 25
- synthetic mail, dev check
- rule results: 0
- errors: 0
- bar: 98.0%
- minimum support: 30 kept rows per category
- fewer than 100 real labels: the done-when accepts this only when all real pilot INBOX mail of the backfill window is labeled (user decisions 2026-11-04, 2026-11-06)

## Go/no-go

| category     | threshold | precision | recall | kept | decision       |
| ------------ | --------- | --------- | ------ | ---- | -------------- |
| urgent       | n/a       | 100.0%    | 100.0% | 5    | no-go: too few |
| needs_reply  | n/a       | 100.0%    | 100.0% | 5    | no-go: too few |
| info         | n/a       | 100.0%    | 80.0%  | 4    | no-go: too few |
| notification | n/a       | 100.0%    | 100.0% | 5    | no-go: too few |
| spam         | n/a       | 83.3%     | 100.0% | 6    | no-go: too few |

Minimum support: 30 kept rows per category (user 2026-11-04).

## Metrics per category

| category     | precision | recall | support |
| ------------ | --------- | ------ | ------- |
| urgent       | 100.0%    | 100.0% | 5       |
| needs_reply  | 100.0%    | 100.0% | 5       |
| delegation   | n/a       | n/a    | 0       |
| info         | 100.0%    | 80.0%  | 5       |
| notification | 100.0%    | 100.0% | 5       |
| spam         | 83.3%     | 100.0% | 5       |
| unsure       | n/a       | n/a    | 0       |

## Confusion matrix (rows: expected, columns: predicted)

| expected     | urgent | needs_reply | delegation | info | notification | spam | unsure |
| ------------ | ------ | ----------- | ---------- | ---- | ------------ | ---- | ------ |
| urgent       | 5      | 0           | 0          | 0    | 0            | 0    | 0      |
| needs_reply  | 0      | 5           | 0          | 0    | 0            | 0    | 0      |
| delegation   | 0      | 0           | 0          | 0    | 0            | 0    | 0      |
| info         | 0      | 0           | 0          | 4    | 0            | 1    | 0      |
| notification | 0      | 0           | 0          | 0    | 5            | 0    | 0      |
| spam         | 0      | 0           | 0          | 0    | 0            | 5    | 0      |
| unsure       | 0      | 0           | 0          | 0    | 0            | 0    | 0      |

## Threshold sweep

### urgent

| threshold | precision | recall | kept |
| --------- | --------- | ------ | ---- |
| 0.50      | 100.0%    | 100.0% | 5    |
| 0.55      | 100.0%    | 100.0% | 5    |
| 0.60      | 100.0%    | 100.0% | 5    |
| 0.65      | 100.0%    | 100.0% | 5    |
| 0.70      | 100.0%    | 100.0% | 5    |
| 0.75      | 100.0%    | 100.0% | 5    |
| 0.80      | 100.0%    | 100.0% | 5    |
| 0.85      | 100.0%    | 100.0% | 5    |
| 0.90      | 100.0%    | 100.0% | 5    |
| 0.95      | 100.0%    | 100.0% | 5    |

### needs_reply

| threshold | precision | recall | kept |
| --------- | --------- | ------ | ---- |
| 0.50      | 100.0%    | 100.0% | 5    |
| 0.55      | 100.0%    | 100.0% | 5    |
| 0.60      | 100.0%    | 100.0% | 5    |
| 0.65      | 100.0%    | 100.0% | 5    |
| 0.70      | 100.0%    | 100.0% | 5    |
| 0.75      | 100.0%    | 100.0% | 5    |
| 0.80      | 100.0%    | 100.0% | 5    |
| 0.85      | 100.0%    | 100.0% | 5    |
| 0.90      | 100.0%    | 100.0% | 5    |
| 0.95      | 100.0%    | 100.0% | 5    |

### info

| threshold | precision | recall | kept |
| --------- | --------- | ------ | ---- |
| 0.50      | 100.0%    | 80.0%  | 4    |
| 0.55      | 100.0%    | 80.0%  | 4    |
| 0.60      | 100.0%    | 80.0%  | 4    |
| 0.65      | 100.0%    | 80.0%  | 4    |
| 0.70      | 100.0%    | 80.0%  | 4    |
| 0.75      | 100.0%    | 80.0%  | 4    |
| 0.80      | 100.0%    | 80.0%  | 4    |
| 0.85      | 100.0%    | 80.0%  | 4    |
| 0.90      | 100.0%    | 80.0%  | 4    |
| 0.95      | 100.0%    | 80.0%  | 4    |

### notification

| threshold | precision | recall | kept |
| --------- | --------- | ------ | ---- |
| 0.50      | 100.0%    | 100.0% | 5    |
| 0.55      | 100.0%    | 100.0% | 5    |
| 0.60      | 100.0%    | 100.0% | 5    |
| 0.65      | 100.0%    | 100.0% | 5    |
| 0.70      | 100.0%    | 100.0% | 5    |
| 0.75      | 100.0%    | 100.0% | 5    |
| 0.80      | 100.0%    | 100.0% | 5    |
| 0.85      | 100.0%    | 100.0% | 5    |
| 0.90      | 100.0%    | 100.0% | 5    |
| 0.95      | 100.0%    | 100.0% | 5    |

### spam

| threshold | precision | recall | kept |
| --------- | --------- | ------ | ---- |
| 0.50      | 83.3%     | 100.0% | 6    |
| 0.55      | 83.3%     | 100.0% | 6    |
| 0.60      | 83.3%     | 100.0% | 6    |
| 0.65      | 83.3%     | 100.0% | 6    |
| 0.70      | 83.3%     | 100.0% | 6    |
| 0.75      | 83.3%     | 100.0% | 6    |
| 0.80      | 83.3%     | 100.0% | 6    |
| 0.85      | 83.3%     | 100.0% | 6    |
| 0.90      | 83.3%     | 100.0% | 6    |
| 0.95      | 83.3%     | 100.0% | 6    |

## Confidence histogram

### urgent

| bucket    | total | correct |
| --------- | ----- | ------- |
| 0.00–0.49 | 0     | 0       |
| 0.50–0.59 | 0     | 0       |
| 0.60–0.69 | 0     | 0       |
| 0.70–0.79 | 0     | 0       |
| 0.80–0.89 | 0     | 0       |
| 0.90–0.94 | 0     | 0       |
| 0.95–1.00 | 5     | 5       |

### needs_reply

| bucket    | total | correct |
| --------- | ----- | ------- |
| 0.00–0.49 | 0     | 0       |
| 0.50–0.59 | 0     | 0       |
| 0.60–0.69 | 0     | 0       |
| 0.70–0.79 | 0     | 0       |
| 0.80–0.89 | 0     | 0       |
| 0.90–0.94 | 0     | 0       |
| 0.95–1.00 | 5     | 5       |

### info

| bucket    | total | correct |
| --------- | ----- | ------- |
| 0.00–0.49 | 0     | 0       |
| 0.50–0.59 | 0     | 0       |
| 0.60–0.69 | 0     | 0       |
| 0.70–0.79 | 0     | 0       |
| 0.80–0.89 | 0     | 0       |
| 0.90–0.94 | 0     | 0       |
| 0.95–1.00 | 4     | 4       |

### notification

| bucket    | total | correct |
| --------- | ----- | ------- |
| 0.00–0.49 | 0     | 0       |
| 0.50–0.59 | 0     | 0       |
| 0.60–0.69 | 0     | 0       |
| 0.70–0.79 | 0     | 0       |
| 0.80–0.89 | 0     | 0       |
| 0.90–0.94 | 0     | 0       |
| 0.95–1.00 | 5     | 5       |

### spam

| bucket    | total | correct |
| --------- | ----- | ------- |
| 0.00–0.49 | 0     | 0       |
| 0.50–0.59 | 0     | 0       |
| 0.60–0.69 | 0     | 0       |
| 0.70–0.79 | 0     | 0       |
| 0.80–0.89 | 0     | 0       |
| 0.90–0.94 | 0     | 0       |
| 0.95–1.00 | 6     | 5       |

Rule results (blocklist, no LLM call): 0, right 0, wrong 0; not in the LLM metrics.

Errors: 0
