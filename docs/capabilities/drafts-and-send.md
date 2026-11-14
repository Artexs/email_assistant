# Drafts and send

> Checked against the code at `cf125cf`, 2026-11-14.

## What it does now

For a delegation mail, or for a mail that needs one clarifying question, triage plans a pair of actions: `create_draft` and `send`. The committer saves the draft in the Drafts folder of the mailbox, as one message, with an APPEND. After the draft exists, the notifier sends an approval request to every linked owner in Telegram. It shows the recipient, the full draft text and the quote of the original mail. Only an owner can tap 📤 Send. The tap is the approval: the committer then sends the same message with SMTP, at most once, and saves a copy in Sent. Without a tap the send never goes out; the hourly job `actions.expiry` ends it after 48 h. `SEND_SCOPE` (default `off`) is a server-wide gate: with `off` an approved send waits. The chaser also uses this path for reminders (`delegation.md`). The user gets a result notice for every send that ends.

## Rules

1. **Draft kinds and the message.** The kinds are `delegation`, `clarification` and `reminder` (`draftKinds` in `packages/core/src/triage/payloads.ts`).
   - `planActions` makes a `delegation` draft when the classifier names an active delegate id and a task. It makes a `clarification` draft (a question to the sender of the mail) when there is no delegate but the classifier gave a question, and the sender address is valid and is not a no-reply address. The chaser makes a `reminder` draft (`delegation.md`). Mail from the spam folder plans no draft.
   - Each draft is one pair: a `create_draft` row and a `send` row with `depends_on_action_id` = the draft. The policy decides the status of both (`docs/architecture.md` §4.3): `ready` and `awaiting_approval` in `assist` mode with the switch `create_draft` on, else `logged` for both.
   - The recipient comes from the `delegates` row or from the sender address of the mail (a clarification), never from LLM text (`docs/architecture.md` §4.1 rule 2). One recipient only.
   - The body is a fixed text per kind and language (`DRAFT_TEMPLATES`: `pl` or `en`; the language `other` uses `en`). The task and the question are LLM text: they pass `markUntrustedText` again and lose their line breaks before they enter the template.
   - The signature is `organizations.style_text` when it is set, else the display name of the owner (`buildOutgoingMessage`).
   - A `delegation` or `clarification` message holds a quote of the original mail: a header block (`--- Original message ---`), then the body, each line with `> `, at most 8000 characters (`QUOTE_MAX_CHARS`). A `reminder` has no quote.
   - The subject is `Fwd: <subject>` for a delegation, `Re: <subject>` for a clarification and `Re: Fwd: <subject>` for a reminder (the subject is cut at 200 characters; an existing prefix is not doubled).
   - The `Message-ID` is `<ea-<draft action id>@<domain of the mailbox>>`, the `Date` is the `created_at` of the draft, and the header `X-EA-Action-Id` is the id of the draft. The draft and the sent mail are the same message.
2. **`create_draft`** (S4, `actions/drafts.ts`): the committer commits `applying`, builds the message and looks for it in Drafts by the header `X-EA-Action-Id` (`locateByActionId`, `docs/architecture.md` §6.1).
   - Found → `applied`. Not found → APPEND with `\Draft` and the INTERNALDATE = `created_at`, then `applied` with the folder and the UID in `provider_result`.
   - After a crash in `applying`, the next claim locates first, so the draft exists once. An error before the APPEND returns a row that started in this call to `ready`; an error at the APPEND leaves it `applying`.
   - A draft is made only while its send waits for approval. When that send has ended before the APPEND (`rejected`, `expired`), no draft is made: the row becomes `expired` (`status_reason` = `send_closed`).
   - A soft error waits 5 min with no count. The third hard error makes the draft `failed` (`hard_error`) and expires its open sends (`draft_missing`).
