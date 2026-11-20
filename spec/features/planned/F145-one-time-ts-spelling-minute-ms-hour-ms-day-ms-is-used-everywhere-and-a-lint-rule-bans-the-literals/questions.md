# F145 questions

All are small: the stages do not change with the answer. Each is a default the plan takes; the owner may confirm or change it.

1. [minor] **Test files stay outside the rule (plan D3).** The rule covers non-test source only, because the test audit (F125) owns the test files until its owner approval, and about 677 test lines hold such literals. Default: tests out of scope now. Undo: a later ticket widens the rule's `files` and rewrites the tests after F125 cuts.
2. [minor] **Lone multiples stay legal (plan D4).** `120_000` or `300_000` alone do not fail lint; only `60_000`, `3_600_000`, `86_400_000` and multiplication chains that fold to a multiple of a minute do. Default: as written. Undo: add the multiple check to lone literals in the rule.
3. [minor] **Seconds and division chains stay as they are (plan D5).** No `SECOND_MS`; `n * 1000` and `ms / 1000 / 60` stay. Default: as written. Undo: a later ticket adds `SECOND_MS` and a rule case.
4. [minor] **The mail OAuth spike tool is outside the rule (plan D10).** `tools/mail-oauth-spike/` has no package and no `src/`. Default: left out. Undo: add its glob to the rule block.
