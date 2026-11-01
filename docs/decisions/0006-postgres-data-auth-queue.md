# 0006 — Postgres (Supabase) for data, auth and work queue
- Status: proposed
- Date: 2026-11-01

## Context
Supabase is already set up. The committer needs DB transactions; `supabase-js` has none (only RPC).
The old docs added Redis for queues. Volume is small (< 200 mails/day/mailbox).

## Decision
- Supabase Postgres (EU region) for data and Supabase Auth for login.
- SQL migrations in `supabase/migrations` are the source of truth (RLS policies are SQL).
- The server uses a direct Postgres connection with transactions and a typed query layer generated from the DB
  (default: Kysely + kysely-codegen; confirm in slice S0).
- The web app uses Supabase only for login. It reads and writes data through the server API.
- RLS is on for every table as a second line of defense. The server filters by `org_id` through a `TenantContext`.
- Work queue: the `emails` table (`status`, `attempts`, `locked_at`) claimed with `FOR UPDATE SKIP LOCKED`.
  Scheduler in the server process. A job library (pg-boss or Supabase Queues) only if more job types appear.

## Consequences
- No Redis, no extra service.
- Server code bypasses RLS, so tenant filters must be tested.
- The generic `IDatabaseProvider` CRUD wrapper is removed.
