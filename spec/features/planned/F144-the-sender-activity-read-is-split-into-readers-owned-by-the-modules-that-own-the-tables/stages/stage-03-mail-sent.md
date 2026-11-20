# F144 stage 03 — mail Sent counts, replied mails and reply delays [risky]

Part of [`../plan.md`](../plan.md). `[risky]`: the delay statements are the costly part of the pass and feed the reply times of the profile. Review: `claude-opus-5-5` before the land.

Needs stage 02: `senderWindow`, `SenderWindow`, `SenderWindowOptions`, `SenderScope`, `notAutomatic` in the mail module. Needs stage 01: `contacts-activity-golden.test.ts`.
May run next to 04 (it changes the triage statements). A land conflict in `contacts/activity.ts`: merge master, re-prove.

## Step 1 — the readers (D3, D5, D6, D7, D9)

- **Goal:** the four `sent_emails` statements become mail readers.
- **Files:** new `apps/server/src/modules/mail/repo/sender-replies.ts`, exported through `mail/repo/index.ts` and `mail/index.ts`; `contacts/activity.ts`.
- **Interfaces** (all `(db: DbOrTrx, ctx: TenantContext, …)`, all rows with `address` in the rule form):
  - `sentCountsByRecipient(db, ctx, options: { mailboxId; since; until; only?: SenderScope }): Promise<{ address; mails; lastAt: Date }[]>` — the user's own mails (`origin = 'user'`, not automatic) to each To or Cc address with an `@`, once per mail; `lastAt` is the newest `internal_date`.
  - `repliedBySentBySender(db, ctx, window: SenderWindowOptions): Promise<{ address; mails }[]>` — window mails with a user Sent reply (`parent_message_id` = Message-ID, sent after the mail, sent at or after `since`), to any recipient.
  - `userReplyDelaysBySender(db, ctx, window: SenderWindowOptions, options: { maxHours: number }): Promise<{ address; samples; medianHours: number }[]>` — the first such reply that goes to the sender or has no stored recipient; samples with hours `> 0` and `≤ maxHours`.
  - `theirReplyDelaysBySender(db, ctx, window: SenderWindowOptions, options: { maxHours: number }): Promise<{ address; samples; medianHours: number }[]>` — the newest user Sent mail that an incoming mail names in `In-Reply-To` (`<id>` tokens when there are any, else bare words; first 2000 characters); one sample per incoming mail.
- **Decisions:** D5 — the `MATERIALIZED` CTEs of the their-delay read stay `MATERIALIZED` (Kysely `.materialized()` if it exists in 0.29; else the D5 fallback for this one statement, with the reason in a comment). The In-Reply-To regexps stay `sql` expressions with the same text. D7 — `MIN_DELAY_SAMPLES` and `MAX_DELAY_HOURS` stay in contacts; contacts passes `maxHours`. D9 — contacts calls the two delay readers only without a scope.
- **Not verified, check here:** `crossJoinLateral` and `.materialized()` in `node_modules/kysely` 0.29; report it.
- **Test** (new `apps/server/test/integration/mail-sender-replies.test.ts`, fixed `NOW = 2026-06-15T12:00:00Z`):
  1. Sent counts: two user mails to `a@example.com` (To and Cc of one mail counts once), one system send and one `Auto-Submitted: auto-replied` user mail to it, one recipient `undisclosed` without `@`: `{ address: "a@example.com", mails: 2, lastAt: <the newer internal_date> }`, no row without `@`.
  2. Replied: a mail of `b@` answered by a user Sent mail to `reply-to@example.com`: `b@` has `mails: 1`; a Sent reply dated before the mail does not count.
  3. User delays: 5 replies of 1, 2, 3, 4, 10 hours → `{ samples: 5, medianHours: 3 }`; a reply at −1 h (clock skew) and one at `maxHours + 1` are no samples.
  4. User delay goes to the sender: a reply with recipient `other@example.com` only is no sample; a reply with no stored recipient is a sample.
  5. Their delays: incoming mails naming `<m1@x>` with 2 h and `m2@x` (bare word) with 4 h: `{ samples: 2, medianHours: 3 }`; an In-Reply-To naming two own mails takes the newest one.
  6. Tenant: org B has the same Message-IDs and addresses; each reader of org A returns the values of tests 1–5.
  7. Mailbox: Sent mail of a second mailbox of org A never pairs with a mail of the first.
- **Guard check:** remove `s.org_id` in the their-delay read, see test 6 fail; remove `s.mailbox_id` in the user-delay read, see test 7 fail; remove the `hours > 0` filter, see test 3 fail.
- **Check:** `bun test` on the new file, the golden test and the `contacts-refresh*` and `contacts-activity-only` integration files.
- **SQL check:** compare the `.compile()` SQL of the two delay readers with today's text (scratch, not committed); name any change of `LATERAL`, `MATERIALIZED` or `LIMIT 1` in your final message.
- **Done when:** the golden test passes unchanged, the new tests pass, `contacts/activity.ts` names no `sent_emails`, and the Proof prints `PROOF_OK`.
- **Out of scope:** triage (04); delegation and docs (05); any change of a sample rule.
