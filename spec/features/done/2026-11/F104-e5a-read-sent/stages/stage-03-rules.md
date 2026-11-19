# F104 stage 03 — Reader type, pure Sent rules, origin of an action id

Part of [`../plan.md`](../plan.md). Review before the land (step 3 decides which Sent mail is the system's). Needs stage 02. Read D3, D4, D6, D7.

## Step 1 — The read-only type

**Interfaces.**

```ts
// mail/port.ts, exported by mail/index.ts
export type SentFolderReader = Pick<MailProvider, "folderStatus" | "fetchAbove" | "fetchContent" | "searchSinceIn" | "fetchByUidsIn">;
```

`fetchSince` in `apps/server/src/modules/mail/sync.ts` takes `Pick<MailProvider, "searchSinceIn" | "fetchByUidsIn">` (callers stay valid).

**Test** (`apps/server/src/modules/mail/sent-reader.test.ts`, a type test): one `// @ts-expect-error` line per write method on a `SentFolderReader` (`moveMessage`, `transferByAppend`, `deleteMessage`, `setFlags`, `appendMessage`, `ensureFolder`); one case passes `createFakeMailProvider()` as a reader. `bun run typecheck` passes.

## Step 2 — Pure rules

**Files.** `apps/server/src/modules/mail/sent-rules.ts`, `apps/server/src/modules/mail/sent-rules.test.ts` (new).

**Interfaces.**

```ts
export const SENT_HEADER_WINDOW_MS = 30 * DAY_MS;
export const SENT_TEXT_WINDOW_MS = 14 * DAY_MS;
export const SENT_CHUNK_SIZE = 50;
export const SENT_TEXT_RUN_LIMIT = 100;
export type SentMode = "initial" | "incremental" | "rescan";
export type SentOrigin = "system" | "draft" | null;
sentTextWindowMs(retentionDays): number                // min(14 d, retention)
sentModeOf(cursor: { uidValidity }, status: FolderStatus): SentMode
parentMessageId(meta): string | null                    // In-Reply-To, else the last References id, normalized
cleanAddresses(list): string[]                          // trim, lower case, drop empty, first of equals, order kept
toNewSentEmail(meta, { mailboxId, path, uidValidity, now, textWindowMs, origin }): NewSentEmail | null
firstPerDedupKey(rows): rows                            // the first row of each key, in order
```

`toNewSentEmail` (D6): null when `internalDate < now − 30 d` (the bound is inclusive). It uses `normalizeMessageId`, `baseDedupKey`, `contentHash` and `threadKey` of `apps/server/src/modules/mail/sync-rules.ts`, as the incoming row does. `sentAt` = the `Date` header when valid, else INTERNALDATE. `origin "system"` only for `system`; `actionId` kept for `system` and `draft`, null for null. `content` = `headers_only` for system rows and for mail older than `textWindowMs`, else `pending`.

**Test** (no DB; `NOW = 2026-11-20T10:00:00Z`; `meta()` = uid 1, size 100, internal date and date `NOW − 1 d`, `messageId "<s1@x.test>"`, from `me@x.test`, to `anna@x.test`):

1. `sentModeOf`: no cursor → `initial`; 7/7 → `incremental`; 7/9 → `rescan`.
2. `parentMessageId`: `" <in-1@x.test> "` → `"<in-1@x.test>"`; no In-Reply-To, references r1, r2 → `"<r2@x.test>"`; nothing or blanks → null.
3. `cleanAddresses([" Anna@X.test", "anna@x.test", "", "B@x.test"])` → `["anna@x.test", "b@x.test"]`.
4. In-Reply-To in-1, references root, in-1, cc `B@x.test`, `b@x.test` → parent in-1, references kept, `threadKey "<root@x.test>"`, cc `["b@x.test"]`, `pending`, `user`, `actionId` null, the incoming dedup key.
5. Internal date `NOW − 20 d` → `headers_only`; `− 31 d` → null; exactly `− 30 d` → a row.
6. `actionId` uuid with `system` → `system`, `headers_only`, id kept; with `draft` → `user`, `pending`, id kept; with null → `user`, id null.
7. `sentTextWindowMs(3)` = 3 days; `sentTextWindowMs(30)` = 14 days; window 3 d and mail at `NOW − 4 d` → `headers_only`.
8. No `Date` header → `sentAt` = internal date. No Message-ID → `hash:` key, thread key = the dedup key.
9. `firstPerDedupKey` over keys a, b, a → the first a, then b.

## Step 3 — `sentOriginOf` in `actions`

**Files.** `apps/server/src/modules/actions/repo/planned.ts` (next to `isOwnActionId`), exported by `apps/server/src/modules/actions/index.ts`; `apps/server/test/integration/actions-sent-origin.test.ts` (new).

**Interface.**

```ts
sentOriginOf(db, ctx, mailboxId, actionId: string): Promise<"system" | "draft" | null>
```

Rule (one query; any sender can write the header): not a uuid → null without a query. The action of this org and id, type `create_draft` or `send`, whose email is in `mailboxId` (the join of `isOwnActionId`); none → null. A `send` that went out (`status = 'applied'` or `send_started_at` set) → `system`. A `create_draft` with such a `send` (`depends_on_action_id` = the draft) → `system`. Else → `draft`.

**Test** (`insertDraftAndSend` of `apps/server/test/integration/fixtures.ts`):

1. Draft with its send `applied` → `system`; the send id → `system`.
2. Send `awaiting_approval` or `rejected` → `draft`.
3. Send `applying` with `send_started_at` set → `system`.
4. `"not-a-uuid"`, a random uuid, the draft id with another mailbox of the org → null.
5. Org B's context with org A's draft id → null.

**Out of scope.** Wiring into the job (stage 06).

## Done when

Steps 1–3 done; the Proof passes (`/tmp/f104-s03`).
