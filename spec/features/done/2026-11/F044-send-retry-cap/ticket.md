---
opened: 2026-11-07
landed: 2026-11-12
---

# F044 · A shorter cap for send retries

## Outcome

A soft `envelope` error (a 4xx reply, a lost connection or a timeout before the content) retries every 5 minutes without a count. Only `held_timeout` ends it, 48 hours after the tap. A shorter cap with its own text, for example 6 hours and then `failed` / `smtp_error`, would tell the user sooner.

## Notes

Moved from `tasks/planned/send-retry-cap.md` on 2026-11-12. The full old task (plan, decisions, log): [plan.md](plan.md).
