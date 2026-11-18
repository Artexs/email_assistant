# F120 · Interfaces

Names that one stage creates and a later stage or ticket uses. Code detail beyond these is the worker's at `HEAD`.

## Core (`packages/core`, stage 01)

- `contactWaitDays(medianTheirReplyHours: number | null, samples: number): number | null` — D12; null below 5 samples or with a null median.
- `usualReplyDays(medianHours: number): number` — max(1, round(h / 24)).
- `suggestionKinds = ["vip", "whitelist", "blocklist"]`, `suggestionScopes = ["address", "domain"]`, `suggestionStatuses = ["open", "accepted", "dismissed", "withdrawn", "expired"]`.
- `SuggestionInput` (one per address, in memory): `{ address, domain, isFreeMailDomain, isOwn, isNoreply, relation, received30, answered30, flagged30, correctedToSpam90, correctedAwayFromSpamOrNotification90, movedBackFromSpamOrNotification90, answered90, userMailsTo90, suspicious90, isVip, isWhitelisted, isBlocklisted, isDelegate }`.
- `SuggestionReason` (counts only, stored as JSON): `{ received?, answered?, flagged?, corrected?, movedBack?, senders? }`, `.strict()`.
- `suggestionsFor(inputs, ctx: { dismissed: Set<string /* kind:scope:key */>, open: Set<string>, createdLast7Days: number, keyOf(value) }) : Candidate[]` — D10 rules, conflict rule, cap order. Pure.
- `SenderLine` (web schema, `@ea/core/web`): `{ relation: SenderRelation, received: number, answered: number, userMailsTo: number, days: 90 }`.
- `SuggestionItem` (web schema): `{ id, kind, scope, pattern, reason: SuggestionReason, createdAt }`.

## Server platform (stage 01)

- `senderKeyHash(credentialsKeyBase64: string, orgId: string, address: string): string` in `platform/crypto.ts` (D3). Caller normalizes (trim, lower case).

## Tables (stage 02, one migration)

### Profile row: `sender_profiles`

`id uuid pk`, `org_id`, `mailbox_id` (FK `mailboxes` ON DELETE CASCADE), `key_hash text`, unique `(mailbox_id, key_hash)`; `received`, `moved_back`, `answered`, `flagged`, `unseen_7d`, `user_mails_to`, `delegations_to` (int ≥ 0); `by_category jsonb`, `corrections jsonb` (category → count); `bulk_signals text[]` (values of `bulkSignals`); `median_user_reply_hours`, `median_their_reply_hours` (real, null); `reply_samples_theirs int` (for D12); `relation text` CHECK `senderRelations`; `first_seen_at`, `last_seen_at`, `last_user_mail_at` (timestamptz, null), `refreshed_at`. No text column holds an address, a name or a subject.

Meanings (90-day window, D4): `received` incoming mails; `by_category` newest `triage_results` category per mail; `corrections` newest `wrong` feedback per mail by `true_category`; `moved_back` newest feedback with source `imap_move`; `answered`, `flagged` from `email_flags`; `unseen_7d` checked, not seen, received more than 7 days ago; `user_mails_to` `origin = user` Sent mails with the address in To or Cc; `delegations_to` delegations to an active delegate with this email.

### `sender_suggestions`

`id`, `org_id`, `mailbox_id` (FK cascade), `key_hash`, `scope`, `kind`, `pattern text null` (the address or `@domain`; null after the end), `reason jsonb`, `status`, `created_at`, `ended_at`, `ended_by uuid null`. Unique partial `(mailbox_id, scope, key_hash, kind) WHERE status = 'open'`. For a domain row, `key_hash = senderKeyHash(…, '@' + domain)`.

### `open_loops`

`due_source` CHECK adds `'contact'`; new column `usual_reply_days smallint null` (set only with `contact`).

## Contacts module (`apps/server/src/modules/contacts`, layer 3)

- Stage 03: `refreshMailboxProfiles(deps, ctx, mailboxId, { now }) : Promise<{ written: number; zeroed: number; skipped: boolean }>`; job `contacts.refresh` (`0 7 * * * *`, hourly at minute 7); `readProfiles(db, ctx, mailboxId, addresses: string[]) : Promise<Map<string /* lower address */, SenderHistory>>` (hashes inside; `days: 90`).
- Stage 04: `deleteOldProfiles(db, ctx, { before })`, `deleteEndedSuggestions(db, ctx, { before })` (retention clearers); `profileRowsOfAddress(trx, ctx, address)` count and delete for DSR.
- Stage 05: `acceptSuggestion(deps, ctx, { id, actor, via })` → `accepted | already | rule_limit | not_found`; `dismissSuggestion(…)` → `dismissed | already | not_found`; `listOpenSuggestions(db, ctx, mailboxId)`; `countOpenSuggestions(db, ctx, mailboxId)`. Audit events `suggestion.accepted`, `suggestion.dismissed` (data: `mailbox_id`, `kind`, `scope`).
- Stage 06 routes: `GET /api/suggestions/:mailboxId` (member), `POST /api/suggestions/:id/accept`, `POST /api/suggestions/:id/dismiss` (owner). Flag `sender_suggestions` first: 404 `not_found` for every role.
- Stage 09: `contactWaitFor(db, ctx, mailboxId, address) : Promise<{ waitDays: number; usualReplyDays: number } | null>`.

## Triage hook (stage 11)

`ClassifierExtras.senderProfile: SenderHistory | null`; `loadClassifierExtras` takes `readProfile?: (ctx, mailboxId, senderLower) => Promise<SenderHistory | null>` from `composition.ts`.
