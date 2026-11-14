# F029 stage 03 — Move finder (F064)

Part of [`../plan.md`](../plan.md). **[risky]**: location writes of `emails` (review job before the land). Needs stage 02 on `master`. Read D5–D14 and the edge-case table of `plan.md` first, then `apps/server/src/modules/mail/sync.ts` `checkReturnedBelowCursor` (the lock, cursor check and transaction form this stage copies) and `apps/server/src/modules/mail/flags.ts` (the `FlagTarget` input).

One `[risky]` step. Nothing calls `findUserMoves` from the job yet; stage 04 wires it.

## Step 1 — `findUserMoves`

**Goal.** For gone mail (the flag refresh did not find its UID in its folder), find the mail at the same UID in a synced folder below that folder's cursor, and write `returned` or `relocated`.

**Files.** `apps/server/src/modules/mail/moves.ts` (new), `apps/server/src/modules/mail/index.ts` (export `findUserMoves`, `MOVE_CHECK_CHUNK` and the two types), `apps/server/test/integration/mail-moves.test.ts` (new).

**Interfaces.**

```ts
import type { SyncFolderKey } from "@ea/core";

/** UIDs per `fetchByUidsIn` call of the finder (one UID FETCH per call). */
export const MOVE_CHECK_CHUNK = 500;

export interface UserMovesDeps {
  db: Db | Transaction<DB>;
  provider: MailProvider;
  now(): Date;
  /** UIDs per fetch; default `MOVE_CHECK_CHUNK`. A test sets it small. */
  chunkSize?: number;
}

export interface UserMovesResult {
  /** Gone rows that still have the folder and UID of the read and no fresh move marker. */
  checked: number;
  returned: number;
  relocated: number;
  /** Hits not written because the folder cursor moved; the next refresh looks again. */
  retry: number;
}

export async function findUserMoves(
  deps: UserMovesDeps,
  ctx: TenantContext,
  mailboxId: string,
  gone: readonly FlagTarget[],
  opts: { skipFolders?: readonly SyncFolderKey[] } = {}
): Promise<UserMovesResult>
```

Imports: `listMoveCandidates`, `listFolderUids`, `listSyncFolders`, `lockSyncFolder`, `markEmailReturned`, `markEmailRelocated` and the types `FlagTarget`, `MoveCandidateRow`, `SyncFolderRow` from `./repo`; `matchMoved`, `MOVE_PENDING_MAX_AGE_MS` from `./sync-rules`; `CursorMovedError` from `./sync`; `createLog` (`const log = createLog("mail")`).

**Algorithm** (in this order):

