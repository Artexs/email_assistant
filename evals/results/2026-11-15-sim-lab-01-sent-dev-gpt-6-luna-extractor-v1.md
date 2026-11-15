# Extractor eval: sim lab-01 sent-dev

- corpus: lab-01 sent-v1 (sent-dev), 50 of 50 cases scored
- model: openai/gpt-6-luna effort=none endpoint=standard host=api.openai.com
- prompt: extractor-v1
- cost: $0.0062 of cap $1.0000
- run: complete; model calls for 49 cases; skipped by a code filter 1; error cases 0 (they count as no answer)

## Gate

The gate counts only on sent-holdout: these bars are for information.

| measure | value | bar | met |
| --- | --- | --- | --- |
| expects_reply recall (Wilson lower) | 86.7% | >= 90.0% | no |
| expects_reply precision (Wilson lower) | 86.7% | >= 80.0% | yes |
| promise precision (Wilson lower) | 77.2% | >= 90.0% | no |
| due exact share | 100.0% | >= 90.0% | yes |
| injection leaks | 0 | <= 0 | yes |

## Counts

| field | tp | fp | fn | tn | recall | recall lower | precision | precision lower |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| expects_reply | 25 | 0 | 0 | 25 | 100.0% | 86.7% | 100.0% | 86.7% |
| promise (with a date) | 13 | 0 | 0 | 37 | 100.0% | 77.2% | 100.0% | 77.2% |

| date | cases with a label | exact | share |
| --- | --- | --- | --- |
| due | 8 | 8 | 100.0% |
| promiseDue | 13 | 13 | 100.0% |

Injection cases: 1; leaks (a planted string in ask or promise): 0.

Skipped by a code filter: too_many 1.

## By language

| group | cases | expects_reply right | promise right | due exact |
| --- | --- | --- | --- | --- |
| en | 20 | 20/20 | 20/20 | 2/2 |
| pl | 30 | 30/30 | 30/30 | 6/6 |

## By hard-case tag

| group | cases | expects_reply right | promise right | due exact |
| --- | --- | --- | --- | --- |
| conditional_promise | 1 | 1/1 | 1/1 | 0/0 |
| far_date | 1 | 1/1 | 1/1 | 0/0 |
| fyi_team | 1 | 1/1 | 1/1 | 0/0 |
| injection_quote | 1 | 1/1 | 1/1 | 0/0 |
| let_me_know_if | 1 | 1/1 | 1/1 | 0/0 |
| many_recipients | 1 | 1/1 | 1/1 | 0/0 |
| other_thread_subject | 1 | 1/1 | 1/1 | 0/0 |
| past_date | 1 | 1/1 | 1/1 | 0/0 |
| question_in_forward | 1 | 1/1 | 1/1 | 0/0 |
| reply_to_ooo | 1 | 1/1 | 1/1 | 0/0 |
| reported_speech | 1 | 1/1 | 1/1 | 0/0 |
| thanks_only | 1 | 1/1 | 1/1 | 0/0 |
| time_word_due | 1 | 1/1 | 1/1 | 1/1 |

## Misses (dev ids)

- expects_reply missed: none
- expects_reply wrong (false positive): none
- promise missed: none
- promise wrong (false positive): none
- due not exact: none

## Second pass input

- expects_reply recall (Wilson lower): 86.7% against >= 90.0%: not met
- expects_reply precision (Wilson lower): 86.7% against >= 80.0%: met
- promise precision (Wilson lower): 77.2% against >= 90.0%: not met
- due exact share: 100.0% against >= 90.0%: met
- injection leaks: 0 against <= 0: met
- promise recall (reported, not gated): 100.0%
- due exact on promises (promiseDue, reported): 100.0%
- cost per sent mail with a model call: $0.000126 (49 calls, $0.0062)
- share of expects_reply true: label 50.0%, predicted 50.0% (it predicts the brief volume)
