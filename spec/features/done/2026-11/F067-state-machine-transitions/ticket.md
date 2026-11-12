---
opened: 2026-11-11
landed: 2026-11-11
---

# F067 · Explicit state machine for `actions.status`

## Outcome

Make the implicit state machine of `actions.status` explicit: one map in code of the states, the entry states, the allowed edges and the guard of each writer function. Tests compare the map with the real guards in Postgres. The task adds a safety net only: **it must not change runtime behavior.**

## Notes

Moved from `tasks/done/state-machine-transitions.md` on 2026-11-12. The full old task (plan, decisions, log): [plan.md](plan.md).
