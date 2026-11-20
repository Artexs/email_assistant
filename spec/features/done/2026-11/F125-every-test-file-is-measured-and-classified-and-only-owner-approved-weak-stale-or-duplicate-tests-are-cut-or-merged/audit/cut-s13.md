# Cut stage 13: look-alike cases of the log lint and job-run argument tests become tables

Group G03 (`MERGE-TABLE`), files `apps/server/src/platform/log-lint.test.ts` and `apps/server/src/scripts/job-run-args.test.ts`. Base: master at the merge of this branch (`cut-keys.ts` ran on a fresh scan of that base).

## Keys

`cut-keys.ts --group G03 --area apps/server/src`: 27 keys, status `ok` for all 27 (21 in `log-lint.test.ts`, 6 in `job-run-args.test.ts`). No `rejected`, `missing` or `deferred-*` row. No open `limen/*` branch changes either file (checked with `git diff --name-only <merge-base> <branch>` per branch).

| Table | File | Rows | Old keys |
| --- | --- | --- | --- |
| old forms fail (header: name, fixture file, code line, expected severities) | `log-lint.test.ts` | 6 | 28, 36, 44, 60, 68, 111 |
| lines that pass (header: name, code line; every row expects `[]`) | `log-lint.test.ts` | 5 | 98, 121, 129, 137, 145 |
| converted files fail (header: name, fixture file, import path, code line, expected severities) | `log-lint.test.ts` | 10 | 165, 175, 195, 223, 237, 251, 286, 326, 364, 372 |
| parses a job and refuses `--force` | `job-run-args.test.ts` | 6 | 12, 17, 22, 27, 32, 37 |

Each row keeps the old case name as its `%s` label and every input and expected value of its old case.

## Kept apart

None of the 27 keys asserts more than the shared shape (one `expect` of the severities, or the two `expect`s of the job-run case). Neighbouring cases that are no G03 key (`a text with an error argument fails`, `a member logger fails …`, `test files are ignored`, the `main.ts`, `channels/operator.ts`, `actions`, `tenancy`, `mail` and platform cases) stay plain cases.

## Notes

- The case `a member logger with an event code passes` (old key :98) sat in the describe `log lint: old forms fail` but expects no finding. It is the first row of the pass table, which lives in `log lint: event form passes` (the describe of the other four pass cases). Its JUnit classname changes from the first describe to the second; its name does not.
- No helper was removed: `logEventSeverities`, `headerFor`, the fixture paths and `TIMEOUT` are still used by the plain cases and the tables.
- The `expect()` call count of the two files is 193 before and after.

## Cut proof

## Cut proof G03 tables

Before: `/tmp/f125-s13/before-1`, `/tmp/f125-s13/before-2`. After: `/tmp/f125-s13/after`. Expected: unit=+0, int=+0.

| lane | cases before | cases after | serial time before | serial time after |
| --- | --- | --- | --- | --- |
| unit | 72 | 72 | 2.59 s | 2.56 s |
| int | 0 | 0 | 0.00 s | 0.00 s |

- Case counts: pass.
- Covered lines: pass; 1 noise files skipped.
- Mutants: not checked (no mutation.json on both sides); 0 on one side only.

Result: PASS


Before: two runs of `cut-run.sh` on the unedited files; after: one run on the edited files.

## Name diff

`grep -o '<testcase name="[^"]*"' unit.xml | sort` of `before-1` and `after`: 72 names each; `diff` output is empty.

## Break once per table

Each break changed one row, ran `bun test <file>`, and the file was restored (`diff` against the saved copy is empty).

- Old forms fail: the expected severities of `free text fails` changed from `[2]` to `[3]`. Result: 1 fail (`log lint: old forms fail > free text fails`), 45 pass.
- Lines that pass: the code line of `an event code alone passes` changed to free text (`log.info("sync done")`). Result: 1 fail (`log lint: event form passes > an event code alone passes`), 45 pass.
- Converted files fail: the expected severities of `an old-form line in testmail fails` changed from `[2]` to `[1]`. Result: 1 fail (`log lint: converted files fail > an old-form line in testmail fails`), 45 pass.
- Job-run table: the row `loops.match` changed to `loops.matchx` (the row is both input and expected value). Result: 1 fail (`parses loops.matchx and refuses --force for it`), 25 pass.
