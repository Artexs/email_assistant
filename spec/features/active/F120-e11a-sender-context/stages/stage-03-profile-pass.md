# F120 stage 03 — Profile read and write [risky]

Part of [`../plan.md`](../plan.md); names in [`../interfaces.md`](../interfaces.md) § Contacts module.

Carry-over reads: stages 01–02; `modules/triage/extras-reader.ts` (`mailKindFilter`), `suspicious-context.ts` (own addresses), the loops reply rule (Sent From aliases, `replyMatch` id compare), `docs/capabilities/sent-mail.md`, `retention.md` (captured headers), `layers.json`.

## Step 1 — module and aggregate read

- Goal: new module `contacts` (layer 3; edges of D7 only where imported; `bun run graph:modules`).
- `readSenderActivity(db, ctx, mailboxId, { now })`: set-based SQL (a fixed number of statements per mailbox, never one per sender) that returns per lower-case address the counts of interfaces.md § Profile row, the 30-day sub-counts (`received30`, `answered30`, `flagged30`), the 90-day suggestion counts (`correctedToSpam90`, `rescued90` as distinct mails, `suspicious90`), the reply-delay samples and the bulk signal codes. Plain addresses stay in memory.
- Decisions: D4, D5, D17. Own addresses (all mailboxes of the org, Sent From aliases of the mailbox) never get a row. Test mail never counts. A mail counts once per address.
- Bulk (D17): a mail is bulk when its captured headers are not cleared and hold `list_id`, `list_unsubscribe` or `auto_submitted` other than `no`, or when the sender is noreply (`isNoreplyAddress`, any age). The ratio for `relationOf` uses as denominator the mails whose headers are not cleared, plus noreply mails.
- Delays (D5): a delay ≤ 0 is dropped; median only with ≥ 5 samples.
- `relation` = `relationOf` with `isDelegate` (an active delegate email equals the address) and `isVip` (a VIP rule of the mailbox or the org matches the address or its `@domain`).

## Step 2 — write and read back

- `refreshMailboxProfiles(deps, ctx, mailboxId, { now })`: one transaction; first `pg_try_advisory_xact_lock(profileLockKey(mailboxId))` (busy → `{ skipped: true }`, no read, no write); then the read of step 1 inside the lock; then upsert one row per address (`first_seen_at` = least of stored and read; `last_seen_at` = greatest of stored, last incoming mail and last user mail; `refreshed_at = now`); rows of the mailbox not in the read get counts 0, medians null, `relation = 'new'` (D6). Hash with `senderKeyHash`. `profileLockKey` is exported for stage 04.
- `readProfiles(db, ctx, pairs, now)`: one query for all `(mailboxId, address)` pairs; map to `SenderHistory` (`days: 90`, `…DaysAgo` from `now`).
- Fixture `seedSenderActivity(db, ctx, mailboxId, spec)` in `apps/server/test/integration/fixtures.ts`: the source rows of one sender spec (mail, results, feedback, flags, headers, Sent).

## Test (integration `contacts-refresh.test.ts`, fixed `now`)

1. `anna@acme.pl`: 8 mails in 30 days, 6 answered, 2 flagged, 3 Sent mails to her → `received 8`, `answered 6`, `flagged 2`, `user_mails_to 3`, `relation known`.
2. A mail 91 days old → not counted.
3. Their delays 10, 20, 30, 40, 50 h → median 30, `reply_samples_theirs 5`; 4 pairs → null. A Sent mail whose id is the second id in `in_reply_to` counts.
4. User delays 2, 4, 6, 8, 10 h → median 6; one more pair at −1 h (clock skew) → still median 6, no error.
5. Sent to `bob@beta.pl` only → row `received 0`, `user_mails_to 1`, `relation known`.
6. Own address, Sent From alias, test mail → no row.
7. Bulk: 3 of 4 fresh mails with `list_id` → `bulk`. Newsletter with 13 mails over 90 days, headers cleared on the 9 older ones, all 4 fresh with `list_id` → `bulk`.
8. Second pass when all mail is older than 90 days → counts 0, `first_seen_at` unchanged.
9. Privacy scan: no text, array or jsonb column of `sender_profiles` holds `anna@acme.pl`, `acme.pl` or `Anna`.
10. Org B, same address → own row, different `key_hash`.
11. `readProfiles` with pairs of two mailboxes → both rows in one call.
12. Lock held by another connection → `skipped: true`, rows unchanged.

## Done when

All tests pass; mutations: drop the 90-day bound → test 2 fails; use all mail as the bulk denominator → test 7 fails. Then the Proof command.
