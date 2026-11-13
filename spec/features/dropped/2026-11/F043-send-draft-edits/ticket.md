---
opened: 2026-11-07
---

# F043 · Send the draft as the user edited it

## Outcome

In S4 the system sends the text that the user approved in the database. An edit of the draft in the mail client does not count, and the approval message says so. Phase 2: the user edits the draft in the mail client and the system sends the edited draft. The committer would read the draft back from Drafts before the send (`locateByActionId` finds it by the header).

## Notes

Moved from `tasks/planned/send-draft-edits.md` on 2026-11-12. The full old task (plan, decisions, log): [plan.md](plan.md).
