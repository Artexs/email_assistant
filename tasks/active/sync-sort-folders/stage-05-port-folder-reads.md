# sync-sort-folders — Stage 5

Part of [`../sync-sort-folders.md`](../sync-sort-folders.md). Read that file's F2, F3, F6, D4 and "Rules for every step" first.

## Stage 5 — Port and adapters: folder status, fetch above, body text, folder list per folder [risky]

Why risky: the sync cursor rule (D4) and every read of the sync go through these calls. The sync stays INBOX-only in this stage (it passes `INBOX`).

- [ ] **5.1 Folder-aware read calls in the port, the IMAP adapter and the fake**
  - Goal: the port reads any folder: status with the UIDNEXT rule (D4), UID range fetch, body text, folder list. The INBOX-only calls go away.
  - Files: create `apps/server/src/modules/mail/uid-next.ts`, `apps/server/src/modules/mail/uid-next.test.ts`; change `apps/server/src/modules/mail/port.ts`,
    `apps/server/src/modules/mail/imap/client.ts`,
    `apps/server/src/modules/mail/fake/index.ts`, `apps/server/src/modules/mail/fake/fake.test.ts`, `apps/server/src/modules/mail/index.ts`,
    `apps/server/src/modules/mail/sync.ts` (callers only), `apps/server/src/modules/mail/tools.ts` (callers only), `apps/server/test/contract/mail-provider.ts`,
    `apps/server/test/integration/imap-contract.test.ts`, and every other caller that `grep -rn "inboxStatus\|fetchAbove\|searchInboxSince\|\.fetchByUids(\|fetchBodyText\|InboxStatus" apps packages tools`
    finds (today: `mail-backfill.test.ts`, `mail-jobs.test.ts`, `mail-sync.test.ts`, `smtp-send.test.ts`).
  - Interfaces:

    ```ts
    // apps/server/src/modules/mail/port.ts
    export interface FolderStatus {
      uidValidity: number;
      /** D4: the largest of STATUS UIDNEXT, SELECT UIDNEXT and highestUid + 1 (finite values only), at least 1. */
      uidNext: number;
      /** The UID of `*`; 0 when the folder is empty. */
      highestUid: number;
    }
    /** The folder is not on the server (any more). Fixed message "IMAP folder not found": never the path (D21; jobs.ts logs error.message). */
    export class MailFolderMissingError extends HardError {
      /* name = "MailFolderMissingError" */
    }
    export interface MailProvider {
      serverInfo(): Promise<MailServerInfo>;
      /** LIST only (no SELECT): path and delimiter of every folder. */
      listFolders(): Promise<{ path: string; delimiter: string }[]>;
      /** Throws MailFolderMissingError when the folder does not exist. */
      folderStatus(folder: string): Promise<FolderStatus>;
      /** UID FETCH lastUid+1:* in `folder`. Can also return uid <= lastUid (RFC 3501 `*` rule). [] for an empty folder. Throws MailFolderMissingError. */
      fetchAbove(folder: string, lastUid: number): Promise<MessageMeta[]>;
      /** Null when larger than the size limit, no text, or no such UID. Throws MailFolderMissingError. */
      fetchBodyText(folder: string, uid: number): Promise<string | null>;
      // unchanged: ensureFolder, fetchMetaIn, searchSinceIn, fetchByUidsIn, moveMessage, deleteMessage, setFlags, appendMessage, close
      // removed: inboxStatus, searchInboxSince, fetchByUids (callers use searchSinceIn(INBOX, …) and fetchByUidsIn(INBOX, …))
    }
    // apps/server/src/modules/mail/uid-next.ts (pure; the IMAP adapter and the fake both use it)
    export function resolveUidNext(input: {
      statusUidNext: number | undefined;
      selectUidNext: number | undefined;
      highestUid: number;
    }): number;
    ```

    ```ts
    // apps/server/src/modules/mail/fake/index.ts — new options and helper changes
    export interface FakeMailProviderOptions {
      // … existing options
      /** One UID counter for all folders, as Interia (F3). Default false (one counter per folder, as GreenMail, F6). */
      globalUids?: boolean;
      /** The STATUS UIDNEXT that the fake reports before the D4 rule; Interia gives 1 (F2). Default: the real next UID. */
      uidNextValue?: number;
    }
    // resetUidValidity(next, folder = INBOX): the folder gets a new UIDVALIDITY and its uids are renumbered.
    /** Every call with its folder argument (or "" for calls without one), in call order. `calls` (names only) stays as it is. */
    readonly folderCalls: { method: string; folder: string }[];
    ```

  - Decisions:
    - IMAP `folderStatus(folder)`: `lockOrNull(folder)` (null → `MailFolderMissingError`); inside the lock read `mailbox.uidValidity` (not finite →
      `HardError`), `mailbox.uidNext`, `exists`; `highestUid` = `fetchOne("*", { uid: true }, { uid: true })` uid when `exists > 0`, else 0; then
      `client.status(folder, { uidNext: true })` (a `false` result or an error that `toMailError` maps to a HardError → treat as undefined; a SoftError rethrows);
      `uidNext = resolveUidNext(…)`. The old `inboxStatus` code is the INBOX case of this.
    - `resolveUidNext`: the max of the finite inputs among `statusUidNext`, `selectUidNext` and `highestUid + 1`; at least 1.
    - `fetchAbove(folder, lastUid)` and `fetchBodyText(folder, uid)`: as today, but in `folder` with `lockOrNull` (null → `MailFolderMissingError`).
    - `listFolders()`: `client.list()` mapped to `{ path, delimiter }`.
    - The fake: `folderStatus` reports `uidNext` = `resolveUidNext({ statusUidNext: opts.uidNextValue ?? realNext, selectUidNext: undefined, highestUid })`.
      A folder that does not exist → `MailFolderMissingError`.
      With `globalUids`, `store()` takes the next UID from one counter for all folders (also for `appendMessage`, `moveMessage`, `userMove`).
    - `sync.ts` and `tools.ts` keep their behaviour: they call the new methods with `INBOX`; `fetchSince(provider, since)` becomes
      `fetchSince(provider, folder, since)` with `searchSinceIn` + `fetchByUidsIn` (chunks of `LOCATE_CHUNK` = 100 UIDs; `fetchByUidsIn` returns
      `FolderMessageMeta`, a superset of `MessageMeta`).
  - Test:
    1. (`uid-next.test.ts`) `resolveUidNext({ statusUidNext: 1, selectUidNext: undefined, highestUid: 38964 })` → 38965;
       `({ undefined, undefined, 0 })` → 1; `({ 40000, undefined, 38964 })` → 40000; `({ NaN, 12, 3 })` → 12.
    2. (contract, fake + both GreenMail variants) `folderStatus(INBOX)`: `uidValidity` > 0, `highestUid` = the UID of the last seeded mail, `uidNext` > `highestUid`.
    3. (contract) a created and seeded `Oferty`: `folderStatus("Oferty").highestUid` = its last UID; an empty created folder → `highestUid` 0, `uidNext` ≥ 1.
    4. (contract) `folderStatus("Nope-<uuid>")`, `fetchAbove("Nope-<uuid>", 0)` and `fetchBodyText("Nope-<uuid>", 1)` → `MailFolderMissingError`; INBOX works after it.
    5. (contract) `fetchAbove("Oferty", 0)` → only `Oferty` mail, ascending UIDs; `fetchBodyText("Oferty", uid)` → its text; `fetchBodyText(INBOX, <unknown uid>)` → null.
    6. (contract) `listFolders()` lists `INBOX` and the created folders with a delimiter (`/` fake, `.` GreenMail).
    7. (fake) `uidNextValue: 1`, 3 mails in `Oferty` (uids 1–3) → `folderStatus("Oferty").uidNext` = 4.
    8. (fake) `globalUids: true`: deliver INBOX, `Oferty`, INBOX → uids 1, 2, 3; `appendMessage` into `AI/Info` → 4.
    9. (fake) `resetUidValidity(9, "Oferty")` → `folderStatus("Oferty").uidValidity` 9, INBOX unchanged.
       9b. (fake) after `fetchAbove("Oferty", 0)` and `fetchByUidsIn(INBOX, [1])`, `folderCalls` ends with `{ method: "fetchAbove", folder: "Oferty" }`,
       `{ method: "fetchByUidsIn", folder: "INBOX" }`. `MailFolderMissingError` message is "IMAP folder not found" (no path).
    10. The existing sync, backfill, jobs and audit tests pass unchanged in meaning (INBOX only).
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`
  - Done when: tests 1–10 and 9b pass; `grep -rn "inboxStatus\|searchInboxSince\|\.fetchByUids(" apps packages tools` finds nothing.
  - Out of scope: `transferByAppend` (stage 9); the sync of other folders (stage 7a).
