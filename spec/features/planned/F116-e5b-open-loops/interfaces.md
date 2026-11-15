# F116 · Interfaces

Part of [plan.md](plan.md). These names are the contract between the stages and for later tickets (E11a, E9b, E6b). A stage that must change one asks first.

## Data (stage 07)

- `open_loops`: `id`, `org_id`, `mailbox_id`, `kind` (`waiting` | `promised` | `delegated`), `status` (`open` | `closed`), `close_reason` (null | `replied` | `replied_subject` | `done` | `dropped` | `untracked` | `stale` | `later_reply` | `expired` | `sent_off`), `sent_email_id` (the mail that opened it), `last_sent_email_id` (the newest own mail that restarted the wait), both FK → `sent_emails` `ON DELETE SET NULL`; `thread_key`, `message_id` and `references_ids` (of the last own mail; used for In-Reply-To and References), `subject` (≤ 300), `to_addresses`, `cc_addresses` (text[], ≤ 10 together), `counterpart` (the first To address), `delegate_id` (kind `delegated` only; FK → `delegates`), `text` (the ask or the promise, ≤ 80), `language` (`pl` | `en`), `due_at`, `due_source` (`stated` | `default`), `wait_from_at`, `later_count` (0–3), `follow_ups_sent` (0–2), `last_follow_up_at`, `surfaced_at`, `auto_reply_at`, `stale_notified_at`, `closed_at`, `closed_by_email_id` (FK → `emails`, `SET NULL`), `closed_by_user_id`, `texts_cleared_at`, `created_at`, `updated_at`. Unique `(org_id, sent_email_id, kind)` where `sent_email_id` is not null. Indexes `(org_id, mailbox_id, status, due_at)`, `(mailbox_id, thread_key) WHERE status = 'open'`. RLS on `org_id`; cascade with the mailbox; `UNIQUE (id, org_id)`.
- `sent_analyses`: `sent_email_id` (PK), `org_id`, `mailbox_id`, `status` (`pending` | `done` | `skipped` | `failed`), `skip_reason` (`own_only`, `system_draft`, `list`, `auto`, `calendar`, `too_many`, `no_text`, `too_old`, `thread_restart`, `llm_cap`), `expects_reply`, `has_promise` (bool, null), `prompt_version`, `attempts`, `next_attempt_at`, `created_at`, `updated_at`. No text column. Cascade with the sent row.
- `actions` (stage 09, the second migration): `email_id` becomes nullable; new `loop_id` (FK `(loop_id, org_id)` → `open_loops`, cascade). CHECK: exactly one of `email_id`, `loop_id`. A `loop_id` row is `create_draft` or `send` only. `outbox.loop_id` (same FK); the outbox mail-kind CHECK accepts `email_id` or `loop_id`.
- `delegations.source`: `triage` (default) | `button`.
- `mailbox_settings.loop_wait_days`: int, default 3, CHECK 1–10. Switch `tool_switches.auto_follow_up` (default off; no DDL).
- Index `emails (mailbox_id, thread_key, received_at)`, name `emails_thread_received_idx`, `CREATE INDEX IF NOT EXISTS` (F115 stage 03 plans the same index: one of the two creates it).
- Flags (`packages/core/src/features.ts`, epic `E5b`, remove-by 2027-06-01): `open_loops` (sent analysis, loops, brief sections, loop taps, routes, tabs), `delegate_button` (the Delegate button and picker).

## Core (`packages/core/src/loops/`)

- `extractorOutputSchema` (zod): `{ expects_reply: boolean, ask: string ≤ 80 | null, due: DueRef | null, promise: string ≤ 80 | null, promise_due: DueRef | null, language: "pl" | "en" | "other" }`. `DueRef = { kind: "date", date: "YYYY-MM-DD" } | { kind: "word", word: "today" | "tomorrow" | "monday" … "sunday" | "end_of_week" | "next_week" }`.
- `sentSkipReason(facts) → SkipReason | null` (the rule filters, D6).
- `DueRef`, `resolveDue(ref, { sentAt, timeZone }) → Date | null`, `defaultDue(sentAt, waitDays, timeZone) → Date` (`core/loops/dates.ts`, stage 01; rules there).
- `normalizeSubject(subject) → string` (drops `Re:`, `RE:`, `Odp:`, `Fwd:`, `FW:`, `PD:` prefixes, repeated; trims; lower case).
- `isAutoReply({ autoSubmitted, precedence, fromAddress }) → boolean` (D10).
- `loopSections(input) → BriefSections` and `renderBrief(sections, texts, opts)` (stage 17).

## Server (module `loops`, layer 3)

