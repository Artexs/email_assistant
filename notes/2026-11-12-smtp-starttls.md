# SMTP STARTTLS on port 587 (F049)

- GreenMail 2.1.15 (dev compose) offers no STARTTLS: its EHLO lists `AUTH PLAIN LOGIN XOAUTH2` and `SMTPUTF8` only (checked 2026-11-12 on port 3025).
  So the STARTTLS contract test uses a scripted server: `apps/server/src/modules/mail/imap/smtp-starttls.test.ts`.
- The scripted server makes a self-signed certificate with `openssl` at test start (needs `openssl` on the PATH). The client trusts it only through `SmtpConnectOptions.ca`.
  `ca` adds a trust anchor; nothing in the code sets `rejectUnauthorized` or `ignoreTLS` for `starttls`.
- nodemailer `requireTLS: true` sends STARTTLS even when EHLO does not list it. A server that answers 502 ends the connection before AUTH.
- Mode per mailbox: column `mailboxes.smtp_security` (`tls` default, `starttls`). Loopback + `tls` + `secure` unset still means plain SMTP to the local test server (unchanged).
- Not done: `mailbox:probe-send` and the e2e helpers have no `--smtp-security`; they use `tls`. Real iCloud login is not tested.
