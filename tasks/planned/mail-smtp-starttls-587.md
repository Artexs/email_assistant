> **Status 2026-11-08 — planned.** Idea from the S5 plan (P9). Not started. Needs: S5b (the connect form with presets).

# SMTP on port 587 with STARTTLS

Scope: `apps/server/src/modules/mail/imap/smtp.ts` (`verifySmtpLogin`, `openSmtpSender`: today `secure: true` on every port except loopback), `connectMailbox` input, the provider presets of `packages/core/src/mail/providers.ts`. Needs: S5b.

## Goal

A mailbox whose provider offers SMTP only on port 587 with STARTTLS (iCloud `smtp.mail.me.com`, many business hosts) can be connected. Certificates are still always checked.

## Done when

- `ConnectInput` and the connect form take an SMTP security mode (`tls` = implicit TLS on 465, `starttls` = STARTTLS on 587); the stored mailbox row keeps it; `verifySmtpLogin` and `openSmtpSender` use `secure: false, requireTLS: true` for `starttls`.
- A GreenMail contract test covers STARTTLS (GreenMail STARTTLS support checked first; else a scripted fake SMTP server with STARTTLS).
- The iCloud preset (app-specific password, `imap.mail.me.com:993`, `smtp.mail.me.com:587` STARTTLS) is in the preset list with its help sentence.
- `docs/architecture.md` §6.1 names the two SMTP modes.

## Plan

Written when the task starts (files to change, steps, tests).

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built; related ADRs set to accepted or superseded.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log

- 2026-11-08: Created by the S5 master plan session.
