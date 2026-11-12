---
opened: 2026-11-02
landed: 2026-11-10
---

# F019 · Subagents for the slice loop (plan → build → review)

## Outcome

Three Claude Code subagents run the build and review steps of each slice, so the user does not open a new session per step. The main session (strong model) stays the orchestrator and planner, because only it can ask the user questions.

## Notes

Moved from `tasks/done/subagents-setup.md` on 2026-11-12. The full old task (plan, decisions, log): [plan.md](plan.md).
