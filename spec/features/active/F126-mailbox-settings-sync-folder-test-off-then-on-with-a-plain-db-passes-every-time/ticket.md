---
opened: 2026-11-14
---

# F126 · The sync-folder CLI test passes every time

## Outcome

`apps/server/test/integration/mail-folders-cli.test.ts`, test "off, then on with a plain Db: audit rows with actor cli, the cursor is null", passes on every run, alone and inside the full integration suite, and it is no longer quarantined.

## Scope

- Starting seam: that test file and `apps/server/src/scripts/mailbox-settings.ts` (`sync-folder`).
- Find the cause (a race between the script's own transaction and the test's reads, a shared row, or a timing assumption) and fix it in the code or the test. No retry and no longer timeout (`docs/code-patterns.md` § Tests).

## Out of scope

- Other flaky tests; the test-suite audit tickets F124 and F125.

## Acceptance

- The test passes 20 runs in a row alone, and in 3 full `bun run test:int:ci` runs in a row; the `test.skip` and its quarantine comment are removed.
- The cause is written in Notes below.

## Notes

Failed twice in CI on `master` on 2026-11-14 (01:32 and 09:19 UTC) with no change to the test file or the code it tests. Quarantined the same day by the coordinator (owner decision, `docs/code-patterns.md` § Tests).

## Sequenced

- Plan after: none.
- Build after: none.
- Gate: none.
