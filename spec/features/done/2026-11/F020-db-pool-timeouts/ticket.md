---
opened: 2026-11-03
landed: 2026-11-03
---

# F020 · DB pool connection timeout

## Outcome

`GET /health` returns 503 fast when the DB host drops packets, not only when it refuses the connection.

## Notes

Moved from `tasks/done/db-pool-timeouts.md` on 2026-11-12. The full old task (plan, decisions, log): [plan.md](plan.md).
