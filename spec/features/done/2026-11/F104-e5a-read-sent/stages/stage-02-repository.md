# F104 stage 02 — Repository: state and rows

Part of [`../plan.md`](../plan.md). Needs stage 01 on `master`. Read D2, D4–D7, D11.

## Step 1 — State functions

**Files.** `apps/server/src/modules/mail/repo/sent-state.ts`; test `apps/server/test/integration/mail-sent-repo.test.ts` (new).

**Interfaces** (names later stages use):

```ts
export type SentErrorCode = "no_folder" | "folder_missing" | "failed";
export interface SentSyncState {
  mailboxId: string; enabled: boolean; enabledAt: Date | null; path: string | null;
  uidValidity: number | null; lastUid: number | null; firstPassAt: Date | null;
  lastPassAt: Date | null; lastErrorCode: SentErrorCode | null;
}
getSentSyncState(db, ctx, mailboxId)          // undefined = no row = off
lockSentSyncState(trx, ctx, mailboxId)        // the same, FOR UPDATE (D5)
insertSentSyncState(db, ctx, mailboxId, { enabled })   // ON CONFLICT DO NOTHING
writeSentSwitch(trx, ctx, mailboxId, { enabled, at })  // upsert; clears path, cursor, pass fields
resetSentCursor(trx, ctx, mailboxId, { path })         // → boolean
updateSentCursor(trx, ctx, mailboxId, { uidValidity, lastUid }, { firstPassAt? })  // → boolean
markSentPass(db, ctx, mailboxId, { at, errorCode })    // → boolean
```

Rules: `enabled_at` = `at` (or now) when on, else null. The last three change only an enabled row (else `false`). `first_pass_at` is set only when null.

**Test** (orgs A and B, a mailbox each; `AT = 2026-11-20T10:00:00Z`):

1. No row → `undefined`.
2. Insert on → on, `enabledAt` set; a second insert changes nothing. Insert off → off, `enabledAt` null.
3. `writeSentSwitch` on at `AT` over a cursor → `enabledAt AT`, the rest null; off over `lastErrorCode "failed"` → all null.
4. `resetSentCursor("Wysłane")` → path set, cursor and `firstPassAt` null; on an off row → `false`.
5. `updateSentCursor(7, 42, firstPassAt AT)` → `7/42`, `AT`; again with `AT + 1 h` keeps `AT`.
6. `markSentPass(AT, "no_folder")` sets both; on an off row → `false`.
7. Org B's context, org A's mailbox → `undefined` or `false`.

## Step 2 — Row functions

**Files.** `apps/server/src/modules/mail/repo/sent-emails.ts`; the same test file.

**Interfaces.**

```ts
export type SentContent = "pending" | "stored" | "headers_only" | "gone";
export interface NewSentEmail {
  mailboxId: string; dedupKey: string; path: string; uidValidity: number; uid: number;
  messageId: string | null; parentMessageId: string | null; referencesIds: string[];
  threadKey: string; fromAddress: string | null; toAddresses: string[]; ccAddresses: string[];
  subject: string | null; sentAt: Date; internalDate: Date; origin: "user" | "system";
  actionId: string | null; content: "pending" | "headers_only";
}
insertSentEmails(trx, ctx, rows)                  // → count of new rows
listPendingSentTexts(db, ctx, mailboxId, { path, uidValidity, since, limit })  // → { id, uid }[]
export type SentTextWrite =
  | { kind: "stored"; bodyText: string | null; autoSubmitted: string | null;
      precedence: string | null; listId: string | null; hasCalendar: boolean | null }
  | { kind: "gone" };
writeSentText(db, ctx, id, read: { path, uid, uidValidity }, write)  // → boolean
expireSentTexts(db, ctx, mailboxId, { before })   // → count
deleteSentEmails(trx, ctx, mailboxId)             // → count
```

Rules:
- `insertSentEmails`: one statement; `[]` → 0, no query. On conflict `(mailbox_id, dedup_key)` it updates only `path`, `uidvalidity`, `uid`, `updated_at` (D4). Callers pass each key once. A tombstoned key inserts nothing.
- `listPendingSentTexts`: `pending` rows of this path and UIDVALIDITY with `internal_date >= since`, oldest first, then id.
- `writeSentText`: writes only a `pending` row whose path, uid and uidvalidity equal `read` (D7).
- `expireSentTexts`: `pending` → `headers_only` where `internal_date < before`.

**Test** (`row(n)`: key `"mid:<s{n}@x.test>:h{n}"`, `"Sent"`, uidvalidity 7, uid n, user):

1. Rows 1, 2 → 2; columns equal the input.
2. Rows 1, 2 again with `"Wysłane"`, uids 11, 12, uidvalidity 8 → 0; location moved; the rest kept.
3. `[]` → 0.
4. Pending rows at AT − 1 d, − 3 d, − 20 d, one with uidvalidity 8, one with path `"Old"`; list (`"Sent"`, 7, since AT − 14 d, limit 2) → − 3 d, − 1 d; limit 1 → − 3 d.
5. Write stored "Hi" → true; again false.
6. Wrong uid or path → false, still `pending`; `gone` → `gone`, text null.
7. Expire before AT − 14 d → 1; `stored` rows untouched.
8. Delete → the count; another mailbox keeps its rows.
9. Org B's context, org A's ids → `[]`, `false`, 0; insert → `23503`.

**Out of scope.** Readers, retention (07); the setter (08).

## Done when

Steps 1–2 done; the Proof passes (`/tmp/f104-s02`).
