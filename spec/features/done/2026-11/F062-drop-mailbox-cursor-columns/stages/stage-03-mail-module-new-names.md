Needs stage 01: `emails.source_uid` and `emails.move_pending_at` in `platform/db/schema.ts`, and the trigger `emails_copy_renamed_columns`. May run next to stage 02 (shared test files only: merge master, re-prove).

# F062 stage 03 — The mail module reads and writes the new names

Part of [`../plan.md`](../plan.md). Decisions D3, D4.

## Goal

The mail module (repositories, sync, move finder, below-cursor check, history backfill) and its tests use `source_uid` and `move_pending_at` only. The mail public API carries the new names. Behaviour does not change.

## Interfaces (stage 04 and other tickets use these)

- `setMovePending(db, ctx, emailId: string, at: Date | null): Promise<void>` replaces `setUndoPending` (same meaning, same arguments), exported from `mail/index.ts`. No alias for the old name.
- `updateEmailLocation(..., next: { folder: string; uid: number; sourceUid?: number; movedAt?: Date | null; movePendingAt?: null })`: the option `undoPendingAt` becomes `movePendingAt`; `sourceUid` now writes `source_uid`.
- The moved-row type of `listRecentlyMoved` (`mail/repo/copies.ts`) and the sync-rules row types carry `source_uid` (snake case, as the DB row) instead of `inbox_uid`; `movePendingAt` keeps its name and now reads `move_pending_at`.
- The insert of a new mail (`insertEmail`) writes `source_uid: row.uid`, not `inbox_uid`.

## Steps

1. **Repositories.** Every query in `mail/repo/` that names `inbox_uid` or `undo_pending_at` names the new column instead: insert, uid update, return, move change, location update, move-pending set and clear, the moved-rows and move-candidate selects. Filters such as `inbox_uid IS NOT NULL` become `source_uid IS NOT NULL`.
2. **Sync code and API.** Rename in `sync-rules.ts`, `sync-below-cursor.ts`, `moves.ts`, `sync-run.ts` and the index exports. Update the two callers of `setUndoPending` in the actions module (`apply.ts`, `undo.ts`) and the `undoPendingAt` option in `apply.ts` so the code compiles; the rest of the actions module is stage 04.
3. **Comments.** Remove the comments that say "the name is old" or "`inbox_uid` keeps its name" in the touched files; describe the column by its new name.
4. **Mail tests.** Rename the column and field names in the mail unit and integration tests and the shared fixtures that insert emails (`mail-sync`, `mail-repo`, `mail-moves`, `mail-history-backfill`, `sync-rules.test.ts`, `fixtures.ts`). A test name that says "inbox_uid" or "undo pending" says "source uid" or "move pending".

## Decisions for this stage

- **S03-1 Rename only.** No query changes its shape, filter logic or order beyond the column name. A worker that finds a bug on the way writes it in the final message; it does not fix it here.
- **S03-2 Mixed state is safe.** After this stage the actions module may still read `inbox_uid` (stage 04). The trigger of stage 01 keeps the names equal, so both readers see the same value.
- **S03-3 Probe tool.** `mail/imap/probe-move.ts` keeps its local `inboxUid` (D9): it is the UID in INBOX, not the column.
- **S03-4 Changelog.** None.

## Test

- T1 The renamed mail tests pass with their old values: a mail moved by the system from INBOX at UID 41 and returned keeps `source_uid = 41`; a move-pending stamp younger than 24 h makes the sync store no copy; one older than 24 h does not.
- T2 New case in the mail repo integration test: `setMovePending(db, ctx, id, 2026-11-20T10:00:00Z)` → `move_pending_at` and (through the trigger) `undo_pending_at` equal that time; `setMovePending(…, null)` → both null.
- T3 New case: `insertEmail` with `uid = 7` in INBOX → `source_uid = 7` and `inbox_uid = 7`.

## Check

`bun test` on the mail unit tests and the listed integration files; `bun run typecheck`.

## Done when

- No file under `apps/server/src/modules/mail/` (except `imap/probe-move.ts`) names `inbox_uid`, `undo_pending_at`, `undoPendingAt` or `setUndoPending`.
- T1–T3 pass.
- The Proof command of `plan.md` (NN = 03) prints `PROOF_OK`.

## Out of scope

- The claim row and the Undo hint in the actions module, and the actions tests (stage 04).
- The guard test and the docs rename (stage 04).
- Any change to the `mailboxes` cursor (stage 02).
