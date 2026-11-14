# F100 stage 05 — Store the capture

Part of [`../plan.md`](../plan.md). **[risky]**: the sync write path. Review job before the land. Needs stages 02 and 04 on `master`.

After this stage every mail that the sync or the backfill stores gets one `email_headers` row in the same transaction (D4), and the daily retention clears the text fields of old rows with the mail body (D5).

Shared file: `mail/sync.ts` (609 lines) — keep the edit small; put new code in new files.

## Step 1 — Repository

**Goal.** Insert, read and clear `email_headers` rows, tenant-scoped.

**Files.** `apps/server/src/modules/mail/repo/headers.ts` (new), `apps/server/src/modules/mail/repo/index.ts`, `apps/server/src/modules/mail/index.ts`, `apps/server/test/integration/mail-headers-repo.test.ts` (new).

**Interfaces.**

```ts
export interface EmailHeadersRow extends CapturedHeaders {
  emailId: string;
  capturedAt: Date;
  textsClearedAt: Date | null;
}

/** Inserts the row of the mail stored with this dedup key in this transaction. False when the mail is not there or a row exists. */
export async function insertEmailHeaders(
  trx: DbOrTrx,
  ctx: TenantContext,
  mail: { mailboxId: string; dedupKey: string },
  capture: CapturedHeaders,
  capturedAt: Date
): Promise<boolean>;

export async function getEmailHeaders(db: DbOrTrx, ctx: TenantContext, emailId: string): Promise<EmailHeadersRow | undefined>;

/** Retention: clears the text fields of rows captured before `before` (D5). Batches of 1,000 by email id, FOR UPDATE SKIP LOCKED. */
export async function clearCapturedHeaders(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { before: Date; batch?: number }
): Promise<number>;
```

`insertEmailHeaders` is one statement: `INSERT INTO email_headers (…) SELECT e.id, e.org_id, … FROM emails e WHERE e.org_id = $org AND e.mailbox_id = $mailbox AND e.dedup_key = $key ON CONFLICT (email_id) DO NOTHING` (Kysely `insertInto(...).expression(...)` or `sql`; values as bound parameters, `attachments` and `links` as `JSON.stringify(...)` cast to `jsonb`). Column ↔ field: `from_name ↔ fromName`, `reply_to ↔ replyTo`, `return_path ↔ returnPath`, `auth_results ↔ authResults`, `list_unsubscribe ↔ listUnsubscribe`, `list_id ↔ listId`, `auto_submitted ↔ autoSubmitted`, `precedence`, `has_calendar ↔ hasCalendar`, `attachments`, `attachment_count ↔ attachmentCount`, `links`, `link_count ↔ linkCount`, `parts_known ↔ partsKnown`. `getEmailHeaders` parses `attachments` and `links` with a Zod schema of `CapturedAttachment[]` / `CapturedLink[]` (no loose JSON reads). `clearCapturedHeaders` follows `clearMailHeaders` (same file style, `mail/repo/retention.ts`): sets the six text columns to null, `attachments` and `links` to `'[]'`, `texts_cleared_at = now()`, only where `texts_cleared_at IS NULL AND captured_at < before`; a repeat run changes nothing.

**Decisions.** D4, D5.

**Test** (integration, `withRollback`, two orgs):

1. Insert for org A's stored mail (by `mailbox_id` + `dedup_key`) → true; `getEmailHeaders` returns every field as given (use the stage 01 case 1 capture as a literal).
2. A second insert for the same mail → false, the row is unchanged.
3. Org B's context with org A's mailbox id and dedup key → false, no row (tenant filter); `getEmailHeaders` in org B's context for org A's mail → undefined.
4. `clearCapturedHeaders({ before })` with one row captured before and one after → 1; the old row has null texts, `attachments = []`, `links = []`, `attachment_count` and `has_calendar` unchanged, `texts_cleared_at` set; a second call → 0; org B's rows are untouched.

**Check.** `bun test apps/server/test/integration/mail-headers-repo.test.ts`

**Done when.** Cases 1–4 pass.

