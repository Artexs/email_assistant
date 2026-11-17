# F110 stage 20: report mail APPEND (seam map)

Written by the stage 20 worker. For a later agent (stage 25 docs, stage 26 deploy, a reviewer).

## Where the code is

- Core: `packages/core/src/outgoing/report-mail.ts` (`buildReportMail`, `reportMailHtml`, `isLinkOfBase`), texts `packages/core/src/texts/report-mail.ts` (`reportMail`), `reportMailKinds` in `notices/kinds.ts`, the four mail renderers in `notices/renderers.ts` (`mailOf`: the Telegram text, no buttons).
- Server: `channels/report-mailbox.ts` (the port, only `append`), `channels/report-mailbox-imap.ts` (adapter: `openMailboxProvider` without a sender, `appendMessage("INBOX", raw, [], now)`), `channels/report-mail-sender.ts` (the job), `channels/quiet-gate.ts` (quiet hours shared with the Telegram sender), `channels/own-report-mail.ts` (`isOwnReportMail`), `composition.ts` (`isOwnMailOf`), `main.ts` (job `channels.report_mail`, every 15 s, not inside the Telegram block).
- `mail/imap/compose.ts`: `composeReportMail` (nodemailer `MailComposer`, text + html = `multipart/alternative`).

## Decisions taken (defaults; no owner answer needed)

- The own-mail header holds the outbox id of the mail row, not an action id (ADR 0022 point 2 says "an action row"; the stage text and `interfaces.md` say outbox id). ADR 0022 is still `proposed`: the coordinator may want to update its point 2.
- The 24 h expiry of mail rows moved from the Telegram sender to the report mail sender (`expireOldMailOutbox`, start of each run). The Telegram sender no longer touches mail rows at all.
- The mail sender runs without the Telegram bot: a mail-only member needs no bot.
- A mail row of a member who went back to `telegram`, or chose another report mailbox, fails as `outdated`; with the flag off at send time the row waits 15 min (no attempt) and expires after 24 h.
- A refused login or a blocked host does not change the mailbox status here: the sync job owns it. The row waits 15 min.
- Subject titles are fixed words per kind (en and pl in `texts/report-mail.ts`); no mail text reaches a header.
- Links: only a URL that starts with `WEB_BASE_URL` becomes an `<a>`; another URL stays escaped text. The plain-text part is the Telegram text.

## Not done / for later

- The weekly report mail has a renderer test in core only; the server test uses a bad weekly view (the fixture `weekStatsExample` is not reachable from the server tests).
- A crash after the APPEND and before the mark can leave two copies (accepted by the stage; one `warn` line `outbox_mail_resent_after_stale`).
- `job-run.ts` has no `channels.report_mail` name.
- Stage 26 rollback: the old code (before stage 03) fails mail rows only through the pattern in `review-3.md`; the new kind `append_refused` is a plain error code (regex `^[a-z0-9_]{1,40}$`), no migration.
