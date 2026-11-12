---
opened: 2026-11-09
---

# F064 · Sync: see a user move into a synced folder below that folder's cursor

## Outcome

Interia keeps the UID when the user moves a mail in webmail. If the user moves a mail into a synced folder that is not the row's source, and the UID is below that folder's cursor, the sync does not see the move. The row keeps its old folder, and an action on it ends `mail_not_found` (D24 (a) and (g)). Make the sync see such a move.

## Notes

Moved from `tasks/planned/sync-return-to-other-folder.md` on 2026-11-12. The full old task (plan, decisions, log): [plan.md](plan.md).