3. **`send`** (S4, `actions/send.ts`): the committer claims a send only when it is `approved` with `approved_at` set, its draft is `applied` and `SEND_SCOPE` admits it (`docs/architecture.md` §4.3).
   - It builds the same message as the draft (same `Message-ID` `<ea-<draft id>@<domain>>`, same `Date`, header `X-EA-Action-Id` = the id of the draft action).
   - Before the call it checks the send limits and commits `applying` with the `Message-ID` in `outgoing_message_id` and the time in `send_started_at` (own commit; `actions/send-limit.ts`). The check and the commit run under a lock of the mailbox, so two committers never pass a limit together. Over a limit (per mailbox 20 an hour and 100 in 24 h, per recipient 5 in 24 h, counted by `send_started_at`), the send goes back to `approved` with no counted try and `next_attempt_at` at the end of the window, `last_error` = `send_limit:<kind>` and the audit event `action.send_limited`; the owner gets the notice `send_held` and the operator the notice `send_limit` (once per mailbox and day). Then it makes one SMTP call (`MailSender`, one connection per call, no retry inside it).
   - When SMTP accepts the mail (250 after DATA), the committer at once commits `applied` with the SMTP response and the audit row.
   - In the same transaction the delegation becomes `sent` and the draft gets a reverse row (rule 8).
   - The copy to Sent is a separate step after that: locate in Sent by the header and APPEND with `\Seen` only if missing. `provider_result.sent_copy` goes from `pending` to `appended`, `found` or `failed`.
   - If the copy fails, the action stays `applied` and the user gets the notice "sent; no copy in Sent".
   - After a crash in `applying`, the committer never sends again by itself: it searches Sent for the header. Found → `applied` (`recovered`). Not found → `failed` (`outcome_unknown`) and a notice.
   - A soft error inside this recovery leaves the row `applying`. A hard error counts, and the third ends as `outcome_unknown`.
   - A new send needs a new tap on "Send again" (rule 6).
   - Check against the code: the claim query takes an `approved` send only if its `approved_at` is less than 48 h old (`APPROVAL_TTL_MS`); an `applying` send is claimed for the recovery with no `SEND_SCOPE` check (`actions/repo/claims.ts`). The draft is also checked after the claim: a send whose draft is not `applied` goes back to `approved` and waits 5 min with no count.
4. **SMTP stage (D10).** `openSmtpSender` (`mail/imap/smtp.ts`) uses nodemailer's `SMTPConnection` directly. Every error is a `SmtpSendError` with a `stage`: `connect`, `login`, `envelope`, `content` or `unknown`.
   - A logger hook of the connection counts the client lines and the server replies (counts and flags only, no text).
   - A server reply after the client `DATA` line (the `(2 + recipients)`-th reply after `MAIL FROM`; the reply code does not matter, because nodemailer accepts any 2xx or 3xx reply to `DATA`) starts the content phase.
   - The nodemailer code `EENVELOPE` gives `envelope`, `EMESSAGE` gives `content`. Another error during the send step gives `unknown` when the content phase started or no client line was seen, else `envelope`.
   - An error that is not a `SmtpSendError` is `unknown` too. `content` and `unknown` mean that the server may have the mail: the committer never retries after them.
5. **Outcomes of a send error (`sendOutcomeOf`):**

   | Error                                                                               | The row goes to                                                                                      | `attempts`                                                          |
   | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
   | Login refused (`EAUTH`)                                                             | `approved`; the mailbox becomes `auth_error`                                                         | no change                                                           |
   | Soft error at `connect`, `login` or `envelope` (lost connection, timeout, DNS, 4xx) | `approved`, retry in 5 min, no notice; from 6 h after the tap `failed` / `smtp_error` (the soft cap) | no change (retry without a count)                                   |
   | Hard error at `connect`, `login` or `envelope` (not a 5xx at `envelope`)            | `approved`, retry in 5 min                                                                           | + 1 (retry with a count); the third ends as `failed` / `smtp_error` |
   | 5xx at `envelope`, or 5xx after the content                                         | `failed` / `smtp_rejected`                                                                           | no change                                                           |
   | 4xx or another error after the content (`content`)                                  | `failed` / `smtp_error`, no retry                                                                    | no change                                                           |
   | `unknown` stage, or an error that is not a `SmtpSendError`                          | `failed` / `outcome_unknown`                                                                         | no change                                                           |

   A compose error before `applying` returns the row to `approved` with a count; the third ends as `failed` / `smtp_error`. Each `failed` send gets a result notice (rule 8).

   **The soft cap (F044):** a soft error before the content (`connect`, `login` or `envelope`) retries every 5 min without a count. A soft error that comes 6 h or more after the tap (`approved_at`, constant `SEND_SOFT_CAP_MS`) ends the send as `failed` / `smtp_error` with `provider_result.cap = "soft_retry"`, `attempts` unchanged, and the delegation `cancelled` (`send_failed`). The result notice has its own text ("did not accept the mail for 6 hours … nothing was sent") and the button 📤 Send again; the tap sets a new `approved_at`, so the new send gets its own 6 h.
   The cap does not touch a retry with a count (a hard error keeps its 3 tries) and there is no retry after `content`. A send that waits for another reason (a draft not applied, a mailbox in `auth_error`) also uses up the 6 h; the first soft error after that ends it. `held_timeout` (48 h, `actions-and-undo.md` § Data) still ends an `approved` send that no try reaches.

