> **Status 2026-11-09 — planned.** Not started. Start it after the pilot weeks of the sort-folder sync, when no code rollback is needed any more.

# Drop the old cursor columns and rename the INBOX-named columns

Scope: follow-up of [`../active/sync-sort-folders.md`](../active/sync-sort-folders.md) (D1, D5, D24; ADR 0014). Needs: that task done and its pilot weeks without a code rollback.

## Goal

The sync reads the cursor of each folder from `mailbox_folders`. The old columns stay only so that the code before the sort-folder sync still runs after a code rollback ("Roll back the code, not the migration", `deploy/README.md`). Remove them and the dual write, and give the INBOX-named columns neutral names.

## Done when

- A migration renames `emails.inbox_uid` → `source_uid` and `emails.undo_pending_at` → `move_pending_at`, and every query, type, test and doc uses the new names.
- A migration drops `mailboxes.uidvalidity` and `mailboxes.last_uid`. The sync no longer writes the copy of the INBOX cursor (the dual write).
- `docs/architecture.md` §5 and `docs/modules.md` name the new columns. ADR 0014 notes that this task closed the rollback window.
- `bun run lint && bun run typecheck && bun run test:unit && bun run test:int` pass.

## Plan

Write the file-level plan when the task starts. This is a migration: mark the migration step `[risky]`. Check that no deployed code before the sort-folder sync is still in use.

- [ ] Write the plan.

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap); related ADRs set to accepted or superseded.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log

- 2026-11-09: Created from the follow-ups of `sync-sort-folders` (stage 15, step 15.2).
