# sync-sort-folders — Stage 4

Part of [`../sync-sort-folders.md`](../sync-sort-folders.md). Read that file's D1, D2, D3, D16, D19 and "Rules for every step" first. Needs stages 2 and 3.

## Stage 4 — Folder repository: list, discovery insert, switch, rescan, junk path [risky]

Why risky: tenant isolation and data integrity (the rows decide which folders of the user's mailbox the app reads).

- [x] **4.1 Repository functions of `mailbox_folders` and the two audit events**
  - Goal: typed queries that the sync loop (stage 7a), the triage (stage 11) and the tools (stage 13) use.
  - Files: change `apps/server/src/modules/mail/repo.ts` (one query per function), create `apps/server/src/modules/mail/folders.ts` (the two functions that
    write an audit row: transaction + audit, like `connect.ts`), change `apps/server/src/modules/mail/index.ts`, `apps/server/src/modules/audit/repo.ts`
    (two event names), `apps/server/test/integration/mail-repo.test.ts`, create `apps/server/test/integration/mail-folders.test.ts`.
  - Interfaces:

    ```ts
    // apps/server/src/modules/mail/repo.ts
    import type { SyncFolderDefault, SyncFolderKey, SyncFolderRole } from "@ea/core";
    // The type of stage 2, narrowed here (one type for the table; every reader of stage 2 keeps compiling):
    export interface SyncFolderRow {
      id: string;
      mailbox_id: string;
      key: SyncFolderKey; // parsed with z.enum(syncFolderKeys); an unknown key in the DB throws HardError
      path: string;
      role: SyncFolderRole; // parsed with z.enum(syncFolderRoles)
      enabled: boolean;
      uidvalidity: number | null;
      last_uid: number | null;
    }
    // Order: role inbox, then sort rows in SYNC_FOLDER_DEFAULTS order (offers, social, bills), then junk.
    export async function listSyncFolders(
      db: DbOrTrx,
      ctx: TenantContext,
      mailboxId: string,
      opts: { enabledOnly: boolean }
    ): Promise<SyncFolderRow[]>;
    // One INSERT … ON CONFLICT DO NOTHING (any unique key) … RETURNING key, role. Never changes an existing row.
    export async function insertSyncFolders(
      db: DbOrTrx,
      ctx: TenantContext,
      mailboxId: string,
      picks: readonly (SyncFolderDefault | { key: "inbox"; path: string; role: "inbox" })[], // built: also the INBOX repair pick
      at: Date
    ): Promise<{ key: SyncFolderKey; role: SyncFolderRole }[]>;
    export async function lockSyncFolderByKey(
      trx: Transaction<DB>,
      ctx: TenantContext,
      mailboxId: string,
      key: SyncFolderKey
    ): Promise<SyncFolderRow | undefined>;
    // Sets `enabled` and `updated_at`; with `clearCursor` also uidvalidity = last_uid = null.
    export async function updateSyncFolderEnabled(
      trx: Transaction<DB>,
      ctx: TenantContext,
      folderId: string,
      change: { enabled: boolean; clearCursor: boolean; at: Date }
    ): Promise<boolean>;
    // The path of the junk row (also when it is disabled), else null (D13).
    export async function getJunkFolderPath(db: DbOrTrx, ctx: TenantContext, mailboxId: string): Promise<string | null>;

    // apps/server/src/modules/mail/folders.ts
    // Inserts the missing INBOX row and picks; one `mailbox.sync_folder_added` audit row per inserted row, in one transaction. Returns the inserted keys.
    // An unknown mailbox (getMailbox undefined) → HardError("mailbox not found").
    export async function ensureSyncFolders(
      db: DbOrTrx,
      ctx: TenantContext,
      mailboxId: string,
      picks: readonly SyncFolderDefault[],
      at: Date
    ): Promise<SyncFolderKey[]>;
    export type SyncFolderSwitchResult = "changed" | "same" | "not_found";
    // Not for `inbox` (the type excludes it). Off → on clears the cursor (a new 24 h first sync, U3).
    // One `mailbox.sync_folder_changed` audit row per change, in the same transaction; `same` writes nothing.
    export async function setSyncFolderEnabled(
      db: DbOrTrx,
      ctx: TenantContext,
      mailboxId: string,
      key: Exclude<SyncFolderKey, "inbox">,
      enabled: boolean,
      actor: "cli" | "system", // the audit actor (stage 4 review, 2026-11-09: `mailbox:settings` passes "cli")
      at: Date
    ): Promise<SyncFolderSwitchResult>;
    ```

    ```ts
    // apps/server/src/modules/audit/repo.ts (auditEvents)
    mailboxSyncFolderAdded: "mailbox.sync_folder_added",     // data: mailbox_id, folder_key, role
    mailboxSyncFolderChanged: "mailbox.sync_folder_changed", // data: mailbox_id, folder_key, enabled
    ```

  - Decisions:
    - All functions filter `org_id = ctx.orgId` and `mailbox_id`. `updated_at` = `at` on every change.
    - `ensureSyncFolders` runs in one transaction (`db.isTransaction ? db : db.transaction()`), calls `insertSyncFolders` with the INBOX row first (key
      `inbox`, path `INBOX`, role `inbox`) and the picks, and audits only the returned non-INBOX keys (an INBOX row added here is a repair: no audit row).
      The audit `data` holds the key and the role, never the path (code rule: folder keys in audit rows).
    - `setSyncFolderEnabled` locks the row with `lockSyncFolderByKey`, compares, calls `updateSyncFolderEnabled`, audits. `forceRescan` (stage 2) stays as it is.
    - `listSyncFolders` sorts in SQL with `CASE role WHEN 'inbox' THEN 0 WHEN 'sort' THEN 1 ELSE 2 END` and then by the index of the key in
      `SYNC_FOLDER_DEFAULTS` (pass it as a `CASE key …` built from the constant), then `key`.
  - Test (`mail-repo.test.ts` for the queries, `mail-folders.test.ts` for the two service functions; two organizations A and B from `createOrgWithMailbox`):
    1. `listSyncFolders` of a new mailbox → one INBOX row; with B's context → `[]`.
    2. `ensureSyncFolders(A, picks offers, junk)` → returns `["offers", "junk"]`; `listSyncFolders` → `inbox`, `offers`, `junk` in this order; 2 audit rows
       `mailbox.sync_folder_added` with `folder_key` and `role`, no `path` in `data`.
    3. A second call with `offers`, `social` → returns `["social"]`; 1 new audit row.
    4. A disabled `offers` row stays disabled and keeps its cursor after `ensureSyncFolders` with `offers`.
    5. `setSyncFolderEnabled(offers, false)` → `changed`, row disabled, 1 audit row; again → `same`, no audit row; `listSyncFolders(enabledOnly)` leaves it out.
    6. A row with cursor `(1, 500)` off then on → `changed` twice; after on the cursor is `(null, null)`.
    7. `setSyncFolderEnabled` for a key that has no row → `not_found`; with B's context on A's mailbox → `not_found`.
    8. `getJunkFolderPath` → null before; `Wiadomości-śmieci` after the junk row exists; the same while it is disabled; B's context → null.
    9. `ensureSyncFolders` with B's context and A's mailbox id → `HardError("mailbox not found")`, no row inserted.
    10. `insertSyncFolders` with B's context on A's mailbox → the foreign key `(mailbox_id, org_id)` refuses it (error), no row. Run this insert in its own
        `db.transaction().execute(…)` outside `withRollback` and expect the rejection (the failed transaction rolls back by itself; inside `withRollback` the
        error would abort the shared test transaction). `lockSyncFolderByKey` with B's context on A's mailbox → `undefined`.
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`
  - Done when: tests 1–10 pass.
  - Out of scope: the sync loop that calls `ensureSyncFolders` (stage 7a); the CLI (stage 13).