6. **"Send again":** after `smtp_error` and `outcome_unknown` the notice has the button 📤 Send again (callback `ag:<action id>`).
   - The tap is the approval: it inserts one new `approved` send for the same draft (key `<failed id>:again`, so one resend per failed row) when the draft is still `applied` and the delegation, if any, is open.
7. **"It went out":** after `outcome_unknown` of a delegation send the notice has a second button ✅ It went out (callback `gw:<action id>`). Only an owner can tap it.
   - It makes no SMTP call and no new send row. In one transaction (lock order: send, then delegation) it checks that the send is `failed` / `outcome_unknown`, has a stored `outgoing_message_id` and has no resend (key `<failed id>:again`).
   - Then the `onWentOut` hook sets the delegation from `cancelled` (`outcome_unknown`) to `sent` with `sent_message_id` = that message id, so a reply of the delegate is matched and the chaser works. The send row stays `failed`.
   - Audit: `action.went_out` and `delegation.sent` (`went_out: true`), both with the owner as actor. A second tap, a delegation in another state, a resent send and a send that is not `outcome_unknown` answer with a toast and change nothing. Reminder and clarification sends have no such button: a failed reminder does not cancel the delegation.
   - After `smtp_rejected` there is no button: the address is wrong, so the user fixes the delegate and the mail is a new one.
