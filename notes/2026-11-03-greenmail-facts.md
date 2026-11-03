# GreenMail 2.1.15 facts (local IMAP/SMTP test server)

Learned in S1a stages 8–11 (2026-11-03). Dev: `bun run dev:up`; ports IMAP 3143, IMAPS 3993, SMTP 3025 on 127.0.0.1.

- Capabilities: `IMAP4rev1 LITERAL+ UIDPLUS SORT IDLE MOVE SASL-IR AUTH=XOAUTH2 QUOTA`. No CONDSTORE, no SPECIAL-USE.
- imapflow finds `Drafts`, `Sent`, `INBOX` by name (`specialUseSource: "name"`); INBOX gets `\Inbox`.
- GreenMail does not save SMTP mail to Sent (`smtp-saves-sent: no`).
- APPEND returns APPENDUID. SMTP on 3025 advertises `AUTH PLAIN LOGIN XOAUTH2`, so `verify()` really logs in.
- With auth off, a login with a new `u-<uuid>@localhost` creates the user (the tests use this).
- imapflow `messageDelete(uid, {uid:true})` sends UID EXPUNGE only with UIDPLUS, else a plain EXPUNGE. `mail/imap/probe.ts` deletes only when the stored and the live UIDPLUS are both true.
- IMAPS uses a self-signed cert: the TLS test expects `DEPTH_ZERO_SELF_SIGNED_CERT` (see `notes/2026-11-03-imapflow-tls-under-bun.md`).
