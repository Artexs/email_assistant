# F032 stage 02 — Store the copy, core tests, docs

Part of [`../plan.md`](../plan.md). **[risky]**; a review job runs before the land. Read D1–D11, § Edge cases. Needs stage 01.

## Step 1 — The copy branch stores `#n` [risky]

**Goal.** In `checkReturnedBelowCursor` (`mail/sync.ts`), a sure copy hit is stored like a new mail (D2–D5, D11); a held meta no longer hides a return (D6).

**Interfaces.**

- `checkReturnedBelowCursor` gets the run state as its last parameter (`syncFolder` passes it).
- `SyncResult.copiesStored: number`, 0 in `emptyResult`.
- The folder check of a hit (today `isStillInFolder`, a boolean) returns the UID where it found the row's mail, or null (D11). The return branch still treats null as "gone".

**Order per chunk.**

1. `dropHeldMetas` with `listFolderRowsAtUids` (D6; the per-hit `listFolderUids` read goes) → `matchReturned`.
2. Per hit, the folder check: null → a return, as today. Found at another UID than the row's `uid` → `uncertain` (D11). Found at the row's `uid` → `decideBelowCursorCopy` with the copies of D3; for `store`, `fetchContent` and a `newRow` insert. Each copy hit counts in `copiesBelowCursor` with today's debug line.
3. The chunk transaction: lock and cursor check, the returns, then per planned copy: `findCopies` in the transaction, the rule again (D4), insert only on `store` with that key, `storeCapture` when the insert stored the row.
4. After the commit only: the run state (D5). `CursorMovedError`: today's warning and `break`.
5. After the loop: the old info line unchanged; the D7 lines.

A helper shared with `planChunk` or `applyChunk` is fine; their behaviour stays.

**Test** (`mail-sync.test.ts`: describes "returned mail below the cursor" (INBOX), "sync folders" (`Oferty`)):

- 2.1 "a copy back to INBOX that leaves the mail in its folder is counted, not returned" becomes "… is stored as #2": `copiesBelowCursor` 1, `copiesStored` 1, `stored` 1, `returnedBelowCursor` 0. New row: key = moved row's key + `#2`; `folder` = `source_folder` = INBOX; `uid` = `inbox_uid` = hit UID; `pending`; `body_text` = the seed text; `received_at` = the copy's INTERNALDATE. Moved row and cursor unchanged.
- 2.2 After 2.1, a second sync: `copiesBelowCursor` 0, `copiesStored` 0, `stored` 0, two rows. The done line: old text ends `checked 1, returned 0, copies 0`; after F103 stage 10, `sync_below_cursor_done` with `checked: 1`, `copies: 0`. Assert the form at HEAD.
- 2.3 Test 8.2 also asserts a `#2` row with `folder` = `source_folder` = `Oferty`, `copiesStored` 1 for `offers`.
- 2.4 Fake with `globalUids`; a newer INBOX mail moves the cursor past the row's folder UID. After 2.1, the user moves the row's mail from `AI/Info` back to INBOX keeping its UID → next sync: that row `returned` with its folder UID, the copy row unchanged, `returnedBelowCursor` 1.
- 2.5 The copy of 2.1 has an `email_headers` row; `captureMissing` 0.
- 2.6 "an identical copy that stays in INBOX at the hit uid is no return" passes unchanged.
- 2.7 Concurrent store: a provider wrapper whose `fetchContent` first inserts, in the test transaction, a row of the identity at INBOX and the hit UID (the row another run stored) → this check inserts nothing (`copiesStored` 0, one copy row in INBOX), debug kind `held`. Second case: the wrapper sets the moved row's `undo_pending_at` = the clock → nothing stored, kind `move_in_flight`.

**Check.** `cd apps/server/test/integration && bun test mail-sync.test.ts mail-sync-capture.test.ts mail-moves.test.ts mail-flags.test.ts`

**Done when.** 2.1–2.7 pass; other tests change only by `copiesStored: 0`.

**Out of scope.** The return branch beyond D6 and D11, `moves.ts`, `flags.ts`, triage, the stage 03 tests.

## Step 2 — Docs (D10)

`sync.md` rule 11: a copy hit is stored as `#n` with body and capture and triaged, unless a move of the mail is in flight, another row holds that UID, this run saw the mail in another synced folder, or the row's mail was found only at another UID. Limits: drop the F032 line; add "a mail that no row knows and that lands below a cursor is not seen". The known alert: a copy now counts once; name the two new lines and the debug kinds. Architecture §6.1 and `modules.md` as D10 says.

**Check.** `bun test apps/server/src/capability-map.test.ts`

**Done when.** It passes. Then the Proof of `plan.md` with `NN` = `02` ends `PROOF_OK`.
