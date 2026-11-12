---
opened: 2026-11-05
landed: 2026-11-07
---

# F024 · Index for the email claim query

## Outcome

Status 2026-11-07 — done. Done by S3 stage 2: migration `20261107000001_assist_actions.sql` adds `emails_claim_idx (mailbox_id, status, received_at)`.

## Notes

Moved from `tasks/done/s1b-claim-index.md` on 2026-11-12. The full old task (plan, decisions, log): [plan.md](plan.md).
