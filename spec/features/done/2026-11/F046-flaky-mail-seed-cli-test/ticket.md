---
opened: 2026-11-07
landed: 2026-11-07
---

# F046 · Flaky CI test: mailbox:seed and mailbox:audit CLI

## Outcome

Stop the CI timeout of `mailbox:seed and mailbox:audit CLI > seed exits 1 for a wrong or missing test address, and 0 with the right one; audit exits 2, then 0` in `apps/server/test/integration/mail-seed.test.ts`.

## Notes

Moved from `tasks/done/flaky-mail-seed-cli-test.md` on 2026-11-12. The full old task (plan, decisions, log): [plan.md](plan.md).
