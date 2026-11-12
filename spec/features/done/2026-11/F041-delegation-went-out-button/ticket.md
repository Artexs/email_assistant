---
opened: 2026-11-07
landed: 2026-11-12
---

# F041 · A button 'It went out' after outcome_unknown

## Outcome

After a send ends as `outcome_unknown`, the delegation stays `cancelled` even when the mail did go out. A later reply of the delegate is then not matched. A button '✅ It went out' in the result notice would set the delegation to `sent` with the stored `outgoing_message_id`, without a new SMTP call, so the reply is matched and the chaser works.

## Notes

Moved from `tasks/planned/delegation-went-out-button.md` on 2026-11-12. The full old task (plan, decisions, log): [plan.md](plan.md).
