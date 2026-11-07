# s3-assist-actions — Stage 6

Part of [`../s3-assist-actions.md`](../s3-assist-actions.md). Read that file's "Input" and "Rules for every step" first.

## Stage 6 — Returned mail below the UID cursor [risky]

Build fix (stage 6 review, 2026-11-07, the user approved): at Interia a system move (COPY + UID EXPUNGE) gives the mail a new UID in the folder (`emails.uid`), and a webmail move back keeps that folder UID. So the check fetches INBOX at both `inbox_uid` and `uid` of each row (at most 200 UIDs per chunk of 100 rows); `matchReturned` accepts a meta whose UID equals the row's `inbox_uid` or its `uid` (identity match, not `\Deleted`); `markEmailReturned` takes `meta.uid`. Extra test: the system COPY shape (folder `uid` ≠ `inbox_uid`), new INBOX mail moves the cursor past `uid`, then `userMove` back with `keepUidOnCopy` → `returnedBelowCursor` 1 and the row's `uid` = `inbox_uid` = the folder UID. Also: `searchSinceIn` throws `SoftError` when imapflow returns `false` (a failed SEARCH must not look like "gone → returned"); `markEmailReturned` on this path updates only a row with `folder <> 'INBOX'` and counts only changed rows; tests for the limit warn and the `CursorMovedError` branch where cheap.

Checkpoint 1 result (Interia, 2026-11-07): a `UID COPY` back to INBOX gets a new UID above `UIDNEXT` (`moveBack.sameAsOriginal` false, `aboveUidNext` true), so a system Undo returns above the cursor. A user move in webmail keeps the UID (2026-11-04 note), so the below-cursor check and the folder check on each hit stay as planned.

