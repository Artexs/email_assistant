# F104 stage 07 — Answered reader, summaries, retention

Part of [`../plan.md`](../plan.md). Needs stage 06 on `master`. Read D10, D12 (the summary fields), D14, D15 (the health input) first.

After this stage other code can ask "did the user answer this mail, and when", the settings and the notice can read a short summary per mailbox, and the daily retention job clears sent text and headers.

## Step 1 — Readers

**Goal.** Three read functions: the answered mark, the per-mailbox summary, the health input of all mailboxes of an organization.

**Files.** `apps/server/src/modules/mail/repo/sent-readers.ts` (new), `apps/server/src/modules/mail/repo/index.ts`, `apps/server/src/modules/mail/index.ts`, `apps/server/test/integration/mail-sent-readers.test.ts` (new).

**Interfaces.**

```ts
export interface UserAnswer { answeredAt: Date; sentEmailId: string; }

/** Per incoming email id: the earliest user sent mail (action_id IS NULL) of the same mailbox whose parent_message_id
 *  equals emails.message_id_header. Ids without an answer are not in the map. [] → empty map, no query.
 *  Chunks of 500 ids. One query per chunk: emails e JOIN sent_emails s ON s.org_id = e.org_id AND
 *  s.mailbox_id = e.mailbox_id AND s.parent_message_id = e.message_id_header AND s.action_id IS NULL,
 *  WHERE e.org_id = ctx.orgId AND e.id IN (…), DISTINCT ON (e.id) ORDER BY e.id, s.sent_at, s.id. */
export async function listUserAnswers(db: DbOrTrx, ctx: TenantContext, emailIds: readonly string[]): Promise<Map<string, UserAnswer>>;

export interface SentSummary {
  /** User mail (action_id IS NULL) with internal_date >= since. */
  userCount: number;
  /** The newest internal_date of user mail of the mailbox, any age; null when none. */
  newestUserAt: Date | null;
}
export async function getSentSummary(db: DbOrTrx, ctx: TenantContext, mailboxId: string, opts: { since: Date }): Promise<SentSummary>;

export interface SentHealthRow { mailboxId: string; firstPassAt: Date; newestUserAt: Date | null; }
/** Mailboxes of the organization with the switch on and a finished first pass, with the newest user internal_date. */
export async function listSentHealth(db: DbOrTrx, ctx: TenantContext): Promise<SentHealthRow[]>;
```

**Decisions.** D10, D12, D15.

**Test** (integration, `withRollback`, two orgs; rows inserted with `insertSentEmails` (stage 02) and incoming mail with `insertTestEmail` from `fixtures.ts`, `message_id_header` set; `NOW = 2026-11-20T10:00:00Z`):

1. Incoming X (`message_id_header "<x@a.test>"`), user sent S1 (`parent "<x@a.test>"`, `sent_at NOW − 2 h`) and S2 (same parent, `NOW − 1 h`) → `listUserAnswers([X])` = `{ X: { answeredAt: NOW − 2 h, sentEmailId: S1 } }`.
2. A system send (action_id set, same parent) is the only reply → X is not in the map.
3. A reply with the same parent in another mailbox of the same org → X is not in the map.
4. Incoming Y with no reply, Z with `message_id_header` null → neither in the map; `listUserAnswers([])` → empty map.
5. 600 incoming ids, one answered at position 550 → the map holds it (chunking).
6. `getSentSummary({ since: NOW − 30 d })` over user rows at `NOW − 1 d`, `NOW − 40 d` and a system row at `NOW − 1 h` → `{ userCount: 1, newestUserAt: NOW − 1 d }`; a mailbox with no rows → `{ 0, null }`.
7. `listSentHealth`: mailbox M1 on with `first_pass_at`, M2 on without `first_pass_at`, M3 off → only M1, with its `newestUserAt`.
8. Tenant filter: each reader in org B's context with org A's ids → empty map, `{ 0, null }`, `[]`.

**Check.** `bun test apps/server/test/integration/mail-sent-readers.test.ts`

**Done when.** Cases 1–8 pass.

**Out of scope.** Any caller (stages 08 and 10; other tickets, plan § Seams).

