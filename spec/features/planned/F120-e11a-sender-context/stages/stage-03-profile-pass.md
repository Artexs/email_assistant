# F120 stage 03 — Profile pass and job [risky]

Part of [`../plan.md`](../plan.md). Names: [`../interfaces.md`](../interfaces.md) § Contacts module.

Carry-over reads: stages 01–02; `modules/triage/extras-reader.ts` (`mailKindFilter`), `suspicious-context.ts` (own addresses), loops match rule (Sent From aliases), `main.ts` (`loops.match` scheduling), `docs/capabilities/sent-mail.md`, `layers.json`.

## Step 1 — module and aggregate read

- Goal: new module `contacts` (layer 3; edges of D7 only if imported; `bun run graph:modules`).
- `readSenderActivity(db, ctx, mailboxId, { now, testMail })`: set-based SQL (a fixed number of statements per mailbox, never one per sender) that returns per lower-case address the raw counts of interfaces.md § Profile row, the 30-day sub-counts that stage 05 needs (`received30`, `answered30`, `flagged30`), the 90-day suggestion counts (corrected to spam, corrected or moved back away from `spam`/`notification`, suspicious mail), the reply-delay samples (D5) and the bulk signal codes. Plain addresses stay in memory.
- Decisions: D4, D5. Own addresses (all mailboxes of the org, Sent From aliases of the mailbox) never get a row. Test mail never counts. A mail counts once per address.
- Bulk: a mail is bulk when it has `list_id`, `list_unsubscribe`, `auto_submitted` other than `no`, or a noreply sender (`isNoreplyAddress`). `relation` = `relationOf` with `isDelegate` (active delegate email equals the address) and `isVip` (a VIP rule of this mailbox or the org matches the address or its `@domain`).

## Step 2 — the pass and the job

- `refreshMailboxProfiles(deps, ctx, mailboxId, { now })`: in one transaction, `pg_try_advisory_xact_lock` on a key of the mailbox (D8; not taken → `{ skipped: true }`, no write); upsert one row per address (counts from the read; `first_seen_at` = least of stored and read; `last_seen_at` = greatest of stored, last incoming mail and last user mail; `refreshed_at = now`); set all counts to 0, medians to null and `relation = 'new'` for rows of the mailbox not in the read (D6). Hash with `senderKeyHash`.
- `readProfiles(db, ctx, mailboxId, addresses)` → `Map<lower address, SenderHistory>` with `days: 90`, `firstSeenDaysAgo`, `lastSeenDaysAgo`, `lastUserMailDaysAgo` from `now`.
- Job `contacts.refresh` (`0 7 * * * *`): each active mailbox of each organization that is not suspended and has `sender_context` on; a mailbox error logs `contacts_refresh_mailbox_failed` (ids and error code) and the run goes on. `bun run job:run --name contacts.refresh` runs one pass and prints counts. Log `contacts_refresh_done` (`mailbox_id`, `count`, `zeroed`; fields in `platform/log-fields.ts`). No address, hash or subject in a line.
- Fixture: `seedSenderActivity(db, ctx, mailboxId, spec)` in `apps/server/test/integration/fixtures.ts` writes the source rows of one sender spec; later stages reuse it.

## Test (integration `contacts-refresh.test.ts`, fixed `now`)

1. Sender `anna@acme.pl`: 8 mails in 30 days, 6 `answered`, 2 `flagged`, 3 Sent mails to her → one row, `received 8`, `answered 6`, `flagged 2`, `user_mails_to 3`, `relation known`.
2. A mail 91 days old of `anna@acme.pl` → not counted (`received` stays 8).
3. Reply delays: 5 pairs Sent → her reply of 10, 20, 30, 40, 50 h → `median_their_reply_hours 30`, `reply_samples_theirs 5`; 4 pairs → null.
4. User delay: 5 incoming mails answered after 2, 4, 6, 8, 10 h (Sent `parent_message_id` = incoming id) → `median_user_reply_hours 6`.
5. Recipient only: Sent mail to `bob@beta.pl`, no mail from him → row with `received 0`, `user_mails_to 1`, `relation known`.
6. Own address and Sent From alias → no row. Test mail (synthetic Message-ID) → no row.
7. Bulk: 3 of 4 mails with `list_id` → `relation bulk`, `bulk_signals` holds `list_id`.
8. Second pass after all mail is older than 90 days → row stays, counts 0, `first_seen_at` unchanged.
9. Two passes at once (two connections; the first holds the lock) → the second returns `skipped: true`; one row per address.
10. Privacy scan: after the pass, no column of `sender_profiles` holds `anna@acme.pl`, `acme.pl` or `Anna` (scan every text, array and jsonb column as text).
11. Flag off → the job writes nothing for that org; a suspended org → nothing.
12. Org B sender with the same address → its own row with a different `key_hash`.

Report the pass time for 5,000 mails and 500 senders in the final message (no assert).

## Done when

Tests 1–12 pass; mutation: drop the 90-day bound → test 2 fails; take the lock away → test 9 fails. Then the Proof command.
