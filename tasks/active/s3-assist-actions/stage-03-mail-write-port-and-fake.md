# s3-assist-actions — Stage 3

Part of [`../s3-assist-actions.md`](../s3-assist-actions.md). Read that file's "Input" and "Rules for every step" first.

## Stage 3 — Mail write port, fake provider, contract cases [risky]

- [x] **3.1 Port methods and the fake provider (D1)**
  - Goal: `MailProvider` can read and write in any folder; the fake behaves like a server with or without MOVE and UIDPLUS, and like a server that keeps the UID on a copy on request (checkpoint 1: an Interia protocol COPY gets a new UID; only an Interia webmail move keeps it; the option stays as the harder case for the tests).
  - Files: change `apps/server/src/modules/mail/port.ts`, `apps/server/src/modules/mail/fake/index.ts`, `apps/server/src/modules/mail/fake/fake.test.ts`, `apps/server/test/contract/mail-provider.ts`, `apps/server/src/modules/mail/index.ts`, `apps/server/src/modules/mail/imap/client.ts` (stub methods only, see Decisions).
  - Interfaces (`port.ts`; every folder argument is a real folder path; `INBOX` is the constant):

    ```ts
    export interface FolderMessageMeta extends MessageMeta {
      flags: string[]; // IMAP flags of the message, e.g. "\\Seen", "\\Flagged"
    }
    export interface MoveResult {
      // The UID in the target folder when the server reports it (COPYUID / MOVE with UIDPLUS); else null.
      newUid: number | null;
    }
    // The UID is not in the folder. Set the name like MailAuthError: the HardError constructor sets "HardError", and describeError prints the name.
    export class MailNotFoundError extends HardError {
      constructor(message: string, options?: { cause?: unknown }) {
        super(message, options);
        this.name = "MailNotFoundError";
      }
    }
    export interface MailProvider {
      // … the S1a read methods stay, except findByMessageId (removed in stage 5) …
      /** Creates the folder when it is missing. Returns the path as the server lists it. */
      ensureFolder(name: string): Promise<string>;
      /** Null when the folder has no such UID (also when the folder does not exist). */
      fetchMetaIn(folder: string, uid: number): Promise<FolderMessageMeta | null>;
      /** UIDs in `folder` with INTERNALDATE on or after the day of `since`; [] when the folder does not exist. */
      searchSinceIn(folder: string, since: Date): Promise<number[]>;
      /** Metas of the given UIDs in `folder`, ascending; unknown UIDs are left out. */
      fetchByUidsIn(folder: string, uids: number[]): Promise<FolderMessageMeta[]>;
      /** Moves one message. Throws MailNotFoundError when `uid` is not in `fromFolder`. */
      moveMessage(fromFolder: string, uid: number, toFolder: string): Promise<MoveResult>;
      /** `\Deleted` + UID EXPUNGE of one message. Throws HardError("no UIDPLUS") when the server has no UIDPLUS. Returns false when the UID is not there. */
      deleteMessage(folder: string, uid: number): Promise<boolean>;
      /** Adds and removes IMAP flags of one message. Throws MailNotFoundError when `uid` is not in `folder`. */
      setFlags(folder: string, uid: number, change: { add?: string[]; remove?: string[] }): Promise<void>;
    }
    ```

    `MessageMeta` stays as it is (no flags); `FolderMessageMeta` adds `flags`. Export the new types from `mail/index.ts`.

  - Decisions:
    - `fetchByUids(uids)` and `fetchBodyText(uid)` stay INBOX-only (the sync uses them); `fetchByUidsIn` is the general one. No method takes a sequence number: every range is a UID range.
    - Fake options: `FakeMailProviderOptions` gets `keepUidOnCopy?: boolean` (default false; true mimics a UID-keeping server, as an Interia webmail move: a copied message keeps its UID in the target, when that UID is free there; else it gets the next UID) and `copyUidMap?: boolean` (default true: `moveMessage` returns `newUid`; false mimics a server without `COPYUID`: `newUid` null).
    - Fake `moveMessage`: with `capabilities.move` true it moves in one step; else it copies, then deletes the source (the same end state; the two-step shape matters only for the crash cases of stage 9, which the tests build by hand with `deliver` and `remove`). Both paths record the call name `moveMessage` in `calls`. `deleteMessage` throws `HardError("no UIDPLUS")` when `capabilities.uidplus` is false. `ensureFolder` creates the folder and returns the name unchanged. `setFlags` keeps a `Set<string>` of flags per stored message; `fetchMetaIn` returns them sorted. `failOn` works for every new method.
    - The fake's `userMove` (test helper) keeps its S1a behaviour (new UID in the target) unless `keepUidOnCopy` is set.
    - The S1a fake test file gets cases for the new methods; the contract suite gets the cases below, so stage 4 runs them on GreenMail without a change.
    - So that this stage compiles and commits alone: `ImapMailProvider` (`imap/client.ts`) gets the seven new methods as stubs that throw `new HardError("not built until stage 4")`. In `mail-provider.ts` every new contract case is wrapped in `test.skipIf(name.startsWith("imap"))` (the suite's `name` argument), so the GreenMail run skips them until stage 4 removes the flag.
  - Test:
    - `fake.test.ts`: `new MailNotFoundError("x").name` is `"MailNotFoundError"` and `describeError` prints `MailNotFoundError`; `keepUidOnCopy` true → `moveMessage` gives `newUid` = the source UID; false → a new UID; `copyUidMap` false → `newUid` null; `deleteMessage` without UIDPLUS throws `HardError` and leaves the message; `setFlags` on a missing UID throws `MailNotFoundError`; `failOn("moveMessage", …)` throws once.
    - `mail-provider.ts` (runs on the fake now, on GreenMail in stage 4): (1) `ensureFolder("AI/Contract-<uuid>")` creates it and returns a path that `serverInfo().folders` lists; a second call returns the same path and creates nothing new; (2) `fetchMetaIn(INBOX, uid)` of a seeded mail has the same `messageId`, `from`, `subject`, `size` and `internalDate` (same millisecond) as `fetchAbove(0)`, and `flags` without `\\Seen`; `fetchMetaIn(INBOX, 999999)` → null; `fetchMetaIn("No-such-folder", 1)` → null; (3) `setFlags(INBOX, uid, { add: ["\\Seen", "\\Flagged"] })` → `fetchMetaIn` flags contain both; `{ remove: ["\\Flagged"] }` → only `\\Seen`; (4) `moveMessage(INBOX, uid, folder)` → the mail is gone from INBOX (`fetchMetaIn` null) and `fetchByUidsIn(folder, [newUid ?? …])` or `searchSinceIn(folder, yesterday)` + `fetchByUidsIn` finds it with the same `messageId`, `size`, `internalDate` and flags; (5) `moveMessage(INBOX, 999999, folder)` throws `MailNotFoundError`; (6) `searchSinceIn(folder, yesterday)` contains the moved UID; `searchSinceIn("No-such-folder", yesterday)` → `[]`; (7) `deleteMessage(folder, uid)` → true, then `fetchMetaIn` → null; `deleteMessage(folder, uid)` again → false; the other mail in the folder stays; (8) after a move the INBOX cursor rule still holds: `fetchAbove(lastUid)` returns no UID ≤ `lastUid` (the `*` quirk is filtered by the caller; this case checks only that the moved UID is not returned as new).
  - Check: `bun run lint && bun run typecheck && bun run test:unit` (the fake and the pure tests); `bun run dev:up && bun run test:int` passes: the fake contract run has the new cases, the GreenMail run skips them (`skipIf`).
  - Done when: the fake passes the new contract cases, the unit and integration tests pass, and the stage commits on its own.
  - Out of scope: the IMAP adapter (stage 4), `locateMessage` (stage 5), removing `findByMessageId` (stage 5).