8. **Approval flow (Telegram).**

   ```mermaid
   sequenceDiagram
       participant W as Triage worker
       participant DB as Postgres
       participant N as Notifier
       participant TG as Telegram
       participant U as User
       participant C as Committer
       participant M as Mail server

       W->>DB: create_draft = ready, send = awaiting_approval (depends on the draft)
       C->>M: APPEND the draft to Drafts (under ACTIONS_SCOPE)
       N->>TG: only after the draft is applied - recipient, original sender with external-sender warning, full draft text, quote, [Send] [Reject]
       U->>TG: taps [Send]
       TG->>DB: handler checks chat → user → owner role → org owns the action, then status = approved only WHERE status = awaiting_approval
       TG-->>U: toast, and the message gets the line "Approved HH:MM, sending"
       C->>DB: store the outgoing Message-ID, status = applying (own commit)
       C->>M: SMTP send with X-EA-Action-Id and the stored Message-ID
       C->>DB: at once after the 250 - status = applied + SMTP response + audit row (one transaction)
       C->>M: copy to Sent (search first, APPEND if missing), remove the draft
       N->>TG: a new message: Sent to <recipient> (or the failure text)
   ```

   - **The approval message** (`renderApprovalRequest`, plain text, at most 4096 characters): the title (`📤 Send? Delegation to <name> <address>`, `Question to the sender <address>` or `Reminder to <name> <address>`), `From:` the original sender with `⚠️ external sender` when the sender is not the mailbox, a delegate, a whitelisted or a VIP address,
     `Subject:`, `Due:`, `Draft:` with the full template text, `Quoted original:` with at most 1500 characters (links show as `[link]`; the quote shrinks first when the message is too long) and the line "The system sends it after your tap. Do not send the draft from your mail client."
     Buttons: 📤 Send and ✖️ Reject. A reminder has no quote and no sender line. Mail with a synthetic `Message-ID` is marked `🧪 test`.
     The notifier and the committer build the text with the same function, so the user sees what goes out.
   - **Reminder sets:** one message approves up to 10 reminders at once (`delegation.md` § Rules).
   - **Taps:** the callback data is a kind and a UUID: `ap:` approve, `ar:` reject, `as:` send all, `rs:` skip all, `ag:` send again, `dd:` done. The handler checks the chat link, then the role: **only an owner can approve, reject or send again**; `dd:` (Done) works for every linked member.
     An unknown id and an id of another organization get the same answer. A second tap finds the status changed and answers with it. An expired or rejected action cannot send.
     `approve` refuses while the draft is not `applied` (`draft_not_ready`), and a tap later than 48 h after `notified_at` expires the send (the hourly job can be late by up to an hour).
   - **The edit after the tap:** the approval message keeps its text (the stored text of the sent card) and gets one line: `⏳ Approved HH:MM, sending.`, `✖️ Rejected HH:MM.`, `⌛ Expired HH:MM. The mail was not sent.` or `✅ Done HH:MM.` or `✅ Marked as sent HH:MM.` (after ✅ It went out). An approved send that is held (by `SEND_SCOPE`, a paused mailbox or a login error) says so, keeps the ✖️ Reject button and expires 48 h after the tap.
   - **The result notice** is a new message (outbox kind `send_result`), one per owner, when the send ends: `✅ Sent to …`, `❌ Not sent …` (`smtp_rejected`, `smtp_error`), `⚠️ Unknown whether the mail … went out` (`outcome_unknown`; "Check Sent or ask the recipient before you send again"), `⌛ Not sent: …` for each `expired` reason, `✖️ Rejected`.
     A `sent` notice adds "No copy in Sent" when the copy failed and "The draft stays in Drafts" when the server has no UIDPLUS. A `pending` Sent copy older than 10 min counts as failed. An edit of the approval message instead of a new message is a follow-up (`F039-approval-edit-in-place`, dropped; E4-A F102 takes it).
     - Check against the code: the old text named the `plan.md` of the ticket `F039-approval-edit-in-place` in the `planned` lane. That ticket is dropped now, and E4-A (`F102-e4-a-act-from-the-panel`) absorbs it.
   - **Notice kinds (S4):** `approval`, `approval_set`, `send_result` (owners only) and `delegation_answered` (every linked member, with a ✅ Done button). The notifier queues a request only after the draft is `applied`, and only for an `active` mailbox.
     With no linked owner it queues nothing and sets nothing: `notified_at` stays null, and after 7 days from creation the expiry job ends the send as `not_notified`.
   - A `send` action has `depends_on_action_id` = its `create_draft` action. The policy makes the send `log_only` when its draft is `log_only`. The expiry job (rule 10) ends a send that nobody answered, and a send whose draft is `failed` or `undone` (`draft_missing`).
   - The send uses the text that the user approved (the draft payload in the DB). Edits of the draft in the mail client do not count in MVP (Phase 2: send the edited draft, `F043-send-draft-edits`, dropped; PD-076 replaces it in E6a F115). The approval record is `approved_by`, `approved_at` and `approved_via`; a database check refuses `approved`, `applying` and `applied` sends without `approved_at`, and a send is never `ready`.
     - Check against the code: the old text named the `plan.md` of the ticket `F043-send-draft-edits` in the `planned` lane. That ticket is dropped now; PD-076 replaces it.
   - After a send is `applied`, a reverse `create_draft` row removes the draft from Drafts when the server has UIDPLUS; else the draft stays, and the notice says so. A reject or an expiry removes the draft the same way. A send that the server refused (`smtp_rejected`) or that failed keeps its draft, so the user can read it.
   - Never retry a send by itself (rule 3).
   - "Send all reminders" (brief, follow-up) is one approval for a listed set of reminder actions (`delegation.md` § Rules).

9. **`SEND_SCOPE` and `SEND_TEST_ADDRESSES`.** `SEND_SCOPE` is an env key with the values `off` (default), `self` and `all`. The full text and the gate table are in `docs/architecture.md` §4.3.
   - `off`: no send goes out. A tap still approves; the send waits and ends as `held_timeout` 48 h after the tap.
   - `self`: only a send whose every recipient is in `SEND_TEST_ADDRESSES` (comma-separated, compared in lower case). The server refuses to start with `self` and no valid address list.
   - `all`: every send of every active mailbox of an organization that is not `suspended`. A send still needs the owner's tap.
   - `bun run mailbox:probe-send` is a manual probe for a test mailbox: it needs `TEST_MAILBOX_ADDRESS` and one recipient that is the mailbox itself or is in `SEND_TEST_ADDRESSES`.
