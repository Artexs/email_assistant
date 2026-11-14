# F104 stage 04 — Header pass

Part of [`../plan.md`](../plan.md). **[risky]**: sync, dedup, a cursor and a read-only guarantee (review job before the land). Needs stage 03 on `master`. Read D3–D6 and D8 first, and `mail/sync.ts` `syncFolder`, `applyChunk`, `setCursor` (the pattern this stage follows).

After this stage `syncSentHeaders` reads the headers of the Sent folder into `sent_emails` with its own cursor, behind the flag and the switch, and never writes to the folder. No job calls it yet (stage 06).

## Step 1 — `syncSentHeaders` [risky]

**Goal.** One header pass per call: the order of D4, the guard of D5, the rows of D6.

**Files.** `apps/server/src/modules/mail/sent-sync.ts` (new), `apps/server/src/modules/mail/index.ts` (exports), `apps/server/test/integration/mail-sent-sync.test.ts` (new).

**Interfaces.**

```ts
import { isFeatureOn } from "../tenancy";

export interface SentSyncDeps {
  db: Db | Transaction<DB>;
  provider: SentFolderReader;
  /** The actions function of stage 03, injected (mail may not import actions). */
  sentOriginOf(ctx: TenantContext, mailboxId: string, actionId: string): Promise<SentOrigin>;
  now(): Date;
  chunkSize?: number; // default SENT_CHUNK_SIZE
}

export type SentPassStatus = "flag_off" | "off" | "no_folder" | "folder_missing" | "cursor_moved" | "done";

export interface SentHeaderResult {
  status: SentPassStatus;
  mode: SentMode | null; // null unless the folder was read
  fetched: number;       // metas read (after the cursor filter)
  stored: number;        // new rows
  system: number;        // rows with origin 'system'
  tooOld: number;        // metas older than the 30-day window
}

export async function syncSentHeaders(deps: SentSyncDeps, ctx: TenantContext, mailboxId: string): Promise<SentHeaderResult>;
```

The order (D4), with `now = deps.now()` read once at the start:

1. `isFeatureOn(deps.db, ctx, "sent_sync")` false → `flag_off`. No other read.
   Then (for step 7) `textWindowMs = sentTextWindowMs((await getOrganization(deps.db, ctx)).data_retention_days)` (`getOrganization` from `../tenancy`; a missing organization → `HardError`).
2. `getSentSyncState` undefined or `enabled` false → `off`.
3. `getMailbox(deps.db, ctx, mailboxId)`; missing → `HardError("mailbox not found")`. `path = mailbox.folder_map.sent` (a non-empty string, else none). None → `markSentPass({ at: now, errorCode: "no_folder" })`, return `no_folder`.
4. `state.path !== path` → in one guarded transaction (step 2 of the guard below, without the cursor compare) `resetSentCursor({ path })`; then read the state again. A failed guard → `cursor_moved`.
5. `deps.provider.folderStatus(path)`; `MailFolderMissingError` → `markSentPass({ errorCode: "folder_missing" })`, return `folder_missing`. The same error from a later provider call of this pass → the same result.
6. `mode = sentModeOf(state, status)`. `incremental`: `metas = filterAboveCursor(await provider.fetchAbove(path, state.lastUid), state.lastUid).kept`. Else: `metas = await fetchSince(deps.provider, path, new Date(now − SENT_HEADER_WINDOW_MS))`. `fetched = metas.length`.
7. Per chunk of `chunkSize` metas, in UID order. Plan (no transaction): for each meta, `origin = meta.actionId === null ? null : await deps.sentOriginOf(ctx, mailboxId, meta.actionId)`; `row = toNewSentEmail(meta, { mailboxId, path, uidValidity: status.uidValidity, now, textWindowMs, origin })`; `null` → `tooOld += 1`; `row.origin === "system"` → `system += 1`; rows → `firstPerDedupKey`, also against the keys of earlier chunks of this call (a `Set`). Write (one transaction, the guard below): `stored += insertSentEmails(rows)`; in `incremental` also `updateSentCursor({ uidValidity: status.uidValidity, lastUid: <last uid of the chunk's metas> })` (the too-old metas count: the cursor passes them).
8. After the last chunk of `initial` or `rescan` (also when there were no metas): one guarded transaction: `updateSentCursor({ uidValidity: status.uidValidity, lastUid: max(status.uidNext − 1, highest uid of metas) }, { firstPassAt: now })`.
9. `markSentPass({ at: now, errorCode: null })`; return `done`.

