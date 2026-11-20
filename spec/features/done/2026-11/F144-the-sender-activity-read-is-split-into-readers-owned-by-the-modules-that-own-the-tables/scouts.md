# F144 scouts

Three scouts, started 2026-11-20 at base c1947f3b. Packets copied whole from each job log (the job result holds only its note check).

## Scout 1 · job 2026-11-20-f144-scout-1-9a2220c1

Question: Which callers use readSenderActivity in apps/server/src/modules/contacts/activity.ts, what is its full signature and output shape, and which SQL statements in it read which tables? List each statement with its purpose, its parameters, and whether it is set-based. Also list the tests that cover it.

Packet: callers, signature, output shape, SQL statements and tests of `readSenderActivity` (contacts/activity.ts)
Base: c1947f3b
Verified: `grep -rn readSenderActivity --include=*.ts .` -> `./apps/server/src/modules/contacts/refresh.ts:115:    const activity = await readSenderActivity(trx, ctx, mailboxId, { now, testMail: deps.testMail });`; `git status --short` printed nothing (worktree clean).
Unknowns: I did not run the tests, so I have not seen their pass/fail state. I read their names and a few assertions only. I did not read the bodies of tests 1–4 in `contacts-activity-only.test.ts` or the guards tests beyond their titles.

1. **Callers and signature.**
   - Signature: `readSenderActivity(db: Db | Transaction<DB>, ctx: TenantContext, mailboxId: string, options: ReadActivityOptions): Promise<SenderActivity[]>` (`activity.ts:~190`). Options are `{ now: Date; testMail: TestMailRule; only?: { address } | { domain } }`.
   - Callers in `src`:
     - `contacts/refresh.ts:115` — the whole-mailbox profile pass, inside a transaction, with no `only`.
     - `contacts/suggest.ts:322` — the Accept re-check, `{ ...options, only }`, scoped to one address or one registrable domain.
   - Re-export: `contacts/index.ts:1` exports `PROFILE_DAYS`, `readSenderActivity`, `ReadActivityOptions` and `SenderActivity`.
   - Output: an array sorted by address. Own addresses and test senders get no row. A domain scope is checked afterwards by `registrableDomain(host) === only.domain`.
   - `SenderActivity` fields:
     - `address`
     - counts: `received`, `received30`, `answered`, `answered30`, `flagged`, `flagged30`, `unseen7d`, `movedBack`, `userMailsTo`, `delegationsTo`, `correctedToSpam90`, `rescued90`, `suspicious90`, `repliedBySent90`, `bulkBase`, `bulkMails`, `replySamplesTheirs`
     - maps: `byCategory` and `corrections`, both `Partial<Record<Category, number>>`
     - `bulkSignals` (`list_id`, `list_unsubscribe`, `noreply`, `auto_submitted`)
     - `medianUserReplyHours` and `medianTheirReplyHours`: `number | null`, and null below 5 samples
     - dates: `firstSeenAt`, `lastSeenAt`, `lastUserMailAt` (all `Date | null`)
     - `relation`, from `relationOf`
   - Observed.

