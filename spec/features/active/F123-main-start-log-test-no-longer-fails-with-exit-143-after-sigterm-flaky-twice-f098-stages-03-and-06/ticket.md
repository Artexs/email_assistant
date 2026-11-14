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

## Sequenced

- Plan after: none.
- Build after: none.
- Gate: none.
