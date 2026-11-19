# F124 stage 02 — stopped at Step 1 (N2 stop rule and plan drift)

Date 2026-11-19. Worktree base: master e04c4ca0. Logs: `/tmp/f124-s02/` (`probe-int.log`, `conn.log`, `fails.txt`). Nothing else in the repo changed.

## Step 1 result

Command: `bun test apps/server/test tools/fake-telegram/test --parallel=4` (machine load average about 15 on 16 cores; other Limen jobs ran).

- Time: 366 s (plan F6 serial: 183 s; plan: 56 s parallel). The suite now has 434 test files and 5,924 tests (plan: 135 files, 1,682 tests). The plan numbers are stale.
- Result: 5,908 pass, 3 skip, 13 fail (plan expected 1).
- Connections to this job's DB: peak 20 (includes the 1 probe connection). Whole server peak: 30. `max_connections`: 100.
- `peak(column 1) × 5 < max_connections`: 20 × 5 = 100 < 100 is FALSE. Stage rule N2: stop and report; do not change the pool size.

## The 13 failures (list in `/tmp/f124-s02/fails.txt`)

The probe log holds 8 `deadlock detected` errors. Likely cause (guess, not verified): test files that run the schema Down/Up of a migration on the one shared job DB (`loops-schema`, `contacts-schema`, `suspicious-schema` tests; failing cases are `F109 migration ... Down`, `the Down and Up sections > 20`) run next to other files that read or write the same tables. `REPEATABLE READ` does not fix that. Other failures: cross-org counts (`createLoopJobs`, `failures`), `lab-reset` guard 4, `seedLabOrg`, `privacy-dsr-address-rule`, `credentials:check`, `graph-committer` 8b (7.9 s; may be load).

## Questions for the coordinator

1. N2: peak 20 per job gives 100 for 5 jobs, equal to `max_connections` 100. Options: (a) accept, because 5 jobs rarely all run the int suite at the same peak; (b) lower the pool `max` for tests (outside the stage); (c) `--parallel=3`. Proposed: (a) with a note, and (b) only if a real "too many clients" error appears.
2. Plan drift: 13 failures, several from schema-altering migration tests, are far more than the one known case. Step 2 needs a decision: a separate DB per worker, or the migration tests move to a serial command (D5 forbids a serial exception list). Proposed: refresh the plan (new ticket for per-worker DBs or isolation of migration tests), then re-run this stage.
