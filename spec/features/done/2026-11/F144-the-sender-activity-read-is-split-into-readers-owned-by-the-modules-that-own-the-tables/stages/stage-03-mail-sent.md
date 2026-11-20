# F144 stage 03 — mail Sent counts and replied mails

Part of [`../plan.md`](../plan.md). Lands on the worker's proof.

Needs stage 02: `senderWindow`, `SenderWindowOptions`, `SenderScope`, `notAutomatic` and `senderScopeCondition` in the mail module. Needs stage 01: `contacts-activity-golden.test.ts`.
May run next to 04 and 05: this stage adds only `mail/repo/sender-replies.ts` and its exports and changes the `sent` and `replied` statements of `contacts/activity.ts`. A land conflict in `contacts/activity.ts` or `mail/index.ts`: merge master, re-prove.

## Step 1 — the two readers (D3, D5, D6, D9, D14)

- **Goal:** the `sent` and `replied` statements become mail readers with today's results.
- **Files:** new `apps/server/src/modules/mail/repo/sender-replies.ts`, exported through `mail/repo/index.ts` and `mail/index.ts`; `contacts/activity.ts`.
- **Interfaces** (`(db: DbOrTrx, ctx: TenantContext, …)`; `address` in the rule form):
  - `sentCountsByRecipient(db, ctx, options: { mailboxId: string; since: Date; until: Date; only?: SenderScope }): Promise<{ address: string; mails: number; lastAt: Date }[]>` — the user's own mails (`origin = 'user'`, not automatic, `internal_date` in `[since, until]`) to each To or Cc address that holds `@`, once per mail; `lastAt` is the newest `internal_date`. The scope uses `senderScopeCondition` of stage 02.
  - `repliedBySentBySender(db, ctx, window: SenderWindowOptions): Promise<{ address: string; mails: number }[]>` — window mails with a Message-ID that have at least one user Sent mail with `parent_message_id` = that Message-ID, not automatic, `sent_at` after the mail's `received_at` and at or after `since`, to any recipient. An `EXISTS`, so a mail counts once.
- **Edge rules (keep, D11):** the replied read has no upper bound on `sent_at` (a reply after `until` counts, as today). Do not add one.
- **Test** (new `apps/server/test/integration/mail-sender-replies.test.ts`; `NOW` and `ago` of `contacts-fixtures.ts`):
  1. Sent counts: two user mails to `a@example.com` (To and Cc of one mail counts once), one system send and one `Auto-Submitted: auto-replied` user mail to it, one recipient `undisclosed` without `@`: `{ address: "a@example.com", mails: 2, lastAt: <the newer internal_date> }`, no row without `@`.
  2. Replied: a mail of `b@example.com` answered by a user Sent mail to `reply-to@example.com`: `b@` has `mails: 1`; a Sent reply dated before the mail does not count.
  3. Two replies to one mail of `c@example.com` at +2 h and +5 h: `c@` has `mails: 1` (the `EXISTS` guard).
  4. Tenant (plan rule form): both readers with org A's `ctx` and org B's mailbox id return `[]`.
  5. Mailbox: Sent mail of a second mailbox of org A does not pair with a mail of the first.
  6. Scope: `only: { domain: "example.com" }` returns `a@example.com`, not `a@example.org`.
- **Guard check:** remove `s.org_id` in the Sent-count read, see test 4 fail; remove `s.mailbox_id` in the replied read, see test 5 fail; turn the `EXISTS` into a join, see test 3 fail.
- **Check:** `bun test` on the new file, the golden test and the `contacts-refresh*` and `contacts-activity-only` integration files.
- **Done when:** the golden test passes unchanged, the new tests pass, and the Proof prints `PROOF_OK`.
- **Out of scope:** the delay statements (stage 04); triage (05); delegation and docs (06).
