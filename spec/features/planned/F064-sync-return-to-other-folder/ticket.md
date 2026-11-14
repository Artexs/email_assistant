---
opened: 2026-11-09
---

# F064 · Sync: see a user move into a synced folder below that folder's cursor

## Outcome

Interia keeps the UID when the user moves a mail in webmail. If the user moves a mail into a synced folder that is not the row's source, and the UID is below that folder's cursor, the sync does not see the move. The row keeps its old folder, and an action on it ends `mail_not_found` (D24 (a) and (g)). Make the sync see such a move.

## Sequenced

- Planned together with F029: the plan, stages and questions are in the F029 folder (`spec/features/<lane>/F029-sync-return-of-a-later-copy/plan.md`; stages 02–05 are this ticket's part). This folder gets no stages of its own.
- Plan after: none. Build after: as F029 (F091 in `done/`).
- Gate: —. F032 (a copy below the cursor, planned separately) builds after F029.

## Notes

Moved from `tasks/planned/sync-return-to-other-folder.md` on 2026-11-12. The full old task (plan, decisions, log): [plan.md](plan.md).