The guard, in every write transaction (use the `deps.db.isTransaction ? run(deps.db) : deps.db.transaction().execute(run)` form of `sync.ts`): `locked = await lockSentSyncState(trx, ctx, mailboxId)`; it must have `enabled` true and the same `enabledAt` (by `getTime()`), `path`, `uidValidity` and `lastUid` as the state this call read last (after step 4, the state with the new path and a null cursor; after each incremental chunk, the cursor that chunk wrote). A mismatch throws a private `SentStateMovedError`; `syncSentHeaders` catches it and returns `cursor_moved` with the counts so far, and calls `markSentPass({ errorCode: null })` (it changes nothing when the row is now off). The writes of that transaction do not happen.

Log nothing in this function (stage 06 logs the result). Never put the path, a subject or an address into an error message.

**Decisions.** D3, D4, D5, D6, D8 (statuses; `markSentPass` here, so a later caller of the header step alone, E6a, also keeps the state).

**Test** (integration, `withRollback`; `NOW = 2026-11-20T10:00:00Z`, `deps.now` returns a variable `now`; per test: `createOrgWithMailbox`, `upsertOrgFeature(trx, ctx, { flag: "sent_sync", enabled: true, setBy: "cli", setAt: NOW })`, `writeSentSwitch(trx, ctx, mailboxId, { enabled: true, at: NOW − 1 h })`, `setFolderMapEntry(trx, ctx, mailboxId, "sent", "Sent")`, a fake from `createFakeMailProvider()` with mail put into `"Sent"` by `deliver`; `deps.sentOriginOf` = the real `sentOriginOf(trx, …)` from `actions` (stage 03); the organization keeps the default `data_retention_days` 30; `configureFeatures({ off: [] })` in `beforeEach`):

