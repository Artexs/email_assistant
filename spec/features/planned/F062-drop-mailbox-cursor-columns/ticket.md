---
opened: 2026-11-09
---

# F062 · Drop the old cursor columns and rename the INBOX-named columns

## Outcome

The sync reads the cursor of each folder from `mailbox_folders`. The old columns stay only so that the code before the sort-folder sync still runs after a code rollback ("Roll back the code, not the migration", `deploy/README.md`). Remove them and the dual write, and give the INBOX-named columns neutral names.

## Notes

Moved from `tasks/planned/drop-mailbox-cursor-columns.md` on 2026-11-12. The full old task (plan, decisions, log): [plan.md](plan.md).
