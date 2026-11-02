> **Status 2026-11-02 — done.** Nothing left.

# Module catalog

Scope: the user asked for a high-level overview (repo split, tech, modules). Needs: `architecture-and-adrs.md`.

## Goal
Show how the system splits into modules, sub-modules, workers and pages, and how they talk.

## Done when
- `docs/modules.md` exists and `docs/architecture.md` links to it.

## Result
- `docs/modules.md`: monorepo layout, "DB state + small workers" communication, module and sub-module catalog
  with owned tables and slices, web pages, status flows. Commit `5ad0fcc`.

## Done-checklist
- [x] Done-when checks pass (see log).
- [x] `docs/` describe the result.
- [x] Learned facts are in `notes/`.
- [x] Follow-up ideas are in `planned/`.

## Log
- 2026-11-02: Done in the restart chat. Created as a task file on 2026-11-02 from `architecture-reset.md` §6.
