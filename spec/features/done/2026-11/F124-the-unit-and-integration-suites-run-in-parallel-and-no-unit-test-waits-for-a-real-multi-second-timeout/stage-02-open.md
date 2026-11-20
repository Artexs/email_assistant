# F124 stage 02 — what is open after the build (2026-11-20)

Built: `--parallel=4` in `test:unit` and `test:int`; one database per `test:int` worker (`apps/server/test/worker-db.ts`, switch `EA_TEST_WORKER_DB=1`); narrow row filters in 6 tests; `db:worktree --drop` also drops `<name>_w<n>`; `max_connections=200` in `deploy/compose.dev.yaml`. Logs: `/tmp/f124-s02/` (not in the repo).

## Not measured under load (a coordinator step re-measures on a quiet machine)

- The 5 int runs, each under 80 s, runs 4 and 5 under `taskset -c 0-3`, and unit under 12 s. The machine ran about 15 jobs at once (load 10 to 20). Measured once each, merged with master: unit 47 s (7,146 tests, 513 files); int 361 s (5,937 tests, 436 files).
- Connection peak per job: sampled 19 to 22 (target was 12). The race files need 16 at once in one worker. `max_connections=200` applies when the dev `db` container restarts; it was not restarted.
- The first `master` CI run after the land (see the CI paragraph in `plan.md` § Log).

## Final runs at the merge commit (one each)

- `bun run lint`: fails on master itself, in `apps/server/src/deploy-logs.test.ts:105` (prettier). Not this stage's file; not fixed here. `final-lint.log`.
- `bun run typecheck`: pass. `bun run test:unit:ci`: pass, `4x PARALLEL`.
- `bun run test:int:ci`: 5,932 pass, 2 fail, both in `cli-streams-other.test.ts`: the case "drop: dropped" and an afterAll hook timed out at 5 s (DROP DATABASE under load). The file passes alone (53 pass, `final-cli-streams-alone.log`). The same hook timed out once before (a run in the middle of the job); the file's cases drop several databases, so it is the slowest file under load. If it repeats on a quiet machine, quarantine rule applies.

## Guard checks

Done and saved: see the final message of the job (worker-database switch, parallel flags, `env: process.env`, worker-database drop, filters). The filter of `lab-demo-seed` does not fail in a serial run: its counts change only when another file writes at the same time.
