---
opened: 2026-11-03
---

# F021 · Smaller env for the running server container

## Outcome

The long-running `server` container gets only the keys it needs. Today `env_file: ../.env` gives it every key, also `POSTGRES_PASSWORD` (superuser) and `MIGRATOR_PASSWORD`. A compromised server could then change the schema or read all data as superuser.

## Notes

Moved from `tasks/planned/server-env-scope.md` on 2026-11-12. The full old task (plan, decisions, log): [plan.md](plan.md).
