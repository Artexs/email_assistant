# F029 stage 02 — Move rule and repository (F064)

Part of [`../plan.md`](../plan.md). Lands on the worker's proof (no review job). Read D6–D9 and D15 of `plan.md` and facts F9, F10, F14 first, then `apps/server/src/modules/mail/sync-rules.ts` (`matchReturned`, `sameMailIdentity`), `apps/server/src/modules/mail/repo/copies.ts` and `apps/server/src/modules/mail/repo/emails.ts` (`markEmailReturned`, `markEmailRelocated`).

May build at the same time as stage 01 (both edit `sync-rules.ts` and `sync-rules.test.ts`, in other functions). The later land merges `master`. Nothing calls the new code yet; stage 03 does.

## Step 1 — `listMoveCandidates`

**Goal.** Read the rows that the move finder needs, by id.

**Files.** `apps/server/src/modules/mail/repo/copies.ts`, `apps/server/src/modules/mail/repo/index.ts` (export the function and the type), `apps/server/test/integration/mail-repo.test.ts`.

**Interfaces.**

```ts
/** A stored row whose mail the flag refresh did not find in its folder: a candidate of the move finder. */
export interface MoveCandidateRow {
  id: string;
  folder: string;
  source_folder: string;
  /** The UID in `folder`. */
  uid: number;
  message_id_header: string | null;
  content_hash: string;
  from_address: string | null;
  received_at: Date;
  /** emails.undo_pending_at: a system move into a synced folder is in flight. */
  undo_pending_at: Date | null;
}

// The rows of `emailIds` in the mailbox, in no fixed order; unknown ids are left out. [] for an empty list (no query).
export async function listMoveCandidates(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  emailIds: readonly string[]
): Promise<MoveCandidateRow[]>
```

Query per chunk of 500 ids (`const MOVE_CANDIDATE_CHUNK = 500`, private): `selectFrom("emails")`, the ten columns, `where("org_id", "=", ctx.orgId)`, `where("mailbox_id", "=", mailboxId)`, `where("id", "in", chunk)`. Map `uid` with `Number(row.uid)` (fact F14). Return `[]` without a query for an empty list (Postgres refuses `IN ()`).

**Decisions.** D5, D9, D15.

**Test** (`mail-repo.test.ts`, a new `describe("mail repository: listMoveCandidates")`; `createTwoTenants`, `insertEmail`/`newEmail` and `emailRow` of the file):

- 2.1 Two rows of org A (one `folder: "AI/Info"`, one in INBOX) and one row of org B: `listMoveCandidates(trx, a.ctx, a.mailboxId, [idA1, idA2, idB])` returns the two A rows with all ten fields (`uid` a number, `undo_pending_at` null); the B id is left out. With `b.ctx` and A's mailbox id: `[]`.
- 2.2 An empty id list returns `[]`.
- 2.3 The mailbox filter: `listMoveCandidates(trx, a.ctx, randomUUID(), [idA1])` returns `[]` (import `randomUUID` from `node:crypto` if the file does not have it).

**Check.** `bun test apps/server/test/integration/mail-repo.test.ts`

**Done when.** Tests 2.1–2.3 pass.

**Out of scope.** Any filter on `received_at` or `folder` (the finder filters).

## Step 2 — Location guards on `markEmailReturned` and `markEmailRelocated`

**Goal.** A finder write changes the row only while it still has the folder and UID that the finder read.

**Files.** `apps/server/src/modules/mail/repo/emails.ts`, `apps/server/test/integration/mail-repo.test.ts`.

**Interfaces.**

```ts
export async function markEmailReturned(
  db: DbOrTrx, ctx: TenantContext, emailId: string, uid: number, at: Date,
  opts: { folder: string; from?: { folder: string; uid: number } }
): Promise<boolean>
// `from` set → also `.where("folder", "=", from.folder).where("uid", "=", from.uid)`.

export async function markEmailRelocated(
  db: DbOrTrx, ctx: TenantContext, emailId: string,
  change: { from: string; to: string; uid: number; fromUid?: number }
): Promise<boolean>
// `fromUid` set → also `.where("uid", "=", change.fromUid)`.
```

