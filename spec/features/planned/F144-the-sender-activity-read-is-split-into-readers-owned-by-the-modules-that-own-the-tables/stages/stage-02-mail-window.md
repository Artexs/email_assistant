# F144 stage 02 — mail window, incoming counts and own addresses

Part of [`../plan.md`](../plan.md). Review: `claude-sonnet-5-5` before the land (new tenant filters).

Needs stage 01: `contacts-activity-golden.test.ts`. Needs F142 stage 01: `normalizedAddress` exported by `apps/server/src/platform/db`, `normalizeAddress` exported by `@ea/core`.
Writes for later stages: `senderWindow`, `SenderWindow`, `SenderWindowOptions`, `SenderScope`, and the mail-internal `notAutomatic` and `senderScopeCondition` (today's `scopeCondition` with `escapeLike`).
Runs alone: stages 03, 04 and 05 need its window.

## Step 1 — the window and the incoming counts (D3, D4, D5, D9, D11)

- **Goal:** the incoming-mail statement becomes a mail reader; the window becomes a mail query part.
- **Files:** new `apps/server/src/modules/mail/repo/sender-activity.ts`, exported through `mail/repo/index.ts` and `mail/index.ts`; `contacts/activity.ts`.
- **Interfaces:**
  - `type SenderScope = { address: string } | { domain: string }`.
  - `interface SenderWindowOptions { mailboxId: string; since: Date; until: Date; testMail: TestMailRule; only?: SenderScope }`.
  - `senderWindow(db: DbOrTrx, ctx: TenantContext, options: SenderWindowOptions): SenderWindow`: a Kysely select (not executed) over `emails` with the columns `id`, `address` (rule form, D6), `received_at`, `message_id_header`, `in_reply_to`. `SenderWindow` is its exported type; triage and the Sent readers embed it as a CTE. It may take `db` (review B1: counting executed statements makes embedding count once).
  - `incomingCountsBySender(db, ctx, options: SenderWindowOptions & { since30: Date; unseenBefore: Date }): Promise<IncomingCounts[]>` with `IncomingCounts = { address; received; received30; answered; answered30; flagged; flagged30; unseen7d; headersKept; headersBulk; listId: boolean; listUnsubscribe: boolean; autoSubmitted: boolean; firstAt: Date; lastAt: Date }`. One statement: the window joined to `email_flags` and `email_headers`. No `suspicious` (D4).
  - `notAutomatic` (the Auto-Submitted test) moves into the mail module and is not exported from `mail/index.ts`.
- **Decisions:** D4 — in `contacts/activity.ts`, the remaining raw `categories` statement gets the suspicious count per address and category, and contacts sums it per address into `suspicious90`; stage 05 then moves that statement. D5 — `count(*) FILTER` through the builder if it has one. D7 — `ActivityScope` in contacts becomes `type ActivityScope = SenderScope`.
- **Test** (new `apps/server/test/integration/mail-sender-activity.test.ts`; `NOW` and `ago` of `contacts-fixtures.ts`):
  1. `x@example.com` with 3 mails at 1, 40 and 89 days, 1 answered at 1 day, 1 flagged at 40 days, 1 unseen at 40 days: `{ received: 3, received30: 1, answered: 1, answered30: 1, flagged: 1, flagged30: 0, unseen7d: 1 }`.
  2. A mail at 91 days and one 1 minute after `NOW` are not counted; one at exactly `NOW − 90 days` is.
  3. A test-mail sender row is absent from the window (the `mailKindFilter` guard).
  4. Tenant: org B holds the same address and 5 mails; org A's reader returns `received: 3`, and with org A's `ctx` and org B's mailbox id returns `[]`.
  5. Mailbox: a second mailbox of org A with 2 mails of the same sender is not counted.
  6. Scope: `only: { domain: "example.com" }` returns `x@example.com` and `y@sub.example.com`, not `z@example.org` and not `w@badexample.com`; `only: { address: "x@example.com" }` returns the one row (the caller passes the rule form, as today).
  7. Headers: a mail with `List-Id`, one with `Auto-Submitted: auto-replied`, one with `Auto-Submitted: no`, one with cleared texts: `{ headersKept: 3, headersBulk: 2, listId: true, autoSubmitted: true }`.
- **Guard check:** remove the `emails.org_id` filter of the window, see test 4 fail; remove the mailbox filter, see test 5 fail; remove `mailKindFilter`, see test 3 fail.

## Step 2 — own addresses (D6)

- **Goal:** the own-address read (mailbox addresses plus Sent From aliases) becomes one mail reader.
- **Files:** `mail/repo/sender-activity.ts`; `contacts/activity.ts`.
- **Interfaces:** `ownAddressesOf(db, ctx, mailboxId: string, options: { maxAliases: number }): Promise<Set<string>>`, rule form. Contacts passes `maxAliases: 100`.
- **Test** (same file): 8. Org mailboxes `me@example.com` and `Other@Example.com`, Sent From `alias@example.com` in this mailbox and `far@example.com` in another mailbox: the set is `{ me@…, other@…, alias@… }`. 9. With `maxAliases: 1` and two aliases, the newest-sent alias is kept. 10. Tenant: org B has mailbox `me2@example.com` and Sent alias `alias2@example.com`; neither is in org A's set, also when org A's `ctx` is called with org B's mailbox id (aliases then empty).
- **Check:** `bun test apps/server/test/integration/mail-sender-activity.test.ts apps/server/test/integration/contacts-activity-golden.test.ts apps/server/test/integration/contacts-refresh.test.ts apps/server/test/integration/contacts-activity-only.test.ts apps/server/test/integration/contacts-refresh-guards.test.ts`.
- **Done when:** the golden test passes unchanged, the new tests pass, `contacts/activity.ts` no longer names `email_flags`, `email_headers` or the Sent alias query, and the Proof prints `PROOF_OK`.
- **Out of scope:** stages 03–06.
