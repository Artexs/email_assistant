# F110 stage 19 — Report mail into the own INBOX `[risky]`

Part of [`../plan.md`](../plan.md). Risk: sending to people, own-mail dedup (ADR 0022). Flag `report_mail`.

## Step 1 — Queue mail rows

- **Goal:** members with `report_channel` `mail` or `both` get the D14 kinds as outbox rows with `channel = 'mail'` (P4, Q6).
- **Files:** the digest job (`channels/digest-job.ts`), the weekly report detector, `queueTrustNotice` (stage 10).
- **Decisions:**
  - The digest job visits members that have a linked chat (`telegram`/`both`) or `mail`/`both`, so a mail-only member without Telegram gets digests. The slot rules (`digest-and-notices.md` rule 3) stay; the "last slot" counts per channel.
  - A mail row: `channel = 'mail'`, `mailbox_id = report_mailbox_id`, dedup key `<telegram key>:mail` (the Telegram row keeps its key).
  - Every other kind is queued for Telegram only, as today.
  - `report_mailbox_id` null, or the mailbox is gone → no mail row (the card in stage 18 warns).
- **Test:**
  1. A member with `both` → one Telegram and one mail digest row per slot; `mail` only and no chat → one mail row.
  2. A `telegram` member → no mail row.
  3. `trust_report_ready` for an owner with `both` → two rows; `urgent` → Telegram only.

## Step 2 — Send by APPEND

- **Goal:** the outbox sender delivers a mail row into INBOX of its mailbox.
- **Files:** a `MailReportChannel` in `channels` (the `ChatChannel` port has `send` only for chats; add a separate small port `ReportMailbox.append(row)` rather than bending `ChatChannel`); MIME building in `packages/core/src/outgoing/` next to the existing message builder; the sender branches on `row.channel`.
- **Decisions:**
  - Render with `renderNotice(kind, view, { channel: "mail", ... })`: the same facts as Telegram, no buttons, links only to `WEB_BASE_URL`.
  - MIME: `multipart/alternative` (text and simple HTML, escaped), UTF-8. `From` and `To` = `"Email assistant" <mailbox address>`; `Subject` = `[Email assistant] <title>` (Polish prefix `[Asystent poczty]` for locale `pl`); `Message-ID` generated; `X-EA-Action-Id: <outbox id>`; `Date` = now.
  - `appendMessage("INBOX", raw, [], now)` through the mailbox's provider (the draft APPEND path shows how to open it). Mailbox not `active` → the row waits (`next_attempt_at` + 15 min, no attempt) until it expires at 24 h (rule 7).
  - An IMAP error → the sender's back-off and attempt rules for soft errors; a refused APPEND (`NO`) → `failed` / `append_refused`.
  - Delivery is at least once (as Telegram, `docs/architecture.md` §6.2): a crash after the APPEND and before the commit can put two copies in INBOX. Accepted; one `warn` line on a take-back.
  - Quiet hours apply to non-digest mail rows as to Telegram rows (stage 18).
- **Test** (GreenMail):
  4. A mail digest row → one message in INBOX with the subject prefix, the header with the outbox id, no `<form>`, every link starting with `WEB_BASE_URL`; the row `sent`.
  5. A paused mailbox → the row waits; after 24 h → `failed` / `expired`.

## Step 3 — Sync skips report mail

- **Goal:** the next sync does not store or triage report mail (ADR 0022 point 2).
- **Files:** new `isOwnReportMail(db, ctx, mailboxId, id)` in `channels` (an outbox row of this org with `channel = 'mail'` and this `mailbox_id`); `main.ts` passes `isOwnActionId(...) || isOwnReportMail(...)` to the sync.
- **Test:**
  6. After test 4, run `mail.sync` → no `emails` row for that message.
  7. A foreign mail with a forged `X-EA-Action-Id` of a Telegram outbox row → stored and triaged.
  8. A forged value that is not a uuid → stored, no query error.

## Done when

- The guard check of `spec/build.md` TRACK is in the final message.
- Proof (`s19`) prints `PROOF_OK`.

## Out of scope

OAuth adapters (E9 implements `appendMessage` there). SMTP, relays, replies to the report.