**Out of scope.** Flags (stage 06).

## Step 2 — Sync and backfill write the row

**Goal.** The row comes with the mail, in its transaction (D4).

**Files.** `apps/server/src/modules/mail/sync.ts` (`Write` insert variant, `planChunk`, `applyChunk`), `apps/server/test/integration/mail-sync.test.ts` (new cases) or a new `mail-sync-capture.test.ts`, `apps/server/src/platform/log-fields.ts` if a field is new.

**Interfaces.**

- `Write` insert variant: `{ kind: "insert"; row: NewEmail; capture: CapturedHeaders | null }`; `planChunk` passes `content.capture` (stage 02 left it unused).
- `applyChunk`: `if (await insertEmail(trx, ctx, write.row)) { stored += 1; if (write.capture !== null) await insertEmailHeaders(trx, ctx, { mailboxId, dedupKey: write.row.dedup_key }, write.capture, deps.now()); else missing += 1; }`.
- `SyncResult` gains `captureMissing: number`; `syncFolder` logs one event line `log.info("capture_missing", { mailbox_id: mailboxId, count })` when it is > 0 (no other new log line).
- `backfillInbox` uses the same `planChunk` and `applyChunk`, so backfilled mail gets rows too (no extra code; a test proves it).

**Decisions.** D4, D30.

**Test** (integration, fake provider like the existing `mail-sync.test.ts` cases):

1. A sync of 2 new INBOX mails (one with `Reply-To` and `List-Unsubscribe` headers) → 2 `emails` rows and 2 `email_headers` rows; the first has `reply_to` and `list_unsubscribe` set.
2. A second sync with no new mail → still 2 rows (no duplicate).
3. A mail over the fake's `bodyLimitBytes` → its row has `parts_known = false` and `body_text` null.
4. A transaction failure after the email insert (force `CursorMovedError` by moving the cursor between plan and apply, as the existing cursor test does) → neither the `emails` row nor the `email_headers` row exists; the next sync stores both.
5. `backfillInbox` of 1 older mail → 1 `emails` row with `backfilled_at` and 1 `email_headers` row.
6. A provider whose `fetchContent` returns `{ text: "x", capture: null }` (wrap the fake) → the mail is stored, no header row, `captureMissing = 1`.

**Check.** `bun test apps/server/test/integration/mail-sync.test.ts apps/server/test/integration/mail-sync-capture.test.ts apps/server/test/integration/mail-backfill.test.ts`

**Done when.** Cases 1–6 pass and the existing sync and backfill tests pass unchanged (except `SyncResult` literals that need `captureMissing: 0`).

**Out of scope.** Back-capture of mail stored before this stage.

## Step 3 — Retention

**Goal.** The daily job clears captured texts with the mail body (D5).

**Files.** `apps/server/src/retention.ts` (`Clearers`, `RetentionCounts` gain `capturedHeaders`; `runOrg` calls `clearCapturedHeaders(db, ctx, { before: <the body cut-off> })`), `apps/server/test/integration/retention-job.test.ts` and `retention-clear.test.ts` (counts objects), the retention table: `docs/architecture.md` §7 or `docs/capabilities/retention.md` (whichever holds the table at your HEAD after F095), one row: "Captured headers (display name, Reply-To, Return-Path, Authentication-Results, List-Unsubscribe, List-Id, attachment names, link hosts) | `email_headers` | as the mail body (`data_retention_days`); counts and codes stay".

**Decisions.** D5.

**Test.**

1. `runOrg` with an organization of `data_retention_days = 30`, one header row captured 31 days ago and one 1 day ago → `capturedHeaders = 1`, the old row cleared.
2. The retention log line carries the new count (assert on the counts object, not on text).

**Check.** `bun test apps/server/test/integration/retention-job.test.ts apps/server/test/integration/retention-clear.test.ts`

**Done when.** Cases 1–2 pass.

**Out of scope.** The DSR map and the organization delete (E7-T3; seam S6).

## Done when (stage)

Steps 1–3 done; the Proof command of `plan.md` passes (`/tmp/f100-s05`).
