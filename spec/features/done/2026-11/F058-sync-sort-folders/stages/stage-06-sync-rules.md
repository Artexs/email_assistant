# sync-sort-folders — Stage 6

Part of [`../plan.md`](../plan.md). Read that file's D6, D7, D8, D9 and "Rules for every step" first.

## Stage 6 — Sync rules across folders (pure) [risky]

Why risky: dedup. These pure rules decide whether a mail is new, a copy, moved by the user, or returned. Stages 7a, 7b and 8 only apply them.

- [x] **6.1 `decideIncoming`, `resolveFolderCheck`, `matchReturned` for a synced folder S**
  - Goal: D7 as pure functions with full unit tests.
  - Files: change `apps/server/src/modules/mail/sync-rules.ts`, `apps/server/src/modules/mail/sync-rules.test.ts`, `apps/server/src/modules/mail/repo.ts`
    (only the `KnownCopy` mapping in `findCopies` and the `MovedRow` type), `apps/server/src/modules/mail/sync.ts` (only to compile: pass `folder: INBOX`
    and map the new decision kinds to today's writes, see Decisions).
  - Interfaces:

    ```ts
    // apps/server/src/modules/mail/sync-rules.ts
    export interface KnownCopy {
      id: string;
      dedupKey: string;
      folder: string;
      /** emails.source_folder (D6). */
      sourceFolder: string;
      /** The UID the row holds in `folder`. */
      uid: number;
      contentHash: string;
      from: string | null;
      receivedAt: Date;
      /** emails.undo_pending_at: a system move into a synced folder is in flight (D9). */
      movePendingAt: Date | null;
    }
    export const MOVE_PENDING_MAX_AGE_MS = 24 * 3_600_000; // replaces UNDO_PENDING_MAX_AGE_MS
    export type IncomingDecision =
      | { kind: "move_in_flight"; emailId: string }
      | { kind: "update_uid"; emailId: string; isSource: boolean }
      | { kind: "check_folder"; emailId: string; folder: string; systemMoved: boolean; seenElsewhere: boolean }
      | { kind: "cross_copy"; emailId: string } // a copy seen elsewhere in this run, no locate (review M1)
      | { kind: "new"; dedupKey: string };
    export function decideIncoming(input: {
      folder: string; // S: the synced folder of the incoming mail
      baseKey: string;
      copies: KnownCopy[];
      /** Email id (or `run:<dedup key>` of a row that this run stored) → the folder where this run matched or stored it (D5, D7). */
      matched: ReadonlyMap<string, string>;
      now: Date;
    }): IncomingDecision;
    export type FolderCheckResult =
      | { kind: "returned"; emailId: string }
      | { kind: "relocated"; emailId: string }
      | { kind: "cross_copy"; emailId: string }
      | { kind: "new"; dedupKey: string };
    export function resolveFolderCheck(input: {
      emailId: string;
      stillInFolder: boolean;
      systemMoved: boolean;
      seenElsewhere: boolean;
      baseKey: string;
      copyCount: number;
    }): FolderCheckResult;

    // apps/server/src/modules/mail/repo.ts
    export interface MovedRow {
      id: string;
      uid: number; // the UID in `folder`
      inbox_uid: number | null; // the last known UID in source_folder (D3: the name stays)
      folder: string;
      source_folder: string;
      message_id_header: string | null;
      content_hash: string;
      from_address: string | null;
      received_at: Date;
      moved_at: Date;
    }
    ```

  - Decisions:
    - `decideIncoming` order (D7): `seenElsewhere` = some copy id is in `matched` with a folder ≠ S. (1) a copy (matched or not) with `movePendingAt` and
      `now - movePendingAt < MOVE_PENDING_MAX_AGE_MS` → `move_in_flight` (its id); (2) the free copies (id not in `matched`) sorted by copy number
      (`copyNumber` as today); the first with `folder === S` → `update_uid`, `isSource = folder === sourceFolder`; (3) the first free copy → `check_folder`
      in its `folder`, `systemMoved = folder !== sourceFolder`, `seenElsewhere`; (4) no free copy and `seenElsewhere` → `cross_copy` (the id of the first copy
      matched elsewhere); (5) else `new` with `copyDedupKey(baseKey, copies.length + 1)` (also when all copies were matched in S: two identical copies in S).
    - The caller puts run copies (rows that this run stored) into `copies` with id `run:<dedup key>` and into `matched` with the folder where they were stored,
      so a run copy is never free: it is never located and never `relocated`.
    - `resolveFolderCheck`: `systemMoved` and still there → `cross_copy` when `seenElsewhere`, else `new` with `copyDedupKey(baseKey, copyCount + 1)`;
      `systemMoved` and gone → `returned`; not `systemMoved` and still there → `cross_copy`; not `systemMoved` and gone → `relocated`. The D22 branch of S3
      (`undo_in_flight`) is removed: the marker is checked in `decideIncoming` (D9).
    - `matchReturned(metas, rows)`: the logic does not change; `metas` now come from each row's `source_folder` (stage 8), and the doc comment says so.
    - `findCopies` selects `source_folder` and maps `undo_pending_at` to `movePendingAt`.
    - `sync.ts` in this stage (no behaviour change for INBOX): `state.matched` becomes a `Map` (id → `INBOX`); it passes `folder: INBOX`; `move_in_flight` →
      count in `result.undoInFlight` (rename the field to `moveInFlight`), store nothing; `update_uid` → today's write; `check_folder` → today's locate, then
      `resolveFolderCheck`; `returned` → today's `returned` write; `new` → insert; `relocated` and `cross_copy` (both kinds) cannot happen while only INBOX
      is synced (every copy's source is INBOX, a copy in INBOX is `update_uid`, and nothing is matched in another folder): throw
      `HardError("unexpected folder check result")` for them until stage 7b replaces this.
  - Test (`sync-rules.test.ts`; `now` = `2026-11-08T12:00:00Z`; copies built with a helper `copy({ id, key, folder, sourceFolder, movePendingAt })`):
    1. S `INBOX`, one copy in `INBOX` (source `INBOX`) → `update_uid`, `isSource` true.
    2. S `INBOX`, one copy in `INBOX` with source `Wiadomości-śmieci` (a rescued mail) → `update_uid`, `isSource` false.
    3. S `Oferty`, one copy in `INBOX` (source `INBOX`) → `check_folder` `INBOX`, `systemMoved` false.
    4. S `Oferty`, one copy in `AI/Info` (source `INBOX`) → `check_folder` `AI/Info`, `systemMoved` true.
    5. A copy with `movePendingAt` = `2026-11-08T11:00:00Z` → `move_in_flight`, also when it is in `matched`; `movePendingAt` = `2026-11-07T11:00:00Z` (25 h) → the rules 2–4 apply.
    6. Copies `#1` in `AI/Info` (source `INBOX`) and `#2` in `Oferty` (source `Oferty`), S `Oferty` → `update_uid` on `#2`.
    7. S `Oferty`, the only copy in `Oferty` is in `matched` with `Oferty` → the next free copy or `new`; with no other copy → `new` with key `<base>#2`.
    8. No copies → `new` with the base key.
    9. `resolveFolderCheck`: (systemMoved, still) → `new` `<base>#3` for `copyCount` 2; (systemMoved, still, seenElsewhere) → `cross_copy`; (systemMoved, gone)
       → `returned`; (source, still) → `cross_copy`; (source, gone) → `relocated`.
    10. The existing `matchReturned` tests pass with `MovedRow.source_folder` added.
    11. The existing INBOX-only tests of `decideIncoming` pass after their inputs get `folder: "INBOX"` and `sourceFolder: "INBOX"`.
    12. An existing test (`sync-rules.test.ts`, `mail-sync.test.ts` or `actions-undo.test.ts`) that expects `returned` (or a stored copy) for a mail whose
        row has a fresh `undo_pending_at` now expects "store nothing" (`moveInFlight` + 1): the D9 change. List each changed test in the step log line.
    13. S `Oferty`; the only copy `#1` (folder INBOX, source INBOX) is in `matched` with `INBOX` (the INBOX pass of this run matched it) → `cross_copy` `#1`,
        no `check_folder` (a rescan or a `returned` in INBOX before, review M1).
    14. S `Oferty`; copy `#1` free in `AI/Info` (source INBOX) and copy `#2` matched in INBOX → `check_folder` `AI/Info` with `seenElsewhere` true.
    15. S `Oferty`; a run copy `run:<base>` stored in INBOX (in `matched` with `INBOX`) → `cross_copy`; S `INBOX` with the same run copy matched in INBOX
        → `new` `<base>#2` (two identical copies in one folder, old rule).
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`
  - Done when: tests 1–15 pass; `test:int` (INBOX sync) passes unchanged.
  - Out of scope: the writes of `relocated`, `returned` into another folder and `cross_copy` (stage 7b); the loop over folders (stage 7a); the below-cursor check per folder (stage 8).