2. **SQL statements.** All filter `org_id`. All use the window `since = now-90d` and `now`, except where noted. All are set-based, so the count of statements is fixed per mailbox. Observed.

   | # | Reads | Purpose | Parameters | Skipped when `only`? |
   |---|---|---|---|---|
   | A | `sent_emails` | `ownAddresses`: Sent From aliases, grouped by address, newest first, `LIMIT 100`. `listMailboxes` runs one more query on the mailboxes table. | `orgId`, `mailboxId` | no |
   | B | via `listSenderRules` (config) and `listDelegateAddresses` (delegation, `activeOnly`) | VIP rules and delegate addresses, kept in memory for `relationOf`. This is not inline SQL, so not `delegates` or `delegations`. | `ctx`, `mailboxId` | no |
   | C | `emails` + `triage_results` + `email_flags` + `email_headers` | `mails`: one row per address with counts (total, 30d, answered, flagged, unseen over 7d, suspicious), header bulk counts and signals, first and last seen. | `orgId`, `mailboxId`, `since`, `since30`, `before7`, `now`, `testMail` kind filter, optional scope | no |
   | D | `emails` + `triage_results` | `categories`: newest triage category per mail, counted by address and category. | as the window | no |
   | E | `emails` + `triage_results` + `triage_feedback` | `feedback`: newest feedback per mail, as three UNION ALL branches (correction, moved_back, rescued). | as the window | no |
   | F | `sent_emails` only | `sent`: user mails (`origin='user'`, not automatic) to each To or Cc address, with the newest `internal_date`. | `orgId`, `mailboxId`, `since`, `now`, optional scope | no |
   | G | `emails` + `sent_emails` | `userDelays`: median hours from a received mail to the first user Sent reply (`parent_message_id` = the mail's Message-ID). Lateral join, per mail. | window and `since` | yes |
   | H | `emails` + `sent_emails` | `replied`: count of window mails that have any user Sent reply, whatever the recipient (`repliedBySent90`). | window and `since` | no |
   | I | `emails` + `sent_emails` | `theirDelays`: median hours from a Sent mail to the incoming mail that names it in `In-Reply-To`. | window | yes |
   | J | `delegations` JOIN `delegates` (`d.active`) | `delegations`: count per delegate address, by `dn.created_at` in the window. | `orgId`, `mailboxId`, `since`, `now` | yes |

   - Statements C, D, E, G, H and I share the CTE `win`, which is built from `emails` with `mailKindFilter("real", testMail)`. It selects `id`, `addr`, `received_at`, `message_id_header` and `in_reply_to`.
   - Statements C, D and E also share the CTEs `nt` (newest `triage_results` row per mail) and `nf` (newest `triage_feedback` row per mail). Statement E uses `nf`.
   - Statement F does not use `win`.
   - Per-sender SQL: none. G has a lateral per mail, not per sender.
   - The in-memory merge and `relationOf` run per address.

3. **Tests.** Observed by reading titles and a few assertions only.
   - `apps/server/test/integration/contacts-refresh.test.ts:665`, `describe("readSenderActivity")`:
     - Test 14: 30d and 90d sub-counts, corrections, rescues and suspicious mail (`toMatchObject` on one sender).
     - Test 15: relation `delegate` or `vip`, and `delegationsTo`. An inactive delegate counts 0.
     - Test 16: the number of statements does not depend on the number of senders (`few == none`, `many == none`, `none > 0`).
   - `apps/server/test/integration/contacts-activity-only.test.ts`, `only` scope:
     - Test 1: an address scope returns that address with its counts.
     - Test 2: a domain scope returns subdomains, not look-alikes.
     - Test 3: a public suffix as scope returns nothing.
     - Test 4: a Sent mail to the address counts; one to a neighbour does not.
   - `apps/server/test/integration/contacts-refresh-guards.test.ts`:
     - One lower-case rule (probe cases).
     - Mailbox scope of the Sent reads, aliases and delegations.
     - Delegation window and inactive delegates.
     - System sends (not user mail).
     - Window edges for incoming and Sent mail.
     - Recipient and delay samples.
     - A recipient with no `@` is not an address.
     - `last_user_mail_at` keeps the newest Sent date.
   - Indirect callers: tests of `suggest.ts` and `refresh.ts` run it. I did not list them.

Checks: the integration tests above cover SQL results, scoping and statement count; they miss unit-level coverage of the merge and `relationOf` in isolation, and none was run in this session.

## Scout 2 · job 2026-11-20-f144-scout-2-5a5c9a0c

Question: For the tables emails, email_headers, email_flags, sent_emails (mail), triage_results, triage_feedback (triage), delegates, delegations (delegation): which exported functions already read them in a way the sender-activity pass could reuse? Which layer is contacts in, and may contacts import mail, triage and delegation today?

Packet: which index.ts readers of the 8 tables the contacts sender-activity pass can reuse, and contacts' layer and import rights.
Base: c1947f3b
Verified: `git status --short | wc -l` -> `0` (worktree clean). Layer facts come from reading layers.json, not from a run. I did not run `layers.test.ts`. My `bun test apps/server/src/modules/layers.test.ts` call only printed bun's "filter as a path" hint.
Unknowns: whether a reader may return per-sender aggregates. None exists today, so that is a design choice for the lead.

1. Layers (observed, `layers.json`): contacts is in layer 3 with triage, actions, delegation, loops and replies. Order: [audit, tenancy] < [config, mail] < [triage, actions, delegation, loops, replies, contacts] < [reports, channels, testmail] < [operator, privacy, trust] < [lab].
   - mail is in layer 2, below contacts, so contacts may import `../mail` index.ts.
   - delegation is in the same layer. The pair `{from: contacts, to: delegation}` is in sameLayerEdges, so contacts may import it. Today's imports are `listDelegateAddresses` in `activity.ts:17` and `suggest.ts:26`.
   - triage is in the same layer and has no `{from: contacts, to: triage}` pair. The only edges involving triage and contacts are `{triage→actions}`, `{triage→delegation}` and `{loops→triage}`. Contacts may NOT import `../triage` today. A reader there needs a new sameLayerEdges pair, or a hook or parameter filled in a composition root.
   - Current contacts imports: `../mail` (`listMailboxes`, `mailKindFilter`, `getSentSyncState`, `listSyncTargets`, `getMailbox`, `TestMailRule`) and `../delegation` (`listDelegateAddresses`).

2. `activity.ts` reads all 8 tables with its own raw SQL (observed). Line numbers: emails `:222`, sent_emails `:139`, `:329`, `:355`, `:381`, `:401`, triage_results `:237`, triage_feedback `:244`, email_flags `:269`, email_headers `:270`, delegations and delegates `:433`. Those queries aggregate per sender over a mailbox and time window, so they take no email ids.

3. mail exports (observed). All take `(db: DbOrTrx, ctx: TenantContext, …)`.
   - `listWaitingSenders(db, ctx, mailboxId, query: WaitingQuery): Promise<string[]>` returns distinct `from_address_lower` of pending mail since `receivedSince`.
   - `listWaitingFromSenders(db, ctx, mailboxId, senders: readonly string[], query): Promise<WaitingMail[]>` returns pending mail rows `id, mailbox_id, from_address, received_at`.
   - `listUserAnswers(db, ctx, emailIds, opts?: {settledOnly?}): Promise<Map<string, UserAnswer{answeredAt, sentEmailId}>>` joins emails and sent_emails; the earliest user reply per mail.
   - `listAnsweredOrFlagged(db, ctx, emailIds): Promise<Set<string>>` and `countAnswered(db, ctx, emailIds): Promise<number>` read email_flags by email id.
   - `getEmailFlags(db, ctx, emailId): Promise<EmailFlagsRow|undefined>` and `getEmailHeaders(db, ctx, emailId): Promise<EmailHeadersRow|undefined>` read one mail.
   - `listFromAddresses(db, ctx, emailIds): Promise<(string|null)[]>` reads emails.
   - `listMailExamples(db, ctx, emailIds): Promise<Map<string, MailExampleFacts>>` joins emails and email_headers.
   - `replyFactsOf(db, ctx, emailIds, opts?: {settledSentOnly?}): Promise<Map<string, MailReplyFacts>>` combines headers, answered flag and own addresses.
   - `sentRecipientDomains(db, ctx, mailboxId, opts: {since: Date; minMails: number; limit: number; maxMails?: number}): Promise<SentRecipientDomain[]>` groups user sends by recipient domain, not by address.
   - `getSentSummary(db, ctx, mailboxId, opts: {since: Date}): Promise<SentSummary{userCount, newestUserAt}>`, `listSentMessageIds(db, ctx, mailboxId, messageIds: readonly string[]): Promise<Set<string>>`.
   - `listThreadContext(db, ctx, mailboxId, threadKey, before: Date, excludeId, opts: {syntheticOnly: false | {testMail}})` reads emails.
   - `mailKindFilter(kind: MailKind, rule: TestMailRule): Expression<SqlBool>` is already used by contacts.
   - Not exported: any per-sender aggregate of emails, flags or headers over a window, any sent_emails per-recipient count, and the user-reply-delay pairing. The contacts pass cannot reuse these today. The id-keyed readers could serve a per-mail pass only after contacts first lists the window's email ids.

4. triage exports (observed), same first two parameters.
   - `listLatestTriageByEmailIds(db, ctx, emailIds): Promise<{email_id, category, confidence, reason_code, model, prompt_version, fields}[]>` is the newest result per mail, 500 ids per chunk. It does not return `suspicious_reasons`.
   - `listNewestResultsOf(db, ctx, emailIds): Promise<Map<string, StoredResultRow{emailId, category, confidence, reasonCode, model, promptVersion, vip}>>` is the same, also without `suspicious_reasons`.
   - `latestTriageResult(db, ctx, emailId)`.
   - `listLatestFeedbackByEmailIds(db, ctx, emailIds): Promise<Map<string, LatestFeedbackRow{verdict, true_category, source, created_at}>>` has the fields contacts reads (verdict, true_category, source), but its row does not carry `email_id`; the map is keyed by id.
   - `latestFeedback(db, ctx, emailId)`.
   - Also exported but unfit: `listTriagedBetween(db, ctx, {after, until}, {limit, categories?})`, `listActivityRows(db, ctx, ActivityRowsQuery)`, `suspiciousSendersOf` and `suspicionOf` (in `suspicious-repo.ts`; I did not read their signatures).
   - Gap: the contacts pass needs `cardinality(suspicious_reasons) > 0` and the category per mail (`activity.ts:237`). No exported reader returns `suspicious_reasons` per mail by id. `suspicionOf` may cover it; I did not check.

5. delegation exports (observed).
   - `listDelegateAddresses(db, ctx, opts?: {activeOnly?: boolean}): Promise<string[]>` is already used by contacts.
   - `listDelegates(db, ctx, opts?: {activeOnly?, activeFirst?, limit?}): Promise<DelegateRow[]>`.
   - `listLatestDelegationsByEmailIds(db, ctx, emailIds): Promise<Map<string, LatestDelegationRow{status, due_at, delegate_name}>>`, the newest delegation per mail.
   - `countDelegationsOfEmail(db, ctx, emailId, source)`.
   - `listDelegations(db, ctx, {status?, limit})`.
   - `listDelegationOutcomes(db, ctx, emailIds): Promise<DelegationOutcomeRow[]>`.
   - Gap: none counts delegations per delegate address in a mailbox and time window, which is the query at `activity.ts:433` (`dn.created_at` within `[since, now]`, `d.active`, grouped by normalized `d.email`).

Checks: `apps/server/src/modules/layers.test.ts` and the lint rule (via `eslint.config.js`) read layers.json, so they would catch an unlisted triage import. I did not run either. Neither checks that a new reader is semantically equal to the raw SQL in `activity.ts`.

## Scout 3 · job 2026-11-20-f144-scout-3-def80750

Question: How do docs/code-patterns.md and docs/capabilities/ describe the rule that a reader lives in the module that owns its table, and what named exceptions exist? How did F100 apply it? Is there a lint or test that detects a module querying another module's table?

Packet finalised; note stays with open checks as read-only evidence has been gathered.
bash git status --short | wc -l; rg -n "own.*table|table.*own" eslint.config.js apps/
wait
think
[limen 2026-11-20T04:17:38.318Z] note changed
write /home/artek/Documents/repos/email_assistant/.limen/jobs/2026-11-20-f144-scout-3-
wait
think
Packet: How do the docs describe "a reader lives in the module that owns its table", what exceptions exist, how did F100 apply it, and does any lint or test catch cross-module table reads?
Base: c1947f3b
Verified: `rg -n "table|own" eslint.config.js apps/server/src/modules/*.test.ts` (filtered to ownership patterns) -> no matching line; `git status --short | wc -l` -> 0
Unknowns: Whether any script outside `eslint.config.js` and `apps/server/src/modules/*.test.ts` checks SQL table names. I searched only those two places and `rg -l` over docs and `apps/server/src`. Nothing surfaced.
1. docs/code-patterns.md:324 says "a reader in the module that owns its table" for Stage 2 metrics. Line 325 names `reports/metrics.ts` as the only service that joins readers. F100 plan.md D19 says "Row readers live in the module that owns the table… one file each, each with a tenant-filter test" and "`reports` may not import `channels`". — observed
2. The named exceptions in § Data access (lines 192–214) are about missing `TenantContext` or Better Auth tables, not about cross-module reads. The SLO readers (line 197), the `auth_*` tables (lines 192, 214) and `privacy` (line 203) are the nearest cases. `privacy` runs generic SQL over its registries, and the docs call it "the exception to 'the module that owns a text column clears it'". Line 264 allows the SLO job to run with no tenant scope. No page in § Layers and borders (lines 18–37) names a raw-SQL exception for joining another module's table. Its only border rule is on imports. — observed
3. The F100 readers are one file per owning module, all in `apps/server/src/modules/`:
   - `triage/metrics-repo.ts`: `listTruthRows`, `listHandledRows`
   - `actions/repo/metrics.ts`: `listHiddenMoveRows`, `listRejectRows`, `listMistakeRows`, `listExpiredUnapprovedSends`, `listReplyPairRows`
   - `delegation/metrics-repo.ts`: `listDelegationDueRows`, `listDelegationOutcomes`
   - `audit/metrics-repo.ts`: `listLlmCallRows`, `countEventsByDataKey`
   - `channels/metrics-repo.ts`: `listUrgentNoticeTimes`

   They are raw `sql` templates run with `.execute(db)` (e.g. `triage/metrics-repo.ts:3`, `channels/metrics-repo.ts:3`), not typed Kysely builders. Each takes `(db: DbOrTrx, ctx: TenantContext, q: WeekQuery)`. Every table is joined with its own `org_id` filter, and rows are parsed with a Zod schema. The rows are plain and typed, with ids, categories and flags. Each read takes the whole week range in one statement. No per-mail loop exists. The readers use `JOIN LATERAL` for the newest result. — observed
4. F100 readers already cross table ownership. `triage/metrics-repo.ts` selects `FROM emails` (a `mail` table) with `triage_results`, and imports `mailKindFilter` from `../mail`. `channels/metrics-repo.ts` selects `FROM emails` and reads `triage_results` and `outbox`. So the F100 rule is "the reader sits with its main table, and it may join mail tables". Strict single-table ownership was not applied. — observed
5. The target code is `apps/server/src/modules/contacts/activity.ts`, function `readSenderActivity`. It is one raw `sql` function that reads `emails`, `triage_results`, `triage_feedback`, `email_flags` and `email_headers` in one set-based group of statements (a `win` CTE with `DISTINCT ON` per mail). It calls `listSenderRules` (config), `listDelegateAddresses` (delegation) and `listMailboxes` (mail) through each module's `index.ts`. Its header comment says "a fixed number of statements for the mailbox, never one per sender". — observed
Checks: `apps/server/src/modules/borders.test.ts` and `layers.test.ts` run the `import/no-restricted-paths` lint zones and the module graph. They cover module imports only. They miss a raw `sql` template or a Kysely query that names another module's table. `rls-policy.test.ts` covers `org_id` policy per table (by name in code-patterns.md). It does not cover ownership. No lint or test that detects a module querying another module's table exists in the places I searched.
