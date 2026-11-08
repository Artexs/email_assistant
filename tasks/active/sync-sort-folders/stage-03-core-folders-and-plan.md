# sync-sort-folders — Stage 3

Part of [`../sync-sort-folders.md`](../sync-sort-folders.md). Read that file's D2, D11, D12, D18 and "Rules for every step" first.

## Stage 3 — Core: sync folder defaults; plan for spam folder mail; the `inbox` move target and its policy

Pure code in `packages/core` (no I/O), plus one small change in the test tool. Review: Opus, high (the plan decides what the committer does to real mail).

- [ ] **3.1 Sync folder defaults and the pick rule; the test tool takes its names from them**
  - Goal: one source for the provider folder names (D2, D18) and a pure rule that picks the folders to sync from the server's folder list.
  - Files: create `packages/core/src/mail/sync-folders.ts`, `packages/core/src/mail/sync-folders.test.ts`, `packages/core/src/mail/index.ts`; change
    `packages/core/src/index.ts` (export), `packages/core/src/testmail/delivery.ts` (`SORT_FOLDER_NAMES` from the defaults), `apps/server/src/modules/mail/tools.ts`
    (`deliverTestMail` finds `junk` by its default name), `apps/server/test/integration/mail-deliver.test.ts` (the junk case without `folderSpecialUse`).
  - Interfaces:

    ```ts
    // packages/core/src/mail/sync-folders.ts
    export const syncFolderRoles = ["inbox", "sort", "junk"] as const;
    export type SyncFolderRole = (typeof syncFolderRoles)[number];
    export const syncFolderKeys = ["inbox", "offers", "social", "bills", "junk"] as const;
    export type SyncFolderKey = (typeof syncFolderKeys)[number];
    export interface SyncFolderDefault {
      key: Exclude<SyncFolderKey, "inbox">;
      path: string;
      role: Exclude<SyncFolderRole, "inbox">;
    }
    // Interia names (U1, notes/2026-11-03-interia-imap-capabilities.md). The order is the sync order after INBOX (D5).
    export const SYNC_FOLDER_DEFAULTS: readonly SyncFolderDefault[] = [
      { key: "offers", path: "Oferty", role: "sort" },
      { key: "social", path: "Społeczności", role: "sort" },
      { key: "bills", path: "Rachunki", role: "sort" },
      { key: "junk", path: "Wiadomości-śmieci", role: "junk" },
    ];
    // The root of the app's own folders (the first part of AI_FOLDER_NAMES.ai_info).
    export const AI_FOLDER_ROOT = "AI";
    export function pickSyncFolders(input: {
      listed: readonly { path: string; delimiter: string }[];
      reservedPaths: readonly string[]; // folder_map values of drafts, sent, trash and the ai_* keys
      defaults?: readonly SyncFolderDefault[]; // tests only; default SYNC_FOLDER_DEFAULTS
    }): SyncFolderDefault[];
    ```

  - Decisions:
    - A default is picked when a listed entry has exactly its `path` (case-sensitive, no trim). Excluded: a path in `reservedPaths`; a path equal to
      `AI_FOLDER_ROOT`; a path that starts with `AI_FOLDER_ROOT` + the entry's delimiter. The result keeps the order of the defaults; each key once.
    - `packages/core/src/testmail/delivery.ts`: `SORT_FOLDER_NAMES` keeps its name and type and is built from `SYNC_FOLDER_DEFAULTS` (keys `offers`, `social`, `bills`).
    - `apps/server/src/modules/mail/tools.ts` `deliverTestMail`: the `junk` path is the `junk` default path when the server lists it (not the `\Junk` folder).
  - Test:
    1. listed `INBOX`, `Oferty`, `Rachunki`, `Społeczności`, `Wiadomości-śmieci`, `AI`, `AI/Spam`, `Kosz` (delimiter `/`), reserved `Kosz`, `AI/Spam` →
       keys `offers`, `social`, `bills`, `junk` in this order.
    2. listed `oferty` (lower case) → not picked.
    3. reserved contains `Oferty` → `offers` not picked.
    4. defaults `[{ key: "offers", path: "AI/Oferty", role: "sort" }]`, listed `AI/Oferty` with delimiter `/` → `[]`; the same with path `AI` → `[]`;
       `AI.Oferty` with delimiter `.` → `[]`.
    5. empty list → `[]`.
    6. `SORT_FOLDER_NAMES` equals `{ offers: "Oferty", social: "Społeczności", bills: "Rachunki" }`.
    7. (`mail-deliver.test.ts`) the case that delivers from `Wiadomości-śmieci` passes without `folderSpecialUse`; a fake folder `AI/Spam` with `\Junk` is never
       searched (its mail is not touched).
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`
  - Done when: tests 1–7 pass.
  - Out of scope: the DB rows (stage 4); the sync (stage 7a).

- [ ] **3.2 Plan for spam folder mail, the `inbox` target, its policy and phrase**
  - Goal: D11 and D12 as pure functions (after the cold review M3: the normal move gate, no flag, no VIP exception).
  - Files: change `packages/core/src/triage/planners.ts`, `packages/core/src/triage/planners.test.ts`, `packages/core/src/triage/policy.ts` (only if a type
    needs it), `packages/core/src/triage/policy.test.ts`, `packages/core/src/digest/would-do.ts`, `packages/core/src/digest/would-do.test.ts`,
    `packages/core/src/triage/index.ts` (exports) if needed.
  - Interfaces:

    ```ts
    // packages/core/src/triage/planners.ts
    export const folderKeys = ["ai_info", "ai_notifications", "ai_spam", "ai_manual"] as const; // unchanged
    export const moveTargets = [...folderKeys, "inbox"] as const;
    export type MoveTarget = (typeof moveTargets)[number];
    export function isMoveTarget(value: unknown): value is MoveTarget;
    export const MOVE_TARGET_NAMES: Record<MoveTarget, string> = { ...AI_FOLDER_NAMES, inbox: "INBOX" };
    export type PlannedAction =
      | { type: "move"; folder: MoveTarget }
      | /* the other members unchanged */;
    export interface PlanSource {
      fromJunk: boolean; // the mail's source_folder is the path of the mailbox's junk row (D11)
    }
    export function planActions(
      category: Category,
      summary: string | null,
      delegation?: DelegationInput,
      source?: PlanSource // undefined = { fromJunk: false }: the plan of today
    ): PlannedAction[];

    // packages/core/src/digest/would-do.ts
    export interface ActionView { /* … */ folder: MoveTarget | null; /* … */ }
    ```

  - Decisions:
    - `fromJunk` false → every plan as today.
    - `fromJunk` true: `spam` → `[]`; `urgent` → `[move inbox]` (no flag, D11); `needs_reply` → `[move inbox]`; `delegation` → `[move inbox]` only
      (U10: no `planDelegation`, so no draft, no send and no delegation row); `info` → `[save_summary, move ai_info]`; `notification` → `[mark_read, move ai_notifications]`;
      `unsure` → `[move ai_manual]`.
    - Policy (`decidePolicy`): a move with `folder` `inbox` follows the move rule of today unchanged (`assist`, `move` switch, `categoryAuto`, `movesSupported`,
      not VIP; `unsure` → `move_unsure`). No new branch is needed; the tests pin it.
    - `would-do.ts`: the move phrase uses `MOVE_TARGET_NAMES` (`move to INBOX`). The text "stays in INBOX" does not change in this step (stage 12).
  - Test (fixed inputs; summary `"S"`; a delegation input with delegate `d1`, name `Ala`, address `ala@x.test`, task `T`):
    1. fromJunk `spam` → `[]`.
    2. fromJunk `urgent` → `[{ type: "move", folder: "inbox" }]` (no `flag`).
    3. fromJunk `needs_reply` → `[{ type: "move", folder: "inbox" }]`.
    4. fromJunk `delegation` with the delegate → `[{ type: "move", folder: "inbox" }]` only (no `create_draft`, no `send`, U10); with a clarification
       question and a sender address → the same; `fromJunk` false with the delegate → the plan of today (`create_draft`, `send`).
    5. fromJunk `info` → save_summary `S` + move `ai_info`.
    6. fromJunk `notification` → mark_read + move `ai_notifications`.
    7. fromJunk `unsure` → move `ai_manual`.
    8. `source` undefined and `{ fromJunk: false }` → the old plans for all 7 categories (the existing tests pass).
    9. policy, move `inbox`, mode `assist`, `move` on, supported: `categoryAuto` true → `apply`; `categoryAuto` false → `log_only`; `vip` true → `log_only`;
       mode `shadow` → `log_only`; `movesSupported` false → `log_only`.
    10. policy, move `inbox` for category `delegation` (`categoryAuto` false, as `autoFor` gives for a category without a bar) → `log_only`.
    11. `describeActions` of a `logged` move `inbox` → `would move to INBOX`.
    12. `isMoveTarget("inbox")` true, `isMoveTarget("INBOX")` false, `isMoveTarget("ai_spam")` true.
  - Check: `bun run lint && bun run typecheck && bun run test:unit`
  - Done when: tests 1–12 pass; the server still compiles (it passes no `source` yet).
  - Out of scope: the server use of `source` (stage 11), of `inbox` in the committer (stage 10), and of `MoveTarget` in the action views (stage 10).