1. Flag off (no `upsertOrgFeature`) → `flag_off`; `fake.calls` is `[]`; no `sent_emails` row; the state is unchanged (`lastPassAt` null).
2. No state row → `off`; a row with `enabled` false → `off`; `fake.calls` `[]` both times.
3. `folder_map` without `sent` (skip `setFolderMapEntry`) → `no_folder`; state `lastErrorCode "no_folder"`, `lastPassAt = NOW`.
4. Initial, four mails in `Sent`: A `internalDate NOW − 1 d`; B `NOW − 20 d`; C `NOW − 40 d`; D `NOW − 2 d` with header `X-EA-Action-Id` = the draft id of `insertDraftAndSend(trx, ctx, mailboxId, { sendStatus: "applied" })`; G `NOW − 3 d` with the draft id of a second `insertDraftAndSend(…, {})` (its send still `awaiting_approval`: the user sent the draft from a mail app) → `done`, `mode "initial"`, `fetched 4`, `tooOld 0` (`fetchSince` drops C by its time filter), `stored 4`, `system 1`; rows: A `user`/`pending`, B `user`/`headers_only`, D `system`/`headers_only` with `action_id` set, G `user`/`pending` with `action_id` = its draft id; every row has `path "Sent"`; no row for C; state `path "Sent"`, `uidValidity` = the fake's, `lastUid` = `uidNext − 1`, `firstPassAt NOW`.
5. Row fields: a mail with `inReplyTo "<in-1@x.test>"`, `references ["<root@x.test>", "<in-1@x.test>"]`, `to ["Anna@X.test"]`, `cc ["b@x.test", "B@x.test"]`, `date NOW − 3 h`, `internalDate NOW − 2 h` → `parent_message_id "<in-1@x.test>"`, `thread_key "<root@x.test>"`, `to_addresses {anna@x.test}`, `cc_addresses {b@x.test}`, `sent_at NOW − 3 h`, `internal_date NOW − 2 h`.
6. Incremental: after case 4, deliver E (`NOW − 1 h`), `now = NOW + 5 min` → `mode "incremental"`, `fetched 1`, `stored 1`, `lastUid` = E's uid; a third call → `fetched 0`, `stored 0`, cursor unchanged. Then deliver F with `internalDate NOW − 40 d` (an old mail moved into Sent) → `fetched 1`, `tooOld 1`, `stored 0`, `lastUid` = F's uid.
7. Rescan: after case 4, `fake.resetUidValidity(900, "Sent")` → `mode "rescan"`, `stored 0`; rows A, B, D, G have `uidvalidity 900` and the new UIDs; state `uidValidity 900`; `firstPassAt` still `NOW`.
8. The same mail twice in `Sent` (two `deliver` calls of one `SeedMessage`, same `internalDate` and size) → one row; with `chunkSize 1` (the copies in two chunks) → still one row.
9. Read-only: put a mail with `fake.appendMessage("Sent", raw, ["\\Seen"], NOW − 1 d)` and one by `deliver` (no flags); then `const start = fake.folderCalls.length`; run an initial and an incremental call; `fake.folderCalls.slice(start).filter((c) => c.folder === "Sent").map((c) => c.method)` holds only `folderStatus`, `fetchAbove`, `searchSinceIn`, `fetchByUidsIn`. After that, `fetchFlagsIn("Sent", uids)` shows `["\\Seen"]` and `[]` as before (read the flags only after the slice).
10. A new path: after case 4, `setFolderMapEntry(…, "sent", "Wysłane")` and two new mails delivered to `"Wysłane"`, `now = NOW + 1 d` → `mode "initial"` over `"Wysłane"`, `stored 2` with `path "Wysłane"`, state `path "Wysłane"`, `firstPassAt NOW + 1 d`; the rows of `Sent` stay with `path "Sent"`.
11. Folder missing: `folder_map.sent = "Gone"` (no such folder in the fake) → `folder_missing`; state `lastErrorCode "folder_missing"`.
12. Switch off during the pass: `deps.sentOriginOf` that first calls `writeSentSwitch(trx, ctx, mailboxId, { enabled: false, at: NOW })`, then answers `null`; one mail with an `X-EA-Action-Id` → `cursor_moved`, `stored 0`, no row; the state is off and clean (the off check holds). The same with `writeSentSwitch({ enabled: true, at: NOW + 1 s })` (a new period) → `cursor_moved`, no row.
13. Crash between chunks: `chunkSize 2`, incremental with 5 new mails, the 3rd mail has an `X-EA-Action-Id` and `deps.sentOriginOf` throws `new SoftError("db")` for it → the call throws; rows of mails 1–2 exist and `lastUid` = mail 2's uid; the next call (a working `sentOriginOf`) stores mails 3–5 and moves the cursor to mail 5.
14. Two orgs: org B with its own mailbox, flag, switch and fake → its pass writes only org B rows; org A's rows and state are unchanged; `syncSentHeaders` in org B's context with org A's mailbox id → `off` (no state row in B's scope).
15. A header `X-EA-Action-Id: not-a-uuid` and one with the uuid of an action of another mailbox → both user rows (`action_id` null, `content` by the window).
16. Retention shorter than the text window: `data_retention_days = 3` for the org, a mail at `NOW − 5 d` → `headers_only`; one at `NOW − 2 d` → `pending`.

**Check.** `bun test apps/server/test/integration/mail-sent-sync.test.ts`

**Done when.** Cases 1–16 pass; `bun run typecheck` passes; no import of `MailProvider` in `sent-sync.ts` other than through `SentFolderReader`.

**Out of scope.** The text step (stage 05), the job (stage 06), logs.

## Done when (stage)

Step 1 done; the Proof command of `plan.md` passes (`/tmp/f104-s04`).
