---
opened: 2026-11-12
---

# F071 · Move the agent workflow to Limen

## Outcome

New features run as Limen jobs: one coordinator pi session with the user, workers and reviewers as Limen jobs in their own worktrees, tickets in `spec/features/`. The useful parts of the current flow stay: deep plans for `[risky]` work, user approval before risky merges, the shared-runtime rules.

## Notes

Moved from `tasks/active/limen-transition.md` on 2026-11-12. The full old task (plan, decisions, log): [plan.md](plan.md). Its stage files: [stages/](stages/).
