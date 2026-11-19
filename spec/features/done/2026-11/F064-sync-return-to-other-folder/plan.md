> **Status 2026-11-09 — planned.** Not started. Real-mailbox numbers come from the pilot weeks.

# Sync: see a user move into a synced folder below that folder's cursor

Scope: follow-up of [`../../done/2026-11/F058-sync-sort-folders/plan.md`](../../done/2026-11/F058-sync-sort-folders/plan.md) (stage 8; known limits D24 (a) and (g)). Needs: that task done. Related: [`copy-below-cursor.md`](../F032-copy-below-cursor/plan.md), [`sync-return-of-a-later-copy.md`](../F029-sync-return-of-a-later-copy/plan.md).

## Goal

Interia keeps the UID when the user moves a mail in webmail. If the user moves a mail into a synced folder that is not the row's source, and the UID is below that folder's cursor, the sync does not see the move. The row keeps its old folder, and an action on it ends `mail_not_found` (D24 (a) and (g)). Make the sync see such a move.

## Done when

- A mail that the system moved (or stored) and that the user then puts into another synced folder, with its UID below that folder's cursor, gets the new `folder` on its row.
- A sync test pins the case (stage 8 test 4 pins the known limit today and changes to the new result).
- The cost is measured: no extra IMAP call per sync pass that grows with the mailbox size.

## Plan

Write the file-level plan when the task starts. Start from `checkReturnedBelowCursor` in `apps/server/src/modules/mail/sync.ts`: it checks only the row's source folder today.

- [ ] Write the plan.

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap); related ADRs set to accepted or superseded.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log

- 2026-11-09: Created from the follow-ups of `sync-sort-folders` (stage 15, step 15.2).
