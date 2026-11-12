> **Status 2026-11-02 — done.** Left for the user: approve the new wording of the task rule in `~/.pi/agent/AGENTS.md`.

# Task and docs convention

Scope: handoff `~/.pi/agent/notes/2026-11-02-handoff-docs-and-tasks.md`. Needs: `roadmap-and-scope.md`.

## Goal
Decide where plans, docs, notes and tasks live and how a task moves, so that all work is visible in `tasks/`.

## Done when
- The user approved the convention and the repo follows it.

## Result
- `tasks/README.md`: folders, "one source per fact" table, life of a task, template, done-checklist. Commit `850e0e7`.
- Slices S0–S6 are task files in `planned/`. `docs/roadmap.md` and `docs/architecture.md` §11 link to them.
- `CLAUDE.md` points to `tasks/README.md`. New tasks go to `planned/`; to `active/` only when the user says "start now".
- Rule: before a task goes to `done/`, the agent updates `docs/` to match what was built.
- No skill for this: `CLAUDE.md` + README are enough. Make a skill only if agents skip the steps.
- The MVP preparation work of the restart chat was split into task files in `done/`.

## Done-checklist
- [x] Done-when checks pass (see log).
- [x] `docs/` describe the result.
- [x] Learned facts are in `notes/`.
- [x] Follow-up ideas are in `planned/`.

## Log
- 2026-11-02: Convention agreed with the user and written. Old work split into done tasks.
