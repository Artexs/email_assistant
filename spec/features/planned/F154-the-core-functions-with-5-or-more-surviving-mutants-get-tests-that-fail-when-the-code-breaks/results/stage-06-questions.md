# Stage 06 question: self-classed survivors are over the cap

The stage rule caps `equivalent` plus `unreachable` rows at 3 per function and 10 per stage. This stage has 24 rows: `isOneEditApart` 8, `punycodeDecode` 5, `digitValue` 7, `isLookalike` 3, `skeleton` 1. Every other mutant of the six functions is killed (`adapt` 0 left). Each row is in `results/stage-06.md` § Self-classed with a reason.

Why they cannot be killed by a test (tests only, no product change):
- `isOneEditApart` (8): the loop guard `a[start] === b[start]` makes every bound check redundant, and the length checks repeat each other. Exhaustive check over all pairs up to length 6: 0 output differences.
- `digitValue` (6 of 7): the upper-case branch is dead code because `foldHost` lower-cases the host first.
- `punycodeDecode` (5): redundant guards (`NaN` falls to `-1`; `fromCodePoint` throws into the `catch`, which hides the missing range check).

Question: accept the 24 rows as classed, or change product code (a product change that the plan forbids)? Proposed default: accept them; if the owner wants them gone, a later ticket removes the dead upper-case branch, the redundant bound checks and the unused `catch`.
Undo: delete the rows from the results file and take the proposed product change.
