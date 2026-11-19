# F125 stage 02 — Audit tool: timings, coverage baseline, `cases.tsv`

Part of [`../plan.md`](../plan.md). Phase A: no test file and no production code changes. Needs stage 01: `audit/data/cases-static.tsv` and the scan key of `scripts/test-audit/scan.ts`. Spawn with `--timeout 2h`: the serial int run holds about 3.5 times the cases of 54fe78f (183 s then), and Step 2 runs it twice more with coverage.

Goal of the stage: every scan row gets its run time and the S9 flag, and a line-coverage baseline per source file exists for the cut proof (D6, D9).

## Step 1 — JUnit reader and the timing run

- **Files:** `scripts/test-audit/junit.ts`, `scripts/test-audit/junit.test.ts`, `scripts/test-audit/run-suites.sh`, README line.
- **Interfaces:**
  ```ts
  export interface JunitCase { file: string; line: number; name: string; classname: string; time: number; assertions: number; skipped: boolean }
  export function parseJunit(xml: string): JunitCase[];
  export function suitePaths(script: string): string[]; // the path tokens of a package.json test script
  ```
  `parseJunit` reads `<testcase …>` elements by attribute (Bun's JUnit is regular, F2; no XML dependency, D3) and decodes `&amp; &lt; &gt; &quot; &apos;` and numeric entities. `skipped` is true when the element holds `<skipped`. `suitePaths("bun test --parallel=4 packages/core apps/server/src")` returns `["packages/core", "apps/server/src"]` (tokens after `bun test` that do not start with `-`).
- **`run-suites.sh <out dir>`:** reads the paths of `test:unit` and `test:int` from `package.json` (through `bun -e` and `suitePaths`), then runs serially, without `--parallel` (clean per-case times):
  - `bun test <unit paths> --reporter=junit --reporter-outfile=<out>/unit.xml`
  - `bun test <int paths> --reporter=junit --reporter-outfile=<out>/int.xml`
  `set -euo pipefail`; it fails when a suite fails. It prints no env value.
- **Test:**
  1. A JUnit snippet with two cases (one with `&quot;` in the name, one with `<skipped />`) → two rows with the decoded name, the right `line`, `time`, `skipped`.
  2. Nested `<testsuite>` elements do not change the case rows.
  3. `suitePaths` on the current `test:unit` and on the F124 form with `--parallel=4` gives the same paths.
- **Check:** `bun test scripts/test-audit`; `bash scripts/test-audit/run-suites.sh /tmp/f125-s02`.
- **Done when:** both XML files exist; unit about 7,030 cases (F1, 1927d052; more if tests landed since) and int at least 5,533 cases (the int call sites, F1; `each` rows add more). Write both counts in the final message.

## Step 2 — Coverage baseline

- **Files:** `scripts/test-audit/coverage.sh`, `scripts/test-audit/lcov.ts`, `scripts/test-audit/lcov.test.ts`, README line.
- **`coverage.sh <out dir>`:** the same paths as Step 1, serial: `bun test <unit paths> --coverage --coverage-reporter=lcov --coverage-dir=<out>/unit` and the same for int into `<out>/int`.
- **`lcov.ts` also exports** `unionHits(a, b)`: per source file the union of hit lines of two parsed reports (the D9 guard uses unit ∪ int).
- **`lcov.ts`:** `parseLcov(text): Map<string, { found: number; hit: number; hitLines: Set<number> }>` keyed by repo-relative source path (`SF:`, `DA:<line>,<count>`, `LF:`, `LH:`). Only source files (not `*.test.*`).
- **Test:** an lcov snippet with two `SF` blocks → two entries with the right `found`, `hit` and hit lines; a `DA` line with count 0 is not a hit; `unionHits` of two reports that hit lines {1,2} and {2,3} of one file gives {1,2,3}.
- **Output:** `audit/data/coverage-baseline.tsv`: `file`, `unit_found`, `unit_hit`, `int_found`, `int_hit`, `union_hit`.
- **Noise (N5):** run `coverage.sh` twice on the same commit (`<out>/run-1`, `<out>/run-2`). Write `audit/data/coverage-noise.tsv`: one row per source file whose union hit lines differ, with the count of differing lines. Write the file count in the final message.
- **Not verified (N2):** coverage of the int suite with its preload. If `coverage.sh` fails for int, write `int_found`/`int_hit` as `-`, keep unit, and write the error (first 20 lines, no env values) in the final message and in `scripts/test-audit/README.md`.
- **Done when:** `coverage-baseline.tsv` is committed.

## Step 3 — `cases.tsv`

- **Files:** `scripts/test-audit/join.ts`, `scripts/test-audit/join.test.ts`.
- **Rule:** read `cases-static.tsv` and both XML files. Join by `file` and `line` (the JUnit `line` is the line of the `test(` call, F2/F4). One scan row may get several JUnit rows (`each` cases, loops): `junit_count` is their number, `time_s` their sum, `assertions` their sum. Add flag `S9` when one JUnit row is ≥ 1 s (unit) or ≥ 2 s (int). Join check: the scan row at (file, line) must also match the JUnit `name` (the scan `name` as a pattern, each `${…}` part a wildcard); a row that does not match is not joined there. Shared rows (stage 01 `shared: true`; Bun reports a case of a suite module with the runner `file` and the module `line`): a JUnit row with no matching scan row at (file, line) joins to the shared row with the same `line` whose `name` pattern matches the JUnit `name` and whose `describePath` ends the JUnit `classname` (when the path is not empty). One shared row collects the JUnit rows of every runner file. Two shared rows that both match: `unscanned` with reason `ambiguous`. A JUnit row without a scan row: a row with `flags` `unscanned` (report it). A scan row of kind `unit`/`int` without JUnit rows: flag `not-run`.
- **Output:** `audit/data/cases.tsv` = the `cases-static.tsv` columns plus `junit_count`, `time_s`, `assertions`, `skipped`. `audit/data/junit-cases.tsv`: one row per JUnit case: `file`, `line`, `name` (evaluated, as JUnit prints it), `classname`, `time_s`, `skipped`, `key` (the scan key it joined to, or `unscanned`). Stage 03 joins Stryker tests to this file. `audit/data/timing-summary.md`: total time per suite; the 20 slowest files and 30 slowest cases; the count of `unscanned` and `not-run` rows; the count of shared rows and of the JUnit rows joined to them, apart from the `unscanned` count.
- **Test:** a scan row with two JUnit rows on the same line → `junit_count` 2 and the summed time; an `unscanned` and a `not-run` case. Shared fixture: a shared row at `contract.ts:12` named `refuses ${x}`, JUnit rows from `a.test.ts` line 12 and `b.test.ts` line 12 with names `refuses login` → both join to the shared row, `junit_count` 2. `a.test.ts` also has its own scan row at line 12 with another name → the JUnit rows still join to the shared row, and the `a.test.ts` row gets only its own JUnit row.
- **Done when:** `cases.tsv` and `timing-summary.md` are committed; the final message gives the `unscanned` and `not-run` counts (each should be under 1 % of rows; more than that is a scan bug to fix in this stage) and the shared counts.

## Done when

Steps 1–3 done; the Phase A Proof of `plan.md` § Proof with `NN=02` prints `PROOF_OK`.
