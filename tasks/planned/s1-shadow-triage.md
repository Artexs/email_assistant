> **Status 2026-11-02 — planned.** Left: everything. Write the file-level plan when the task moves to `active/`.

# S1 Shadow triage

Scope: `docs/roadmap.md` §2, row S1. Modules: `docs/modules.md`. Needs: S0.

## Goal
The system reads the user's Gmail and logs what it *would* do (mode `shadow`). Accuracy is measured.

## Done when
- One week of the user's mail is classified.
- Accuracy is measured on at least 100 labeled mails (eval runner).

## Plan
Written when the task starts (files to change, steps, tests).

**Gate:** Gemini Cloud Billing must be on before the system reads real mail (ADR 0007).

## Done-checklist
- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap); related ADRs set to accepted or superseded.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log
- 2026-11-02: Created from `docs/roadmap.md` and `docs/architecture.md` §11.
