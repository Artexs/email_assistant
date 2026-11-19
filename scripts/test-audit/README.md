# Test audit tools

Maintenance tools of the test audit (not product code, not run in CI). Own `tsconfig.json`; no new dependency (`typescript` is a root dev dependency). Check: `bunx tsc -p scripts/test-audit --noEmit`; tool tests: `bun test scripts/test-audit`.

- **Static scan** (`scan.ts`, `scan-program.ts`, `scan-format.ts`, CLI `scan-cli.ts`): one row per `test(`/`it(` call site of every tracked test file, plus shared suite modules (non-test `.ts` files under `apps/server/test/`, `apps/server/src/`, `tools/` that import `test` or `it` from `bun:test`).
  Command: `bun scripts/test-audit/scan-cli.ts --out <ticket folder>/audit/data`.
  Output: `cases-static.tsv` (columns of `CaseRow`, arrays joined with `,`), `groups.tsv` (`group`, `type`, `files` = distinct files, `cases`, `keys`), `scan-summary.md`.
- **Timing run** (`run-suites.sh`, `junit.ts`): `bash scripts/test-audit/run-suites.sh <out dir>` runs the `test:unit` and `test:int` paths of `package.json` serially (no `--parallel`) and writes `unit.xml` and `int.xml` (Bun JUnit). `parseJunit` and `suitePaths` live in `junit.ts`. The int run needs the job DB (`scripts/limen-prepare.sh`).
- **Coverage run** (`coverage.sh`, `lcov.ts`, CLI `coverage-cli.ts`): `bash scripts/test-audit/coverage.sh <out dir>` writes `<out dir>/unit/lcov.info` and `<out dir>/int/lcov.info`. Run it twice (`<out>/run-1`, `<out>/run-2`), then `bun scripts/test-audit/coverage-cli.ts --run1 <out>/run-1 --run2 <out>/run-2 --data <ticket folder>/audit/data` writes `coverage-baseline.tsv` (run 1) and `coverage-noise.tsv` (files whose unit ∪ int hit lines differ between the runs).
- **Join** (`join.ts`, `join-format.ts`, CLI `join-cli.ts`): `bun scripts/test-audit/join-cli.ts --in <dir with unit.xml and int.xml> --data <ticket folder>/audit/data` reads `cases-static.tsv` and writes `cases.tsv` (scan columns plus `junit_count`, `time_s`, `assertions`, `skipped`), `junit-cases.tsv` and `timing-summary.md`.

## Coverage notes

- Bun 1.4.4 writes the int lcov (with the preload of `bunfig.toml`) without error: 854 source files in the stage 02 run (N2 holds).
- The lcov file lists helper files under `apps/server/test/` too; only `*.test.*` and `*.spec.*` files are dropped.
- A flaky case (a 5 s timeout under load) fails a run but Bun still writes its lcov file; `coverage.sh` runs both suites, then exits 1.
- Stage 02 noise: two runs on one commit differ in 1 source file (`apps/server/src/platform/auth-two-factor.ts`, 2 lines).

## Join notes

- Scan data and the timing run must come from the same commit: run `scan-cli.ts` again at the commit of the timing run.
- Bun reports the line of the first argument of the outer call. For a `test.each` table (or a name on the next line) that is after the line of the scan key. The join takes the nearest earlier scan row of the file when its name pattern matches the JUnit name (`via` = span in the code); a row that starts in between blocks it.
- A scan name is a pattern: `${…}`, `%s`-style marks and `$name` marks are wildcards. Bun leaves a `$name` unreplaced when the value is `undefined` and drops the space after it (`row $row→`), so those cases stay `unscanned`.
- A call whose name is a variable (`test(name, …)` in a loop) has no scan row, so its JUnit cases are `unscanned`; at the stage 02 run that is 20 cases in 3 files, plus the 3 `$row` cases above.
- The classname of a JUnit case lists the innermost describe first (`inner > outer`). A shared-module row joins when its `describePath` ends the outer-first path of the case.
- A JUnit case with no scan row gets its own row in `cases.tsv` (flag `unscanned`, key `file:line`).

## Scan notes

- A case row is one call site: a `test.each` table or a loop is one row (JUnit counts more).
- The key is `file:line` of the `test(`/`it(` call; a shared module row uses the module path.
- `S5`/`S6` rows can overlap: three identical bodies in one file form a B group and a T group.
- The no-prod-import flag ignores type-only imports (they carry no runtime code) and treats a bare Node module such as `fs` as a production import (only `node:*` is allowed).
- Asserting helpers resolve with `tsconfig.base.json` options only. A helper imported through an alias that this config lacks does not resolve, so its case counts as having no expect.
- Test files with no `bun:test` import still scan. Shared modules need the import.
