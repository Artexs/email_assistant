---
opened: 2026-11-11
---

# F068 · `actions.status` writers read the transitions map at runtime

## Outcome

The writer functions in `apps/server/src/modules/actions/repo.ts` take their guard (the `from` statuses per type) from `actions/transitions.ts`, or check `canTransition` before each write. Optionally close the latent edges L1–L8 and the extra latent edges of stage 2 (see the task above).

## Notes

Moved from `tasks/planned/actions-transitions-runtime.md` on 2026-11-12. The full old task (plan, decisions, log): [plan.md](plan.md).
