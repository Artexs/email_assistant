# F115 · Interfaces

Part of [plan.md](plan.md). These names are the contract between stages and for later tickets (F110 E4-B, F116 E5b, F118 E9b, F122 E6b). A stage that must change one asks first.

## Core (`packages/core/src/replies/`)

- `drafterOutputSchema` (zod): `{ decision: "draft" | "no_draft", reason_code: "needs_facts" | "not_a_reply" | "unsafe_request" | null, body: string, gaps: string[], language: "pl" | "en" }`.
- `checkReplyBody(body, { language, allowed: string[] }) → { ok: true } | { ok: false, failures: ReplyCheckCode[] }`. Codes: `address`, `link`, `phone`, `account_number`, `blank_lines`, `header_line`, `control_chars`, `too_long` (> 2,000), `language`, `gap_syntax`. `allowed` = instruction, signature and writing style; a matched string in them passes.
- `gapsOf(body) → string[]`; `hasGaps(body) → boolean` (true when `[[` appears). Gap syntax: `[[` 1–80 characters without `[` or `]` `]]`.
- `replyEligibility(facts, { trigger, now }) → { ok: true, language } | { ok: false, reason: ReplyBlockReason }`. Reasons: `not_checked`, `category`, `junk_source`, `not_a_person`, `own_mailbox`, `suspicious`, `calendar`, `answered`, `too_old`, `language`, `open_newer`, `oauth_mailbox` (D19; set by the callers, not by `replyEligibility`). `trigger`: `auto` | `tap` | `redraft` | `sample`.
- `ReplyFacts`: `triaged` (bool), `category`, `language` (`pl`/`en`/`other`), `fromJunk`, `fromAddress`, `ownAddresses`, `headers` (null or `{ listId, listUnsubscribe, autoSubmitted, precedence, hasCalendar }`), `suspicion` (`Suspicion` of `core/triage/suspicious.ts`: `{ state: "untriaged" } | { state: "clean" } | { state: "flagged", reasons }`), `answered` (bool), `receivedAt`, `ownerLocale` (`pl` / `en` / null; stage 06: a tap with language `other` drafts in it, null reads as `pl`). A null `fromAddress` is `not_a_person`. Module `replies` joins the facts with `loadReplyFacts(db, ctx, emailIds, { ownerLocale })` → `Map<emailId, { facts: ReplyFacts, mail: MailReplyFacts }>`.
- `quoteReply(original, language, timeZone) → string`: "On <date>, <name> wrote:" / "<date>, <name> napisał(a):", then `> ` lines, at most `QUOTE_MAX_CHARS`.
- `normalizeDraftText(text) → string`: CRLF → LF, trailing spaces per line cut, trailing blank lines cut. `draftCopyKey({ text, subject, to, cc, attachmentCount, attachments })` → a canonical JSON string (addresses lower case and sorted; attachments as `name|type|size` in part order). The hash `draftCopyHash(copy)` (hex SHA-256 of that string) lives in module `actions` (stage 08).

## Draft payload kind `reply` (`core/triage/payloads.ts`)

`{ kind: "reply", to: [1 address], cc: address[] (0–10), language, body, request_id, folder (of the mail at request time), recipients: "from" | "reply_to" | "all", version?, subject_text?, body_text? }`. Gaps are always derived: `gapsOf(body_text ?? body)`. The send payload repeats `kind`, `to`, `cc`. `body_text`, when set, replaces `body` (F102 edit).

## Data (stage 03; repositories 03b)

- `reply_requests`: `id`, `org_id`, `mailbox_id`, `email_id`, `thread_key`, `folder` (of the mail at request time), `trigger`, `status` (`pending`, `drafting`, `done`, `no_draft`, `failed`, `cancelled`, `superseded`), `reason_code`, `instruction` (≤ 300, null), `requested_by` (user, null for `auto`), `previous_send_id` (null), `send_action_id` (null), `sample_body` (null), `attempts`, `next_attempt_at`, `locked_at`, `created_at`, `updated_at`. Unique `(org_id, email_id)` where `trigger = 'auto'`. Index `(org_id, status, next_attempt_at)`. RLS on `org_id`; FKs `(email_id, org_id)`, `(mailbox_id, org_id)` with cascade.
- `mailbox_profiles`: `mailbox_id` (PK), `org_id`, `display_name` (≤ 100), `signature` (≤ 1,000), `writing_style` (≤ 1,000), `updated_at`, `updated_by`. All text nullable. RLS; cascade with the mailbox.
- Index `emails (mailbox_id, thread_key, received_at)`: exists as `emails_thread_received_idx` (F116); stage 03 adds and drops none.
- Outbox kinds `replies_ready`, `reply_prompt`, `reply_result`.

