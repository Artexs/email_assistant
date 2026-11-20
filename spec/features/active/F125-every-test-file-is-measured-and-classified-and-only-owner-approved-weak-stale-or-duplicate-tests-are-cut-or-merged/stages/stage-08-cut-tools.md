# F125 stage 08 — Cut tools: key resolve, stage run, before/after proof

Part of [`../plan.md`](../plan.md) § Phase B. Needs: `audit/approval-groups.tsv`, `audit/data/cases.tsv`, `audit/data/coverage-noise.tsv` (landed in stages 01–07). May run next to 17 and 18. Gets a review job (plan § Review).

Goal: every cut stage uses the same three tools to find its keys and to prove D9 (plan D12–D14). No test or product code changes.

## Interfaces (later stages call these exactly)

- **`bun scripts/test-audit/cut-keys.ts --scan <cases-static.tsv> (--group <Gnn> | --keys <k1,k2,…>) [--area <path prefix>] --out <tsv>`**
  Reads the old rows (`audit/data/cases.tsv`: key → file, `describePath`, `name`) and the fresh scan at the stage base. Writes one row per approved key: `old_key, new_key, status, file, describePath, name`. `status` is `ok`, `deferred-none` (no case with that file, path and name), `deferred-two` (two or more), or `rejected` (the key is in `audit/reject.tsv`). `--area` keeps only keys under that prefix. Exit 0 also when rows are deferred; the stage decides.
- **`bash scripts/test-audit/cut-run.sh <out dir> <test file>…`**
  Sorts the files into the unit and the int lane by the paths of `test:unit` and `test:int` (`suitePaths` of `junit.ts`). A file in neither lane: exit 2 with its path. Runs each lane that has files once, serial (no `--parallel`), with JUnit and lcov: `<out>/unit.xml`, `<out>/unit/lcov.info`, `<out>/int.xml`, `<out>/int/lcov.info`. A failed lane: the script runs the other lane too, then exits 1 (as `coverage.sh`).
- **`bun scripts/test-audit/cut-proof.ts --before <dir> [--before <dir>] --after <dir> --expect unit=<±n>,int=<±n> --log <md> [--title <text>]`**
  Checks, and appends one Markdown section to `--log`:
  1. JUnit case count per lane: `after − before` equals the `--expect` delta exactly. A lane that is not named must not change.
  2. Union lcov (unit ∪ int) hit lines per source file: no line hit in every `--before` run is unhit after. A line hit in only some `--before` runs is noise and is not checked. `audit/data/coverage-noise.tsv` adds its files' lines as noise too. Test files and `apps/server/test/` helpers are left out (as `coverage-cli.ts`).
  3. Mutants, only when both `<before>/mutation.json` and `<after>/mutation.json` exist: compare by (file, line, column, mutator, replacement) with `compareRuns` of `mutation-summary.ts`. A `Killed` before that is `Survived` or `NoCoverage` after fails. `Timeout` on either side is no change. The places of `audit/data/mutation-unstable.tsv` are not checked. A mutant that exists on one side only is listed, not failed (a moved line).
  4. Prints the serial time per lane before and after.
  Exit 0 when 1–3 hold, else 1 with each failure listed.

## New data files

- `audit/reject.tsv` (`key`, `reason`): the 4 keys of `audit/report.md` § 3 (`time-rewrite-check.test.ts:43`, `main.test.ts:42`, `:52`, `:61`, with the full paths of `approval-groups.tsv`).
- `audit/data/mutation-unstable.tsv` (`file`, `line`, `column`): the 6 places of `scripts/test-audit/README.md` § Mutation notes.

## Tests (`scripts/test-audit/cut-*.test.ts`, pure functions, fixed values)

- T1 cut-keys: an old key whose name moved from line 30 to 34 → `ok`, `new_key` `…:34`.
- T2 cut-keys: two fresh cases with the same file, path and name → `deferred-two`; none → `deferred-none`; a key in `reject.tsv` → `rejected` even when it resolves.
- T3 cut-proof counts: before unit 10, int 5; after unit 16, int 4; `--expect unit=+6,int=-1` → pass; `--expect unit=+5,int=-1` → fail with `unit: expected +5, got +6`.
- T4 cut-proof lcov: `a.ts` hit {1,2,3} in both before runs, after {1,2} → fail naming `a.ts` line 3; the same with line 3 hit in only one before run → pass.
- T5 cut-proof mutants: `Killed` → `Survived` at `x.ts` 4:2 → fail; `Killed` → `Timeout` → pass; the same flip at a place in `mutation-unstable.tsv` → pass.
- T6 cut-run lane split: `apps/server/test/integration/a.test.ts` → int, `packages/core/src/b.test.ts` → unit, `notes/c.test.ts` → exit 2 (test the pure split function).

Break each check once (for example drop the noise filter), see its test fail, and log it.

## Docs

`scripts/test-audit/README.md`: one usage line per new tool, and § Cut proof with the order of plan § Cut stage steps.

## Done when

- `bun test scripts/test-audit` and `bunx tsc -p scripts/test-audit --noEmit` pass (save both logs in `/tmp/f125-s08/`).
- One dry run on the stage base: `cut-run.sh` twice and `cut-proof.ts --expect unit=+0` on `packages/core/src/site.test.ts` passes (no change, so no drop); log in `/tmp/f125-s08/dry.md`.
- Last step: `bun run check:job`; copy its last line.
