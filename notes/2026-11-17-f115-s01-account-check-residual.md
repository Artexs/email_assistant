# F115 stage 01: account check, owner default, residual and false positives (2026-11-17)

Owner answer ("idk"): the coordinator default holds (ticket F115, "Stage 01 account check"). The draft FAILS `account_number` on:
1. every run of 12 digits or more that the user did not type (`LONG_SEQUENCE_DIGITS`, `packages/core/src/replies/digits.ts`): digits that cost something and follow each other with ONE space, dot or dash between two runs. A date, time, money, percentage, rate, postal code, year or amount next to a currency ends the sequence. A number typed by the user, or a number of the quoted mail, is allowed as a whole; a number that mixes typed groups with new groups is a new number;
2. any IBAN that passes mod 97 that the user did not type (an IBAN of the mail is not allowed);
3. a body whose unexplained digits cost more than 12 (the digit budget, second layer).
`phone` stays: 9 to 11 unexplained digits in a phone-like run. The user's approval of the exact version is the last control; zero misses on hostile text is not the goal.

Choices made here (coordinator default plus the owner's "numbers the user typed in the mail they answer are allowed"):
- Numbers of the quoted mail (subject and body) are KNOWN from 9 to 26 digits, in one run or in groups joined by one space, dot or dash. This keeps false positives low (an ID of the mail has 13 digits in 20 % of the generated bodies). It also lets the draft repeat an account number that the mail holds (a BEC mail): only the user's approval stops that. A number of 27 digits or more and an IBAN of the mail are never known.
- Earlier limit "mail runs only up to 12 digits" is replaced by 26.

## Residual (what still passes), measured with the reviewer's adversarial generator rebuilt (`/tmp/f115-s01/adv/adv.ts`, 77,000 forms, same structure and seed as the original; the original scripts were deleted on the owner's order)

| Run | Forms that pass | Share |
|---|---|---|
| Random check digits (log `/tmp/f115-s01/adv5-random-check.log`) | 6,897 of 77,000 | 8.96 % |
| Valid check digits (log `/tmp/f115-s01/adv5-valid-check.log`) | 1,194 of 77,000 | 1.55 % |

By digits in the number that passes (random check digits / valid check digits): 11 or fewer: 3,931 / 780; exactly 12: 2,254 / 187; 13 to 16: 660 / 212; 17 or more: 52 / 15.
Reading: an IBAN with 12 or fewer digits whose letters or words split the digit groups passes unless its check digits are valid (mod 97 finds the valid ones). 12-digit numbers pass when a word, markup or two characters sit between the groups. 13–16 digit cards pass when a group looks like a date, year or rate.
The new rule adds nothing on this generator (same 6,897 before and after, log `/tmp/f115-s01/adv5-old-random-check.log` is the code of commit `3e48aeec`): the budget and mod 97 already catch every form that has a single-separator sequence of 12 or more. Its effect is on pure numbers: 12 digits fail as `account_number` (before: as `phone`).
Pure numbers (`/tmp/f115-s01/adv/twelve.ts`, 5,000 each, log `/tmp/f115-s01/adv5-twelve.log`): with one space, dot, dash or none between random groups of 2–6 digits: 12 digits 88 pass (1.8 %), 13 digits 39, 16 digits 40, 20 digits 0, 26 digits 0. With the word "do" or "i" between the groups: 12 digits 5,000 of 5,000 pass, 13 digits 97, 16 digits 126, 20 and 26 digits 0 (the budget catches them).
Random valid IBANs of PL, NL, DE, GB, FR, NO, KZ, MT with random separators and currencies: 0 misses of 5,000 each (`/tmp/f115-s01/random-run5-20261115.log`); random cards of 13–19 digits: about 11 % pass.

## False positives on normal replies (bodies the checks must pass)

- Reviewer-style business bodies (`/tmp/f115-s01/adv/fp2.ts`, rebuilt; dates, times, amounts, ranges, table rows, invoice and order numbers, NIP and phone typed by the user, an ID of the answered mail passed as quoted mail), 5,000 bodies each: seed 777 1.60 %, seed 12345 1.62 %, seed 99 1.70 % (logs `/tmp/f115-s01/fp5-777.log`, `fp5-12345.log`, `fp5-99.log`). All failures are `account_number`: bodies with two or three unexplained numbers (invoice plus order plus postal code) that pass the budget layer only below 13 digits.
- Without the quoted mail the same generator fails 76 % of the bodies that repeat an ID of the mail (659 of 862): the caller must pass the mail (`draftReply` does).
- Own sentences (`/tmp/f115-s01/random-run5-20261115.log`): 2 false failures in 5,000 (0.04 %).

## Proofs

Tests: `packages/core/src/replies/digits.test.ts` (describe "the long sequence" and the pins of the mail numbers), `apps/server/src/modules/replies/drafter.test.ts`. Mutations: `/tmp/f115-s01/mutate5.py`, log `/tmp/f115-s01/mutation5.log`: 34 mutants of the sequence rule, the separators, the allowed numbers and the mail keys; all killed. The earlier 625 mutants of the digit budget (`/tmp/f115-s01/mutation4.log`, 14 survivors) were not rerun.
