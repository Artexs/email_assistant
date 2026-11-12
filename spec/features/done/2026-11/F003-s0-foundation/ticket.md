---
opened: 2026-11-02
landed: 2026-11-03
---

# F003 · S0 Foundation

## Outcome

A clean base: Bun workspaces (`apps/server`, `apps/web`, `packages/core`), env check, logger, DB layer with a migration runner, tenancy tables (`organizations`, `users`, `memberships`), Compose `db` for dev, CI, `GET /health`. Old code and deps removed (`docs/architecture.md` §12). Other tables come with their slice.

## Notes

Moved from `tasks/done/s0-foundation.md` on 2026-11-12. The full old task (plan, decisions, log): [plan.md](plan.md).
