> **Status 2026-11-02 — planned.** Left: everything. Write the file-level plan when the task moves to `active/`.

# S4 Drafts, approvals, delegation

Scope: `docs/roadmap.md` §2, row S4. Modules: `docs/modules.md`. Needs: S3.

## Goal
Delegation and clarification drafts, approval with Telegram buttons, send by SMTP only after approval, delegation tracking and chaser. Safe against prompt injection.

## Done when
- A delegation goes out only after a button tap and is followed up by the chaser.
- Tests: no code path sends without an approval row; two taps send once; an expired or rejected approval cannot send.
- A crash test in `applying` shows no second draft and no second send (`X-EA-Action-Id` lookup).
- A delegate's reply in the thread sets the delegation to `answered`.
- The approval message shows the recipient, the original sender, the external-sender warning and the full draft text.
- Injection eval cases pass: links, bank account numbers and phone numbers in LLM text are removed or marked.

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