## Server functions

- Module `replies` (layer 3): `createReplyJobs(deps)` → jobs `replies.drafter` (every 15 s) and `replies.sweep` (every 5 min); `requestReply(deps, ctx, { emailId, userId, via, instruction? })` → `{ kind: "queued", requestId } | { kind: "open", sendId } | { kind: "blocked", reason } | { kind: "feature_off" }`; `redraftReply(deps, ctx, { sendId, userId, via, instruction })` (same answers plus `changed`, `closed`); `setReplyRecipients(deps, ctx, { sendId, userId, via, mode: "all" | "reply_to" | "from" })` → like `editApproval`'s answers plus `too_many_recipients`, `no_reply_to`; `previewStyle(deps, ctx, { mailboxId, userId })` → `{ body } | { kind: "failed", reason }`; `sampleReplies(deps, ctx, { mailboxId, userId, count: 3 })` → `{ items: { emailId, body }[] }`; `replyOutcomeRows(db, ctx, { since })` for the core metric `replyOutcomeCounts(rows) → Record<ReplyOutcome, number>` (`made`, `sent_by_tap`, `sent_by_user`, `rejected`, `expired`, `newer_mail`, `answered`, `original_moved`, `draft_changed`, `no_draft`, `failed`).
- Module `actions`: `replaceApproval(trx, ctx, { sendId, payload, userId, via, now })` (the F102 supersede core, shared by `editApproval`); `closeSend(trx, ctx, { sendId, reason, notify, claimed, now })` for every kind, reasons `answered` | `newer_mail` | `original_moved` | `policy_changed` | `suspicious` | `sent_by_user` | `draft_changed` | `draft_missing`; `claimed: true` = the committer holds the claim of this row; `claimed: false` answers `busy` for a locked row. It edits the Telegram cards through `ApprovalHooks.onDecided` (`expired`); `approvalExpiresAt(kind, row)`.
- Module `triage`: `suspicionOf(db, ctx, emailIds) → Map<emailId, Suspicion>` (three-state; every id is in the map). `drafter-v1` in the prompt registry.
- Module `mail`: `replyFactsOf(db, ctx, emailIds) → Map<emailId, MailReplyFacts>` (`headers` or null, `replyTo`, `answered`, `ownAddresses`, `fromAddress`, `fromJunk`, `folder`, `receivedAt`, `threadKey`, `toAddresses`, `ccAddresses`; an id of another organization is absent), `newerMailInThread(db, ctx, emailId) → boolean` (D7 rule; `actions` and `replies` both call it) and `mailboxProfileOf(db, ctx, mailboxId)`.

## Log fields

`reply_request_id` (uuid, new in stage 07), `result` (code, new in stage 08); the other fields exist (`action_id`, `reason`, `error_code`, `count`). Not `request_id`: that is the HTTP request context (F103).

## Telegram callbacks (`core/digest/callback.ts`)

New kinds, each with an action or mail UUID: `reply_review` (start or next, `afterId` optional), `reply_skip` (sendId), `reply_redraft` (sendId), `reply_all` (sendId), `reply_use_reply_to` (sendId), `reply_draft` (emailId). Two-letter codes are new and unique (a test checks every code).

## Routes (stage 14; `/api`, behind `approvals_page` and `reply_drafts`)

- `POST /replies` `{ emailId, instruction? }` → 202 `{ requestId }`, or 200 `{ sendId }` when a draft is open; 409 `blocked` + `reason`, `feature_off`.
- `POST /approvals/:id/redraft` `{ instruction }` → 202 `{ requestId }`; 409 `changed` + `currentId`, `closed`, `redraft_limit`.
- `POST /approvals/:id/recipients` `{ mode }` → `{ id, version }`; 409 `changed`, `closed`; 400 `too_many_recipients`, `no_reply_to`.
- `GET /replies/requests/:id` → `{ status, reasonCode, sendId }` (`superseded` carries the open `sendId` of the thread).
- `GET|PUT /mailboxes/:id/profile`, `POST /mailboxes/:id/profile/preview`, `POST /mailboxes/:id/reply-samples` (stage 10 and 16).
- `POST /approvals/:id/approve` gains 409 `has_gaps` and 409 `feature_off` (stage 05).
- `ApprovalItem` gains for kind `reply`: `gaps` (derived), `cc`, `replyTo` (stored, or null), `instruction`, `redraftsLeft`, `sentVisible`.
- `POST /telegram/consent` `{ version }` (stage 12): an already linked user confirms the new consent; one `web.telegram_consent` audit row. F116 stage 17 builds the same route and reader if it lands first; then stage 12 reuses them and adds only its text and version.
