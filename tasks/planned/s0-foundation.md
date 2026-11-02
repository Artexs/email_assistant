> **Status 2026-11-02 — planned.** Left: everything. Write the file-level plan when the task moves to `active/`.

# S0 Foundation

Scope: `docs/roadmap.md` §2, row S0. Modules: `docs/modules.md`. Needs: —.

## Goal
A clean base: Bun workspaces (`apps/server`, `apps/web`, `packages/core`), env check, logger, DB layer, new migration, local Supabase, CI. Old adapters removed (`docs/architecture.md` §12).

## Done when
- CI is green (lint, typecheck, test).
- The new migration applies on a clean local DB.
- `.ai/AGENT.md` is rewritten to match `docs/architecture.md`.

## Plan
Written when the task starts (files to change, steps, tests).

## Done-checklist
- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap); related ADRs set to accepted or superseded.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log
- 2026-11-02: Created from `docs/roadmap.md` and `docs/architecture.md` §11.
