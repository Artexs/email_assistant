# F125 stage 03 — Audit tool: mutation run of `packages/core`

Part of [`../plan.md`](../plan.md). Phase A: no test file and no production code changes. Needs stage 02 landed (`junit-cases.tsv`, for the join). May run at the same time as stages 05 and 06.

Goal of the stage: a reproducible mutation run of `packages/core` outside the repo, and per-case data: kills, unique kills, greedy-cover membership; per source file: score and survived mutants (D4, D5, F3).

## Step 1 — `mutation.sh`

- **Files:** `scripts/test-audit/mutation.sh`, README line.
- **Usage:** `bash scripts/test-audit/mutation.sh <out dir> [--mutate <glob>]…`. Default mutate: `src/**/*.ts` and `!src/**/*.test.ts`.
- **What it does** (`set -euo pipefail`):
  1. `base="${XDG_CACHE_HOME:-$HOME/.cache}/ea-test-audit"; mkdir -p "$base"; work=$(mktemp -d "$base/mutation.XXXXXX")`; `trap 'rm -rf "$work"' EXIT` right after it (a failed run also removes the folder; never under `/tmp`, D4); copy `packages/core/src`, `packages/core/tsconfig.json` and `tsconfig.base.json` into it. Rewrite the `extends` path of the copied `tsconfig.json` to `./tsconfig.base.json`.
  2. Write `package.json`: `{"name":"core-mutation","private":true,"type":"module","dependencies":{"zod":"<the zod range of packages/core/package.json>"},"devDependencies":{"@stryker-mutator/core":"10.1.1","@hughescr/stryker-bun-runner":"1.6.0","typescript":"5.9.3"}}` (exact versions, F3). Read the zod range with `bun -e`.
  3. `bun install` in `$work`.
  4. Write `stryker.conf.mjs`: `appendPlugins: ['@hughescr/stryker-bun-runner']`, `testRunner: 'bun'`, `mutate: <the globs>`, `reporters: ['json', 'clear-text']`, `concurrency: 8`, `disableBail: true`, `tempDirName: '.stryker-tmp'`.
  5. `npx stryker run` in `$work` (Stryker runs on Node ≥ 22; check `node --version` first and fail with a clear line if lower).
  6. Copy `reports/mutation/mutation.json` and the clear-text log to `<out dir>`. The trap removes `$work`.
- **Never** run `bun add` or `bun install` in the repo. `git status` after the run shows no change outside the stage's files.
- **Check:** `bash scripts/test-audit/mutation.sh /tmp/f125-s03/run-1`.
- **Done when:** `/tmp/f125-s03/run-1/mutation.json` exists; the score is within 1 point of 85.53 % (F3), or the final message explains the difference (for example, core changed since 54fe78f).

## Step 2 — Summary tool

- **Files:** `scripts/test-audit/mutation-summary.ts`, `scripts/test-audit/mutation-summary.test.ts`, README line.
- **Interfaces:**
  ```ts
  export interface MutantRow { file: string; line: number; column: number; mutator: string; replacement: string; status: string; killedBy: string[] }
  export interface CaseKills { testId: string; file: string; line: number; name: string; kills: number; uniqueKills: number; inCover: boolean }
  export function readReport(json: unknown): { mutants: MutantRow[]; tests: Map<string, { file: string; line: number; name: string }> };
  export function caseKills(report: ReturnType<typeof readReport>): CaseKills[];
  export function greedyCover(killSets: Map<string, Set<string>>): Set<string>;
  ```
  Paths get the `packages/core/` prefix (F4). `uniqueKills` = mutants whose `killedBy` has exactly this test. `greedyCover`: repeat "take the test that kills the most not-yet-covered mutants" until all killed mutants are covered; ties broken by test id order (stable output).
- **Outputs** (`audit/data/`):
  - `mutation-tests.tsv`: `key` (the scan key: join each Stryker test to a row of `audit/data/junit-cases.tsv` by the rule in `plan.md` F4 — same file, the last ` > ` part of the Stryker name equal to the JUnit `name`, nearest line — and take that row's `key`; else `unjoined`). Several Stryker tests may share one key (`each` rows); the reader sees them together. `file`, `line`, `name`, `kills`, `unique_kills`, `in_cover`, flags `S10`/`S11`.
  - `mutation-files.tsv`: per source file: mutants, killed, timeout, survived, no coverage, score.
  - `mutation-survived.tsv`: one row per survived or no-coverage mutant: file, line, column, mutator, replacement (the `GAP` input of stage 04).
  - `mutation-baseline.tsv`: one row per mutant: file, line, column, mutator, status (the D9 baseline for phase B).
  - `mutation-summary.md`: score, counts, the 23-or-so zero-kill cases (with their names), the cover size, the 15 files with the most survived mutants.
- **Test:**
  1. A report with 3 mutants and 3 tests: t1 kills m1 and m2, t2 kills m2, t3 kills nothing → kills 2/1/0, unique 1/0/0, cover `{t1}`.
  2. A mutant with status `Survived` has no `killedBy`; it counts in no kill set.
  3. Two calls with the same input give the same cover.
- **Done when:** the five files are committed; the final message gives the `unjoined` count (under 2 % of Stryker tests, else fix the join in this stage).

## Step 3 — Stability check (N1)

- **Check:** `bash scripts/test-audit/mutation.sh /tmp/f125-s03/run-2` on the same commit, then compare the two reports: count of mutants, and the status per (file, line, column, mutator). Write the result into `scripts/test-audit/README.md` § Mutation: "Two runs on <sha>: <n> mutants each; <k> status differences" with the differing rows if any (timeouts can flip).
- **Done when:** the README line is committed. More than 1 % differences: say so in the final message; phase B then compares only `Killed` versus `Survived`/`NoCoverage`, never `Timeout`.

## Done when

Steps 1–3 done; the Phase A Proof of `plan.md` § Proof with `NN=03` prints `PROOF_OK`.
