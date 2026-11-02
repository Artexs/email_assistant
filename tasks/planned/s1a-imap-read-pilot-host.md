> **Status 2026-11-02 — planned.** Left: everything. Write the file-level plan when the task moves to `active/`.

# S1a IMAP read + pilot host

Scope: `docs/roadmap.md` §2, row S1a. Modules: `docs/modules.md`. Needs: S0.

## Goal
The system reads the user's Interia INBOX over IMAP every 5 minutes and stores new mail, on the home VPS, with backups and a heartbeat. No LLM yet, no change to the mailbox.

## Done when
- `bun run mailbox:check` on the real Interia account prints the capabilities (IDLE, MOVE, UIDPLUS, CONDSTORE, SPECIAL-USE, keywords), the special-use folders, and whether SMTP saves sent mail by itself. The result is in `notes/`.
- `bun run mailbox:connect` stores the password encrypted; a test reads the raw DB row and finds no plain text.
- On the test mailbox (seeded with synthetic mail by IMAP APPEND): 48 hours of sync with no lost and no duplicate mail.
- Tests: a UIDVALIDITY change, a mail without `Message-ID`, a known mail that comes back to INBOX (not stored twice, not triaged again; the feedback row comes in S1b), mail sent by the owner (skipped).
- Compose (`server` + `db`) runs on the home VPS with `restart: unless-stopped`; `db` has no public port.
- The heartbeat reaches the external dead-man's-switch service; a stopped server raises its alert (test once).
- A nightly encrypted `pg_dump` is copied off the VPS; one restore test is done and logged.
- The IMAP adapter checks TLS certificates (no `rejectUnauthorized: false`).

## Plan
Written when the task starts (files to change, steps, tests).

User steps first: turn on "korzystam z programu pocztowego" in Interia; create a second Interia account for tests; Docker or Podman on the home VPS.
Rules: `docs/architecture.md` §6.1 (IMAP), §8 (operations), §10 (deployment).

## Done-checklist
- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap); related ADRs set to accepted or superseded.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log
- 2026-11-02: Created from the cold review (`tasks/done/mvp-plan-review.md`, findings F2, F8) and the user's answers (Interia IMAP, home VPS).
