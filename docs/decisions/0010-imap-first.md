# 0010 — IMAP + SMTP with a password first, behind a MailProvider port

- Status: accepted (user, 2026-11-02), amended by 0014
- Date: 2026-11-02
- Supersedes: 0004

## Context

The pilot mailbox is at Interia (`@poczta.interia.pl`), not Gmail (user, 2026-11-02).
The user wants mail access through IMAP with the mailbox password for now. Google sign-in (OAuth / SSO) can come later.
The Gmail API path (ADR 0004) needs Google verification and a yearly CASA assessment for every public app.
That cost does not apply to IMAP at Interia. Many Polish business mailboxes are at IMAP hosts (Interia, Onet, WP, home.pl, OVH, nazwa.pl).

## Decision

- Mail access: IMAP over TLS (port 993) to read and move mail, SMTP over TLS (port 465) to send. Login = address + password.
  Use an app password if the provider has one (check at Interia in S1a).
- POP3 is not supported: it has no folders, no flags and no drafts, so the system cannot archive or move mail with it.
- One `MailProvider` port in the `mail` module. First adapter: `imap/` (libraries `imapflow`, `mailparser`, `nodemailer`).
- TLS certificates are always checked (the old Interia config turned the check off: `backend/src/adapters/get_provider.ts:35`).
- Folders replace Gmail labels: `AI/Spam`, `AI/Info`, `AI/Notifications`, `AI/Manual` (names from config, per mailbox).
- Sync: poll INBOX every 5 minutes with a cursor (UIDVALIDITY + last UID). The dedup key is the `Message-ID` header + a content hash.
- Send is at-most-once: SMTP has no idempotency key. The action is `applied` at once after the SMTP 250, and the system never retries
  a send by itself after an error with an unknown stage (`docs/architecture.md` §4.1 rule 6).
  IMAP IDLE (push) can come later.
- The rules for sync, threads, moves, drafts and send are in `docs/architecture.md` §6.1.

## Consequences

- No Google verification and no CASA for the pilot and for IMAP customers.
- The stored secret is a full mailbox password, not a scoped token. It is encrypted (ADR 0009). An app password limits the damage.
- IMAP has no thread ids and no labels: the system builds threads from headers and uses one folder per mail.
- Server features differ per provider (MOVE, UIDPLUS, keywords, SPECIAL-USE). S1a checks them and stores them per mailbox.
- 2026-11-03 (S1a check): Interia has IDLE and UIDPLUS; no MOVE, CONDSTORE, SPECIAL-USE capability or custom keywords; no `UIDNEXT` on SELECT;
  `SEARCH HEADER` finds nothing for `X-` headers and `Message-ID`; SMTP does not save sent mail; a move keeps the UID. App passwords: not checked yet; the pilot uses the normal password.
  Details: `notes/2026-11-03-interia-imap-capabilities.md`.
- 2026-11-07 (S3 stage 1): the hierarchy delimiter is `/` and a nested folder needs its parent first; a protocol COPY gives a new UID and keeps size, INTERNALDATE and `Message-ID` (a webmail move keeps the UID). So S3 finds moved mail by identity (`locateMessage`), not by header search. Details: `notes/2026-11-03-interia-imap-capabilities.md`, "Move probe".
- 2026-11-07 (S4 stage 1, Interia probe): SMTP on port 465 answers `DATA` with 354 and the end of the data with 250. It saves no copy in `Wysłane`, so the committer APPENDs one after the 250 (locate first, APPEND only if missing). A mail sent to the mailbox's own address comes back to INBOX after about 1 s with `X-EA-Action-Id` intact, so the sync skips mail whose header matches an `actions` row. nodemailer reports the stage only in part (a dropped connection after the content looks like a dropped connection after the greeting), so the adapter classifies an SMTP error by stage with a logger hook: a server reply after the client `DATA` line starts the content phase, and the committer never retries after `content` or `unknown` (`docs/architecture.md` §4.1 rule 6). Details: `notes/2026-11-07-send-approval-facts.md`.
- Microsoft 365 turned off password login for IMAP; Gmail needs OAuth or an app password. Adding them is a new adapter
  (Phase 2), and Gmail OAuth brings back Google verification.
