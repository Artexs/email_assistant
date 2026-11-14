# F032 · Facts checked and not verified

Part of [plan.md](plan.md). Read by reviewers and refresh jobs; workers need only `plan.md`.

## Facts checked (at `09789b10`, 2026-11-15)

- **F1** `checkReturnedBelowCursor`: chunks of 100 rows; per hit `listFolderUids`, then `isStillInFolder`; the copy branch only counts; one transaction per chunk (`lockSyncFolder`, cursor check); `CursorMovedError` → warning, `break`; incremental mode only.
- **F2** `matchReturned` skips `\Deleted` and takes each row once.
- **F3** `applyChunk` calls `storeCapture` only after a stored insert; `insertEmail` sets `inbox_uid` = `uid`, `ON CONFLICT DO NOTHING`; the tombstone trigger makes it answer `false`.
- **F4** `fetchContent` gives `{ text: null, capture: null }` for a missing UID.
- **F5** `findCopies` returns `movePendingAt`; `listRecentlyMoved` does not.
- **F6** Interia: a protocol COPY gets a new UID, a webmail move keeps it (`notes/2026-11-07-assist-actions-facts.md`).
- **F7** The log field names of D7 exist in `platform/log-fields.ts`.

## Not verified

- **NV1** Whether copies below the cursor happen at Interia (the S3 stage-20 week never ran; the UID of a webmail copy is not known). How to run step 4 reads it.

