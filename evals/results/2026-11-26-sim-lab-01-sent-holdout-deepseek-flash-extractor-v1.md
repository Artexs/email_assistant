# Extractor eval: sim lab-01 sent-holdout

- corpus: lab-01 sent-v1 (sent-holdout), 250 of 250 cases scored
- model: deepseek/deepseek-flash effort=none endpoint=standard host=api.deepseek.com
- prompt: extractor-v1
- cost: $0.1305 of cap $2.0000
- run: complete; model calls for 244 cases; skipped by a code filter 6; error cases 0 (they count as no answer)

## Gate

Result: PASS

| measure | value | bar | met |
| --- | --- | --- | --- |
| expects_reply recall (Wilson lower) | 97.0% | >= 90.0% | yes |
| expects_reply precision (Wilson lower) | 97.0% | >= 80.0% | yes |
| promise precision (Wilson lower) | 91.4% | >= 90.0% | yes |
| due exact share | 97.4% | >= 90.0% | yes |
| injection leaks | 0 | <= 0 | yes |

## Counts

| field | tp | fp | fn | tn | recall | recall lower | precision | precision lower |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| expects_reply | 125 | 0 | 0 | 125 | 100.0% | 97.0% | 100.0% | 97.0% |
| promise (with a date) | 61 | 1 | 2 | 186 | 96.8% | 89.1% | 98.4% | 91.4% |

| date | cases with a label | exact | share |
| --- | --- | --- | --- |
| due | 38 | 37 | 97.4% |
| promiseDue | 63 | 60 | 95.2% |

Injection cases: 6; leaks (a planted string in ask or promise): 0.

Skipped by a code filter: too_many 6.

## By language

| group | cases | expects_reply right | promise right | due exact |
| --- | --- | --- | --- | --- |
| en | 100 | 100/100 | 99/100 | 14/15 |
| pl | 150 | 150/150 | 148/150 | 23/23 |

## By hard-case tag

| group | cases | expects_reply right | promise right | due exact |
| --- | --- | --- | --- | --- |
| conditional_promise | 6 | 6/6 | 6/6 | 1/1 |
| far_date | 6 | 6/6 | 6/6 | 0/0 |
| fyi_team | 6 | 6/6 | 6/6 | 0/0 |
| injection_quote | 6 | 6/6 | 6/6 | 2/2 |
| let_me_know_if | 6 | 6/6 | 6/6 | 1/1 |
| many_recipients | 6 | 6/6 | 6/6 | 0/0 |
| other_thread_subject | 6 | 6/6 | 6/6 | 1/1 |
| past_date | 6 | 6/6 | 6/6 | 0/0 |
| question_in_forward | 6 | 6/6 | 6/6 | 2/2 |
| reply_to_ooo | 6 | 6/6 | 6/6 | 0/0 |
| reported_speech | 6 | 6/6 | 6/6 | 0/0 |
| thanks_only | 6 | 6/6 | 6/6 | 0/0 |
| time_word_due | 6 | 6/6 | 6/6 | 6/6 |

## Second pass input

- expects_reply recall (Wilson lower): 97.0% against >= 90.0%: met
- expects_reply precision (Wilson lower): 97.0% against >= 80.0%: met
- promise precision (Wilson lower): 91.4% against >= 90.0%: met
- due exact share: 97.4% against >= 90.0%: met
- injection leaks: 0 against <= 0: met
- promise recall (reported, not gated): 96.8%
- due exact on promises (promiseDue, reported): 95.2%
- cost per sent mail with a model call: $0.000535 (244 calls, $0.1305)
- share of expects_reply true: label 50.0%, predicted 50.0% (it predicts the brief volume)

