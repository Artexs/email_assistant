# F157 stage 13 split log

Base commit: 73801f3e. Before XML made at the base with `EA_TEST_WORKER_DB=1 bun test --timeout=30000` (a failing case: none). Each part ran in its own `bun test` call.

## `apps/server/test/integration/mail-sync.test.ts` — 3,044 lines at the base

Old file deleted. Parts (all in `apps/server/test/integration/`), helpers file `mail-sync-helpers.ts` (307 lines):

| Part | Lines | Cases | Topic |
| --- | --- | --- | --- |
| `mail-sync-copies.test.ts` | 370 | 16 | incremental: identical copies, `#2`, spam folder copies |
| `mail-sync-incremental.test.ts` | 542 | 22 | incremental: chunks, cursor; initial sync; rescan |
| `mail-sync-returned.test.ts` | 393 | 13 | returned mail below the cursor: first half |
| `mail-sync-returned-copies.test.ts` | 371 | 9 | returned mail below the cursor: held copies `#3`/`#4` |
| `mail-sync-folders.test.ts` | 333 | 12 | sync folders: first runs, errors |
| `mail-sync-folders-cross.test.ts` | 373 | 15 | sync folders: cross-folder dedup, failed discovery |
| `mail-sync-folders-below.test.ts` | 389 | 10 | sync folders: returns below the Oferty cursor |
| `mail-sync-log.test.ts` | 192 | 4 | log lines |

Proof: `split-proof PASS cases=101`. No `assertions` line was printed.

Setup list (top-level statements that are not imports, `describe` or `test`):

- `const db = testDb()` and the `afterAll` that destroys it: repeated in each of the 8 parts.
- `UID_VALIDITY`, `Setup`, `setup`, `NOW`, `hoursAgo`, `deps`, `seed`, `emails`, `cursorOf`, `onBodyCall`, `FolderCall`, `spyFolderReads`, `movedRowOf`, `copyRowsOf`, `withDebugLines`: helpers file (exported).
- `setupNew`, `setupKnown`: `mail-sync-incremental.test.ts` (only initial and rescan use them). `afterFirstCall`: the same part.
- Folder helpers that sat inside the `sync folders` describe (`OFFERS`, `JUNK`, `FOLDER_NOW`, `ago`, `folderDeps`, `folderSetup`, `addFolderRow`, `folderRow`, `storedRows`, `of`, `withLogs`) and the `returned` helpers `interia`, `storeAndMark`: helpers file (exported, same bodies). `SOCIAL`, `BILLS`: `mail-sync-folders.test.ts`.
- Describe-local helpers kept in the one part that uses them: `twoCopiesInSpam`, `rowOfCopy` (copies); `interiaGlobal`, `skipLines`, `putInFolder`, `twoMovedRows` (returned-copies); `crossRows`, `markSystemMoved` (folders-cross); `movedFromFolder`, `markMoved`, `rowById`, `copyOfMovedOffers` (folders-below).
- `log lines` keeps its own `OFFERS`, `FOLDER_NOW`, `ago`, `folderDeps`, `ids`, `offersRow`, `globalUidFake`, `MARKER_SUBJECT`.
- No `mock.module` and no `setSystemTime` in the file.

## `apps/server/test/integration/mail-history-backfill.test.ts` — 817 lines at the base

Old file deleted. Helpers file `mail-history-backfill-helpers.ts` (71 lines).

| Part | Lines | Cases | Topic |
| --- | --- | --- | --- |
| `mail-history-backfill-inbox.test.ts` | 408 | 13 | `backfillInbox`; only mail from before the connect |
| `mail-history-backfill-open.test.ts` | 377 | 10 | refusals; `backfillMailbox` opens; normal rows |

Proof: `split-proof PASS cases=23`. No `assertions` line was printed.

Setup list: `db` and `afterAll` in both parts. Helpers file: `UID_VALIDITY`, `NOW`, `SINCE_DAYS`, `ago`, `seed`, `deps`, `syncedMailbox`, `rowsOf`, `byId`, `cursorOf`, `sinceOf`. `headerCount`, `triagedH4`: inbox part. `secrets`: open part. `refused`, `withSecret`, `tokens` stay inside their describes in the open part.

## Repointed references

- `docs/capabilities/sync.md` (Tests list): the old file became the eight `mail-sync-*` parts.
- `docs/capabilities/trust.md` (two lines): `mail-history-backfill.test.ts` became the inbox and open parts.
- `git grep -F` of both old file names outside `spec/`, `notes/`, `docs/owner-decisions.md`, `docs/decisions/`, `docs/product/` prints nothing.
- Reference checks: `bun test` of `capability-map`, `legal-papers`, `bare-codes`, `claims`, `transitions` tests: 106 pass, 0 fail.
- `git log --follow` check: see the final report.
