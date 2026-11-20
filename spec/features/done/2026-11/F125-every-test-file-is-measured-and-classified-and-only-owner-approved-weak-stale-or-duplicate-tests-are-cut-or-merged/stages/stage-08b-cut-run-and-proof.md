# F125 stage 08b — Cut tools part 2: stage run and before/after proof

Part of [`../plan.md`](../plan.md) § Phase B. Needs: `audit/data/coverage-noise.tsv`, `scripts/test-audit/junit.ts` `suitePaths`, `mutation-summary.ts` `compareRuns` (stages 01–03). May run next to 08. Gets a review job (plan § Review).

Goal: every cut stage proves D9 with the same two tools (plan D12–D14). No test or product code changes. Stage 08 builds `cut-keys`.

## Interfaces (later stages call these exactly)

- **`bash scripts/test-audit/cut-run.sh <out dir> <test file>…`**
  Sorts the files into the unit and the int lane by the paths of `test:unit` and `test:int` (`suitePaths` of `junit.ts`). A file in neither lane: exit 2 with its path. Runs each lane that has files once, serial (no `--parallel`), with JUnit and lcov: `<out>/unit.xml`, `<out>/unit/lcov.info`, `<out>/int.xml`, `<out>/int/lcov.info`. A failed lane: the script runs the other lane too, then exits 1 (as `coverage.sh`).
- **`bun scripts/test-audit/cut-proof.ts --before <dir> [--before <dir>] --after <dir> --expect unit=<±n>,int=<±n> --log <md> [--title <text>]`**
  Checks, and appends one Markdown section to `--log`:
  1. JUnit case count per lane: `after − before` equals the `--expect` delta exactly. A lane that is not named must not change. A lane with no XML file on one side counts as 0 cases and 0 lines (stage 09 has no unit file before).
  2. Union lcov (unit ∪ int) hit lines per source file: no line hit in every `--before` run is unhit after. A line hit in only some `--before` runs is noise and is not checked. `audit/data/coverage-noise.tsv` adds its files' lines as noise too. Test files and `apps/server/test/` helpers are left out (as `coverage-cli.ts`).
  3. Mutants, only when both `<before>/mutation.json` and `<after>/mutation.json` exist: compare by (file, line, column, mutator, replacement) with `compareRuns`. A `Killed` before that is `Survived` or `NoCoverage` after fails. `Timeout` on either side is no change. The places of `audit/data/mutation-unstable.tsv` are not checked. A mutant that exists on one side only is listed, not failed (a moved line).
  4. Prints the serial time per lane before and after.
  Exit 0 when 1–3 hold, else 1 with each failure listed.

## New data file

`audit/data/mutation-unstable.tsv` (`file`, `line`, `column`): the places listed in `scripts/test-audit/README.md` § Mutation notes.

## Tests (`scripts/test-audit/cut-proof.test.ts`, `cut-run.test.ts`; pure functions, fixed values)

- T3 counts: before unit 10, int 5; after unit 16, int 4; `--expect unit=+6,int=-1` → pass; `unit=+5,int=-1` → fail with `unit: expected +5, got +6`; no unit XML before and 6 unit cases after, `unit=+6` → pass.
- T4 lcov: `a.ts` hit {1,2,3} in both before runs, after {1,2} → fail naming `a.ts` line 3; the same with line 3 hit in only one before run → pass.
- T5 mutants: `Killed` → `Survived` at `x.ts` 4:2 → fail; `Killed` → `Timeout` → pass; the same flip at a place in `mutation-unstable.tsv` → pass.
- T6 lane split: `apps/server/test/integration/a.test.ts` → int, `packages/core/src/b.test.ts` → unit, `notes/c.test.ts` → exit 2 (test the pure split function).

Break each check once (for example drop the noise filter), see its test fail, and log it.

## Docs

`scripts/test-audit/README.md`: a usage line per new tool, and § Cut proof with the order of plan § Cut stage steps.

## Done when

- `bun test scripts/test-audit` and `bunx tsc -p scripts/test-audit --noEmit` pass (logs in `/tmp/f125-s08b/`).
- One dry run on the stage base: `cut-run.sh` twice and `cut-proof.ts --expect unit=+0` on `packages/core/src/site.test.ts` passes (no change, so no drop); log in `/tmp/f125-s08b/dry.md`.
- One commit, then `bun run check:job` last; copy its last line.