## Step 2 — Retention

**Goal.** The daily job clears sent text after the organization's period and sent headers after 90 days, counted from `internal_date` (D14).

**Files.** `apps/server/src/modules/mail/repo/retention.ts`, `apps/server/src/modules/mail/repo/index.ts`, `apps/server/src/modules/mail/index.ts`, `apps/server/src/retention.ts`, `apps/server/test/integration/retention-clear.test.ts`, `apps/server/test/integration/retention-job.test.ts`.

**Interfaces.**

```ts
/** sent_emails.body_text → null where internal_date < before. Batches by id, FOR UPDATE SKIP LOCKED, as clearMailBodies. */
export async function clearSentBodies(db: DbOrTrx, ctx: TenantContext, opts: { before: Date; batch?: number }): Promise<number>;

/** sent_emails.subject, from_address → null; to_addresses, cc_addresses, references_ids → '{}' where internal_date < before
 *  and one of them is still set. message_id, parent_message_id, thread_key, dedup_key and the times stay. */
export async function clearSentHeaders(db: DbOrTrx, ctx: TenantContext, opts: { before: Date; batch?: number }): Promise<number>;
```

`retention.ts`: `RetentionCounts` gains `sentBody` and `sentHeaders`; `Clearers` gains both functions; `runOrg` calls `clearSentBodies({ before: now − org.dataRetentionDays days })` after `clearMailBodies` and `clearSentHeaders({ before: textsBefore })` after `clearMailHeaders`. The per-organization log line lists the two counts in the line's current form (if F103 converted it to an event line before your base, follow how that line carries the other counts).

**Decisions.** D14.

**Test** (integration):

1. `clearSentBodies({ before: NOW − 30 d })`: a `stored` row with text at `internal_date NOW − 31 d` → cleared (`body_text` null, `content` still `stored`); one at `NOW − 29 d` keeps its text; a repeat run → 0.
2. `clearSentHeaders({ before: NOW − 90 d })`: a row at `NOW − 91 d` → subject, from, to, cc, references cleared; `parent_message_id`, `thread_key`, `message_id` kept; a row at `NOW − 89 d` unchanged; a repeat run → 0.
3. `batch: 1` with 3 old rows → 3 (the loop).
4. Org B's run never touches org A's rows.
5. `retention-job.test.ts`: the expected `runOrg` objects (`ZERO` and the filled cases) gain `sentBody` and `sentHeaders`; one filled case has one old sent body and one old sent header row → both counts 1.
6. `listUserAnswers` still answers after `clearSentHeaders` (the parent id stays).

**Check.** `bun test apps/server/test/integration/retention-clear.test.ts apps/server/test/integration/retention-job.test.ts apps/server/test/integration/mail-sent-readers.test.ts`

**Done when.** Cases 1–6 pass.

**Out of scope.** Deleting sent rows by age (the rows stay, as `emails` rows stay).

## Step 3 — Docs

**Files.** `docs/architecture.md` §7, `docs/capabilities/retention.md`, `docs/capabilities/sent-mail.md`.

- `architecture.md` §7 "Retention" table: two rows after "Subject, addresses": `Sent mail text | sent_emails.body_text | 30 days from the Sent INTERNALDATE (organizations.data_retention_days)` and `Sent mail subject, addresses | sent_emails | 90 days from the Sent INTERNALDATE, then cleared (the row stays for reply times)`. §7 "Delete": the list of what a mailbox removal deletes gains "sent mail and the Sent state".
- `retention.md` rule 2 table: rows for `clearSentBodies` and `clearSentHeaders`, with the period "from `internal_date`" (the table's other rows count from `created_at`; say so in the row).
- `sent-mail.md`: a rule for `listUserAnswers` (direct parent, user mail only, earliest reply), the summary and health readers, and retention; Entry points rows for `repo/sent-readers.ts` and the two clear functions; refresh "Checked against".

**Check.** `bun test apps/server/src/capability-map.test.ts`

**Done when.** The test passes.

## Done when (stage)

Steps 1–3 done; the Proof command of `plan.md` passes (`/tmp/f104-s07`).
