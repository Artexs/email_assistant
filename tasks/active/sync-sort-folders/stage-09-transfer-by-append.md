# sync-sort-folders — Stage 9

Part of [`../sync-sort-folders.md`](../sync-sort-folders.md). Read that file's F7, F8, D12 and "Rules for every step" first. Needs stage 5.

## Stage 9 — Adapter: move into INBOX by APPEND (`transferByAppend`) [risky]

Why risky: it writes and deletes mail in the user's mailbox. The order rule: APPEND first, EXPUNGE last (a crash leaves two copies, never none).

- [ ] **9.1 `transferByAppend` in the port, the IMAP adapter and the fake, with contract tests**
  - Goal: move one message by APPEND of its raw source (flags and INTERNALDATE kept), then `UID EXPUNGE` of the source (D12).
  - Files: change `apps/server/src/modules/mail/port.ts`, `apps/server/src/modules/mail/imap/client.ts`, `apps/server/src/modules/mail/fake/index.ts`,
    `apps/server/src/modules/mail/fake/fake.test.ts`, `apps/server/test/contract/mail-provider.ts`.
  - Interfaces:

    ```ts
    // apps/server/src/modules/mail/port.ts
    /** The largest message that transferByAppend reads into memory. */
    export const TRANSFER_MAX_BYTES = 25_000_000;
    export interface MailProvider {
      // …
      /**
       * Moves one message by APPEND of its raw source to `toFolder` (flags without \Recent and \Deleted, the same INTERNALDATE),
       * then \Deleted + UID EXPUNGE of the source. For a server that sorts a COPY into INBOX back (Interia, F8).
       * Throws MailNotFoundError when `uid` is not in `fromFolder` (also when the folder is missing); HardError("no UIDPLUS") before any write
       * when the server has no UIDPLUS; HardError("message too large to transfer") when RFC822.SIZE > TRANSFER_MAX_BYTES.
       * `newUid` = the APPENDUID, else null.
       */
      transferByAppend(fromFolder: string, uid: number, toFolder: string): Promise<MoveResult>;
    }
    ```

  - Decisions:
    - IMAP, inside `guard("transferByAppend", …)`, in this order (imapflow holds **one** mailbox lock at a time and has no lock timeout, so never call a
      method that takes its own lock, such as `fetchMetaIn`, while this method holds a lock: it would wait forever; re-review N1):
      1. `lockOrNull(fromFolder)` (null → `MailNotFoundError`). Inside: `hasUid(uid)` (false → `MailNotFoundError`); UIDPLUS check (`HardError("no UIDPLUS")`);
         `fetchOne(uid, { uid: true, size: true, flags: true, internalDate: true }, { uid: true })`; size check; `fetchOne(uid, { uid: true, source: true }, { uid: true })`
         (no source → `HardError("no source")`). Release the lock (`finally`).
      2. With no lock held: `client.append(toFolder, source, flags without \Recent and \Deleted, internalDate)`; `false` → `SoftError("IMAP append skipped")`
         (as `appendMessage`); no APPENDUID → `HardError("append gave no uid")` (UIDPLUS is required, so this is a fault; review m4). The source stays.
      3. With no lock held: `this.fetchMetaIn(toFolder, newUid)` (it takes and releases its own lock); null → `HardError("appended mail not found")`, the source stays.
      4. `lockOrNull(fromFolder)` again (null → return `{ newUid }`: the source folder is gone, nothing to delete). Inside: `hasUid(uid)` false → return
         `{ newUid }` (another client removed it); else `messageDelete(String(uid), { uid: true })`, then `hasUid(uid)` must be false, else
         `HardError("expunge refused")`. Release the lock (`finally`).
    - The fake: the same checks in the same order; `store(toFolder, msg, internalDate, size, flags minus \Recent/\Deleted)`; then `failIfSet("deleteMessage")`
      (a test can stop the delete step, as for the copy path); then remove the source. `toFolder` missing → `HardError("NO [TRYCREATE]")` before any write.
    - Never fall back to `moveMessage` inside `transferByAppend`; the caller chooses (stage 10).
  - Test (contract: fake + `imap-greenmail` + `imap-greenmail-copy-path`):
    1. A mail with `\Seen` and `\Flagged` in `Oferty` → `transferByAppend("Oferty", uid, INBOX)`: INBOX holds one copy with the same RFC822.SIZE, INTERNALDATE
       (to the second), `Message-ID`, and the flags `\Seen`, `\Flagged` (ignore `\Recent`); `Oferty` has no copy; `newUid` = the INBOX UID (`fetchByUidsIn` finds it).
    2. `sameMailIdentity(meta in INBOX, identity of the source meta)` is true (the `content_hash` does not change).
    3. An unknown UID → `MailNotFoundError`; a missing source folder → `MailNotFoundError`; nothing written.
    4. (fake) `capabilities: { uidplus: false, move: false }` → `HardError("no UIDPLUS")`, INBOX unchanged.
    5. (fake) `failOn("deleteMessage", new HardError("x"))` → the call throws; the mail is in both folders (the ensure of stage 10 cleans it up).
    6. (fake) a mail delivered with `size: 25_000_001` → `HardError("message too large to transfer")`, nothing written.
    7. (fake) `toFolder` missing → `HardError`, the source unchanged.
       7b. (GreenMail, both variants) the call returns within 10 s (a test timeout of 10 000 ms): it would hang with a nested lock (N1).
    8. (fake) `appendMessage` path with `capabilities.uidplus` true but an option that drops the APPENDUID (add fake option `appendUid: false`) → `HardError("append gave no uid")`,
       the source unchanged (the appended copy stays: the ensure of stage 10 finds it in the target and deletes the source on the next try).
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`
  - Done when: tests 1–8 and 7b pass on all three contract variants where they apply.
  - Out of scope: when the committer uses it (stage 10).