- `createLoopJobs(deps)` → jobs `loops.analyze` (every 60 s), `loops.match` (every 2 min), `loops.chaser` (every 15 min; acts once per local day from 07:30).
- `analyzeSent(deps, ctx, mailboxId, { now, limit })`, `matchReplies(deps, ctx, mailboxId, { now })`, `runLoopChaser(deps, ctx, mailboxId, { now, force })`.
- Commands, each with `via` (`web` | `telegram` | `cli`): `draftFollowUp(deps, ctx, { loopId, userId, via })` → `{ kind: "planned", sendId } | { kind: "would_draft" } | { kind: "waiting", sendId } | { kind: "closed" } | { kind: "limit_reached" } | { kind: "too_soon" } | { kind: "suspicious" } | { kind: "drafts_off" } | { kind: "not_allowed" } | { kind: "feature_off" } | { kind: "not_found" }`; `laterLoop`, `doneLoop`, `dropLoop`, `reopenLoop`, `untrackLoop` → `{ kind: "ok" } | { kind: "already" } | { kind: "limit_reached" } | { kind: "not_allowed" } | { kind: "not_found" }`.
- Readers: `listLoops(db, ctx, { kind, filter, before, limit })`, `briefLoopsOf(db, ctx, mailboxIds, { now, timeZone })`, `loopDueRows(db, ctx, { range })` (M2), `clearLoopTexts(db, { before, batch })` (retention).
- `loopHooks(deps): LoopHooks` wired in `main.ts`. `LoopHooks` is defined in `actions` with `noLoopHooks`: `isOpen(trx, ctx, loopId) → boolean`, `onFollowUpSent(trx, ctx, { loopId, sendId, messageId, at })`, `anchorOf(trx, ctx, loopId) → LoopAnchor | undefined` (`mailboxId`, `messageId`, `referencesIds`, `subject`, `to`, `cc`, `language`, `quote` (the own sent text or null), `sentAt`).
- `onSentOff(trx, ctx, { mailboxId, at })` → injected into `mail.setSentSync` as `SentSwitchHooks.onDisabled` (default no-op).

## Module `loops`: manual delegation

- `delegateMail(deps, ctx, { emailId, delegateId, userId, via })` → `{ kind: "planned", sendId, delegationId } | { kind: "exists", delegationId } | { kind: "delegate_inactive" } | { kind: "drafts_off" } | { kind: "not_delegable" } | { kind: "feature_off" } | { kind: "not_found" }`.

## Draft payload kind `follow_up` (`core/triage/payloads.ts`)

`{ kind: "follow_up", loop_id, to: address[1–10], cc: address[0–9], language, sent_at, subject, quote: string | null, n: 1 | 2 }`. The send payload repeats `kind`, `to`, `cc`. Recipients come from the loop row only (D12).

## Telegram callbacks (`core/digest/callback.ts`)

`lf:<loopId>` Draft follow-up, `ll:<loopId>` Later, `lc:<loopId>` Done, `lx:<loopId>` Drop, `lr:<loopId>` Reopen, `dg:<emailId>` open the picker, `dp:<email b64url>:<delegate b64url>` pick (16-byte UUIDs as 22-character base64url; 48 bytes). A test checks that every prefix is unique and every value ≤ 64 bytes.

## Routes (`/api`, flag `open_loops`; `/emails/:id/delegate` flag `delegate_button`)

- `GET /loops?kind=waiting|promised|delegated&filter=open|due|closed&before=&limit=` → `{ items: LoopItem[], next }`. `LoopItem`: `kind`, `id`, `status`, `closeReason`, `counterpart`, `delegate` (null), `text`, `subject`, `dueAt`, `dueSource`, `sentAt`, `laterLeft`, `followUpsSent`, `followUpWaiting`, `sendId`, `matchedBySubject`, `autoReplyOnly`, `reason` (a code for the reason line).
- `POST /loops/:id/follow-up` (owner), `/later` (member), `/done` (member), `/drop` (owner), `/reopen` (owner), `/untrack` (owner). 409 codes = the command kinds.
- `POST /emails/:id/delegate` (owner) `{ delegateId }` → 200 `{ sendId, delegationId }`; 409 `exists`, `delegate_inactive`, `drafts_off`, `not_delegable`.
- `GET /settings/:mailboxId` gains `loopWaitDays` (1–10) and the switch `auto_follow_up`; new `PATCH /settings/:mailboxId/loop-wait` `{ days }` (owner); `PATCH /settings/:mailboxId/switches/auto_follow_up` (the existing switch route).
- The Delegated tab reads `GET /delegations` (F102) and `GET /loops?kind=delegated` and shows them as two lists; `DelegationItem` does not change.
- `POST /telegram/consent` `{ version }`: from F115 stage 12 when landed, else stage 17 adds it with the same shape.
