> **Status 2026-11-02 — planned.** Left: everything. Write the file-level plan when the task moves to `active/`.

# S2 Telegram

Scope: `docs/roadmap.md` §2, row S2. Modules: `docs/modules.md`. Needs: S1b.

## Goal
Digest and urgent notices on the user's phone through a Telegram bot. The user corrects the AI with one tap. Works in shadow mode.

## Done when
- The user gets the digest in Telegram at the set times; each line has ✅ / ✏️ buttons that write `triage_feedback`.
- An urgent mail gives a notice ≤ 10 minutes after it arrives (5-minute sync + one tick).
- An IMAP login error gives an `auth_error` notice.
- The digest shows "last sync HH:MM", also when it is empty.
- `/digest`, `/pause`, `/resume`, `/status` work.
- Tests: an update from an unlinked chat gets no reply; a used or expired link token fails.
- Dev and pilot use two different bots.

## Plan
Written when the task starts (files to change, steps, tests).

## Done-checklist
- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap); related ADRs set to accepted or superseded.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log
- 2026-11-02: Created from `docs/roadmap.md` and `docs/architecture.md` §11.
- 2026-11-02: Changed after the cold review (`tasks/done/mvp-plan-review.md`) and the user's answers (IMAP, home VPS, own Postgres).
