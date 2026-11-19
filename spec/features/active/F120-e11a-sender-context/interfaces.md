# F120 · Interfaces

Names that one stage creates and a later stage or ticket uses. Code detail beyond these is the worker's at `HEAD`.

## Core (`packages/core`, stage 01)

- `contactWaitDays(medianTheirReplyHours: number | null, samples: number): number | null` — D12; null below 5 samples or with a null median.
- `usualReplyDays(medianHours: number): number` — clamp(round(h / 24), 1, 60).
- `suggestionKinds = ["vip", "whitelist", "blocklist"]`, `suggestionScopes = ["address", "domain"]`, `suggestionStatuses = ["open", "accepted", "dismissed", "withdrawn", "expired"]`.
- `SuggestionInput` (one per address, in memory): `{ address, domain, isFreeMailDomain, isOwnDomain, isOwn, isNoreply, relation, received30, answered30, flagged30, correctedToSpam90, rescued90, answered90, userMailsTo90, suspicious90, isVip, isWhitelisted, isBlocklisted, isDelegate }`. `rescued90` = distinct mails that the user moved back or corrected away from `spam` or `notification` (one mail counts once).
- `SuggestionReason` (counts only, stored as JSON): `{ received?, answered?, flagged?, corrected?, rescued?, senders? }`, `.strict()`.
- `suggestionsFor(inputs, ctx: { dismissed: Set<string /* kind:scope:key */>, open: Set<string>, createdLast7Days: number, sentCoverage: boolean, keyOf(value) }) : Candidate[]` — D10 rules, conflict rule, cap order. Pure.
- `SenderLine` (web schema, `@ea/core/web`): `{ relation: SenderRelation, received: number, answered: number, userMailsTo: number, lastSeenDaysAgo: number | null, days: 90 }`.
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

- Stage 03 (built): `readSenderActivity(db, ctx, mailboxId, { now, testMail })`; `refreshMailboxProfiles(deps: { db, credentialsKey, testMail }, ctx, mailboxId, { now }) : Promise<{ written: number; zeroed: number; skipped: boolean }>` (`skipped` also when `sender_context` is off); `readProfiles(deps: { db, credentialsKey }, ctx, pairs: { mailboxId: string; address: string }[], now) : Promise<Map<string /* `${mailboxId}:${lower address}` */, SenderHistory>>` (one query for up to 1,000 pairs; hashes inside, so the key is a parameter; `days: 90`); `tryLockProfiles(db, mailboxId)`.
- Stage 03b: job `contacts.refresh` (`0 7 * * * *`, hourly at minute 7); `profileLockKey(mailboxId)` (the advisory lock key that the pass and the DSR erase share, D8); `sentCoverage(db, ctx, mailboxId)` (D16).
- Stage 04 (built): `deleteOldProfiles(db, ctx, { before })`, `deleteEndedSuggestions(db, ctx, { before, openBefore, now })` (retention clearers; the second ends open rows older than `openBefore` as `expired`, then deletes ended rows older than `before`; both return a row count); `lockProfilesOfOrg(trx, ctx)` (blocking lock of every mailbox, id order), `senderContextRowsOf(db, ctx, credentialsKey, address)` → `{ profiles, suggestions }` (ids), `deleteSenderContextRowsOf(trx, ctx, credentialsKey, address)` (DSR); `senderAddressesOfProfiles(db, ctx, credentialsKey)` → `Map<hash, address>` (export). `matchSubject(db, orgId, address, credentialsKey)` and `exportOrganization(db, { …, credentialsKey })` take the key.
- Stage 05 (built; `notes/2026-11-19-f120-s05-suggestions.md`): `sentCoverage(db, ctx, mailboxId, now)` is now current coverage (fresh pass within 24 h, no error code); `deps = { db, now, testMail }` (stage 07: the Accept re-check reads the sender activity, which needs the test-mail rule); `acceptSuggestion(deps, ctx, { id, actor, via })` → `accepted | already | rule_limit | not_available | not_found` (`not_available`: the sender is protected now; the row ends as `withdrawn`; stage 07, notes `notes/2026-11-19-f120-s07-rules-card.md`); `dismissSuggestion(…)` → `dismissed | already | not_found`; `listOpenSuggestions(db, ctx, mailboxId)`; `countOpenSuggestions(db, ctx, mailboxId)`. Audit events `suggestion.accepted`, `suggestion.dismissed` (data: `mailbox_id`, `kind`, `scope`, `via`).
- Stage 06 routes: `GET /api/suggestions/:mailboxId` (member), `POST /api/suggestions/:id/accept`, `POST /api/suggestions/:id/dismiss` (owner). Flag `sender_suggestions` first: 404 `not_found` for every role. Built (`notes/2026-11-19-f120-s06-suggestion-routes.md`): `suggestionRoutes({ db, now, testMail })` in `modules/contacts/routes.ts`; `listOpenSuggestions` now returns newest first; `countOpenSuggestionsOfOrg(db, ctx)` (the weekly line). Weekly view key: `suggestions?: { open: number; panelUrl?: string }`.
- Stage 09: `contactWaitFor(db, ctx, mailboxId, counterpart) : Promise<{ waitDays: number; usualReplyDays: number } | null>` (null with `contact_wait` or `sender_context` off).

## Triage hook (stage 11)

`ClassifierExtras.senderProfile: SenderHistory | null`; `loadClassifierExtras` takes `readProfile?: (ctx, mailboxId, senderLower) => Promise<SenderHistory | null>` from `composition.ts`.
