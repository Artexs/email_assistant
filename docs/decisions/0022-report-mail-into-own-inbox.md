# 0022 — Report mail goes into the user's own INBOX by IMAP APPEND

- Status: proposed (E4 discovery, 2026-11-13; waits for the owner's answer to decision 5 of `docs/product/stage-2/epics/E04-control-surface.md`)
- Date: 2026-11-13
- Numbers 0018–0020 are reserved by the S6 plan; 0021 is the E2 simulator stack.

## Context

Telegram is the only channel for the digest today (ADR 0005). Many target executives (`docs/product/stage-2/03-product-frame.md` §3) do not use Telegram for work. A digest by mail is market standard (Fyxer sends briefings and digests by mail, vendor pages 2026). The E4 "what I would have done" report needs the same channel.

Three ways to deliver a mail to the user:
1. A system SMTP sender (the S6b auth-mail relay). The digest holds senders, subjects and AI text. A relay then holds a copy of mail metadata: a new sub-processor, and it breaks the "who holds a copy of my mail" answer (E10).
2. SMTP from the user's own mailbox to itself. It uses the send path, the send limits and the Sent folder, and it passes the provider's outbound spam filter.
3. IMAP APPEND into the user's INBOX. The message never leaves the user's mail host. No spam filter, no send quota, no Sent copy.

## Decision

1. The system may put its own report mail (digest, shadow report, later the E5 brief) into the INBOX of a mailbox the user connected, by IMAP APPEND (or the provider's "create a message in a folder" call for OAuth adapters, E9). It never sends report mail by SMTP and never through a relay.
2. Each such message carries the header `X-EA-Action-Id` with the id of an action row (type for report mail, decided in planning), so the sync recognizes it as own mail and does not triage it (the check in `mail/sync.ts` exists).
3. From is the mailbox address with the display name of the product; the subject has a fixed prefix; links point only to `WEB_BASE_URL`; the mail has no buttons and no form.
4. The channel is a user choice per member: Telegram, mail, or both. Urgent notices and approval requests stay on Telegram (and later web push, E9).
5. The `MailProvider` port already has `appendMessage(folder, raw, flags, internalDate)` (`apps/server/src/modules/mail/port.ts:103`, used for drafts). Report mail uses it with INBOX. The OAuth adapters (E9) must implement it too.

## Consequences

- No new sub-processor; the security-and-data page (E10) keeps one answer: report content stays on the user's mail host and the product server.
- The mailbox gets more mail (one or two a day). The user can filter it by the subject prefix or the header.
- APPEND rights on INBOX are needed; every IMAP host allows them for the account owner. A failure is an action failure with a reason, like a draft APPEND.
- A shared mailbox (several people read it) shows the report to all of them. Stage 2 serves one executive per mailbox; the EA flow (Stage 3) revisits this.
- `docs/architecture.md` §4.1 and §6.1 must list INBOX as a folder the system writes to (report mail only).