- [x] **6.1 `checkReturnedBelowCursor` in the incremental sync (D4)**
  - Goal: at Interia (UID kept on a move) a mail that the user puts back into INBOX is marked `returned_at` within one sync, although it is below the cursor; on an RFC server the check does no harm.
  - Files: change `apps/server/src/modules/mail/sync.ts`, `apps/server/src/modules/mail/sync-rules.ts`, `apps/server/src/modules/mail/sync-rules.test.ts`, `apps/server/src/modules/mail/repo.ts`, `apps/server/test/integration/mail-sync.test.ts`, `apps/server/test/integration/mail-repo.test.ts`.
  - Interfaces:

    ```ts
    // repo.ts
    export interface MovedRow {
      id: string;
      uid: number; // the UID in `folder` (the hint of the folder check)
      inbox_uid: number | null;
      folder: string;
      message_id_header: string | null;
      content_hash: string;
      from_address: string | null;
      received_at: Date;
      moved_at: Date;
    }
    export async function listRecentlyMoved(
      db,
      ctx,
      mailboxId: string,
      opts: { movedAfter: Date; limit: number }
    ): Promise<MovedRow[]>; // folder <> 'INBOX', inbox_uid not null, moved_at >= movedAfter; newest moved_at first (DESC), then id
    // sync.ts
    export const RETURN_CHECK_WINDOW_MS = 7 * 24 * 3_600_000;
    export const RETURN_CHECK_LIMIT = 500;
    export const RETURN_CHECK_CHUNK = 100;
    // SyncResult gets `returnedBelowCursor: number` and `copiesBelowCursor: number`
    // sync-rules.ts
    export function matchReturned(
      metas: readonly FolderMessageMeta[], // fetchByUidsIn returns them with flags
      rows: readonly MovedRow[],
      mode?: IdentityMode
    ): { emailId: string; uid: number }[];
    ```

  - Decisions:
    - Where: `syncMailbox`, only in `incremental` mode, after the last chunk (the cursor is already moved). Not in `initial`, `rescan` or `backfill` (a rescan re-reads 7 days of INBOX through the normal path, which marks returned mail with `check_folder`; a mail returned below the cursor at Interia after a UIDVALIDITY change is caught by the next incremental sync).
    - Steps: `rows = listRecentlyMoved(…, { movedAfter: now − RETURN_CHECK_WINDOW_MS, limit: RETURN_CHECK_LIMIT })`; `[]` → nothing. For each chunk of `RETURN_CHECK_CHUNK` rows: `metas = provider.fetchByUidsIn(INBOX, chunk.map(inbox_uid))`; `hits = matchReturned(metas, chunk)` = for each meta that is not `\Deleted` (`isDeleted`, M2: a failed expunge or another client's delete leaves the source copy at `inbox_uid`), the row with `inbox_uid === meta.uid` whose `sameMailIdentity(meta, row)` holds (mode `IDENTITY_MODE`). Folder check on every hit (M4): `locateMessage(provider, row.folder, locateKeyOf(row, row.uid), { excludeUids: await listFolderUids(db, ctx, mailboxId, row.folder, { exceptEmailId: row.id, messageId: row.message_id_header, contentHash: row.content_hash }) })`. Still in the folder → not a return: a copy below the cursor (Interia may keep the UID on a COPY back too); log `sync <mailboxId> copy below cursor: email <id>` (debug, not info: the row stays in the list, so the same copy comes back on every incremental sync for 7 days, about 2,000 times; re-review Rm5), `result.copiesBelowCursor += 1`, nothing stored (storing such a copy needs the body fetch and the `#n` insert of the chunk path: a follow-up, stage 18.3). Gone → a return. Then one transaction per chunk with `lockMailbox` and the cursor guard as in `applyChunk` (expected = the cursor after the chunks; `next` null): `markEmailReturned(id, uid, now)` for each return; `result.returnedBelowCursor += returns`. A `CursorMovedError` here is logged as a warning and ends the sync (the next tick repeats the check).
    - Why a folder check on each hit: D4 first assumed that a fresh copy always gets a new INBOX UID above the cursor. Interia keeps the UID on a webmail move (a protocol COPY gets a new UID: stage 1 `moveBack.sameAsOriginal` false; the check stays for other servers and other clients), so a hit at the old UID can be a copy. Hits are rare (one per user move back), so the check costs one locate per hit. A row whose `inbox_uid` was reused by another mail (UIDVALIDITY changed in between) fails the identity compare and is skipped.
    - When `rows.length === RETURN_CHECK_LIMIT`: one warn line `sync <mailboxId> returned below cursor: list hit the limit <n>` (the oldest moves of the window are not checked this run).
    - A row in the list whose Undo is under way (a reverse action `ready`): if the user also put the mail back by hand, the hit sets `returned_at`; stage 11 then writes no feedback (the reverse exists) and stage 9's ensure finds the mail in INBOX and marks the reverse applied. No double move.
    - Cost: at most 5 `UID FETCH` commands per sync (500 UIDs) plus one locate per hit; the moved rows older than 7 days leave the list by themselves.
    - Log line (info, ids and counts): `sync <mailboxId> returned below cursor: checked <n>, returned <m>, copies <c>`; only when `n > 0`.
  - Test:
    - `sync-rules.test.ts`: `matchReturned`: a meta whose UID equals a row's `inbox_uid` and whose identity matches → hit; the same meta with `\Deleted` in its flags → no hit; same UID, other identity → no hit; a meta with a UID of no row → ignored; two rows, one hit.
    - `mail-sync.test.ts` (fake with `keepUidOnCopy: true`, `capabilities.move: false`): (1) a stored mail (row `folder` = `AI/Info`, `uid` and `inbox_uid` = 10, `moved_at` = now − 1 h, set by a repo helper or SQL in the test) is put back into INBOX at UID 10 by `deliver`-like fake setup (`fake.userMove` with `keepUidOnCopy`) → after `syncMailbox` the row has `returned_at`, `folder` INBOX, `uid` 10; `result.returnedBelowCursor` 1; the folder check called `locateMessage` in `AI/Info` and found nothing; the cursor is unchanged; no new row; (1b) the same, but the mail is copied (not moved) back to INBOX UID 10 and stays in `AI/Info` → no `returned_at`, `result.copiesBelowCursor` 1, `returnedBelowCursor` 0, the row unchanged; (1c) the mail is back at INBOX UID 10 but carries `\Deleted` (fake `setFlags`) → no hit, no folder check; (2) the same with `moved_at` = now − 8 days → not checked (no `fetchByUidsIn` call, `returnedBelowCursor` 0); (3) a row with `folder` INBOX is not in the list; (4) 120 moved rows → two `fetchByUidsIn` calls; (5) another mail sits at INBOX UID 10 (identity differs) → no return; (6) a fake without `keepUidOnCopy` (RFC shape): the returned mail arrives above the cursor, the S1a path marks it (`result.returned` 1) and the below-cursor check finds no hit (`returnedBelowCursor` 0): exactly one `returned_at`.
    - `mail-repo.test.ts`: `listRecentlyMoved` filters by `org_id`, `mailbox_id`, folder, window and limit; order newest `moved_at` first: with three rows and `limit` 2 the two newest come back (test (4) of `mail-sync.test.ts` also checks that the first `fetchByUidsIn` chunk holds the newest rows).
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the tests pass.
  - Out of scope: the feedback row (stage 11), setting `moved_at` (stage 7/9: the committer).
