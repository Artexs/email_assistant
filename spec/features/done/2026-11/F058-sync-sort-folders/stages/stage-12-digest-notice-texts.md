# sync-sort-folders — Stage 12

Part of [`../plan.md`](../plan.md). Read that file's U7, D15 and "Rules for every step" first. Needs stages 3 and 10.

## Stage 12 — Digest and notice texts with the folder

- [x] **12.1 Core texts: folder tag, "stays in <folder>", failed-move texts**
  - Goal: the pure render functions show where a mail is (D15).
  - Files: change `packages/core/src/digest/digest.ts`, `packages/core/src/digest/digest.test.ts`, `packages/core/src/digest/would-do.ts`,
    `packages/core/src/digest/would-do.test.ts`, `packages/core/src/digest/notices.ts`, `packages/core/src/digest/notices.test.ts`.
  - Interfaces:

    ```ts
    // digest.ts
    export interface DigestItem {
      /* … */ folderTag: string | null;
    } // the source folder when it is not INBOX, else null
    // would-do.ts
    export function describeActions(
      actions: readonly ActionView[],
      names?: ReadonlyMap<string, string>,
      opts?: { stayFolder?: string }
    ): string;
    // "stays in <stayFolder>" when no action applies; default stayFolder "INBOX"
    // notices.ts
    export function renderUrgentNotice(input: { /* … */ folderTag: string | null }): OutMessage;
    export function renderActionFailedNotice(input: {
      /* … */ sourceFolder: string;
      currentFolder: string;
    }): OutMessage;
    ```

  - Decisions:
    - Digest line 1: `${n}. ${tag} · ${sender}${folderTag ? ` · 📁 ${cutText(folderTag, 30)}` : ""}${synthetic ? " · 🧪 test" : ""}`.
    - Urgent notice line 1: `🔴 Urgent mail${folderTag ? ` · 📁 ${cutText(folderTag, 30)}` : ""}${synthetic ? " · 🧪 test" : ""}`.
    - `FAILED_FIRST_LINE.move.reverse` = "Undo failed: could not move a mail back to" + ` ${cutText(sourceFolder, 30)}`. The `bad_payload` and the original
      move text: "The mail stays in <currentFolder>." The reverse text keeps "The mail stays in <folder of the payload>…" as today.
    - Every folder text goes through `cutText`; no other change of the layout or the buttons.
  - Test:
    1. A digest item with `folderTag` `Oferty` → line 1 ends with `· 📁 Oferty`; `null` → the line of today.
    2. A 45-character folder name → cut to 30 with the `cutText` ending.
    3. `describeActions([], new Map(), { stayFolder: "Wiadomości-śmieci" })` → `stays in Wiadomości-śmieci`; without opts → `stays in INBOX`.
    4. Urgent notice with `folderTag` `Oferty` → line 1 `🔴 Urgent mail · 📁 Oferty`.
    5. Failed reverse move with `sourceFolder` `Oferty` → first line `⚠️ Undo failed: could not move a mail back to Oferty`.
    6. Failed original move, `currentFolder` `Oferty` → the last line has `The mail stays in Oferty.`; `bad_payload` → the same folder.
    7. The existing digest and notice tests pass with `folderTag: null`, `sourceFolder: "INBOX"`, `currentFolder: "INBOX"`.
  - Check: `bun run lint && bun run typecheck && bun run test:unit`
  - Done when: tests 1–7 pass.
  - Out of scope: the server queries (12.2).

- [x] **12.2 Server: the folders reach the texts**
  - Goal: the digest, the urgent notice and the failed-action notice get the folders from the DB; no urgent notice for spam folder mail (D23).
  - Files: change `apps/server/src/modules/triage/repo.ts` (`listTriagedBetween` selects `e.folder`, `e.source_folder`; `TriagedItemRow`),
    `apps/server/src/modules/reports/digest.ts`, `apps/server/src/modules/channels/notices.ts`, `apps/server/src/modules/actions/repo.ts`
    (`listFailedUnnotified` selects `emails.folder`, `emails.source_folder`), tests `apps/server/test/integration/reports-digest.test.ts`,
    `apps/server/test/integration/channels-notices.test.ts`.
  - Interfaces: `TriagedItemRow` gets `folder: string` and `source_folder: string`; the failed-action row type of `listFailedUnnotified` gets the same two fields.
  - Decisions: `folderTag` = `source_folder === INBOX ? null : source_folder`; `stayFolder` = `folder`; failed notice: `sourceFolder` = `source_folder`,
    `currentFolder` = `folder`. The digest `MOVE_TARGET_NAMES` lookup in `channels/notices.ts` (`folderName` of a failed move) accepts `inbox` (stage 3 names).
    The urgent detector (`channels/notices.ts`, the `listTriagedBetween(… categories: ["urgent"])` loop) skips a row whose `source_folder` is the mailbox's
    `junk` path (`getJunkFolderPath`, read once per mailbox in the run); no outbox row, no audit row; the digest still lists the mail (D23).
  - Test:
    1. (`reports-digest.test.ts`) a triaged `needs_reply` mail with `source_folder` = `folder` = `Oferty` → its digest line has `📁 Oferty` and `→ stays in Oferty`.
    2. A rescued mail (`folder` INBOX, `source_folder` `Wiadomości-śmieci`, an applied move `inbox`) → `📁 Wiadomości-śmieci` and `→ done: move to INBOX`.
    3. An INBOX mail → the line of today.
    4. (`channels-notices.test.ts`) an urgent mail from `Oferty` → the urgent notice line 1 has `📁 Oferty`.
    5. A failed reverse move of an `Oferty` mail → `Undo failed: could not move a mail back to Oferty`.
    6. An `urgent` mail with `source_folder` `Wiadomości-śmieci` (the junk path) → no `urgent` outbox row; the same mail is in the digest (NEEDS ACTION, `📁 Wiadomości-śmieci`).
       An `urgent` mail from `Oferty` → the urgent notice as usual.
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`
  - Done when: tests 1–6 pass.
  - Out of scope: approval texts (D15); the web panel (S5).
