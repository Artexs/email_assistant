# Why the seat runs at full CPU with fewer workers (2026-11-20)

Question (owner): a few days ago many workers ran at low CPU; now half as many keep the CPU at full load for hours. Did the old pipeline skip integration tests?

## Answer

No. Workers ran integration tests before too. The checks rule in `.agents/limen/styleguide.md` says "lint, typecheck, test:unit, test:int before a commit" since 2026-11-12.

Evidence: count of jobs whose session ran `bun run test:int` (tool-call commands in `.limen/jobs/*/session/*.jsonl`):

| Day   | Jobs | Jobs that ran test:int | test:int calls |
| ----- | ---- | ---------------------- | -------------- |
| 11-15 | 480  | 403                    | 1049           |
| 11-18 | 109  | 72                     | 149            |
| 11-19 | 200  | 114                    | 342            |
| 11-20 | 147  | 77                     | 255            |

## What changed (all on 2026-11-20, 00:30 to 01:23)

1. `ea0d5afb`, `6b90a4da` (F124 stage 02): `test:int` and `test:unit` run `bun test --parallel=4`. Each int worker gets its own database. Before, one test run was one Bun process. Now one run is 4 Bun processes plus 4 DB connections sets. With about 7 jobs that test at the same time, that is about 28 Bun test processes and Postgres on 16 cores. Load average at 10:59 was 35.
2. `a70aa0c5`, `05c7a0e6`: new `.agents/limen/reminders.md`. Every code job ends with merge master, typecheck, lint, full `test:unit:ci` and the lanes it changed. Workers in practice also run full `test:int:ci` (seen in live processes of F146 and F148 jobs).
3. Same commits: `scripts/land-check.sh` runs in the background for each candidate whose master moved: typecheck, `lint:full` (no cache), full unit again. 139 results in `.limen/land-checks/`. This repeats work the worker just did.
4. F136 (per-job e2e ports and DB) removed the shared e2e lock. Playwright suites with their servers can now run in several jobs at once.
5. `b6433d3c`: test timeout 30 s. It hides slow runs under load; it does not reduce load.
6. The suite grew: 559 test files on 11-15, 986 now; integration 238 → 443.

## Mechanism

`--parallel=4` makes one job alone faster. With many jobs at once it oversubscribes the CPU. Each run gets slower, so runs overlap longer, so more runs share the CPU. Not measured: wall time per run before and after.

## Options

- Run tests with `--parallel=1` inside Limen jobs (env switch), keep 4 for a person alone and CI.
- Worker last step: changed-lane int tests only; full int stays in CI on master.
- Land check: skip the rerun when the worker already tested a master that differs only in non-code files.

## The loop today (read from reminders.md, styleguide.md, land-check.sh, ci.yml)

1. Worker, during work: styleguide says lint, typecheck, full unit, full int before each commit. 11-20: 115 worker jobs ran lint 908 times, typecheck 505, unit 342, int 241.
2. Worker, last step: merge master, typecheck, lint, full unit, lanes it changed (in practice full int too).
3. Reviewer: reruns checks. 11-20: 32 reviews ran unit 32 times, int 16, lint 91.
4. Land check (local, background, when master moved since step 2): merge master, bun install, typecheck, lint:full (no cache), full unit. One run took about 6 min under load.
5. Land, auto-push, GitHub CI on master: lint:full, typecheck, unit, int, e2e, image build. Off this machine.
   No pre-commit hook runs (core.hooksPath empty, no .git/hooks/pre-commit).

## Applied loop (owner, 2026-11-20)

1. Each commit: `scripts/pre-commit.sh` (shared `.git/hooks/pre-commit`, installed by `scripts/install-hooks.sh`, also from `limen-prepare`). Lint of staged code files (cached), typecheck (web/docs astro check only when their files or core are staged), unit tests that import a changed file. Skips commits with no code file and merge commits.
2. End of job: `bun run check:job` (`scripts/check-job.sh`). Merge master, lint changed files, typecheck, unit and integration tests with `bun test --changed=master`, 4 processes each (owner, 2026-11-20: no seat-wide lock). A migration, package.json, bun.lock, bunfig, tsconfig or test setup change runs the full suites. Last line `check:job PASS master=… tip=…`.
3. Reviewer: no suites, lint or typecheck; one test file only to prove a doubt.
4. Land check (`scripts/land-check.sh`): merge master, bun install, typecheck only.
5. GitHub CI on master: every suite (lint:full, typecheck, unit, int, e2e, image).

`--parallel=4` stays everywhere. The saving is fewer runs per change, not fewer processes per run.

Limits: `--changed` follows imports only; a changed shell script or data file read at run time does not pick its test. CI catches it on master. Cached lint on changed files misses a type-aware error in an unchanged file; `lint:full` in CI catches it.
