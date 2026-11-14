# F104 stage 02 — Repository: state and rows

Part of [`../plan.md`](../plan.md). Needs stage 01 on `master`. Read D2, D4–D7, D11 first.

After this stage the `mail` module has typed, tenant-scoped functions for the switch state, the cursor and the sent rows. Nothing calls them yet except the tests.

## Step 1 — State functions

**Goal.** Read, lock and change one `mailbox_sent_sync` row.

**Files.** `apps/server/src/modules/mail/repo/sent-state.ts` (new), `apps/server/src/modules/mail/repo/index.ts` (exports), `apps/server/test/integration/mail-sent-repo.test.ts` (new).

**Interfaces.**

```ts
export type SentErrorCode = "no_folder" | "folder_missing" | "failed";

export interface SentSyncState {
  mailboxId: string;
  enabled: boolean;
  enabledAt: Date | null;
  path: string | null;
  uidValidity: number | null; // Int8 selects as a string: map with Number(), as folders.ts toRow does
  lastUid: number | null;
  firstPassAt: Date | null;
  lastPassAt: Date | null;
  lastErrorCode: SentErrorCode | null;
}

/** undefined: no row (= off). */
export async function getSentSyncState(db: DbOrTrx, ctx: TenantContext, mailboxId: string): Promise<SentSyncState | undefined>;

/** The same read with FOR UPDATE: the pass's write guard and the setter use it. */
export async function lockSentSyncState(trx: Transaction<DB>, ctx: TenantContext, mailboxId: string): Promise<SentSyncState | undefined>;

/** Connect: inserts the row; `enabled_at = now()` when enabled. ON CONFLICT (mailbox_id) DO NOTHING. */
export async function insertSentSyncState(db: DbOrTrx, ctx: TenantContext, mailboxId: string, input: { enabled: boolean }): Promise<void>;

/** The switch (stage 08 calls it inside its transaction, after lockSentSyncState). Upsert of the whole row:
 *  on → enabled true, enabled_at = at; off → enabled false, enabled_at null; both → path, uidvalidity, last_uid,
 *  first_pass_at, last_pass_at, last_error_code null; updated_at now(). */
export async function writeSentSwitch(trx: Transaction<DB>, ctx: TenantContext, mailboxId: string, input: { enabled: boolean; at: Date }): Promise<void>;

/** A new Sent path: path set, cursor and first_pass_at null. Only while enabled (WHERE enabled). Returns false when no row changed. */
export async function resetSentCursor(trx: Transaction<DB>, ctx: TenantContext, mailboxId: string, input: { path: string }): Promise<boolean>;

/** Sets the cursor; `firstPassAt` (when given) sets first_pass_at only where it is null (COALESCE). Only while enabled. */
export async function updateSentCursor(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  next: { uidValidity: number; lastUid: number },
  opts: { firstPassAt?: Date }
): Promise<boolean>;

/** last_pass_at = at, last_error_code = code. Only while enabled (an off row must stay clean: mailbox_sent_sync_off_check). */
export async function markSentPass(db: DbOrTrx, ctx: TenantContext, mailboxId: string, input: { at: Date; errorCode: SentErrorCode | null }): Promise<boolean>;
```

Each function filters by `org_id` and `mailbox_id`. Bigint values are written as numbers and read back with `Number()`.

**Decisions.** D2, D5 (the lock), D8 (`markSentPass`), D11 (`writeSentSwitch`).

**Test** (integration, `withRollback`, two orgs A and B, each with a mailbox; `AT = 2026-11-20T10:00:00Z`):

1. No row → `getSentSyncState` is `undefined`.
2. `insertSentSyncState({ enabled: true })` → `enabled`, `enabledAt` set, all cursor fields null; a second call changes nothing (no error).
3. `insertSentSyncState({ enabled: false })` → `enabled` false, `enabledAt` null.
4. `writeSentSwitch({ enabled: true, at: AT })` on a row with a cursor → `enabledAt = AT`, cursor, path, `firstPassAt`, `lastPassAt`, `lastErrorCode` null.
5. `writeSentSwitch({ enabled: false })` on an enabled row with a cursor and `lastErrorCode = 'failed'` → all null, `enabled` false (the off check holds).
6. `resetSentCursor({ path: "Wysłane" })` on an enabled row with a cursor and `firstPassAt` → `path = "Wysłane"`, cursor and `firstPassAt` null; on a disabled row → `false`, no change.
7. `updateSentCursor({ uidValidity: 7, lastUid: 42 }, { firstPassAt: AT })` → cursor `7/42`, `firstPassAt = AT`; a second call with `firstPassAt: AT + 1 h` keeps `AT`.
8. `markSentPass({ at: AT, errorCode: "no_folder" })` on an enabled row → set; on a disabled row → `false`, row unchanged.
9. Tenant filter: every function in org B's context with org A's mailbox id → `undefined` or `false`, and org A's row unchanged.

**Check.** `bun test apps/server/test/integration/mail-sent-repo.test.ts`

**Done when.** Cases 1–9 pass.

**Out of scope.** The setter's transaction, audit and delete (stage 08).

## Step 2 — Row functions

**Goal.** Insert sent rows idempotently, list and write the text work, delete a mailbox's rows.

