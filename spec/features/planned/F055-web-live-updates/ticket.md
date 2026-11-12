---
opened: 2026-11-08
---

# F055 · Live updates in the web panel (server-sent events)

## Outcome

A page refreshes within a second of a change instead of the 30-second poll of S5, without a second request path for the data: a push signal only says "something changed for this organization", and the page refetches through the same hook.

## Notes

Moved from `tasks/planned/web-live-updates.md` on 2026-11-12. The full old task (plan, decisions, log): [plan.md](plan.md).
