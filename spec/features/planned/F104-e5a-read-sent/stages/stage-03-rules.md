# F104 stage 03 — Read-only port type and pure Sent rules

Part of [`../plan.md`](../plan.md). Needs stage 02 on `master`. Read D3, D4, D6 first.

After this stage the code has the read-only provider type for the Sent folder and the pure rules that turn one fetched message into a sent row. No job uses them yet.

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
export const SENT_TEXT_WINDOW_MS = 14 * DAY_MS;   // text of the last 14 days
export const SENT_CHUNK_SIZE = 50;
export const SENT_TEXT_RUN_LIMIT = 100;            // text fetches per run

export type SentMode = "initial" | "incremental" | "rescan";

/** initial: no cursor; incremental: the same UIDVALIDITY; rescan: another one. */
export function sentModeOf(cursor: { uidValidity: number | null }, status: FolderStatus): SentMode;

/** normalizeMessageId(In-Reply-To), else the last References id (normalized), else null. */
export function parentMessageId(meta: Pick<MessageMeta, "inReplyTo" | "references">): string | null;

/** Trimmed, lower case, empty values dropped, the first of equal values kept, order kept. */
export function cleanAddresses(list: readonly string[]): string[];

/** null when meta.internalDate < now − SENT_HEADER_WINDOW_MS (too old). `ownActionId` = the header value when
 *  isOwnActionId said yes, else null. */
export function toNewSentEmail(
  meta: MessageMeta,
  input: { mailboxId: string; uidValidity: number; now: Date; ownActionId: string | null }
): NewSentEmail | null;

/** Keeps the first row of each dedup key, in order. */
export function firstPerDedupKey<T extends { dedupKey: string }>(rows: readonly T[]): T[];
```

`toNewSentEmail`: `messageId = normalizeMessageId(meta.messageId)`; `dedupKey = baseDedupKey(messageId, contentHash(meta))`; `referencesIds` = each `meta.references` id through `normalizeMessageId`, nulls dropped; `threadKey = threadKey({ ...meta, messageId }, dedupKey)` (the function of `sync-rules.ts`, as `newRow` in `sync.ts` calls it); `fromAddress` = `cleanAddresses([meta.from])[0] ?? null` (skip when `from` is null); `toAddresses`, `ccAddresses` through `cleanAddresses`; `subject = meta.subject`; `sentAt = meta.date` when it is a valid date, else `meta.internalDate`; `actionId = ownActionId`; `content` = `"headers_only"` when `ownActionId !== null` or `meta.internalDate < now − SENT_TEXT_WINDOW_MS`, else `"pending"`. Import `normalizeMessageId`, `baseDedupKey`, `contentHash`, `threadKey` from `./sync-rules`.

**Decisions.** D4, D6.

**Test** (unit, no DB; `NOW = 2026-11-20T10:00:00Z`; `meta(overrides)` builds a `MessageMeta` with `uid 1`, `size 100`, `internalDate NOW − 1 d`, `date NOW − 1 d`, `messageId "<s1@x.test>"`, `from "me@x.test"`, `to ["anna@x.test"]`):

1. `sentModeOf({ uidValidity: null }, status(7))` → `initial`; `({ uidValidity: 7 }, status(7))` → `incremental`; `({ uidValidity: 7 }, status(9))` → `rescan`.
2. `parentMessageId({ inReplyTo: " <in-1@x.test> ", references: ["<r@x.test>"] })` → `"<in-1@x.test>"`; `({ inReplyTo: null, references: ["<r1@x.test>", "<r2@x.test>"] })` → `"<r2@x.test>"`; `({ inReplyTo: null, references: [] })` → `null`; `({ inReplyTo: "  ", references: [] })` → `null`.
3. `cleanAddresses([" Anna@X.test", "anna@x.test", "", "B@x.test"])` → `["anna@x.test", "b@x.test"]`.
4. `toNewSentEmail(meta({ inReplyTo: "<in-1@x.test>", references: ["<root@x.test>", "<in-1@x.test>"], cc: ["B@x.test", "b@x.test"] }), { mailboxId: "m", uidValidity: 7, now: NOW, ownActionId: null })` → `parentMessageId "<in-1@x.test>"`, `referencesIds ["<root@x.test>", "<in-1@x.test>"]`, `threadKey "<root@x.test>"`, `ccAddresses ["b@x.test"]`, `content "pending"`, `actionId null`, `dedupKey` = `baseDedupKey("<s1@x.test>", contentHash(meta))`.
5. `internalDate NOW − 20 d` → `content "headers_only"`; `internalDate NOW − 31 d` → `null`; `internalDate NOW − 30 d` exactly → a row (the bound is inclusive).
6. `ownActionId "6f9c…"` (any uuid) with `internalDate NOW − 1 d` → `content "headers_only"`, `actionId` set.
7. `date null` → `sentAt = internalDate`; `date` set → `sentAt = date`.
8. `messageId null` → `messageId null`, `dedupKey` starts with `hash:`, `threadKey` = the dedup key when no references and no In-Reply-To.
9. `firstPerDedupKey([{dedupKey:"a", n:1}, {dedupKey:"b", n:2}, {dedupKey:"a", n:3}])` → n 1, 2.

**Check.** `bun test apps/server/src/modules/mail/sent-rules.test.ts`

**Done when.** Cases 1–9 pass.

**Out of scope.** Any DB or provider call (stage 04).

## Done when (stage)

Steps 1–2 done; the Proof command of `plan.md` passes (`/tmp/f104-s03`).