**Files.** `apps/server/src/modules/mail/repo/sent-emails.ts` (new), `apps/server/src/modules/mail/repo/index.ts`, `apps/server/test/integration/mail-sent-repo.test.ts`.

**Interfaces.**

```ts
export type SentContent = "pending" | "stored" | "headers_only" | "gone";

export interface NewSentEmail {
  mailboxId: string;
  dedupKey: string;
  uidValidity: number;
  uid: number;
  messageId: string | null;
  parentMessageId: string | null;
  referencesIds: string[];
  threadKey: string;
  fromAddress: string | null;
  toAddresses: string[];
  ccAddresses: string[];
  subject: string | null;
  sentAt: Date;
  internalDate: Date;
  actionId: string | null;
  content: "pending" | "headers_only";
}

/** One INSERT for all rows (none → 0, no query). ON CONFLICT (mailbox_id, dedup_key) DO UPDATE SET uid, uidvalidity,
 *  updated_at = now() — nothing else changes on a known row. Returns the number of new rows (RETURNING (xmax = 0)).
 *  The caller passes each dedup key at most once (Postgres refuses a second update of one row in one statement). */
export async function insertSentEmails(trx: Transaction<DB>, ctx: TenantContext, rows: NewSentEmail[]): Promise<number>;

export interface PendingSentText { id: string; uid: number; }

/** Rows with content 'pending', this uidvalidity, internal_date >= since; oldest internal_date first, then id. */
export async function listPendingSentTexts(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { uidValidity: number; since: Date; limit: number }
): Promise<PendingSentText[]>;

export type SentTextWrite =
  | { kind: "stored"; bodyText: string | null; autoSubmitted: string | null; precedence: string | null; listId: string | null; hasCalendar: boolean | null }
  | { kind: "gone" };

/** Guarded: WHERE id AND org_id AND content = 'pending' AND uid = read.uid AND uidvalidity = read.uidValidity. */
export async function writeSentText(
  db: DbOrTrx,
  ctx: TenantContext,
  id: string,
  read: { uid: number; uidValidity: number },
  write: SentTextWrite
): Promise<boolean>;

/** content 'pending' → 'headers_only' for rows of the mailbox with internal_date < before. Returns the count. */
export async function expireSentTexts(db: DbOrTrx, ctx: TenantContext, mailboxId: string, opts: { before: Date }): Promise<number>;

/** Deletes every sent row of the mailbox. Returns the count. */
export async function deleteSentEmails(trx: Transaction<DB>, ctx: TenantContext, mailboxId: string): Promise<number>;
```

The `org_id` of a new row is `ctx.orgId`. Arrays go in as `text[]` values (Kysely passes a JS array; follow `insertEmail` in `repo/emails.ts` for `to_addresses`). Every value is a bound parameter.

**Decisions.** D4 (upsert), D6, D7, D11 (delete).

**Test** (same file, same orgs; one `row(n, overrides)` helper that builds a `NewSentEmail` with `dedupKey: "mid:<s{n}@x.test>:h{n}"`, `uidValidity: 7`, `uid: n`):

1. `insertSentEmails` of rows 1, 2 → 2; the stored columns equal the input (arrays, dates, `content`).
2. Again rows 1, 2 with `uid` 11, 12 and `uidValidity` 8 → 0 new; the rows now hold `uid` 11, 12 and `uidvalidity` 8; `subject`, `content` and `created_at` unchanged.
3. `insertSentEmails([])` → 0.
4. `listPendingSentTexts({ uidValidity: 7, since: AT − 14 d, limit: 2 })` over rows with `internal_date` AT − 1 d, AT − 3 d, AT − 20 d (all pending, uidvalidity 7) and one with uidvalidity 8 → the AT − 3 d row, then AT − 1 d; with `limit: 1` only AT − 3 d.
5. `writeSentText(id, { uid, uidValidity: 7 }, { kind: "stored", bodyText: "Hi", autoSubmitted: null, precedence: null, listId: null, hasCalendar: false })` → true; the row is `stored` with `body_text = "Hi"`; a second call → false.
6. `writeSentText` with `uid` that differs from the row's → false, row still `pending`; `{ kind: "gone" }` with the right read → `content = 'gone'`, `body_text` null.
7. `expireSentTexts({ before: AT − 14 d })` → the AT − 20 d row becomes `headers_only`; returns 1; `stored` rows are untouched.
8. `deleteSentEmails` → the count of org A's mailbox rows; another mailbox's rows stay.
9. Tenant filter: `listPendingSentTexts`, `writeSentText`, `expireSentTexts`, `deleteSentEmails` in org B's context with org A's ids → `[]`, `false` or 0, and org A's rows unchanged; `insertSentEmails` in org B's context with org A's mailbox id fails with `23503` (the composite FK).

**Check.** `bun test apps/server/test/integration/mail-sent-repo.test.ts`

**Done when.** Cases 1–9 of step 2 pass, and step 1 still passes.

**Out of scope.** Readers for the answered mark, summaries and health (stage 07); retention (stage 07).

## Done when (stage)

Steps 1–2 done; the Proof command of `plan.md` passes (`/tmp/f104-s02`).
