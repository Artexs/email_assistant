> **Status 2026-11-03 — planned.** Left: everything.

# Smaller env for the running server container

Scope: `deploy/compose.yaml`, `docs/architecture.md` §10. Needs: S1a.

## Goal
The long-running `server` container gets only the keys it needs. Today `env_file: ../.env` gives it every key, also `POSTGRES_PASSWORD` (superuser) and `MIGRATOR_PASSWORD`. A compromised server could then change the schema or read all data as superuser.

## Idea
- Split the root `.env` into a server env (APP_PASSWORD URL, CREDENTIALS_KEY, HEARTBEAT_URL, LOG_LEVEL) and a migrate/admin env.
- Run `db:migrate` with a separate one-off service or `--env-file` that has `MIGRATOR_DATABASE_URL`.

## Log
- 2026-11-03: Created from the S1a stage 14 review (finding 5, question).
