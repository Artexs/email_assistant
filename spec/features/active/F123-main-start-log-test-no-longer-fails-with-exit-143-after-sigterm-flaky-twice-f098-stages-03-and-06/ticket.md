---
opened: 2026-11-14
---

# F123 · The server start-log test passes every time: no exit 143 after SIGTERM

## Outcome

`apps/server/test/integration/main-start-log.test.ts` passes on every run, alone and inside the full integration suite. The server child exits with code 0 after SIGTERM, and the test no longer sees 143.

## Scope

- Starting seam: `apps/server/test/integration/main-start-log.test.ts` and the SIGTERM handler in `apps/server/src/main.ts`.
- Find the cause (a race in the shutdown path, or a test that kills the child before its handler is installed) and fix it in the code or the test.

## Out of scope

- Other flaky tests; changes to the shutdown order of jobs.

## Acceptance

- The test passes 20 runs in a row alone, and in 3 full `bun run test:int:ci` runs in a row.
- The cause is written in `Notes` below.

## Notes

Seen twice on 2026-11-14 as one failure in a full integration run (exit code 143 after SIGTERM where the test expects 0): F098 stage 03 run 1 and F098 stage 06 run 1. Each time it passed alone and in the next full run. CLAUDE.md: a second failure of the same flake gets a quarantine ticket.

Cause (2026-11-14): `apps/server/src/main.ts` logged `server_listening` before it installed the SIGTERM and SIGINT handlers (`process.on` at the end of the file). The test sends SIGTERM as soon as it reads that line. On a loaded CI host the child could still be before `process.on`, so Bun's default signal action ended it with exit 143. Reproduced on purpose: a 300 ms `Bun.sleepSync` between the log line and `process.on` made the test fail with exit 143 every time. Fix: the `server_listening` line now comes after the handlers. The line is the ready signal, so a signal after it is always handled. The same probe, with the sleep before the log line, passes. No retry, no longer timeout, no change to the test body; only the `test.skip` and its quarantine comment are gone.

Proof (2026-11-14): the test file passed 20 runs in a row alone; 3 full `bun run test:int:ci` runs in a row passed (1681 pass, 0 fail each). Two earlier full runs failed 34 tests in `testmail-cli`-style tests with ENOSPC: the shared `/tmp` had no free inodes (823k held by `/tmp/node-compile-cache`). This is not the F123 cause. The proof runs used `TMPDIR` inside the worktree.

## Sequenced

- Plan after: none.
- Build after: none.
- Gate: none.
