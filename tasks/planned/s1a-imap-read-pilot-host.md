> **Status 2026-11-02 — planned.** Left: everything. Write the file-level plan when the task moves to `active/`.

# S1a IMAP read + pilot host

Scope: `docs/roadmap.md` §2, row S1a. Modules: `docs/modules.md`. Needs: S0.

## Goal
The system reads the user's Interia INBOX over IMAP every 5 minutes and stores new mail, on the home VPS, with backups and a heartbeat. No LLM yet, no change to the mailbox.

## Done when
- `bun run mailbox:check` on the real Interia account prints the capabilities (IDLE, MOVE, UIDPLUS, CONDSTORE, SPECIAL-USE, keywords), the special-use folders, whether SMTP saves sent mail by itself, and whether `SEARCH HEADER` finds a custom `X-` header. The result is in `notes/`.
- `bun run mailbox:connect` stores the password encrypted; a test reads the raw DB row and finds no plain text.
- On the test mailbox: 48 hours of sync with no lost and no duplicate mail, while a timer APPENDs new synthetic mail every hour. The 48 hours include one manual move back to INBOX and one forced UIDVALIDITY rescan.
- Tests: a UIDVALIDITY change (known mail only gets its new `uid`), a mail without `Message-ID`, the same `Message-ID` with a different content hash (stored as a new mail), `UID FETCH n:*` returning a message below the cursor (ignored), a known mail that comes back to INBOX after a system move (`returned_at` set, not triaged again), a mail with the owner's `From:` (stored, not skipped), a mail with a known `X-EA-Action-Id` (skipped).
- Compose (`server` + `db`) runs on the home VPS with `restart: unless-stopped`; `db` has no public port. Docker or Podman is picked at the start; after a VPS reboot both containers run again (test once).
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
