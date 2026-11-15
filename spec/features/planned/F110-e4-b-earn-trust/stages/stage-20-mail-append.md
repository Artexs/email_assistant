# F110 stage 20 — Report mail: APPEND and own-mail skip `[risky]`

Part of [`../plan.md`](../plan.md). Risk: sending to people, own-mail dedup (ADR 0022). Flag `report_mail`.

## Step 1 — Send by APPEND

- **Goal:** a mail outbox row (stage 19) lands in INBOX of its mailbox.
- **Files:** a `ReportMailbox` port in `channels` (`append(row): Promise<void>`; do not bend `ChatChannel`); MIME building in `packages/core/src/outgoing/` next to the existing message builder; the outbox sender claims `mail` rows through this port.
- **Decisions:**
  - Render with `renderNotice(kind, view, { channel: "mail", ... })`: the same facts as Telegram, no buttons, links only to `WEB_BASE_URL`.
  - MIME: `multipart/alternative` (text and simple escaped HTML), UTF-8. `From` and `To` = `"Email assistant" <mailbox address>`; `Subject` = `[Email assistant] <title>` (`[Asystent poczty]` for locale `pl`); `Message-ID` generated; `X-EA-Action-Id: <outbox id>`; `Date` = now.
  - `appendMessage("INBOX", raw, [], now)` through the mailbox's provider (the draft APPEND path shows how to open it). Mailbox not `active` → the row waits (`next_attempt_at` + 15 min, no attempt) until it expires at 24 h.
  - An IMAP network error → the sender's soft-error back-off; a refused APPEND (`NO`) → `failed` / `append_refused`.
  - At least once (as Telegram, `docs/architecture.md` §6.2): a crash after the APPEND and before the commit can put two copies in INBOX. Accepted; one `warn` line on a take-back.
  - Quiet hours apply to non-digest mail rows as to Telegram rows (stage 18).
- **Test** (GreenMail):
  1. A mail digest row → one message in INBOX with the subject prefix, the header with the outbox id, no `<form>`, every link starting with `WEB_BASE_URL`; the row `sent`.
  2. A paused mailbox → the row waits; after 24 h → `failed` / `expired`.
  3. A `pl` member → the Polish prefix.

## Step 2 — Every sync and backfill skips report mail

- **Goal:** report mail is never stored, triaged or sampled (ADR 0022 point 2; review 1 N7).
- **Files:** new `isOwnReportMail(db, ctx, mailboxId, id)` in `channels` (an outbox row of this org with `channel = 'mail'` and this `mailbox_id`); one composed check `isOwnMail = isOwnActionId || isOwnReportMail` built in the composition roots and passed to **every** caller that takes the own-mail check today: the main sync, `backfillMailbox` (CLI and the history job), and any rescan path (grep the callers of `isOwnActionId`).
- **Test:**
  4. After test 1, run `mail.sync` → no `emails` row for that message.
  5. The history backfill (stage 05, `purpose: "history"`) with that report mail in INBOX → no `emails` row (review 1 T10).
  6. A foreign mail with a forged `X-EA-Action-Id` of a Telegram outbox row → stored and triaged.
  7. A forged value that is not a uuid → stored, no query error.

## Done when

- The guard check of `spec/build.md` TRACK is in the final message.
- Proof (`s20`) prints `PROOF_OK`.

## Out of scope

SMTP, relays, replies to the report. OAuth report mailboxes are in scope: F117 opens them by XOAUTH2 through `openMailboxProvider`, as the committer does (review 2 N7).
