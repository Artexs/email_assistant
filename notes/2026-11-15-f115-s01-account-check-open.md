# F115 stage 01: account-number check not landed (2026-11-15, pause)

State: branch `limen/2026-11-15-f115-s01-drafter-core-risky-llm-6915e2eb`, head `3e48aeec` (job `2026-11-15-f115-s01-drafter-core-risky-llm-e4a702ce`). NOT landed. Not reviewed a third time. The branch stays in git.

Why not landed: this is the third try at the account-number check of a reply draft (text that may leave to a third party). The worker's own numbers say zero misses is not met:
- Adversarial generator `adv.ts`: 6,704 of 77,000 forms pass (1,142 with valid check digits). About 2,665 are an IBAN with 12 or fewer digits and a word, markup or split between groups (found only by mod 97).
- Random 13-19 digit card numbers pass in about 11 % of the worker's own cases (1-4 digits of slack in a budget of 12).
- False positives are met (1.2-1.4 %, below 2 %).
- A rise of valid-mode misses from 563 to 1,142 is not explained (possible regression).
- Last code edit not re-mutated; 14 survivors of 625 mutants (2 provably equivalent).
Logs: `/tmp/f115-s01/` (`rr2-adv.log`, `rr2-adv-valid.log`, `random-run4-20261115.log`, `mutation4.log`, `proof-result4.txt`).

The real choice is a product choice, not a code choice: a pattern or digit-budget check cannot give zero misses on hostile text. Options:
1. Forbid every digit run of 12 or more in a draft (no account, no card, no long number; costs some legitimate drafts), plus mod 97 on IBAN.
2. Keep the budget check as one layer and add the human approval step as the control (the draft is never sent without approval; the user sees the text).
3. Accept the residual miss rate for the prototype only (stage 02, synthetic mail, no real mail).
Coordinator recommendation: option 1 for any text that goes to a model or a third party; option 2 for the draft the user reads.

To continue: resume the job with the choice, then one narrow Opus re-review (third), then landcheck and `limen land --keep-open`. Stage 02 (real LLM spend up to $6) needs the owner's yes and this choice first.
