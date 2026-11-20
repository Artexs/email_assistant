# Cut stage 14: web, docs and deploy tables (group G03, MERGE-TABLE)

Base: `e2bfbc7c` (master with the cut tools). Raw JUnit and lcov are in `/tmp/f125-s14/` (`before-1`, `before-2`, `after`).

## Keys

`cut-keys --group G03 --area <file>` for each of the four files, on a fresh scan at the stage base: 16 keys, all `ok` (no `rejected`, `missing`, `deferred-none` or `deferred-two`). No unmerged `limen/*` branch changes one of the four files (`git diff --name-only master...<branch>` for the five open branches).

| File | Keys (old line) | Table |
| --- | --- | --- |
| `apps/web/src/lib/two-factor-flow.test.ts` | 18, 22, 26 | one table: event after the failed verify clears the warning |
| `apps/docs/integrations/link-check.test.ts` | 33, 109, 114 | one table: pages and the expected `checked` count |
| `apps/docs/integrations/link-check.test.ts` | 38, 76, 105 | one table: page body and the expected `broken_link` message |
| `apps/docs/src/in-place.test.ts` | 21, 26, 55, 100 | one table: text, ref, expected output |
| `deploy/test/compose-lib.test.ts` | 54, 67, 73 | one table: `.env` lines and the expected state (`deploy/db.env` is written in each row) |

Each row keeps the old case name as its label, every input and every expected value. Kept apart: none.

## Proof

Before twice and after once, on the four files (all unit lane): `bash scripts/test-audit/cut-run.sh /tmp/f125-s14/<dir> <four files>`.
`bun scripts/test-audit/cut-proof.ts --before /tmp/f125-s14/before-1 --before /tmp/f125-s14/before-2 --after /tmp/f125-s14/after --expect unit=+0 --log … --title "Stage cut proof"`:

### Cut proof

Before: `/tmp/f125-s14/before-1`, `/tmp/f125-s14/before-2`. After: `/tmp/f125-s14/after`. Expected: unit=+0, int=+0.

| lane | cases before | cases after | serial time before | serial time after |
| --- | --- | --- | --- | --- |
| unit | 56 | 56 | 0.35 s | 0.52 s |
| int | 0 | 0 | 0.00 s | 0.00 s |

- Case counts: pass.
- Covered lines: pass; 1 noise files skipped.
- Mutants: not checked (no mutation.json on both sides); 0 on one side only.

Result: PASS


### Name diff

`diff` of the sorted `testcase` names of `before-1/unit.xml` and `after/unit.xml` (56 names each): empty. The `expect()` count stays 94.

### Break once per table

One expected value changed, one file run with `bun test <file>`, the file restored from a copy:

- two-factor table: the row "new backup codes clear the warning" given a failed-verify event instead of `codes_made`: only that case fails (4 pass, 1 fail).
- compose-lib table: the row 4c expected `split` instead of `mixed`: only 4c fails (9 pass, 1 fail).
- in-place table: the row T2 expected anchor `#L4` instead of `#L3`: only T2 fails (23 pass, 1 fail).
- link-check pass table: the row T7 expected `checked: 3` instead of 2: only T7 fails (16 pass, 1 fail).
- link-check throw table: the row "a src is checked like an href" expected `other.png` in the message: only that row fails (16 pass, 1 fail).
