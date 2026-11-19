# F124 stage 02 — what is not proven (2026-11-20)

Built and committed on branch of job `2026-11-19-f124-stage-02-continue-c98074c5`: `--parallel=4` in `test:unit` and `test:int`; one database per test worker for `test:int`; narrow filters in 5 tests; docs line. Logs of the runs: `/tmp/f124-s02/` (not kept in the repo).

## Not run (the job ran out of time)

1. The Stage 02 Proof of `plan.md` § Proof (lint, typecheck, unit once, int 5 times, runs 4 and 5 under `taskset -c 0-3`). Only one int run after the last big change passed with 0 failures (`bun run test:int`, 343 s, load average 20 from other jobs).
2. The time limits (unit under 12 s, int under 80 s): measured 49 s and 343 s on a loaded machine; not comparable with the plan. Needs a quiet machine.
3. Guard checks (remove the guard, see the test fail, restore): not done for the worker-database switch, the `--parallel=4` flags and the row filters.

## Open questions

1. Connections: peak per job was 19 to 22 (sampled with `ss`), above the target of 12. The cause is real: race files open two pools (app and owner role) and race 8 transactions on each, so one worker needs 16 at once. A lower number needs weaker races. Built instead: `max_connections=200` in `deploy/compose.dev.yaml` (takes effect when the dev `db` container restarts; not restarted). Proposed: accept.
2. `db-worktree --drop` does not drop the worker databases (`email_assistant_<name>_w1..w4`) of a job: add that, or drop by hand.
3. CI: the worker databases need `POSTGRES_PASSWORD`; the code falls back to `postgres` (the CI service password), so `ci.yml` is unchanged. Unverified on CI.
4. `cli-streams-other.test.ts` afterAll hook timed out once (5 s) under load while dropping databases; it did not repeat in the next run.
