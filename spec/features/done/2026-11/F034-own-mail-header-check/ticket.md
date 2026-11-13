---
opened: 2026-11-07
---

# F034 · Wire `isOwnActionId` into the sync job (own-mail header check)

## Outcome

`apps/server/src/main.ts` stubs `isOwnActionId` to `false`. S4 creates drafts and sent mail with the header `X-EA-Action-Id`. S4 must wire `actions.isOwnActionId` into the sync job. Then the sync recognizes mail that the system made and does not triage it again.

## Notes

Moved from `tasks/planned/own-mail-header-check.md` on 2026-11-12. The full old task (plan, decisions, log): [plan.md](plan.md).
