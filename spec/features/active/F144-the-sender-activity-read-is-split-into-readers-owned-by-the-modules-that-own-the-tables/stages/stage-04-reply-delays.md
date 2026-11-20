# F144 stage 04 — mail reply-delay readers [risky]

Part of [`../plan.md`](../plan.md). `[risky]`: the two delay statements are the costly part of the pass and feed the reply times of the profile and the open-loop wait. Review: `claude-opus-5-5` before the land.

Needs stage 02: `senderWindow`, `SenderWindowOptions`, `notAutomatic` in the mail module. Needs stage 01: `contacts-activity-golden.test.ts`.
May run next to 03 and 05: this stage adds only `mail/repo/sender-delays.ts` and its exports and changes the `userDelays` and `theirDelays` statements of `contacts/activity.ts`. A land conflict: merge master, re-prove.

## Step 1 — the two readers (D3, D5, D6, D7, D9, D14)

- **Goal:** the user-delay and their-delay statements become mail readers with today's results and today's plan shape.
- **Files:** new `apps/server/src/modules/mail/repo/sender-delays.ts`, exported through `mail/repo/index.ts` and `mail/index.ts`; `contacts/activity.ts`.
- **Interfaces** (`address` in the rule form; `medianHours` from `percentile_cont(0.5)`):
  - `userReplyDelaysBySender(db, ctx, window: SenderWindowOptions, options: { maxHours: number }): Promise<{ address: string; samples: number; medianHours: number }[]>` — per window mail, the first user Sent mail (`ORDER BY sent_at, id LIMIT 1` in a lateral) with `parent_message_id` = the mail's Message-ID, not automatic, `sent_at` after `received_at` and at or after `since`, that goes to the sender or has no stored recipient. Samples with hours `> 0` and `≤ maxHours`.
  - `theirReplyDelaysBySender(db, ctx, window: SenderWindowOptions, options: { maxHours: number }): Promise<{ address: string; samples: number; medianHours: number }[]>` — per incoming window mail, the newest user Sent mail before it that the mail names in `In-Reply-To` (`<id>` tokens when there are any, else bare words; first 2000 characters); one sample per incoming mail.
- **Edge rules (keep, D11):** the user-delay read has no upper bound on `sent_at`. The own Sent set of the their-delay read (`own_sent`) has no Auto-Submitted filter and no date bound. Do not "align" them.
- **Decisions:** D5 — both CTEs of the their-delay read stay `MATERIALIZED` (`CTEBuilder.materialized()` exists in Kysely 0.29.8, plan review N13); the lateral uses `innerJoinLateral … onTrue`. The In-Reply-To regexps stay `sql` expressions with the same text. D7 — `MIN_DELAY_SAMPLES` and `MAX_DELAY_HOURS` stay in contacts; contacts passes `maxHours` and calls both readers only without a scope.
- **Test** (new `apps/server/test/integration/mail-sender-delays.test.ts`; `NOW` and `ago` of `contacts-fixtures.ts`):
  1. User delays: 5 mails of `a@example.com` with replies of 1, 2, 3, 4, 10 hours: `{ samples: 5, medianHours: 3 }`.
  2. A reply at `maxHours + 1` h is no sample.
  3. A mail with a reply at −1 h and one at +2 h gives one sample of 2 h.
  4. A mail with replies at +2 h and +5 h gives one sample of 2 h (the `LIMIT 1` guard).
  5. A reply only to `other@example.com` is no sample; a reply with no stored recipient is a sample.
  6. Their delays: `b@example.com` mails naming `<m1@x>` with 2 h and `m2@x` (a bare word) with 4 h: `{ samples: 2, medianHours: 3 }`.
  7. A mail of `c@example.com` whose In-Reply-To names two own mails takes the newer one (one sample).
  8. Tenant (plan rule form): both readers with org A's `ctx` and org B's mailbox id return `[]`.
  9. Mailbox: a Sent mail of a second mailbox of org A never pairs with a mail of the first.
- **Guard check:** remove `s.sent_at > w.received_at` in the user-delay lateral, see test 3 fail; remove `LIMIT 1`, see test 4 fail; remove the window `org_id` filter together with the `sent_emails.org_id` filter of the lateral, see user test 8 fail (each alone fails no test: the composite foreign key `(mailbox_id, org_id)` keeps rows of another organization out of this mailbox); remove the window `org_id` filter together with the `own_sent` `org_id` filter, see their test 5 fail; remove `sent_emails.mailbox_id` in the lateral, see user test 9 fail; remove it in `own_sent`, see their test 6 fail.
- **SQL check:** compare the `.compile()` SQL of both readers with today's text (scratch, not committed); name any change of `LATERAL`, `MATERIALIZED`, `DISTINCT ON` or `LIMIT 1` in your final message.
- **Check:** `bun test` on the new file, the golden test and the `contacts-refresh*` integration files.
- **Done when:** the golden test passes unchanged, the new tests pass, `contacts/activity.ts` names no `sent_emails` once stage 03 has landed too, and the Proof prints `PROOF_OK`.
- **Out of scope:** any change of a sample rule; the Sent counts (03); triage (05).