Callers that do not pass the new fields behave exactly as now (the sync passes and `checkReturnedBelowCursor` stay unchanged). Extend the comment line above each function by one clause ("With `from`, only while the row still has that folder and UID.").

**Decisions.** D8.

**Test** (`mail-repo.test.ts`, describe `mail repository: emails`, after line 673):

- 2.4 `markEmailReturned` with `from: { folder: "AI/Info", uid: 2 }` on a row in `AI/Info` with uid 1 → `false`, the row is unchanged; with `from: { folder: "AI/Info", uid: 1 }` → `true`, `folder`/`source_folder` = the target, `uid` = `inbox_uid` = the new UID, `returned_at` set.
- 2.5 `markEmailReturned` with `from: { folder: "AI/Spam", uid: 1 }` on that row (other folder) → `false`.
- 2.6 `markEmailRelocated` with `fromUid: 9` on an INBOX row with uid 1 → `false`; with `fromUid: 1` → `true` (fields as in the test at line 631).

The existing tests at lines 575–673 pass unchanged.

**Check.** `bun test apps/server/test/integration/mail-repo.test.ts`

**Done when.** Tests 2.4–2.6 pass and the old ones still pass.

**Out of scope.** `updateEmailUid`, `updateEmailLocation`.

## Step 3 — Pure rule `matchMoved`

**Goal.** From the metas that one synced folder returns at the UIDs of gone rows, pick each row's own mail.

**Files.** `apps/server/src/modules/mail/sync-rules.ts`, `apps/server/src/modules/mail/sync-rules.test.ts`.

**Interfaces.** Put it after `matchReturned`; import the row type as `matchReturned` imports `MovedRow` (`import type { MoveCandidateRow, MovedRow } from "./repo";`).

```ts
/**
 * A user move of a known mail into a synced folder: the server keeps the UID (Interia has one UID counter per mailbox),
 * so a meta of that folder at the row's own `uid`, not `\Deleted`, with the identity of the row, is the row's mail.
 * Each row and each meta give at most one hit; for one meta the first matching row of `rows` wins.
 */
export function matchMoved(
  metas: readonly FolderMessageMeta[],
  rows: readonly MoveCandidateRow[],
  mode: IdentityMode = IDENTITY_MODE
): { emailId: string; uid: number }[]
```

Identity: `sameMailIdentity(meta, { messageId: row.message_id_header, contentHash: row.content_hash, from: row.from_address, receivedAt: row.received_at }, mode)`. Unlike `matchReturned`, only the row's `uid` counts (a gone row has no other known UID that the user move keeps).

**Decisions.** D6, D7.

**Test** (`sync-rules.test.ts`, new `describe("matchMoved")`; reuse `meta()`, a `withFlags` helper like the one of `matchReturned`, and a `goneRow(id, uid, overrides)` helper with `folder: "INBOX"`, `source_folder: "INBOX"`, `message_id_header: "<a1@example.test>"`, `content_hash: contentHash(meta())`, `from_address: "boss@example.test"`, `received_at: new Date("2026-11-03T10:05:00Z")`, `undo_pending_at: null`):

- 2.7 meta uid 10, row `e1` uid 10, same identity → `[{ emailId: "e1", uid: 10 }]`.
- 2.8 the same meta with flags `["\\Deleted"]` → `[]`.
- 2.9 meta uid 10 with `messageId: "<other@example.test>"` → `[]`.
- 2.10 meta uid 11, row uid 10 → `[]`.
- 2.11 rows `e1` and `e2` both uid 10 with the same identity, one meta uid 10 → `[{ emailId: "e1", uid: 10 }]` (one hit, the first row).
- 2.12 metas uid 10 and 12, rows `e1` uid 10 and `e2` uid 12 → two hits in meta order.
- 2.13 a row without Message-ID (`message_id_header: null`, `content_hash` of a meta with `messageId: null`) and a meta with `messageId: null` and that hash → one hit.

**Check.** `bun test apps/server/src/modules/mail/sync-rules.test.ts`

**Done when.** Tests 2.7–2.13 pass; then the Proof command of `plan.md` (`/tmp/f029-s02`) prints `PROOF_OK`.

**Out of scope.** The finder itself (stage 03); no doc change in this stage (stage 04 writes the docs; the new names are not on a capability page yet, so `capability-map.test.ts` is not affected).
