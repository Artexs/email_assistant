# F032 stage 02 — Store the copy, tests, docs

Part of [`../plan.md`](../plan.md). **[risky]** (sync and dedup); a review job runs before the land. Read D1–D10 and § Edge cases. Needs stage 01.

## Step 1 — The copy branch stores `#n` [risky]

**Goal.** In `checkReturnedBelowCursor` (`mail/sync.ts`), a copy hit is stored like a new mail (D2–D5); a held meta no longer hides a return (D6).

**Interfaces.** `checkReturnedBelowCursor` gets the run state as its last parameter (`syncFolder` passes it). `SyncResult.copiesStored: number`, 0 in `emptyResult`.

**Order per chunk.** `dropHeldMetas` (D6, replaces the per-hit `listFolderUids` read) → `matchReturned` → per hit: gone → a return as today; still there → count and log as today, then `decideBelowCursorCopy` (D2, D3) and, for `store`, `fetchContent` + a `newRow` insert → one transaction: lock, cursor check, returns, then inserts and captures (D4) → after the commit only, the run state (D5) → logs (D7). A helper shared with `planChunk` or `applyChunk` is fine; their behaviour stays.

**Test** (`mail-sync.test.ts`, the describes "returned mail below the cursor" (INBOX) and "sync folders" (`Oferty`), with their helpers and fakes):

- 2.1 "a copy back to INBOX that leaves the mail in its folder is counted, not returned" becomes "… is stored as #2": `copiesBelowCursor` 1, `copiesStored` 1, `stored` 1, `returnedBelowCursor` 0. The new row: key = the moved row's key + `#2`; `folder` = `source_folder` = INBOX; `uid` = `inbox_uid` = hit UID; `pending`; `body_text` = the seed text; `received_at` = the copy's INTERNALDATE. Moved row and cursor unchanged.
- 2.2 After 2.1, a second sync: `copiesBelowCursor` 0, `copiesStored` 0, `stored` 0, two rows; the info line ends `checked 1, returned 0, copies 0`.
- 2.3 Test 8.2 also asserts a `#2` row with `folder` = `source_folder` = `Oferty`, `copiesStored` 1 for `offers`.
- 2.4 Moved row `undo_pending_at` = clock − 1 h → nothing stored; − 25 h → stored.
- 2.5 Another row of the identity in `Oferty` with `uid` = hit UID → nothing stored, that row unchanged.
- 2.6 Cross copy: moved row's source `Oferty`; in the same run INBOX gets an identical mail above its cursor (stored `#2`) → `offers`: `copiesBelowCursor` 1, `copiesStored` 0. A second run stores it as `#3` (the chunk path does the same).
- 2.7 Key conflict: a second row of the identity, not moved (`folder` = `source_folder` = `AI/Spam`, another UID), key set to `#3` by SQL. The count is 2, so the key `#3` conflicts: no error, `copiesStored` 0, two rows, debug `not_inserted`.
- 2.8 Rows `#1` and `#2` of one identity, both moved from INBOX to `AI/Info`, both originals still in INBOX → one sync stores `#3` and `#4`.
- 2.9 Fake with `globalUids`; a newer INBOX mail moves the cursor past the row's folder UID. After 2.1, the user moves the moved row's mail back from `AI/Info` to INBOX keeping its UID → next sync: that row `returned` with its folder UID; the copy row unchanged; `returnedBelowCursor` 1.
- 2.10 The copy of 2.1 has an `email_headers` row; `captureMissing` 0.
- 2.11 "a cursor moved during the check ends it …" with a copy: nothing stored, the warning; the next run stores it.
- 2.12 "an identical copy that stays in INBOX at the hit uid is no return" passes unchanged.

**Check.** `cd apps/server/test/integration && bun test mail-sync.test.ts mail-sync-capture.test.ts mail-moves.test.ts mail-flags.test.ts`

**Done when.** 2.1–2.12 pass. Other tests change only by `copiesStored: 0` in `SyncResult` objects.

**Out of scope.** The return branch beyond D6, `moves.ts`, `flags.ts`, triage.

## Step 2 — Docs (D10)

The pages of D10. `sync.md` rule 11: a copy hit is stored as `#n` with body and capture and triaged, except during a move in flight, when another row holds that UID, or when this run saw the mail in another synced folder. Limits: drop the F032 line; add "a mail that no row knows and that lands below a cursor is not seen". The known alert: a copy now counts once; name the two new lines and the debug kinds.

**Check.** `bun test apps/server/src/capability-map.test.ts`

**Done when.** It passes. Then the Proof of `plan.md` with `NN` = `02` ends `PROOF_OK`.

