# Test audit tools

Maintenance tools of the test audit (not product code, not run in CI). Own `tsconfig.json`; no new dependency (`typescript` is a root dev dependency). Check: `bunx tsc -p scripts/test-audit --noEmit`; tool tests: `bun test scripts/test-audit`.

- **Static scan** (`scan.ts`, `scan-program.ts`, `scan-format.ts`, CLI `scan-cli.ts`): one row per `test(`/`it(` call site of every tracked test file, plus shared suite modules (non-test `.ts` files under `apps/server/test/`, `apps/server/src/`, `tools/` that import `test` or `it` from `bun:test`).
  Command: `bun scripts/test-audit/scan-cli.ts --out <ticket folder>/audit/data`.
  Output: `cases-static.tsv` (columns of `CaseRow`, arrays joined with `,`), `groups.tsv` (`group`, `type`, `files` = distinct files, `cases`, `keys`), `scan-summary.md`.
- **Timing run** (`run-suites.sh`, `junit.ts`): `bash scripts/test-audit/run-suites.sh <out dir>` runs the `test:unit` and `test:int` paths of `package.json` serially (no `--parallel`) and writes `unit.xml` and `int.xml` (Bun JUnit). `parseJunit` and `suitePaths` live in `junit.ts`. The int run needs the job DB (`scripts/limen-prepare.sh`).
- **Coverage run** (`coverage.sh`, `lcov.ts`, CLI `coverage-cli.ts`): `bash scripts/test-audit/coverage.sh <out dir>` writes `<out dir>/unit/lcov.info` and `<out dir>/int/lcov.info`. Run it twice (`<out>/run-1`, `<out>/run-2`), then `bun scripts/test-audit/coverage-cli.ts --run1 <out>/run-1 --run2 <out>/run-2 --data <ticket folder>/audit/data` writes `coverage-baseline.tsv` (run 1) and `coverage-noise.tsv` (files whose unit ∪ int hit lines differ between the runs).
- **Join** (`join.ts`, `join-format.ts`, CLI `join-cli.ts`): `bun scripts/test-audit/join-cli.ts --in <dir with unit.xml and int.xml> --data <ticket folder>/audit/data` reads `cases-static.tsv` and writes `cases.tsv` (scan columns plus `junit_count`, `time_s`, `assertions`, `skipped`), `junit-cases.tsv` and `timing-summary.md`.
- **Cut keys** (`cut-keys.ts`): `bun scripts/test-audit/cut-keys.ts --scan <fresh cases-static.tsv at the stage base> (--group <Gnn> | --keys <k1,k2,…>) [--area <path prefix>] [--audit <audit dir>] --out <tsv>` finds the approved cases of a cut stage by name. One row per key: `old_key, new_key, status, file, describePath, name`. Status order: `rejected` (key in `audit/reject.tsv`, checked first), `missing` (no old triple), then the fresh scan gives `ok` (one case), `deferred-none` or `deferred-two`. A `--keys` item `<file>::<name>` is a kept case named at the stage base: it matches file and name in the fresh scan. `<audit dir>` defaults to the `audit` folder under `spec/features/active/` that holds `approval-groups.tsv`.
- **Approved keys** (`audit/data/approved-keys.tsv`: `key`, `file`, `describePath`, `name`, `base`, `note`): the approved keys that have no row in `cases.tsv` because their review scanned at its own base; `cut-keys.ts` reads this file before `cases.tsv`. Written from scans at the review bases, one per row.
- **Mutation run** (`mutation.sh`): `bash scripts/test-audit/mutation.sh <out dir> [--mutate <glob>]… [--with-static]` copies `packages/core/src` to a work folder under `${XDG_CACHE_HOME:-$HOME/.cache}/ea-test-audit/mutation.*` (never `/tmp`; an `EXIT` trap removes it), installs pinned Stryker and the Bun runner there (never in the repo), runs `stryker run` with `disableBail: true` and copies `mutation.json` and `mutation.log` to `<out dir>`. Needs Node 22 or higher. Default mutate: `src/**/*.ts`, `!src/**/*.test.ts`, `!src/**/*.test-helper.ts`. Static mutants (module-level code) are ignored unless `--with-static` (they need tens of CPU hours).
- **Mutation gaps** (`mutation-gaps.ts`): `bun scripts/test-audit/mutation-gaps.ts --in <mutation.json> [--min <n>] [--by fn]` prints a TSV of `file id survived no_coverage total` per function (default `--min 5`; `Survived` and `NoCoverage` count). A mutant belongs to the innermost named function (declaration, method, or an arrow or function expression held by a variable or property); an anonymous callback passes up; none gives `(module level)`. The id is the short name, the dotted chain when the name repeats in the file, plus `@<line>` if that repeats too; `--by fn` groups by short name. `--before <a> --after <b>` prints Markdown tables (`file | function | before | after`, `test file | case | kills`) and exits 1 when a case that is new in `<b>` kills no mutant that survived in `<a>`.
- **Mutation run lock** (`mutation.sh`): one Stryker run at a time, through `flock` on `/tmp/email-assistant-mutation.lock` (taken before the sources are copied). A run that finds the lock held prints `mutation.sh: waiting for the mutation lock`, waits up to 2 hours, then exits 3 with `mutation.sh: mutation lock busy for 2 hours`.
- **Mutation summary** (`mutation-summary.ts`): `bun scripts/test-audit/mutation-summary.ts --in <out dir>/mutation.json --data <ticket folder>/audit/data` writes `mutation-tests.tsv` (per Stryker test: scan `key`, kills, unique kills, `in_cover`, flags `S10`/`S11`; `unjoined` when no JUnit row matches), `mutation-files.tsv`, `mutation-survived.tsv`, `mutation-baseline.tsv` and `mutation-summary.md`. Reads `junit-cases.tsv`. `bun scripts/test-audit/mutation-summary.ts --compare <run-1>/mutation.json <run-2>/mutation.json` lists the mutants whose status differs between two runs (by file, line, column, mutator, replacement).

