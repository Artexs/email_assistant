Needs: nothing from another stage (no new column). May run next to stage 01 (both edit `privacy/export-map.ts`, different tables) and stage 03 (both may edit `mail-sync.test.ts`: merge master, re-prove).

# F062 stage 02 — Stop the copy of the INBOX cursor into `mailboxes`

Part of [`../plan.md`](../plan.md). Decisions D5, D8.

## Goal

The sync writes the INBOX cursor only to its `mailbox_folders` row. No code reads or writes `mailboxes.uidvalidity` or `mailboxes.last_uid`. The columns stay in the database until stage 05.

## Steps

1. **Writers.** In the mail folder repository (`mail/repo/folders.ts`), `updateFolderCursor` no longer updates `mailboxes` for the `inbox` row, and `forceRescan` no longer sets `mailboxes.uidvalidity`. Each folder-row write stays as it is, in the same transaction.
2. **Readers.** `MailboxRow` (`mail/repo/mailboxes.ts`) loses `uidvalidity` and `last_uid`; the row mapper drops them from the object it returns (not only from the type), so no caller can read a stale copy. `getMailbox` and `lockMailbox` may keep `selectAll`.
3. **Fixtures and tests.** Test fixtures stop writing the two `mailboxes` columns. Delete the integration test "after an incremental sync mailboxes.last_uid equals the INBOX folder row (dual write)". Keep every test of the folder cursor.
4. **Export map and docs.**
   - `privacy/export-map.ts`: `mailboxes.uidvalidity` and `last_uid` move to the excluded list, reason "stale copy of the INBOX cursor; dropped by the contract migration".
   - `docs/capabilities/sync.md` rule 7 and `docs/architecture.md` § 5: remove "the INBOX cursor is also written to `mailboxes`" (dual write).
   - `deploy/README.md` § Synced folders, rollback bullet: replace the dual-write sentence and the pointer to steps (a) and (b) of the old sort-folder rollout with: a rollback goes one release back; every release since the sort-folder sync reads the cursor from `mailbox_folders`; no SQL.
   - `docs/code-patterns.md` and `docs/release-checklist.md`: remove any sentence that names this dual write as a live example (the worker greps "dual write").

## Decisions for this stage

- **S02-1 Rollback safety (D5).** The rollback target of the release that carries this stage is built from code where no reader uses the `mailboxes` cursor (checked at base `96cf823f`). The worker checks again at `HEAD`: no code outside tests reads `MailboxRow.uidvalidity` / `.last_uid` or selects `mailboxes.uidvalidity` / `mailboxes.last_uid` by name. If a reader exists at `HEAD`, stop and report it: the stage then waits one release.
- **S02-2 No SQL on rollback or roll forward.** After a rollback, the old release writes the copy again; that is harmless. After the roll forward, the new code ignores it.
- **S02-3 No new test that names the old columns.** The stop is shown by the removed code, the type change and the deleted test. A test that reads `mailboxes.last_uid` would fail after stage 05.
- **S02-4 Changelog.** None: no behaviour change an operator sees.

## Test

- T1 The existing folder-cursor tests pass unchanged: initial, incremental and rescan mode per folder; `mailbox:rescan` clears every folder cursor.
- T2 `bun run typecheck` passes with `MailboxRow` without the two fields (proves no reader).
- T3 The `privacy-export-map` test passes.

## Check

`bun test` on the mail sync and mail repo integration tests, the export-map test, `bun run typecheck`.

## Done when

- No statement in app code writes `mailboxes.uidvalidity` or `mailboxes.last_uid`; `MailboxRow` has neither field.
- The four doc places no longer describe a live dual write.
- The Proof command of `plan.md` (NN = 02) prints `PROOF_OK`.

## Out of scope

- Dropping the columns (stage 05).
- `mailbox_folders` and `mailbox_sent_sync` cursor columns.
- The emails columns (stages 01, 03, 04).
