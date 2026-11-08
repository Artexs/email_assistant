# sync-sort-folders — Stage 8

Part of [`../sync-sort-folders.md`](../sync-sort-folders.md). Read that file's F3, D6, D7, D8 and "Rules for every step" first. Needs stages 7a and 7b.

## Stage 8 — Sync: user moves and returns across folders (relocated, returned, below the cursor) [risky]

Why risky: the "returned" signal writes user feedback (`triage.returned` → `wrong`). A false return hurts the metric; a missed one hides a wrong move.

- [ ] **8.1 The below-cursor return check (S3 D4) per source folder; the Interia keep-UID cases**
  - Goal: a system-moved mail that the user puts back into its source folder with the same UID (Interia webmail, F3) is found below that folder's cursor, for every synced folder.
  - Files: change `apps/server/src/modules/mail/sync.ts` (`checkReturnedBelowCursor`, `isStillInFolder`), `apps/server/src/modules/mail/repo.ts`
    (`listRecentlyMoved`), tests `apps/server/test/integration/mail-sync.test.ts`, `apps/server/test/integration/mail-repo.test.ts`,
    `apps/server/test/integration/triage-returned.test.ts` (one end-to-end case).
  - Interfaces:

    ```ts
    // apps/server/src/modules/mail/repo.ts
    // Rows of the mailbox with folder <> source_folder, source_folder = opts.sourceFolder, inbox_uid not null, moved_at >= movedAfter;
    // newest moved_at first, then id; at most `limit`.
    export async function listRecentlyMoved(
      db: DbOrTrx,
      ctx: TenantContext,
      mailboxId: string,
      opts: { sourceFolder: string; movedAfter: Date; limit: number }
    ): Promise<MovedRow[]>;
    // apps/server/src/modules/mail/sync.ts
    async function checkReturnedBelowCursor(
      deps: SyncDeps,
      ctx: TenantContext,
      mailboxId: string,
      folder: SyncFolderRow,
      cursor: Cursor,
      result: SyncResult
    ): Promise<void>;
    ```

  - Decisions:
    - `syncFolder` runs the check after every incremental run of every folder (not only INBOX), with `sourceFolder` = the row's path. Window 7 days, limit 500,
      chunks of 100 (the existing constants).
    - In the check, the UIDs come from `inbox_uid` and `uid` of each row; the metas from `fetchByUidsIn(S, uids)`; `matchReturned` as today; the
      exclusion with `listFolderUids(…, S, …)`; `isStillInFolder` in the row's `folder` as today; the write `markEmailReturned(…, { folder: S })` inside a
      transaction that locks the folder row and compares its cursor (a `CursorMovedError` there → warn, stop the check, as today).
    - The log line keeps its shape and adds the folder key: `sync <mb> folder <key> returned below cursor: checked n, returned n, copies n`.
    - A return into a synced folder that is not the row's source, below that folder's cursor, is not seen (known limit, follow-up
      `tasks/planned/sync-return-to-other-folder.md`, stage 15).
  - Test (fake in Interia mode: `globalUids`, `keepUidOnUserMove`, `uidNextValue: 1`, no MOVE):
    1. A row with `folder` `AI/Info`, `source_folder` `Oferty`, `inbox_uid` 40, `uid` 52, `moved_at` = `NOW − 1 h`; the user moves it back from `AI/Info` into
       `Oferty` (keeps UID 52, below the `Oferty` cursor 60) → after the `Oferty` run: `returned_at` set, `folder` `Oferty`, `returnedBelowCursor` 1.
    2. The same row, but the mail is still in `AI/Info` and an identical copy sits in `Oferty` at UID 52 → `copiesBelowCursor` 1, no write.
    3. A row with source INBOX and a return into INBOX below the INBOX cursor → as the existing S3 test (INBOX run), unchanged.
    4. A row with source INBOX that the user moves from `AI/Info` into `Oferty` keeping the UID below the `Oferty` cursor → nothing changes (known limit; the test pins it).
    5. `listRecentlyMoved` with `sourceFolder` `Oferty` leaves out rows with source INBOX, rows with `folder = source_folder`, rows older than 7 days, and rows of another organization.
    6. A rescued row (`folder` INBOX, `source_folder` `Wiadomości-śmieci`, `moved_at` set) that the user moves back into `Wiadomości-śmieci` keeping the
       UID → the `junk` run marks it returned (`folder` = `Wiadomości-śmieci`).
    7. The check of the `Oferty` run does not fetch INBOX (`fake.folderCalls` shows `fetchByUidsIn` only with `Oferty` and `searchSinceIn`/`fetchMetaIn` only with the row folders).
    8. (`triage-returned.test.ts`) after test 1, `triage.returned` sets the move `undone` (`user_moved_back`) and writes one `wrong` feedback row (`imap_move`),
       as for INBOX mail.
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`
  - Done when: tests 1–8 pass; the existing below-cursor tests pass.
  - Out of scope: actions (stage 10); `mailbox:audit` (stage 13).
