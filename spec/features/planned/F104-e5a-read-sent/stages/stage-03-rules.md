# F104 stage 03 — Read-only port type, pure Sent rules, origin of an action id

Part of [`../plan.md`](../plan.md). Review job before the land (step 3 decides which Sent mail is the system's). Needs stage 02 on `master`. Read D3, D4, D6, D7 first.

After this stage the code has the read-only provider type for the Sent folder, the pure rules that turn one fetched message into a sent row, and the `actions` function that tells a system send from the user's own send of a system draft. No job uses them yet.

## Step 1 — The read-only type

**Goal.** A provider type with only the five read methods, so Sent code cannot call a write method.

**Files.** `apps/server/src/modules/mail/port.ts`, `apps/server/src/modules/mail/sync.ts` (one signature), `apps/server/src/modules/mail/index.ts` (export the type), `apps/server/src/modules/mail/sent-reader.test.ts` (new, unit).

**Interfaces.**

```ts
// port.ts, after MailProvider:
/** What the Sent pass may call (ADR 0029: read-only). Every body read is BODY.PEEK, so no read sets \Seen. */
export type SentFolderReader = Pick<MailProvider, "folderStatus" | "fetchAbove" | "fetchContent" | "searchSinceIn" | "fetchByUidsIn">;
```

`sync.ts`: change the `provider` parameter of `fetchSince` from `MailProvider` to `Pick<MailProvider, "searchSinceIn" | "fetchByUidsIn">`. Its body and its other callers stay as they are (a `MailProvider` still fits).

`sent-reader.test.ts` is a type test that typecheck runs: a function `(reader: SentFolderReader) => { … }` whose body holds one line per write method, each as `void reader.moveMessage;` under a comment `// @ts-expect-error the Sent reader has no write method` (the form of `platform/llm/client-roles.test.ts` line 200): `moveMessage`, `transferByAppend`, `deleteMessage`, `setFlags`, `appendMessage`, `ensureFolder`; plus one `bun:test` case that calls `createFakeMailProvider()` and passes it where a `SentFolderReader` is expected (it compiles and the test passes).

**Decisions.** D3.

**Test.** 1. `bun run typecheck` passes (each `@ts-expect-error` line has an error). 2. The unit case passes.

**Check.** `bun run typecheck && bun test apps/server/src/modules/mail/sent-reader.test.ts`

**Done when.** Both pass.

**Out of scope.** EXAMINE or any adapter change (D3 rejected it).

## Step 2 — Pure rules

**Goal.** One file of pure functions: windows, the parent id, addresses, the mode, the row of one message.

**Files.** `apps/server/src/modules/mail/sent-rules.ts` (new), `apps/server/src/modules/mail/sent-rules.test.ts` (new, unit).

**Interfaces.**

```ts
import type { FolderStatus, MessageMeta } from "./port";
import type { NewSentEmail } from "./repo";

const DAY_MS = 24 * 3_600_000;
export const SENT_HEADER_WINDOW_MS = 30 * DAY_MS; // headers of the last 30 days (ADR 0029 decision 5)
export const SENT_TEXT_WINDOW_MS = 14 * DAY_MS;   // text of the last 14 days, never past the retention

/** min(SENT_TEXT_WINDOW_MS, retentionDays days). */
export function sentTextWindowMs(retentionDays: number): number;

export type SentOrigin = "system" | "draft" | null; // the answer of sentOriginOf (step 3)
export const SENT_CHUNK_SIZE = 50;
export const SENT_TEXT_RUN_LIMIT = 100;            // text fetches per run

export type SentMode = "initial" | "incremental" | "rescan";

/** initial: no cursor; incremental: the same UIDVALIDITY; rescan: another one. */
export function sentModeOf(cursor: { uidValidity: number | null }, status: FolderStatus): SentMode;

/** normalizeMessageId(In-Reply-To), else the last References id (normalized), else null. */
export function parentMessageId(meta: Pick<MessageMeta, "inReplyTo" | "references">): string | null;

/** Trimmed, lower case, empty values dropped, the first of equal values kept, order kept. */
export function cleanAddresses(list: readonly string[]): string[];

/** null when meta.internalDate < now − SENT_HEADER_WINDOW_MS (too old). `origin` = what sentOriginOf answered for
 *  meta.actionId (null when the mail has no such header). */
export function toNewSentEmail(
  meta: MessageMeta,
  input: { mailboxId: string; path: string; uidValidity: number; now: Date; textWindowMs: number; origin: SentOrigin }
): NewSentEmail | null;

/** Keeps the first row of each dedup key, in order. */
export function firstPerDedupKey<T extends { dedupKey: string }>(rows: readonly T[]): T[];
```

`toNewSentEmail`: `messageId = normalizeMessageId(meta.messageId)`; `dedupKey = baseDedupKey(messageId, contentHash(meta))`; `referencesIds` = each `meta.references` id through `normalizeMessageId`, nulls dropped; `threadKey = threadKey({ ...meta, messageId }, dedupKey)` (the function of `sync-rules.ts`, as `newRow` in `sync.ts` calls it); `fromAddress` = `cleanAddresses([meta.from])[0] ?? null` (skip when `from` is null); `toAddresses`, `ccAddresses` through `cleanAddresses`; `subject = meta.subject`; `sentAt = meta.date` when it is a valid date, else `meta.internalDate`; `path`, `uidValidity`, `uid = meta.uid`; `origin` = `"system"` when `input.origin === "system"`, else `"user"`; `actionId = input.origin === null ? null : meta.actionId`; `content` = `"headers_only"` when `origin` is `"system"` or `meta.internalDate < now − textWindowMs`, else `"pending"`. Import `normalizeMessageId`, `baseDedupKey`, `contentHash`, `threadKey` from `./sync-rules`.

**Decisions.** D4, D6.

**Test** (unit, no DB; `NOW = 2026-11-20T10:00:00Z`; `input(overrides)` = `{ mailboxId: "m", path: "Sent", uidValidity: 7, now: NOW, textWindowMs: SENT_TEXT_WINDOW_MS, origin: null }`; `meta(overrides)` builds a `MessageMeta` with `uid 1`, `size 100`, `internalDate NOW − 1 d`, `date NOW − 1 d`, `messageId "<s1@x.test>"`, `from "me@x.test"`, `to ["anna@x.test"]`):

1. `sentModeOf({ uidValidity: null }, status(7))` → `initial`; `({ uidValidity: 7 }, status(7))` → `incremental`; `({ uidValidity: 7 }, status(9))` → `rescan`.
2. `parentMessageId({ inReplyTo: " <in-1@x.test> ", references: ["<r@x.test>"] })` → `"<in-1@x.test>"`; `({ inReplyTo: null, references: ["<r1@x.test>", "<r2@x.test>"] })` → `"<r2@x.test>"`; `({ inReplyTo: null, references: [] })` → `null`; `({ inReplyTo: "  ", references: [] })` → `null`.
3. `cleanAddresses([" Anna@X.test", "anna@x.test", "", "B@x.test"])` → `["anna@x.test", "b@x.test"]`.
4. `toNewSentEmail(meta({ inReplyTo: "<in-1@x.test>", references: ["<root@x.test>", "<in-1@x.test>"], cc: ["B@x.test", "b@x.test"] }), input())` → `parentMessageId "<in-1@x.test>"`, `referencesIds ["<root@x.test>", "<in-1@x.test>"]`, `threadKey "<root@x.test>"`, `ccAddresses ["b@x.test"]`, `content "pending"`, `origin "user"`, `actionId null`, `path "Sent"`, `uid 1`, `dedupKey` = `baseDedupKey("<s1@x.test>", contentHash(meta))`.
5. `internalDate NOW − 20 d` → `content "headers_only"`; `internalDate NOW − 31 d` → `null`; `internalDate NOW − 30 d` exactly → a row (the bound is inclusive).
6. `meta({ actionId: <uuid> })` with `origin "system"` → `origin "system"`, `content "headers_only"`, `actionId` = the uuid; with `origin "draft"` → `origin "user"`, `content "pending"`, `actionId` = the uuid; with `origin null` → `origin "user"`, `actionId null`.
6b. `textWindowMs: sentTextWindowMs(3)` and `internalDate NOW − 4 d` → `content "headers_only"`; `sentTextWindowMs(30)` = `SENT_TEXT_WINDOW_MS`; `sentTextWindowMs(3)` = 3 days in ms.
7. `date null` → `sentAt = internalDate`; `date` set → `sentAt = date`.
8. `messageId null` → `messageId null`, `dedupKey` starts with `hash:`, `threadKey` = the dedup key when no references and no In-Reply-To.
9. `firstPerDedupKey([{dedupKey:"a", n:1}, {dedupKey:"b", n:2}, {dedupKey:"a", n:3}])` → n 1, 2.

**Check.** `bun test apps/server/src/modules/mail/sent-rules.test.ts`

**Done when.** Cases 1–9 and 6b pass.

**Out of scope.** Any provider call (stage 04).

## Step 3 — `sentOriginOf` in `actions`

**Goal.** Tell a system send from the user's own send of a system draft by the `X-EA-Action-Id` of a Sent mail (D6; cold review 1, M2).

**Files.** `apps/server/src/modules/actions/repo/planned.ts` (next to `isOwnActionId`), `apps/server/src/modules/actions/repo/index.ts`, `apps/server/src/modules/actions/index.ts`, `apps/server/test/integration/actions-sent-origin.test.ts` (new).

**Interfaces.**

```ts
/** What the X-EA-Action-Id of a Sent mail of this mailbox means. Any sender can write the header: a value that is not a
 *  uuid never reaches the query. */
export async function sentOriginOf(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  actionId: string
): Promise<"system" | "draft" | null>;
```

Rule: not a uuid → null. Read the action `a` with `a.org_id = ctx.orgId`, `a.id = actionId`, `a.type IN ('create_draft', 'send')`, joined to its email with `e.mailbox_id = mailboxId` (the join of `isOwnActionId`); none → null. `a.type = 'send'` and (`status = 'applied'` or `send_started_at IS NOT NULL`) → `system`. `a.type = 'create_draft'` and a `send` action `s` exists with `s.org_id = ctx.orgId`, `s.depends_on_action_id = a.id` and (`s.status = 'applied'` or `s.send_started_at IS NOT NULL`) → `system`. Else → `draft`. One query (a `LEFT JOIN` or an `EXISTS`), every value bound.

**Decisions.** D6.

**Test** (integration, `withRollback`, `insertDraftAndSend(trx, ctx, mailboxId, { sendStatus })` from `fixtures.ts`, which returns `draftId` and `sendId`):

1. Draft id with its send `applied` → `system`; the send id itself → `system`.
2. Draft id with its send `awaiting_approval` → `draft`; with `rejected` → `draft`.
3. Draft id with its send `applying` and `send_started_at` set (update the row in the test) → `system`.
4. `"not-a-uuid"` → null; a random uuid → null; the draft id with another mailbox of the same org → null.
5. Org B's context with org A's draft id → null.

**Check.** `bun test apps/server/test/integration/actions-sent-origin.test.ts`

**Done when.** Cases 1–5 pass.

**Out of scope.** Wiring it into the job (stage 06); the reply-draft rules of E6a.

## Done when (stage)

Steps 1–3 done; the Proof command of `plan.md` passes (`/tmp/f104-s03`).
