---
opened: 2026-11-07
---

# F039 · Edit the approval message with the result

## Outcome

The result of a send is a new Telegram message (outbox kind `send_result`). The approval message keeps only the line that the tap added. An edit of the approval message with the result would read better: one message for each mail, from the request to the result.

## Notes

Moved from `tasks/planned/approval-edit-in-place.md` on 2026-11-12. The full old task (plan, decisions, log): [plan.md](plan.md).
