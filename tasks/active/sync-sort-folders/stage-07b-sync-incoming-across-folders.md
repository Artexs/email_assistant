# sync-sort-folders — Stage 7b

Part of [`../sync-sort-folders.md`](../sync-sort-folders.md). Read that file's D5, D7, D8, D9 and "Rules for every step" first. Needs stage 7a.

## Stage 7b — Sync: cross copies, relocated, returned, move in flight across folders [risky]

Why risky: dedup across folders. A wrong decision stores a mail twice, loses its location, or writes a false "returned" (user feedback).

- [ ] **7b.1 The cross-folder writes of `planChunk` and `applyChunk`**
  - Goal: D7 and D8 for every synced folder S, with the run state shared by all folders (review M1).
  - Files: change `apps/server/src/modules/mail/sync.ts`, `apps/server/src/modules/mail/repo.ts`, `apps/server/src/modules/mail/index.ts` (exports if needed);
    tests `apps/server/test/integration/mail-sync.test.ts`, `apps/server/test/integration/mail-repo.test.ts`.
  - Interfaces:

    ```ts
    // apps/server/src/modules/mail/repo.ts
    // returned (D8): folder = source_folder = opts.folder, uid = inbox_uid = uid, returned_at = at; only WHERE folder <> source_folder.
    // Replaces the `onlyOutsideInbox` option (the guard is now always on).
    export async function markEmailReturned(
      db: DbOrTrx,
      ctx: TenantContext,
      emailId: string,
      uid: number,
      at: Date,
      opts: { folder: string }
    ): Promise<boolean>;
    // relocated (D8): folder = source_folder = change.to, uid = inbox_uid = change.uid; only WHERE folder = source_folder AND folder = change.from.
    export async function markEmailRelocated(
      db: DbOrTrx,
      ctx: TenantContext,
      emailId: string,
      change: { from: string; to: string; uid: number }
    ): Promise<boolean>;
    // apps/server/src/modules/mail/sync.ts
    type Write =
      | { kind: "insert"; row: NewEmail }
      | { kind: "update_uid"; emailId: string; uid: number; isSource: boolean }
      | { kind: "returned"; emailId: string; uid: number; folder: string }
      | { kind: "relocated"; emailId: string; uid: number; from: string; to: string };
    ```

  - Decisions:
    - `planChunk` for every S: the run copies in `copies` carry the folder and UID where this run stored them (`state.newKeys`: base key →
      `{ dedupKey, folder, uid }[]`; id `run:<dedup key>`), and they are in `state.matched` with that folder. `state.matched` gets the email id with S for:
      `update_uid`, `returned`, `relocated`, and a `check_folder` that ends `new` (the checked row, as today). It gets **nothing** for `cross_copy` and
      `move_in_flight` (re-review n4: else a rescan would turn the row's own folder pass into a cross copy and leave its UID stale).
    - `check_folder` → `locateMessage(provider, decision.folder, key, { excludeUids: otherCopyUids(copies, id, decision.folder) })` (as today) →
      `resolveFolderCheck({ …, systemMoved, seenElsewhere })` → `returned` (write with `folder` S), `relocated` (write with `from` = the copy's folder, `to` S),
      `cross_copy` (count `crossCopies`, `log.debug` with the email id and the folder key, no write), `new` (insert). `decideIncoming` `cross_copy` → the same count, no locate.
    - `applyChunk` counts only writes that changed a row (`markEmailReturned` / `markEmailRelocated` false → 0; a debug line with the email id).
    - The below-cursor check (S3 D4, still INBOX-only until stage 8) calls `markEmailReturned(…, { folder: INBOX })`.
    - Remove the stage 7a `HardError("cross-folder check: stage 7b")`.
  - Test (`mail-sync.test.ts`; Interia-mode fake unless named; `NOW` = `2026-11-08T12:00:00Z`):
    1. Cross copy: a row in INBOX (source INBOX) and the same mail delivered into `Oferty` (new UID) → the `Oferty` run stores nothing;
       `crossCopies` 1 in the `offers` result.
    2. Same run, both new: the same mail in INBOX and in `Oferty` → INBOX stores it, the `Oferty` run counts a cross copy and makes no `fetchMetaIn` /
       `searchSinceIn` call for it (call log).
    3. Rescan of INBOX and `Oferty` in one run (`forceRescan`) while the `anna` case exists (a row in INBOX, a copy in `Oferty`) → INBOX `update_uid`, `Oferty`
       `crossCopies` 1, no new row (review M1).
    4. Relocated (fake without `keepUidOnUserMove`): a row in INBOX; `userMove(INBOX, uid, "Oferty")` (new UID above the `Oferty` cursor) → the row has
       `folder` = `source_folder` = `Oferty`, the new uid and `inbox_uid`, `returned_at` null; no new row; `relocated` 1; no `triage_feedback` row.
    5. Returned into the source above its cursor (fake without `keepUidOnUserMove`): a row in `AI/Info` with source `Oferty` and `moved_at`; the user moves
       it back into `Oferty` → `folder` = `source_folder` = `Oferty`, `returned_at` = `NOW`; `returned` 1.
    6. A returned in INBOX (a row in `AI/Info` with source INBOX, moved back into INBOX above the cursor) and the same mail also in `Oferty` → INBOX `returned` 1,
       `Oferty` `crossCopies` 1, no new row (review M1).
    7. Returned into another synced folder: a row in `AI/Info` with source INBOX that the user moves into `Oferty` above its cursor → `folder` = `source_folder`
       = `Oferty`, `returned_at` set (D8: counts as a return).
    8. Move in flight: a row with `undo_pending_at` = `NOW − 1 min`; its copy appears in INBOX and in `Oferty` → nothing stored; `moveInFlight` 1 in each;
       no locate call.
    9. Two identical copies in `Oferty` in one run (no row yet) → two rows (`<base>` and `<base>#2`), as the old INBOX rule.
    10. Rescan of INBOX and `Oferty` with a row R1 in `Oferty` (source `Oferty`) and a copy of it in INBOX → the INBOX pass gives `cross_copy`; the `Oferty`
        pass gives `update_uid` on R1 (its new UID after `resetUidValidity`), not a cross copy (re-review n4).
    11. (`mail-repo.test.ts`) `markEmailRelocated` with a wrong `from` → false, no change; with another organization's context → false; `markEmailReturned` on a
        row with `folder = source_folder` → false; with another organization's context → false.
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`
  - Done when: tests 1–11 pass and the stage 7a tests still pass.
  - Out of scope: the below-cursor check per source folder (stage 8); actions (stage 10).