10. **The job `actions.expiry`** (`actions/expiry.ts`, every hour at minute 7; all mailboxes, also paused ones) ends a send that nobody answered or that is held: `timeout` (`awaiting_approval` 48 h after `notified_at`, with a `sent` outbox row of its request), `not_seen` (the same age and no `sent` row; not for a suspended organization), `draft_missing` (its draft is `failed` or `undone`), `not_notified` (no approval request went out within 7 days of creation) and `held_timeout` (`approved` 48 h after the tap, not locked). It cascades in one transaction: the send, the draft (a reverse row or `expired`) and the delegation (`cancelled`). A send in flight (`applying`, or `approved` with a fresh lock) finishes. The log line holds the counts per reason.
    - `bun run job:run --name <job> [--force]` runs one of them once (`actions.expiry`, `delegation.chaser`, `actions.committer`, `channels.notifier`, `platform.retention`); `--force` skips the 07:30 and once-per-day gate of the chaser (`delegation.md`).

## Entry points

| Kind     | Name                                                                                                           | Where                                                     |
| -------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| job      | `actions.expiry` (`0 7 * * * *`, hourly at minute 7)                                                           | `apps/server/src/modules/actions/expiry.ts`               |
| job      | `actions.committer` (`*/15 * * * * *`; applies drafts and sends, see `actions-and-undo.md`)                    | `apps/server/src/modules/actions/committer.ts`            |
| job      | `channels.notifier` (every 15 s; its detectors queue the approval and result notices)                          | `apps/server/src/modules/channels/notices/index.ts`       |
| CLI      | `bun run job:run --name <job> [--force]`                                                                       | `apps/server/src/scripts/job-run.ts`                      |
| CLI      | `bun run mailbox:probe-send` (a test mailbox only; sends one real mail)                                        | `apps/server/src/scripts/mailbox-probe-send.ts`           |
| Telegram | callbacks `ap:`, `ar:`, `as:`, `rs:`, `ag:`, `gw:` (Send, Reject, Send all, Skip all, Send again, It went out) | `apps/server/src/modules/channels/callbacks.ts`           |
| function | `applyDraft`, `buildDraftMessage`                                                                              | `apps/server/src/modules/actions/drafts.ts`               |
| function | `applySend`, `sendOutcomeOf`                                                                                   | `apps/server/src/modules/actions/send.ts`                 |
| function | `approve`, `reject`, `approveSet`, `rejectSet`, `sendAgain`, `markWentOut`                                     | `apps/server/src/modules/actions/approvals.ts`            |
| function | `createExpiryJob`, `expireSend`, `closeDraftOfSend`, `expireReminderActions`                                   | `apps/server/src/modules/actions/expiry.ts`               |
| function | `expireUnseenApprovals`                                                                                        | `apps/server/src/modules/actions/expire.ts`               |
| function | `sendFilterFor`, `sendScopeAdmits`                                                                             | `apps/server/src/modules/actions/scope.ts`                |
| function | `sendScope`                                                                                                    | `apps/server/src/composition.ts`                          |
| function | `openSmtpSender`, `classifySmtpError`                                                                          | `apps/server/src/modules/mail/imap/smtp.ts`               |
| function | `probeSend`                                                                                                    | `apps/server/src/modules/mail/imap/probe-send.ts`         |
| function | `approvalViewFor`                                                                                              | `apps/server/src/modules/channels/notices/approval.ts`    |
| function | `sendResultDetector`                                                                                           | `apps/server/src/modules/channels/notices/send-result.ts` |
| function | `buildOutgoingMessage`, `outgoingMessageId`, `outgoingSubject`                                                 | `packages/core/src/outgoing/message.ts`                   |
| function | `renderTemplate`                                                                                               | `packages/core/src/outgoing/templates.ts`                 |
| function | `quoteOriginal`, `quoteCut`                                                                                    | `packages/core/src/outgoing/quote.ts`                     |
| function | `isExternalSender`, `approvalViewOf`                                                                           | `packages/core/src/outgoing/sender.ts`                    |
| function | `renderApprovalRequest`, `renderSendResult`, `approvalEdit`                                                    | `packages/core/src/digest/approvals.ts`                   |
| function | `draftPayloadSchema`, `sendPayloadSchema`, `sendPayloadFor`                                                    | `packages/core/src/triage/payloads.ts`                    |

## Data

