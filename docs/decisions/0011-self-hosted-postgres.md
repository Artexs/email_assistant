# 0011 — Own Postgres in Compose on the home VPS; no Supabase
- Status: accepted (user, 2026-11-02)
- Date: 2026-11-02
- Supersedes: 0006

## Context
The pilot runs on a home VPS that is on all the time (user, 2026-11-02). The user wants an own database.
The web app reads no domain tables directly (it uses the server API), so the Supabase Data API and RLS-for-clients have no user.
Local Supabase starts about 10 containers. The server needs plain Postgres with transactions.

## Decision
- Postgres 17 (stock image) in a container. Docker or Podman Compose runs two services: `db` and `server`.
  `db` listens only on the internal Compose network (or `127.0.0.1`). It has no public port.
- SQL migration files in `db/migrations/` are the source of truth. A small runner applies them (tool chosen in S0, for example `dbmate`).
- Query layer: Kysely + kysely-codegen (types from the DB).
- The server uses its own DB role `app` (not the superuser). `db/roles.sql` creates `app` and `migrator` (owner of the tables, runs the migrations);
  migrations grant `app` its rights.
  `app` has only INSERT and SELECT on `audit_log`.
  One privileged function deletes the data of a mailbox or an organization.
- Tenant isolation: every repository function takes a `TenantContext` and filters by `org_id`. Integration tests check this.
  Option for S6: the server runs under RLS with `set_config('app.org_id', …)` in each transaction.
- Work queue: the `emails` and `actions` tables (`status`, `attempts`, `next_attempt_at`, `locked_at`), claimed with
  `FOR UPDATE SKIP LOCKED`. The scheduler runs in the server process. No Redis.
- Web login is decided when S5 starts (own `users` table now; options then: e-mail magic link, Telegram login, passkeys).
- Backups: a nightly `pg_dump`, encrypted, copied off the VPS. One restore test per month.

## Consequences
- One small stack: 2 containers, starts in seconds, little RAM.
- No Supabase Auth: S5 needs its own login (small, for one or a few users).
- The VPS owner runs backups and updates. External customers (S6) need a hosted EU server, not a home machine.
- Old Supabase files (`backend/supabase/`, `@supabase/supabase-js`, migration `20251202212208_…`) are removed in S0.
