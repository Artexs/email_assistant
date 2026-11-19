Needs stage 03: `setMovePending`, the `movePendingAt` option of `updateEmailLocation`, and the mail tests on the new names. Needs stage 01: `emails.source_uid` in `schema.ts`.

# F062 stage 04 — Actions module on the new names, the guard test, the docs

Part of [`../plan.md`](../plan.md). Decisions D4, D9.

## Goal

No code in the repository names the old emails columns. A unit test keeps it so. The docs describe the columns by their new names.

## Steps

1. **Actions module.** The claim query (`actions/repo/claims.ts`) selects `emails.source_uid`; the claim row type field `inbox_uid` becomes `source_uid`; the Undo hint in `actions/apply.ts` (`toUid` of a reverse move) reads `email.source_uid`. Remove the comment "`inbox_uid` keeps its name".
2. **Remaining tests.** Rename the column in the actions integration tests (`actions-move`, `actions-undo`, `actions-apply`, `actions-committer`, `actions-schema`) and the other test helpers that insert emails (`scope-two-orgs`, `trust-history-classify-helpers`). The `actions-schema` case "a new email has inbox_uid and moved_at NULL" checks `source_uid` and `moved_at`.
3. **Guard test** `apps/server/src/platform/db/retired-columns.test.ts` (a unit test, no DB):
   - It reads every `.ts`, `.tsx`, `.astro`, `.js` and `.sql` file under `apps/`, `packages/`, `tools/` and `scripts/` (skip `node_modules`, `dist`, build output).
   - Retired names (case-sensitive, word bounded where shown): `\binbox_uid\b`, `\bundo_pending_at\b`, `undoPendingAt`, `UndoPending`, `\binboxUid\b`.
   - Allowed: `apps/server/src/platform/db/schema.ts`; `apps/server/src/modules/privacy/export-map.ts` (the excluded entries, until stage 05); the guard test itself; the stage-01 trigger test `apps/server/test/integration/emails-renamed-columns-schema.test.ts` (it writes the old names on purpose; stage 05 keeps it for its absence check); for `inboxUid` only, `mail/imap/probe-move.ts` and `imap-probe-move.test.ts` (D9).
   - The allow list is one exported-in-file constant `RETIRED_COLUMN_ALLOW` so stage 05 can shrink it.
   - A finding prints `<path>:<line> <name>`; the test fails on any finding.
4. **Docs.**
   - `docs/architecture.md` § 5 (`emails` row and the sync rules that name the columns): new names, drop "the name is old".
   - `docs/modules.md` (mail module: `updateEmailLocation`, the column list).
   - `docs/capabilities/actions-and-undo.md` and `docs/capabilities/sync.md`: new names.
   - ADR 0014: one dated line under its consequences: `inbox_uid` and `undo_pending_at` are now `source_uid` and `move_pending_at`; the old names stay in the DB until the contract migration of `spec/features/<lane>/F062-drop-mailbox-cursor-columns/`.
   - `notes/` and done tickets keep their old text (history).

## Decisions for this stage

- **S04-1 Guard scope.** The guard reads code, not docs. Docs are checked by the reviewer of this stage with `rg -n "inbox_uid|undo_pending_at" docs/architecture.md docs/modules.md docs/capabilities`: it must find only the "copy for the rollback window" note of stage 01 (which stage 05 removes).
- **S04-2 Why a source scan.** Until stage 05 the old names still typecheck (they are in `schema.ts`), and raw `sql` strings never typecheck. Only a scan stops a branch of another ticket that still writes `inbox_uid` from landing.
- **S04-3 Rename only.** As stage 03, S03-1.
- **S04-4 Changelog.** None.

## Test

- T1 The renamed actions tests pass with their old values: an Undo of a move from INBOX at UID 41 to `AI/Newsletter` at UID 9 uses `toUid = 41`; a rescue sets and clears the move-pending stamp.
- T2 Guard test, positive: run on the repo → no finding.
- T3 Guard test, negative (inside the same test file, on an in-memory list of fake files, no disk write): a file `apps/server/src/x.ts` with the text `inbox_uid` → one finding `apps/server/src/x.ts:1 inbox_uid`; the same text in `apps/server/src/platform/db/schema.ts` → no finding; `inboxUid` in `apps/server/src/modules/mail/imap/probe-move.ts` → no finding; `undoPendingAt` there → one finding.

## Check

`bun test apps/server/src/platform/db/retired-columns.test.ts`, the actions integration tests, `bun run typecheck`.

## Done when

- The guard test passes at `HEAD` and its negative cases pass.
- The docs listed in step 4 use the new names.
- The Proof command of `plan.md` (NN = 04) prints `PROOF_OK`.

## Out of scope

- The drop of any column (stage 05).
- The `mailboxes` cursor (stage 02).
- Renaming `probe-move` report fields (D9).
