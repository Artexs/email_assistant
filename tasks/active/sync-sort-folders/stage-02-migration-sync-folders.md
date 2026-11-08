# sync-sort-folders — Stage 2

Part of [`../sync-sort-folders.md`](../sync-sort-folders.md). Read that file's D1, D3, D6, D17 and "Rules for every step" first.

## Stage 2 — Migration `sync_folders`; the INBOX cursor in `mailbox_folders` [risky]

Why risky: a migration on the live pilot DB, and the sync cursor moves to a new table. The behaviour of the sync must not change in this stage (INBOX only).

- [ ] **2.1 Migration, schema types, INBOX cursor through the folder row (dual write)**
  - Goal: the new table and column exist; every mailbox has an INBOX row with its cursor; the INBOX sync and the backfill read and write that row and also
    write the old `mailboxes` columns in the same transaction (D3). No other behaviour change.
  - Files: create `db/migrations/<YYYYMMDDHHMMSS>_sync_folders.sql` (the UTC time of the build; it must sort after `20261108000001_delegation.sql` and must
    not equal a version in `db/migrations/` of `origin/master` at build time); regenerate `apps/server/src/platform/db/schema.ts` (`bun run db:types`, never by hand);
    change `apps/server/src/modules/mail/repo.ts`, `apps/server/src/modules/mail/sync.ts`, `apps/server/src/modules/mail/connect.ts`,
    `apps/server/src/modules/mail/index.ts`; tests: `apps/server/test/integration/mail-schema.test.ts`, `apps/server/test/integration/mail-repo.test.ts`,
    `apps/server/test/integration/fixtures.ts` (`createOrgWithMailbox` inserts the INBOX row), `apps/server/test/integration/mail-sync.test.ts`,
    `apps/server/test/integration/mail-backfill.test.ts`, `apps/server/test/integration/mail-connect.test.ts`.
  - Interfaces:

    ```sql
    -- migrate:up
    CREATE TABLE mailbox_folders (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL,
      mailbox_id uuid NOT NULL,
      key text NOT NULL CHECK (key ~ '^[a-z][a-z_]{0,19}$'),
      path text NOT NULL CHECK (length(path) BETWEEN 1 AND 200),
      role text NOT NULL CHECK (role IN ('inbox', 'sort', 'junk')),
      enabled boolean NOT NULL DEFAULT true,
      uidvalidity bigint,
      last_uid bigint,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (mailbox_id, org_id) REFERENCES mailboxes (id, org_id) ON DELETE CASCADE,
      UNIQUE (mailbox_id, key),
      UNIQUE (mailbox_id, path),
      CONSTRAINT mailbox_folders_inbox_key_check CHECK ((key = 'inbox') = (role = 'inbox')),
      CONSTRAINT mailbox_folders_inbox_row_check CHECK (role <> 'inbox' OR (path = 'INBOX' AND enabled))
    );
    CREATE UNIQUE INDEX mailbox_folders_one_junk_idx ON mailbox_folders (mailbox_id) WHERE role = 'junk';
    CREATE INDEX mailbox_folders_org_id_idx ON mailbox_folders (org_id);

    INSERT INTO mailbox_folders (org_id, mailbox_id, key, path, role, uidvalidity, last_uid)
    SELECT org_id, id, 'inbox', 'INBOX', 'inbox', uidvalidity, last_uid FROM mailboxes;

    ALTER TABLE emails ADD COLUMN source_folder text NOT NULL DEFAULT 'INBOX';
    DROP INDEX emails_moved_idx;
    CREATE INDEX emails_moved_idx ON emails (mailbox_id, moved_at) WHERE folder <> source_folder;

    -- migrate:down
    DROP INDEX emails_moved_idx;
    CREATE INDEX emails_moved_idx ON emails (mailbox_id, moved_at) WHERE folder <> 'INBOX';
    ALTER TABLE emails DROP COLUMN source_folder;
    DROP TABLE mailbox_folders;
    ```

    ```ts
    // apps/server/src/modules/mail/repo.ts
    // The one row type of the table (stage 4 adds the other queries). Stage 2 is built before stage 3, so `key` and `role` are `string` here;
    // stage 4 narrows them to SyncFolderKey / SyncFolderRole (z.enum of stage 3) in the same type.
    export interface SyncFolderRow {
      id: string;
      mailbox_id: string;
      key: string;
      path: string;
      role: string;
      enabled: boolean;
      uidvalidity: number | null;
      last_uid: number | null;
    }
    export async function insertInboxFolder(db: DbOrTrx, ctx: TenantContext, mailboxId: string): Promise<void>; // ON CONFLICT DO NOTHING
    export async function getSyncFolder(
      db: DbOrTrx,
      ctx: TenantContext,
      mailboxId: string,
      key: string
    ): Promise<SyncFolderRow | undefined>;
    export async function lockSyncFolder(
      trx: Transaction<DB>,
      ctx: TenantContext,
      folderId: string
    ): Promise<SyncFolderRow | undefined>; // FOR UPDATE
    // CAS on the folder row (uidvalidity and last_uid `is not distinct from` expected). When the row is the INBOX row it also sets
    // mailboxes.uidvalidity and last_uid to `next` in the same statement order inside the caller's transaction (D3 dual write).
    export async function updateFolderCursor(
      db: DbOrTrx,
      ctx: TenantContext,
      folderId: string,
      expected: Cursor,
      next: Cursor
    ): Promise<boolean>;
    // Kept with its signature: now the CAS of the mailbox's INBOX row (via getSyncFolder + updateFolderCursor). The tests that set an INBOX cursor
    // (actions-end-to-end, actions-move, actions-undo, mail-backfill, mail-repo, mail-sync) keep calling it unchanged.
    export async function updateCursor(
      db: DbOrTrx,
      ctx: TenantContext,
      mailboxId: string,
      expected: Cursor,
      next: Cursor
    ): Promise<boolean>;
    ```

  - Decisions:
    - The sync no longer uses `lockMailbox` (it stays for `connect.ts`): `syncMailbox` and `backfillInbox` read the INBOX row with
      `getSyncFolder(…, "inbox")` (a missing row → `HardError("mailbox has no INBOX folder row")`), and `applyChunk`, `setCursor` and the below-cursor
      transaction (S3 D4, `checkReturnedBelowCursor`) lock the
      folder row with `lockSyncFolder`, compare its cursor and write it with `updateFolderCursor`.
    - The dual write: `updateFolderCursor` runs the folder-row CAS first; when it changed one row and `key = 'inbox'`, it updates `mailboxes` (`uidvalidity`,
      `last_uid`) of that mailbox with `org_id` filter. A `DbOrTrx` that is not a transaction is wrapped in one (as `applyChunk` does), so both writes commit together.
    - `insertEmail` sets `source_folder` from the new row (`NewEmail.source_folder`; `newRow` in `sync.ts` sets it to `INBOX` in this stage).
    - `connectMailbox` calls `insertInboxFolder` in its transaction, after `insertMailbox`. The fixture `createOrgWithMailbox` does the same.
    - `forceRescan` sets `uidvalidity = 0` on every folder row of the mailbox where it is not null, and on `mailboxes` (dual write). Return true when at least
      one folder row changed.
    - The `MailboxRow` type keeps `uidvalidity` and `last_uid` (the columns stay); no sync code reads them after this stage (grep `uidvalidity` and `last_uid`
      in `apps/server/src`: only `repo.ts` dual write and `toMailboxRow`).
    - The migration has no data change other than the INBOX rows and the default column. Existing rows: `source_folder` = `INBOX`.
  - Test:
    1. (manual, on the worktree DB, before the commit) `bun run db:rollback` (back to `20261108000001`), insert with `psql` one mailbox with
       `uidvalidity 7, last_uid 120` and one with null cursor, plus 2 emails (one `folder 'INBOX'`, one `folder 'AI/Info'` with `moved_at` set); run
       `bun run db:migrate`; then: 2 INBOX rows with `(7, 120)` and `(null, null)`; both emails have `source_folder = 'INBOX'`; then
       `bun run db:rollback && bun run db:migrate` works twice in a row. Write the commands and the output into the stage log line.
    2. (`mail-schema.test.ts`) a row with role `inbox` and key `offers` → check error `mailbox_folders_inbox_key_check`; key `inbox` with path `Oferty` →
       `mailbox_folders_inbox_row_check`; a disabled INBOX row → the same check; a second `junk` row of one mailbox → unique error; the same path twice → unique error.
    3. (`mail-schema.test.ts`) `pg_indexes.indexdef` of `emails_moved_idx` contains `folder <> source_folder`.
    4. (`mail-repo.test.ts`) `updateFolderCursor` on the INBOX row: expected matches → true, the row and `mailboxes` hold `next`; a mismatch → false and
       nothing changes; the row id of another organization → false.
    5. (`mail-repo.test.ts`) `updateFolderCursor` on a non-INBOX row (insert one with SQL in the test) → `mailboxes` does not change.
    6. (`mail-repo.test.ts`) `insertInboxFolder` twice → one row; `getSyncFolder` with another organization's context → `undefined`. (The integration tests
       connect as `app`, so they also prove the default grants of the new table, `20261103000001_app_grants.sql`.)
    7. (`mail-connect.test.ts`) after `connectMailbox` the mailbox has one INBOX row with null cursor.
    8. (`mail-sync.test.ts`, `mail-backfill.test.ts`) the existing cases pass unchanged: their `updateCursor(…, mailboxId, …)` setup now writes the INBOX row
       (and `mailboxes`); one new case: after an incremental sync `mailboxes.last_uid` equals the INBOX row's `last_uid`. Exception (independent review m4):
       the two `CursorMovedError` cases that move the cursor with `trx.updateTable("mailboxes").set({ last_uid: 99 })` (`mail-sync.test.ts` near lines 522
       and 1141) now set `last_uid` 99 on the INBOX row of `mailbox_folders` (the sync no longer reads `mailboxes`); name both in the step log line.
    9. `forceRescan` → every folder row with a cursor and `mailboxes` have `uidvalidity` 0; the next sync rescans INBOX (existing rescan test).
  - Check: `bun run db:migrate && bun run db:types && bun run lint && bun run typecheck && bun run test:unit && bun run test:int`; test 1 by hand.
  - Done when: tests 1–9 pass; `git diff --stat` shows no change to old migrations.
  - Out of scope: other folders in the sync (stage 7a); discovery (stage 4); renames of `inbox_uid` or `undo_pending_at` (D3: they stay).
