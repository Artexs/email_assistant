# F104 stage 04 — Header pass

Part of [`../plan.md`](../plan.md). **[risky]**: sync, dedup, a cursor, a read-only guarantee (review before the land). Needs stage 03. Read D3–D6, D8 and the `syncFolder` pattern of `apps/server/src/modules/mail/sync.ts`.

## Step 1 — `syncSentHeaders` [risky]

**Files.** `apps/server/src/modules/mail/sent-sync.ts`, `apps/server/test/integration/mail-sent-sync.test.ts` (new).

**Interfaces.**

```ts
export interface SentSyncDeps {
  db: Db | Transaction<DB>;
  provider: SentFolderReader;
  sentOriginOf(ctx, mailboxId, actionId): Promise<SentOrigin>; // injected: mail may not import actions
  now(): Date;
  chunkSize?: number; // default SENT_CHUNK_SIZE
}
export type SentPassStatus = "flag_off" | "off" | "no_folder" | "folder_missing" | "cursor_moved" | "done";
export interface SentHeaderResult {
  status: SentPassStatus; mode: SentMode | null;
  fetched: number; stored: number; system: number; tooOld: number;
}
syncSentHeaders(deps, ctx, mailboxId): Promise<SentHeaderResult>
```

**Order** (`now` read once):

1. Flag `sent_sync` off (`isFeatureOn`) → `flag_off`, no other read.
2. No state row, or off → `off`.
3. Mailbox missing → `HardError`. No non-empty `folder_map.sent` → `markSentPass(no_folder)`, `no_folder`.
4. State path differs → guarded `resetSentCursor`, read the state again.
5. `folderStatus(path)`; `MailFolderMissingError` here or later → `markSentPass(folder_missing)`, `folder_missing`.
6. Mode by `sentModeOf`. `incremental`: `fetchAbove` + `filterAboveCursor`; else `fetchSince(now − 30 d)`.
7. Per chunk, in UID order: plan rows (`sentOriginOf` only for metas with an action id; `toNewSentEmail` with `sentTextWindowMs` of the org's `data_retention_days`; nulls count `tooOld`; `firstPerDedupKey` across all chunks of the call); then one guarded transaction: `insertSentEmails`, and in `incremental` `updateSentCursor` to the chunk's last UID (too-old metas move it too).
8. After `initial`/`rescan` (also with no metas): guarded `updateSentCursor(max(uidNext − 1, highest uid), firstPassAt: now)`.
9. `markSentPass(null)`, `done`.

**Guard (D5).** Each write transaction locks the state row and needs `enabled` and the same `enabledAt`, `path`, `uidValidity`, `lastUid` as the state this call read last. A mismatch writes nothing; the call returns `cursor_moved` with its counts and calls `markSentPass(null)`.

No log lines here. No path, subject or address in an error text.

**Test** (per test: flag on, switch on at `NOW − 1 h`, `folder_map.sent = "Sent"`, a fake with mail in `"Sent"`, the real `sentOriginOf`):

1. Flag off → `flag_off`; no provider call, no row, `lastPassAt` null.
2. No state row, or off → `off`; no provider call.
3. No `sent` key → `no_folder`; `lastErrorCode "no_folder"`, `lastPassAt NOW`.
4. Initial over A (`NOW − 1 d`), B (`− 20 d`), C (`− 40 d`), D (`− 2 d`, a draft whose send is `applied`), G (`− 3 d`, send `awaiting_approval`) → `done`, fetched 4, stored 4, system 1; A `user/pending`, B `user/headers_only`, D `system/headers_only`, G `user/pending` with `action_id`; cursor `uidNext − 1`; `firstPassAt NOW`.
5. In-Reply-To in-1, references root, in-1, to `Anna@X.test`, cc `b`, `B`, date `NOW − 3 h` → parent in-1, thread root, to `{anna@x.test}`, cc `{b@x.test}`, `sent_at NOW − 3 h`.
6. After 4: E (`NOW − 1 h`) → incremental, stored 1, cursor at E; again → 0; F (`− 40 d`) → `tooOld 1`, cursor at F.
7. `resetUidValidity(900, "Sent")` → `rescan`, stored 0; rows carry 900 and the new UIDs; `firstPassAt` kept.
8. The same mail twice → one row; also with `chunkSize 1`.
9. Read-only: a mail with `\Seen`, one without; from a `folderCalls` snapshot, initial and incremental → `"Sent"` calls are only `folderStatus`, `fetchAbove`, `searchSinceIn`, `fetchByUidsIn`; flags unchanged.
10. Path → `"Wysłane"` with 2 mails, `now = NOW + 1 d` → `initial` there, stored 2; `Sent` rows keep `path "Sent"`.
11. `folder_map.sent = "Gone"` → `folder_missing`.
12. A `sentOriginOf` hook turns the switch off → `cursor_moved`, no row, state clean; the same with off → on at `NOW + 1 s`.
13. `chunkSize 2`, 5 new mails, `sentOriginOf` throws `SoftError` for mail 3 → the call throws; mails 1–2 stored, cursor at 2; the next call stores 3–5.
14. Org B's pass writes only org B rows; org B's context with org A's mailbox → `off`.
15. `X-EA-Action-Id: not-a-uuid`, or another mailbox's action → user rows, `action_id` null.
16. Retention 3 d: mail at `NOW − 5 d` → `headers_only`; at `− 2 d` → `pending`.
17. A tombstoned mail (`dsr_tombstones` holds its key hash) → no row, no error; the cursor still passes it.

**Out of scope.** Text step (05); job, logs (06).

## Done when

Cases 1–17 pass; `apps/server/src/modules/mail/sent-sync.ts` uses no `MailProvider`; the Proof passes (`/tmp/f104-s04`).
