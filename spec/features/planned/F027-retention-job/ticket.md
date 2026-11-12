---
opened: 2026-11-06
---

# F027 · Retention job (`platform.retention`)

## Outcome

A daily job in the server process clears text columns after their retention time, so stored mail text and message text do not stay longer than the documented time. Today no job runs: `emails.body_text`, the digest and notice texts in `outbox.text` and the other rows in the table below stay for ever.

## Notes

Moved from `tasks/planned/retention-job.md` on 2026-11-12. The full old task (plan, decisions, log): [plan.md](plan.md).