## Cut proof

Order of one cut stage (plan § Cut stage rules): re-scan the keys at the stage base; check the open `limen/*` branches for files in the way; `cut-run.sh <out>/before <files>` once or twice (two `--before` runs make a line hit in only one of them noise); edit the tests; `cut-run.sh <out>/after <files>`; `cut-proof.ts` with `--expect` set to the change of the case counts; commit when it exits 0. A stage that cuts in `packages/core` also runs `mutation.sh` before and after into the same folders (`mutation.json`).

Checks of `cut-proof.ts`:

1. JUnit case count per lane: `after − before` equals `--expect` exactly; a lane that is not named must not change; a lane with no XML file counts as 0 cases.
2. Union lcov (unit ∪ int) hit lines per source file: no line hit in every `--before` run is unhit after. A line hit in only some `--before` runs is noise, and so is every line of a file in `coverage-noise.tsv`. Test files and `apps/server/test/` helpers are left out.
3. Mutants (only with `mutation.json` on both sides): a `Killed` mutant before that is `Survived` or `NoCoverage` after fails (compare by file, line, column, mutator, replacement). `Timeout` is no change; the places of `mutation-unstable.tsv` are not checked; a mutant on one side only is listed, not failed.
4. The serial time per lane (the `time` of the JUnit root element) before and after is printed.

What the cut stages (09 to 20) learned:

- **Keys drift.** A case that a stage already moved or renamed shows as `deferred-none` in a later scan. Resolve it by its new name with `--keys <file>::<name>`; that is a rename, not a deferral. A case that stays in its file under its old name is `ok`.
- **Open branches.** Check each branch with `git diff --name-only <merge-base>...<branch>` and `git cherry <base> <branch>`. A file that a branch changes is deferred; its key stays `ok` in `cut-keys.ts` until the branch lands. At the end of phase B one branch (the removal of a model provider) still held `triage/cost.test.ts` and the config test of `platform/`.
- **Tables.** Merging look-alike cases into a `test.each` table keeps the JUnit `name`; only the class name (the `describe`) can change. Compare the sorted `testcase` names of a before run and the after run (`grep -o '<testcase name="[^"]*"' unit.xml | sort`): the diff must be empty, and the case counts do not change (`--expect unit=+0`). One table may repeat a name. Break one expected value per table, run the file, and see exactly that row fail.
- **Serial time is noise.** Two runs on one commit differed by 1.7× (41.28 s and 71.83 s, the same nine spawns) and 2.2× (5.78 s and 12.95 s) while other jobs ran in parallel. Use the case counts and the covered lines as proof. Use time only for a cut that moves a slow case out of a lane (`lab-bots.test.ts`: 83.90 s, 56.32 s, 34.23 s over two stages).
- **Two `--before` runs.** When one mutation run serves both, copy its `mutation.json` into both `before` folders (`cut-proof.ts` needs the file in each).
- **Mutation scope per stage.** Pass one `--mutate src/<file>` for each non-test file in the import closure of the changed test files (80 and 81 files in stages 16 and 20; 6,631 mutants in the stage 16 runs).
- **Unstable mutants.** A mutant that only a 5 s load timeout kills flips between runs (`contacts/address.ts` 24:7 and 25:10, killed only by `no character that folds to a letter is missing, over every code point`). Confirm with a second run at the tip and a run at the base in a scratch worktree, then add its place to `audit/data/mutation-unstable.tsv`. A stage may pass a copy of that file with `--data` and let the coordinator add the rows.
- **Mutants at one place.** Two mutants can start at one line and column and differ in their end. The compare key (`mutantPlace` in `mutation-summary.ts`) includes the end, so the order of the Stryker list does not matter.
- **Copies of a test path list.** The `test:unit` paths live in `package.json` and in `scripts/check-job.sh`. A path added to one goes to the other.
- **A never-run test in CI.** A `skipIf` file that needs the e2e URLs runs in the `e2e` job, in a step that fails on a skip line (`grep -Eq '^ *[0-9]+ skip'`). The step runs before the browser tests, so a failed browser run cannot hide the skip.

## Split proof

`bun scripts/test-audit/split-proof.ts --before <xml> --after <xml> [--after <xml> …]` compares the JUnit cases of an old test file with those of its parts as a multiset keyed by class name, name and skipped state, one `--after` XML per part. It prints `missing`, `extra` and `assertions` lines, then `split-proof PASS cases=<n>` or `FAIL`; exit 0 pass, 1 fail, 2 bad argument. A changed assertion count alone does not fail it: stop unless a cause is known.

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
