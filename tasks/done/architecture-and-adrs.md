> **Status 2026-11-01 — done.** Left for the user: review ADRs 0001–0006, 0008, 0009 (`planned/docs-and-adr-review.md`).

# Architecture and ADRs

Scope: restart of the project. Needs: `product-brief.md`.

## Goal
A clear target architecture and the main technical decisions, written down.

## Done when
- `docs/architecture.md` and `docs/decisions/0001–0009` exist; `CLAUDE.md` points to `docs/`.

## Result
- `docs/architecture.md`: diagrams, data model, pipeline (rules → classify → plan → policy → commit), slices S0–S6. Commit `ed7ce8f`.
- ADRs 0001–0009 in `docs/decisions/` (status: proposed, except 0007).
- Main choices: one repo, Bun workspaces, modular monolith; Gmail API first; Telegram first; Postgres (Supabase) for data, auth and queue; LLM returns data only.

## Done-checklist
- [x] Done-when checks pass (see log).
- [x] `docs/` describe the result.
- [x] Learned facts are in `notes/`.
- [x] Follow-up ideas are in `planned/`.

## Log
- 2026-11-01: Done in the restart chat. Created as a task file on 2026-11-02 from `architecture-reset.md` §6.