1. `gone.length === 0` → return all zeros. No DB query, no provider call.
2. `rows = await listMoveCandidates(deps.db, ctx, mailboxId, gone.map((t) => t.emailId))`. Keep a row only when a gone target with its id has the same `folder` and `uid` (the row did not move after the refresh read it; D9) and `undo_pending_at` is null or at least `MOVE_PENDING_MAX_AGE_MS` old at `deps.now()` (D9). `checked` = the kept count. Then `log.debug("user_moves_checked", { mailbox_id: mailboxId, count: checked })`. `checked === 0` → return.
3. `folders = await listSyncFolders(deps.db, ctx, mailboxId, { enabledOnly: true })` (INBOX, sort folders, junk; fact F10). `remaining` = the kept rows.
4. For each folder S of `folders`, in order, while `remaining` is not empty:
   - Skip S when `opts.skipFolders` holds `S.key`, or `S.uidvalidity === null` or `S.last_uid === null` (D6).
   - `inS = remaining.filter((row) => row.folder !== S.path && row.uid <= S.last_uid)`. Empty → next folder.
   - `uids` = the distinct `uid` of `inS`, ascending. For each chunk of `deps.chunkSize ?? MOVE_CHECK_CHUNK`: `metas.push(...await deps.provider.fetchByUidsIn(S.path, chunk))`.
   - `hits = matchMoved(metas, inS)`. For each hit: `row` = the row of `inS` with `hit.emailId`; `held = await listFolderUids(deps.db, ctx, mailboxId, S.path, { exceptEmailId: row.id, messageId: row.message_id_header, contentHash: row.content_hash })`; `held.has(hit.uid)` → drop the hit (that UID is another identical row's mail; D7). Else keep `{ row, uid: hit.uid, kind: row.folder !== row.source_folder ? "returned" : "relocated" }`.
   - Remove every row of the kept hits from `remaining` (a row found in S is not looked for in a later folder; D6).
   - No kept hit → next folder. Else one transaction (the form of `checkReturnedBelowCursor`: `deps.db.isTransaction ? run(deps.db as Transaction<DB>) : deps.db.transaction().execute(run)`): `locked = await lockSyncFolder(trx, ctx, S.id)`; `locked?.uidvalidity !== S.uidvalidity || locked.last_uid !== S.last_uid` → `throw new CursorMovedError(…)` (fixed text with the mailbox id only, as in `sync.ts`). Then per kept hit: `returned` → `markEmailReturned(trx, ctx, row.id, uid, deps.now(), { folder: S.path, from: { folder: row.folder, uid: row.uid } })`; `relocated` → `markEmailRelocated(trx, ctx, row.id, { from: row.folder, to: S.path, uid, fromUid: row.uid })`. A `true` adds 1 to `returned` or `relocated` and logs `log.debug("user_move_found", { mailbox_id: mailboxId, email_id: row.id, folder_key: S.key, kind })`; a `false` counts nothing (another writer won; D8).
   - Catch `CursorMovedError` around that transaction only: `retry += <kept hits of S>`, go on with the next folder. Any other error propagates (stage 04 catches it in the job).
5. When `returned + relocated > 0`: `log.info("user_moves_found", { mailbox_id: mailboxId, count: returned + relocated })`. Return the result.

The file header comment states the rule in plain words (Interia keeps the UID on a webmail move; the refresh's gone mail is looked for at that UID in the synced folders below their cursors; nothing here writes to the mailbox). No path, address, subject or Message-ID in any line (D12).

**Decisions.** D5–D9, D11, D12, D14, D15.

**Test** (`mail-moves.test.ts`, one `withRollback` each, `NOW = new Date("2026-11-08T12:00:00Z")`). Setup helpers in the file:

- `const fake = createFakeMailProvider({ uidValidity: 7, globalUids: true, keepUidOnUserMove: true, uidNextValue: 1, capabilities: { move: false } })` (the Interia shape).
- `box = await createOrgWithMailbox(trx)`; set the INBOX cursor with plain SQL: `trx.updateTable("mailbox_folders").set({ uidvalidity: 7, last_uid: <n> }).where("mailbox_id", "=", box.mailboxId).where("key", "=", "inbox")`; add rows for `offers` (`Oferty`, role `sort`) and `junk` (`Wiadomości-śmieci`, role `junk`) as `addFolderRow` of `mail-sync.test.ts` does (copy that helper; `uidvalidity` 7, `last_uid` given, `enabled` given).
- `stored(trx, box, fake, folder, uid, row: { folder; source_folder; moved_at?; undo_pending_at? })`: reads `fake.fetchMetaIn(folder, uid)` and inserts the row with `insertTestEmail` with `uid`, `folder`, `source_folder`, `message_id_header: meta.messageId`, `content_hash: contentHash(meta)`, `from_address: meta.from`, `received_at: meta.internalDate` (so the identity matches). Returns the id.
- `target(id, folder, uid, meta)`: a `FlagTarget` `{ emailId: id, folder, uid, messageId: meta.messageId, receivedAt: meta.internalDate }`.
- `rowOf(id)`: `folder`, `source_folder`, `uid` and `inbox_uid` as numbers, `returned_at`.
- Seed mail with `seed(n)` as in `mail-flags.test.ts` (`internalDate` one hour before `NOW`).

Cases (fixed values; `u` = the UID the fake returned):

- 3.1 Limit (g): mail 1 delivered into INBOX (`u`), row in INBOX (source INBOX); `fake.userMove("INBOX", u, "Oferty")` keeps `u`; `offers` cursor `u + 5`, INBOX cursor `u + 5` → `{ checked: 1, returned: 0, relocated: 1, retry: 0 }`; row `folder` = `source_folder` = `Oferty`, `uid` = `inbox_uid` = `u`, `returned_at` null.
- 3.2 Limit (f): mail in `Wiadomości-śmieci`, row folder and source there; `userMove` to INBOX; INBOX cursor `u + 5` → `relocated` 1; row `folder` = `source_folder` = `INBOX`.
- 3.3 Limit (a): mail in `AI/Info`, row `folder: "AI/Info"`, `source_folder: "INBOX"`, `moved_at` 1 h ago; `userMove("AI/Info", u, "Oferty")`; `offers` cursor `u + 5` → `returned` 1; row `folder` = `source_folder` = `Oferty`, `uid` = `u`, `returned_at` = `NOW`.
- 3.4 A return into the row's own source after the 7-day window: row `AI/Info`/source INBOX, `moved_at` 8 days ago; `userMove("AI/Info", u, "INBOX")`; INBOX and `offers` cursors `u + 5` → `returned` 1, row in INBOX with `returned_at` = `NOW`. Only INBOX is fetched (`fake.folderCalls` has one `fetchByUidsIn` for `INBOX` and none for `Oferty`: the hit ends the search).
- 3.5 The row moved after the read: the target says `INBOX`/`u`, the DB row has `folder: "AI/Info"` → `checked` 0, no provider call after the call (compare `fake.folderCalls.length` before and after).
- 3.6 Move marker: as 3.1 but `undo_pending_at` 1 h before `NOW` → `checked` 0, row unchanged; with `undo_pending_at` 25 h before `NOW` → `relocated` 1.
- 3.7 UID above the cursor of S: as 3.1 but `offers` cursor `u - 1` → no `fetchByUidsIn` for `Oferty`, `relocated` 0, row unchanged.
- 3.8 An identical row holds the UID in S: as 3.1, plus a second row of the same identity (other `dedup_key`) with `folder` = `source_folder` = `Oferty` and `uid` = `u` → no write (`relocated` 0), both rows unchanged.
- 3.9 Cursor moved: wrap `fake` so that its `fetchByUidsIn` for `Oferty` first sets the `offers` `last_uid` to `u + 6` in the DB (same `trx`), then calls the fake → `{ checked: 1, relocated: 0, retry: 1 }`, row unchanged; a second `findUserMoves` with the plain `fake` and the same target → `relocated` 1.
- 3.10 Cost, nothing gone: `findUserMoves(…, [])` → all zeros and `fake.folderCalls` unchanged.
- 3.11 Cost, chunks: three rows in `AI/Info` (system-moved), their mail removed from the fake (`fake.remove`), INBOX and `offers` cursors above all three UIDs, `chunkSize: 2` → `checked` 3, no write, exactly 2 `fetchByUidsIn` calls for `INBOX` and 2 for `Oferty`, and no `fetchMetaIn` or `searchSinceIn` call.
- 3.12 Skips: as 3.1 with `opts.skipFolders: ["offers"]` → no `Oferty` call, `relocated` 0. As 3.1 with the `offers` row `enabled: false` → the same. As 3.1 with the `offers` row `last_uid` null → the same.
- 3.13 Tenants: a row of org B (second `createOrgWithMailbox`) passed as a target with org A's `ctx` and mailbox id → `checked` 0, B's row unchanged.
- 3.14 Logs: run 3.1 under `spyOn(console, "log")` and `spyOn(console, "error")` (restore after); one line holds `user_moves_found`; no line holds `Oferty`, `<m1@x.test>` or the sender address.

**Check.** `bun test apps/server/test/integration/mail-moves.test.ts` and `bun run typecheck`

**Done when.** Cases 3.1–3.14 pass; `sync.ts`, `flags.ts` and `jobs.ts` are unchanged in `git diff master`; then the Proof command of `plan.md` (`/tmp/f029-s03`) prints `PROOF_OK`.

**Out of scope.** The job wiring and the `gone` field of `refreshFlags` (stage 04); writing `email_flags` (D13); the docs (stage 04).