Rows of `actions` with `type` `create_draft` or `send` (the status flow is in `actions-and-undo.md` § Data):

- `status`, `status_reason`, `attempts`, `next_attempt_at`, `locked_at`, `last_error`: the retry and the claim, as for every action.
- `depends_on_action_id`: a send points to its draft. `reverses_action_id`: a reverse `create_draft` points to the draft that it removes.
- `idempotency_key`: `<email id>:create_draft` and `<email id>:send`; a reminder uses `<email id>:create_draft:reminder:<day>` and `<email id>:send:reminder:<day>`; "Send again" uses `<failed id>:again`. Unique per organization.
- `outgoing_message_id`: the `Message-ID` that the send stores before the SMTP call.
- `approved_by`, `approved_at`, `approved_via` (`telegram` or `cli`); the checks `actions_send_approved_check` (an `approved`, `applying` or `applied` send has `approved_at`) and `actions_send_never_ready_check` (a send is never `ready`).
- `notified_at`: the approval request was queued. `result_notified_at`: the result notice was queued. `send_started_at`: the time of the latest SMTP try of a send; each new try after a release sets it again; the send limits count by it.
- `provider_result` of a draft: `uid`, `folder`, `found`. Of a send: `response`, `accepted`, `message_id`, `sent_copy` (`pending`, `appended`, `found`, `failed`); on a failure `stage`, `response_code`, `code`, `cap` (`soft_retry`), `recovered`.
- `payload` of a draft: `kind`, `to`, `language`, `task` or `question`, `due_date`, `delegate_id`, `delegate_name`; a reminder adds `delegation_id`, `reminder` (1 or 2) and `thread`. A send repeats `kind`, `to`, `delegate_id`, `delegation_id`, `reminder`, and adds `set_id` for a reminder set. The retention job clears old payloads.
- `outbox` kinds of this capability: `approval`, `approval_set`, `send_result`, `delegation_answered`. `organizations.style_text` is the signature.
- Audit events: `action.applying`, `action.applied`, `action.approved`, `action.rejected`, `action.expired`, `action.failed`, `action.send_again`, `action.went_out`, `action.sent_copy_failed`, `action.send_limited`.

## Limits

- No free-text reply drafts: E6a (F115).
- Edits of a draft in the mail client do not count; the system sends the approved payload, not the Drafts copy. PD-076 (E6a, F115) changes it.
- No web approval page: approvals work only in Telegram. E4-A (F102) adds the panel and the edit of a waiting draft (PD-031).
- Send limits (PD-044, F099): per mailbox 20 an hour and 100 in 24 h, per recipient 5 in 24 h (`SEND_LIMIT_*`). A send over a limit waits as `approved` with `last_error = send_limit:<kind>`; rules in `docs/code-patterns.md` § Side effects and `docs/architecture.md` §4.1. No per-organization limit and no limit in the panel: the operator sets the env keys.
- A send needs an owner with a linked Telegram chat. With no linked owner the send ends as `not_notified` after 7 days.
- The approval message is a new message; the edit in place of a card in the chat is E4-A (F102).
- `SEND_SCOPE` is one setting for the whole server, not per organization.

## Decisions

- ADR 0003 (plan, policy, commit; the approval and the send), ADR 0005 (Telegram first; the approval taps), ADR 0010 (IMAP first; the SMTP send).
- PD-031 (Limits only: approvals in Telegram and the panel), PD-044 (Limits only: send limits), PD-076 (Limits only: mail-client edits).
- `docs/architecture.md` keeps the flow, rules 1–5 of §4.1 and the mode and policy tables (§4.3).

## Tests

- `apps/server/test/integration/actions-drafts.test.ts`
- `apps/server/test/integration/actions-send.test.ts`
- `apps/server/test/integration/actions-approvals.test.ts`
- `apps/server/test/integration/actions-resume-approvals.test.ts`
- `apps/server/test/integration/actions-close.test.ts`
- `apps/server/test/integration/smtp-send.test.ts`
- `apps/server/test/integration/actions-send-logs.test.ts`
- `packages/core/src/outgoing/message.test.ts`
- `packages/core/src/outgoing/quote.test.ts`
- `packages/core/src/outgoing/sender.test.ts`
- `packages/core/src/outgoing/templates.test.ts`
- `packages/core/src/digest/approvals.test.ts`
