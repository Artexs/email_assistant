# Test audit tools

Maintenance tools of the test audit (not product code, not run in CI). Own `tsconfig.json`; no new dependency (`typescript` is a root dev dependency). Check: `bunx tsc -p scripts/test-audit --noEmit`; tool tests: `bun test scripts/test-audit`.

- **Static scan** (`scan.ts`, `scan-program.ts`, `scan-format.ts`, CLI `scan-cli.ts`): one row per `test(`/`it(` call site of every tracked test file, plus shared suite modules (non-test `.ts` files under `apps/server/test/`, `apps/server/src/`, `tools/` that import `test` or `it` from `bun:test`).
  Command: `bun scripts/test-audit/scan-cli.ts --out <ticket folder>/audit/data`.
  Output: `cases-static.tsv` (columns of `CaseRow`, arrays joined with `,`), `groups.tsv` (`group`, `type`, `files` = distinct files, `cases`, `keys`), `scan-summary.md`.
- **Timing run** (`run-suites.sh`, `junit.ts`): `bash scripts/test-audit/run-suites.sh <out dir>` runs the `test:unit` and `test:int` paths of `package.json` serially (no `--parallel`) and writes `unit.xml` and `int.xml` (Bun JUnit). `parseJunit` and `suitePaths` live in `junit.ts`. The int run needs the job DB (`scripts/limen-prepare.sh`).
- **Coverage run** (`coverage.sh`, `lcov.ts`, CLI `coverage-cli.ts`): `bash scripts/test-audit/coverage.sh <out dir>` writes `<out dir>/unit/lcov.info` and `<out dir>/int/lcov.info`. Run it twice (`<out>/run-1`, `<out>/run-2`), then `bun scripts/test-audit/coverage-cli.ts --run1 <out>/run-1 --run2 <out>/run-2 --data <ticket folder>/audit/data` writes `coverage-baseline.tsv` (run 1) and `coverage-noise.tsv` (files whose unit ∪ int hit lines differ between the runs).
- **Join** (`join.ts`, `join-format.ts`, CLI `join-cli.ts`): `bun scripts/test-audit/join-cli.ts --in <dir with unit.xml and int.xml> --data <ticket folder>/audit/data` reads `cases-static.tsv` and writes `cases.tsv` (scan columns plus `junit_count`, `time_s`, `assertions`, `skipped`), `junit-cases.tsv` and `timing-summary.md`.
- **Mutation run** (`mutation.sh`): `bash scripts/test-audit/mutation.sh <out dir> [--mutate <glob>]… [--with-static]` copies `packages/core/src` to a work folder under `${XDG_CACHE_HOME:-$HOME/.cache}/ea-test-audit/mutation.*` (never `/tmp`; an `EXIT` trap removes it), installs pinned Stryker and the Bun runner there (never in the repo), runs `stryker run` with `disableBail: true` and copies `mutation.json` and `mutation.log` to `<out dir>`. Needs Node 22 or higher. Default mutate: `src/**/*.ts`, `!src/**/*.test.ts`, `!src/**/*.test-helper.ts`. Static mutants (module-level code) are ignored unless `--with-static` (they need tens of CPU hours).
- **Mutation gaps** (`mutation-gaps.ts`): `bun scripts/test-audit/mutation-gaps.ts --in <mutation.json> [--min <n>] [--by fn]` prints a TSV of `file id survived no_coverage total` per function (default `--min 5`; `Survived` and `NoCoverage` count). A mutant belongs to the innermost named function (declaration, method, or an arrow or function expression held by a variable or property); an anonymous callback passes up; none gives `(module level)`. The id is the short name, the dotted chain when the name repeats in the file, plus `@<line>` if that repeats too; `--by fn` groups by short name. `--before <a> --after <b>` prints Markdown tables (`file | function | before | after`, `test file | case | kills`) and exits 1 when a case that is new in `<b>` kills no mutant that survived in `<a>`.
- **Mutation run lock** (`mutation.sh`): one Stryker run at a time, through `flock` on `/tmp/email-assistant-mutation.lock` (taken before the sources are copied). A run that finds the lock held prints `mutation.sh: waiting for the mutation lock`, waits up to 2 hours, then exits 3 with `mutation.sh: mutation lock busy for 2 hours`.
- **Mutation summary** (`mutation-summary.ts`): `bun scripts/test-audit/mutation-summary.ts --in <out dir>/mutation.json --data <ticket folder>/audit/data` writes `mutation-tests.tsv` (per Stryker test: scan `key`, kills, unique kills, `in_cover`, flags `S10`/`S11`; `unjoined` when no JUnit row matches), `mutation-files.tsv`, `mutation-survived.tsv`, `mutation-baseline.tsv` and `mutation-summary.md`. Reads `junit-cases.tsv`. `bun scripts/test-audit/mutation-summary.ts --compare <run-1>/mutation.json <run-2>/mutation.json` lists the mutants whose status differs between two runs (by file, line, column, mutator, replacement).

## Mutation notes

- Two runs on 4ce3f351: 21,250 mutants each; 6 status differences (0.03 %), all between `Killed` and `Survived`: `replies/digits.ts` 297:21, 368:17, 372:23 (two regex mutants) killed in run 1, survived in run 2; `testmail/batch.ts` 107:5 survived then killed; `triage/suspicious.ts` 342:7 killed then survived. A guess, not verified: the digit-budget test of `replies/digits.test.ts` hits its 5 s timeout on a loaded machine (it did in the dry run of an earlier attempt). Phase B compares `Killed` against `Survived` and `NoCoverage` for every mutant outside these 6 places, and never `Timeout`.
- The default run ignores static mutants (module-level code, 7,819 of 21,250): a run takes about 28 min instead of tens of CPU hours. Score at 4ce3f351: 86.45 % against 85.53 % in the F3 probe (core changed and grew since 54fe78f).
- Mutants compare by (file, line, column, mutator, replacement): Stryker ids are not compared.
- `mutation-tests.tsv` has 9 of 2,769 Stryker tests `unjoined` (0.33 %): they are newer than `junit-cases.tsv` (`llm-providers.test.ts`, `cost-model.test.ts`, `site.test.ts`). Run `join-cli.ts` again, then the summary, to close them.

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
