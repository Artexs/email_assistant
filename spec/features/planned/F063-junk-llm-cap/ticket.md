---
opened: 2026-11-09
---

# F063 · A separate daily LLM limit for spam folder mail

## Outcome

Mail from the spam folder (`Wiadomości-śmieci`) uses the shared daily LLM cap (`LLM_DAILY_CAP`, default 300). The count on 2026-11-08 showed 3 spam folder mails in 8 days, so D14 added no separate limit. If a spam wave ever uses the cap, add one so that spam folder mail cannot starve the other mail.

## Notes

Moved from `tasks/planned/junk-llm-cap.md` on 2026-11-12. The full old task (plan, decisions, log): [plan.md](plan.md).
