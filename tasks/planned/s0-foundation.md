> **Status 2026-11-02 — planned.** Left: everything. Write the file-level plan when the task moves to `active/`.

# S0 Foundation

Scope: `docs/roadmap.md` §2, row S0. Modules: `docs/modules.md`. Needs: — (ADR review done: `tasks/done/docs-and-adr-review.md`).

## Goal
A clean base: Bun workspaces (`apps/server`, `apps/web`, `packages/core`), env check, logger, DB layer with a migration runner, tenancy tables (`organizations`, `users`, `memberships`), Compose `db` for dev, CI, `GET /health`. Old code and deps removed (`docs/architecture.md` §12). Other tables come with their slice.

## Done when
- CI is green: lint, typecheck, unit tests, integration tests against Postgres in a service container.
- `bun run db:migrate` applies all migrations on an empty Postgres 17 container; `bun run db:types` generates the Kysely types.
- The server starts and `GET /health` returns 200 with the DB status.
- The env check stops the start on a missing key (test).
- A test shows that a tenancy repository function filters by `org_id`.
- `openai`, `express`, `helmet`, `cors`, `googleapis`, `@supabase/supabase-js`, `dotenv` are not in any `package.json`; `backend/supabase/` is gone.
- One lockfile (`bun.lock`); no `package-lock.json`. Root `.env.example` lists only keys that the code reads. README says Bun, not npm.
- `docs/code-patterns.md` matches the new layout.
- The server connects as the DB role `app`, not as `migrator` or a superuser (test). `db/roles.sql` creates `migrator` (owns the tables, runs the migrations) and `app` (passwords from env); the superuser runs it once: the `db` init script on the Mac, a `psql` step in CI (service containers cannot mount repo files). Details: `docs/architecture.md` §5.
- `bun run org:create` creates the pilot organization, user and owner membership (tenancy belongs to S0).
- `bun run gemini:test` runs from the repo root (script moved to `apps/server/src/scripts/`); `tasks/active/gemini-setup.md` and `docs/roadmap.md` §5 name the new command.
- CI lints, typechecks and builds `apps/web` (the Astro starter stays as it is until S5).

## Plan
Written when the task starts (files to change, steps, tests).

Notes: pick the migration runner (for example `dbmate`) and confirm Kysely + kysely-codegen here. Fix root lint, husky and lint-staged paths (they point to `backend/**`).
The old `ImapEmailProvider` and all other old adapters are deleted in S0 (S1a can read them with `git show 29e9522:<path>`).
The dev Mac has the Docker CLI + Colima (installed 2026-11-02, `docker run postgres:17` works).

## Done-checklist
- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap); related ADRs set to accepted or superseded.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log
- 2026-11-02: Created from `docs/roadmap.md` and `docs/architecture.md` §11.
- 2026-11-02: Changed after the cold review (`tasks/done/mvp-plan-review.md`) and the user's answers (IMAP, home VPS, own Postgres).
