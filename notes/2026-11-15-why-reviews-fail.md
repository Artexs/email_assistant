# Why 9 of 67 stage reviews ended FAIL (2026-11-15)

Count: 67 stage reviews of F102 to F128 on 2026-11-15, 58 PASS, 9 FAIL (repair). 51 of the 58 PASS had test gaps or small fixes. None of the faults reached the VPS.

Causes of the repairs I could name (coordinator reading, not a study):
- Concurrency the worker did not test (F116 s16: two picks with different delegates; F102 s18: a reload drops the row while a dialog is open). The worker wrote tests for its own rules and a mutation check for each; the race needed an independent two-connection probe. The reviewer wrote it.
- Adversarial input in a scanner (F113 s15: a quoted local part passed an address scan keyed on the word before the `@`). The plan wording "scan every string for a word with an `@`" fixed the weak design.
- A copy of private data the plan did not list (F116 s07: erase cleared the loop text but not its subject copy).
- A rule that landed on master during the build (F116 s09: the migration contract check; the worker had no checker).
- A test seam mocked too far (F117 s16: a shared dialog mock, and a start call with no body that the real route rejects).

Standing actions:
- Land check runs `db:check-migrations` too (a rule that lands mid-build).
- Builder brief for a risky stage: for every rule of the form "exactly one", "once", "never twice" or "only X": write a two-connection race test with committed rows, also as the table owner. For every web dialog: a test where a reload removes the row while the dialog is open. For every scanner or parser: probe quoted, encoded and lookalike forms.
- Plans: list every place a value is copied (a table, a log, a card, a cache) before a delete or erase rule.
