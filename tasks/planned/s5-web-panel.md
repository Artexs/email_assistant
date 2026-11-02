> **Status 2026-11-02 — planned.** Left: everything. Write the file-level plan when the task moves to `active/`.

# S5 Web panel (lite)

Scope: `docs/roadmap.md` §2, row S5. Modules: `docs/modules.md`. Needs: S3 (S4 for delegation data).

## Goal
Setup and control without the CLI: login, onboarding, mailboxes, settings, rules, activity (`docs/modules.md` §4).

## Done when
- The user can set up a mailbox and link Telegram without the CLI.
- The activity page shows each mail's decision and reason, with Undo and ✅ / ✏️ feedback.
- Playwright smoke tests pass.
- The panel is reachable from outside the home network only through TLS (reverse proxy or tunnel).

## Plan
Written when the task starts (files to change, steps, tests).

Before the start: ask 5–10 target customers which mail provider they use (decides if Gmail / Microsoft 365 come before S6). Decide the login method and the web stack (static build served by the server is preferred).

## Done-checklist
- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap); related ADRs set to accepted or superseded.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log
- 2026-11-02: Created from `docs/roadmap.md` and `docs/architecture.md` §11.
- 2026-11-02: Changed after the cold review (`tasks/done/mvp-plan-review.md`) and the user's answers (IMAP, home VPS, own Postgres).
