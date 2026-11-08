# sync-sort-folders — Stage 7a

Part of [`../sync-sort-folders.md`](../sync-sort-folders.md). Read that file's U3, D2, D4, D5, D6, D21 and "Rules for every step" first. Needs stages 2–6.

## Stage 7a — Sync loop per folder: discovery, new mail, errors [risky]

Why risky: sync on the user's only real mailbox. After this stage the sync reads every enabled synced folder and stores new mail with its source folder.
The cross-folder decisions (cross copy, relocated, returned into another folder) come in stage 7b; until then they fail safe (see Decisions).

- [ ] **7a.1 `syncMailbox` runs discovery and one `syncFolder` per row**
  - Goal: one cursor per folder, new mail stored with `folder` = `source_folder` = S, the D5 error rules, the D21 log lines.
  - Files: change `apps/server/src/modules/mail/sync.ts`, `apps/server/src/modules/mail/jobs.ts`, `apps/server/src/modules/mail/repo.ts`
    (`updateEmailUid` with an optional `opts: { isSource?: boolean }`, default `true`, so the existing `mail-repo.test.ts` calls keep working), `apps/server/src/modules/mail/index.ts`; tests
    `apps/server/test/integration/mail-sync.test.ts`, `apps/server/test/integration/mail-jobs.test.ts`, create `apps/server/test/integration/imap-sync-greenmail.test.ts`.
  - Interfaces:

    ```ts
    // apps/server/src/modules/mail/sync.ts
    export interface SyncResult {
      folder: SyncFolderKey;
      mode: "initial" | "incremental" | "rescan" | "backfill";
      fetched: number;
      stored: number;
      uidUpdated: number;
      returned: number;
      relocated: number;
      crossCopies: number;
      moveInFlight: number;
      returnedBelowCursor: number;
      copiesBelowCursor: number;
      skippedOwn: number;
      ignoredBelowCursor: number;
    }
    // The top-level SyncResult fields are the INBOX result, so the existing callers (mail-sync, mail-backfill, mail-seed, actions-* tests, jobs.ts)
    // keep reading `result.stored` and the other INBOX counts unchanged.
    export interface MailboxSyncResult extends SyncResult {
      folders: SyncResult[]; // every folder that synced, INBOX first
      failed: SyncFolderKey[]; // folders with an error (D5), never `inbox`
      skipped: SyncFolderKey[]; // rows whose path the server does not list
      added: SyncFolderKey[]; // rows that discovery inserted in this run
    }
    export async function syncMailbox(
      deps: SyncDeps,
      ctx: TenantContext,
      mailboxId: string
    ): Promise<MailboxSyncResult>;
    // backfillInbox: unchanged signature; its SyncResult gets folder "inbox" and the new zero counters; INBOX only (D16).
    ```

  - Decisions:
    - `syncMailbox`: (1) `getMailbox`; discovery in a `try`: `provider.listFolders()`; `reservedPaths` = the `folder_map` values of `drafts`, `sent`, `trash`
      and every `ai_*` key; `pickSyncFolders`; `ensureSyncFolders(…, deps.now())`; info line `sync <mb>: added sync folders <keys>` (comma-separated)
      when some were added. A `MailAuthError` rethrows; any other error → the D5 warn line, `listed` = null (every row counts as listed). (2)
      `listSyncFolders(enabledOnly: true)`. (3) For each row in order: `listed` not null and the path not in it → warn + `skipped`; else `syncFolder`.
      (4) Errors of `syncFolder`: `MailAuthError` → rethrow; the INBOX row → rethrow (as today); another row → the D21 warn line with
      `describeError(error)`, `failed`, go on. (5) One `RunState` for the whole run; `state.matched` is a `Map` (id → folder).
    - `syncFolder(deps, ctx, mailbox, row, state)`: today's `syncMailbox` body with `row.path` as S: `folderStatus(S)`; mode from the row's cursor (null →
      `initial`, another UIDVALIDITY → `rescan`); `fetchAbove(S, last_uid)` + `filterAboveCursor`, or `fetchSince(provider, S, since)` with 24 h (initial) /
      7 days (rescan); `planChunk` with S; `applyChunk` locks the folder row (`lockSyncFolder`), compares and writes its cursor (`updateFolderCursor`); after the
      last chunk of an initial or rescan run `setCursor` with `max(status.uidNext - 1, highest kept)` (D4 makes `uidNext - 1` the folder's highest UID).
      The below-cursor check runs only for INBOX in this stage (as today); stage 8 makes it per folder. One info line per folder (D21).
    - `planChunk` with S: the own-mail skip as today; `decideIncoming({ folder: S, … })`; `move_in_flight` → count, no write; `update_uid` → the write with
      `isSource` (`updateEmailUid(…, uid, { isSource })`: `inbox_uid` only when `isSource`); `new` → body from `fetchBodyText(S, uid)`, row with `folder` =
      `source_folder` = S; run copies go into `state.newKeys` and `state.matched` with S. For S ≠ INBOX, `check_folder` and `cross_copy` throw
      `HardError("cross-folder check: stage 7b")` (the folder fails safe with a warn line; the tests of this stage avoid these cases). For S = INBOX they
      behave as after stage 6.
    - `jobs.ts`: `markSynced` after `syncMailbox` returns (INBOX synced, D5); the job line sums `folders` (D21); the 3-runs `error` line (D5): a
      `Map<string, number>` in `createMailSyncJob` keyed `<mailboxId>:<key>`, +1 for each key in `failed`, reset to 0 when the key is in `folders`; at
      exactly 3 → one `log.error`.
  - Test (`mail-sync.test.ts`; fake in Interia mode unless named: `globalUids`, `keepUidOnUserMove`, `uidNextValue: 1`, no MOVE; `NOW` = `2026-11-08T12:00:00Z`;
    the INBOX cursor set with `updateCursor` as in the existing setup):
    1. First run after the deploy: INBOX cursor set, the fake lists `Oferty`, no `Oferty` row → `added` `["offers"]`; 2 `Oferty` mails at `NOW − 2 h` and
       `NOW − 20 h` are stored with `folder` = `source_folder` = `Oferty`; one at `NOW − 30 h` is not stored; the `Oferty` cursor = the highest `Oferty` UID; INBOX `incremental`.
    2. `Wiadomości-śmieci` with 3 mails at `NOW − 3 days` and none in 24 h → no row stored; its cursor = its highest UID (not 0); a second run stores nothing.
    3. A new mail in `Społeczności` above its cursor → stored, `status` pending; `fake` saw `fetchBodyText` with `Społeczności` (the call log with the folder, stage 5).
    4. A disabled `junk` row → not synced; discovery does not enable it.
    5. A row `bills` whose path the server no longer lists → `skipped` `["bills"]`, one warn line, INBOX synced; the job sets `last_synced_at`.
    6. The `offers` row has a cursor (incremental mode); a provider wrapper that throws `SoftError` from `fetchAbove` only for `Oferty` → INBOX stored, `failed` `["offers"]`, `junk` synced, the `Oferty` cursor
       unchanged; the next run (no failure) stores the `Oferty` mail once.
    7. A `SoftError` in INBOX → the run throws; no `Oferty` call in the call log.
    8. `resetUidValidity(9, "Oferty")` → `Oferty` mode `rescan` (7 days), INBOX `incremental`; known `Oferty` rows get `update_uid`, no new rows.
    9. `CursorMovedError` in the `Oferty` chunk (move its cursor in another transaction between plan and apply, as the existing INBOX test does) → warn,
       `failed` `["offers"]`, `junk` still syncs.
    10. A crash before the `Oferty` commit (the wrapper throws after `planChunk`, before `applyChunk`) → no row and no cursor change; the next run stores the mail once.
    11. Own sent mail (`X-EA-Action-Id` of an `actions` row) in `Oferty` → `skippedOwn` 1 in the `offers` result, no row.
    12. `folder_map` with `trash: "Oferty"` → no `offers` row is added.
    13. `listFolders` throws `HardError` → the discovery warn line; the existing rows sync (INBOX and an existing `offers` row).
    14. (`mail-jobs.test.ts`) `Oferty` fails 3 runs in a row → exactly one `error` line on the third run; a success resets the count (a 4th failure gives no line,
        the 3rd after the reset gives one).
    15. (`imap-sync-greenmail.test.ts`, GreenMail) create `Oferty`, APPEND 1 mail, run `syncMailbox` twice → 1 row with `source_folder` `Oferty`; the second run stores nothing.
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`
  - Done when: tests 1–15 pass and the existing sync, backfill, seed, jobs and actions tests pass. Existing tests that compare a whole result with
    `toEqual` (for example `mail-sync.test.ts` around line 440) get the new fields `folder`, `relocated`, `crossCopies`, `moveInFlight` (re-review n3).
  - Out of scope: cross copies, relocated, returned into another folder (stage 7b); the below-cursor check per folder (stage 8); actions (stage 10).
