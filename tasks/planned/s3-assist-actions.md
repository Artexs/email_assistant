> **Status 2026-11-02 — planned.** Left: everything. Write the file-level plan when the task moves to `active/`.

# S3 Assist actions

Scope: `docs/roadmap.md` §2, row S3. Modules: `docs/modules.md`. Needs: S2.

## Goal
In mode `assist` the system changes the mailbox for real (folder moves, mark read, flag, summaries), only for categories that passed the S1b go/no-go table. Every change has Undo.

## Done when
- One week of `assist` mode with at most N wrong moves, found by Undo or feedback (the user sets N before the start).
- The Undo button restores the mail (folder, read state, flag) and writes feedback (test).
- A user move back to INBOX after a system move gives exactly one `imap_move` feedback row; after an Undo it gives none; a second identical copy of a moved mail is stored and triaged as a new mail (tests).
- Every applied action has an audit row.
- A test stops the process between the IMAP call and the DB commit; after restart there is no double action.
- Soft errors do not count toward the 3 tries; after 3 hard errors the action is `failed` and the user gets a notice.
- Backups run (from S1a) and one restore test is logged.

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
