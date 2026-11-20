---
opened: 2026-11-09
landed: 2026-11-20
---

# F062 · The moved-mail columns have neutral names and the old INBOX cursor copy is gone

## Outcome

The sync keeps the cursor of each folder only in its folder row. The two mail columns that still carry INBOX-era names get names that match their meaning: the UID in the source folder, and a move in flight. The change ships in two releases so that a code rollback works at every step, as the release rules require.

## Scope

- Expand: new columns `emails.source_uid` and `emails.move_pending_at`, a trigger that keeps old and new names equal, all code on the new names.
- Stop the copy of the INBOX cursor into `mailboxes` (the dual write of the sort-folder sync).
- A guard test that no code names the old columns.
- Contract, one release later: drop the old emails columns, the trigger and `mailboxes.uidvalidity` / `last_uid`.
- Docs: architecture § 5, modules, the sync and Undo capability pages, ADR 0014, the deploy rollback notes.

## Out of scope

- The cursor columns of `mailbox_folders` and `mailbox_sent_sync` (same names, still in use).
- `SET NOT NULL` on the new columns.
- Any change of sync or Undo behaviour.

## Acceptance

- `bun run db:check-migrations` passes; the contract migration carries `-- contract: v<the expand release>`.
- An integration test shows that a write through either column name is visible under the other name while the trigger exists.
- After stage 04, the guard test finds no `inbox_uid`, `undo_pending_at` or `UndoPending` in `apps/`, `packages/`, `tools/`, `scripts/` outside its allow list (stage 04 step 3).
- After stage 05, `schema.ts` has no `inbox_uid`, `undo_pending_at`, and `Mailboxes` has no `uidvalidity` or `last_uid`.
- ADR 0014 records that this ticket closed the rollback window of the sort-folder sync.

## Slices

Five stages; see [`plan.md`](plan.md) § How to run. Stages 01 and 05 are migrations and each needs the single migration slot. Stage 05 starts only after the release that carries stages 01–04 is the running release on the VPS.

## Sequenced

- Plan after: none.
- Build after: none. Gate: stage 01 rides the release after v0.4.2 (expected v0.4.3); stage 05 rides the release after that (expected v0.4.4) (`notes/2026-11-20-replan-parallel.md` § 6).
- Overlap: the planned file split of large files (F143) may split `mail-sync.test.ts` or `actions-move.test.ts`; whichever lands second merges master and re-proves.

## Notes

Follow-up of the sort-folder sync (`spec/features/done/2026-11/F058-sync-sort-folders/plan.md` D3, D24; ADR 0014). Open defaults: [`questions.md`](questions.md).
