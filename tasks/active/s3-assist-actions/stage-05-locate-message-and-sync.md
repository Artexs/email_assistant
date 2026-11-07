# s3-assist-actions — Stage 5

Part of [`../s3-assist-actions.md`](../s3-assist-actions.md). Read that file's "Input" and "Rules for every step" first.

## Stage 5 — `locateMessage`, identity rules, sync without `findByMessageId` [risky]

Checkpoint 1 input: if stage 1 found `targetMeta.sameSize` false and `targetMeta.sameInternalDate` true at Interia, the identity mode below is `no_size`; both false → the build stopped at checkpoint 1; else `strict`. If `searchSinceInFolder.found` was false, the main session adds the fallback decided at checkpoint 1 to 5.1 before the build.

Checkpoint 1 result (Interia, 2026-11-07): a COPY keeps RFC822.SIZE, INTERNALDATE, the ENVELOPE date and `Message-ID` → `IDENTITY_MODE = "strict"`. `SEARCH SINCE` works in a folder other than INBOX → no fallback.

- [x] **5.1 Pure identity rules and `locateMessage` (D3)**
  - Goal: the system finds a known mail in any folder without a header search, and tells a second identical copy from a returned mail with the same rule as S1a.
  - Files: change `apps/server/src/modules/mail/sync-rules.ts`, `apps/server/src/modules/mail/sync-rules.test.ts`; create `apps/server/src/modules/mail/locate.ts`, `apps/server/src/modules/mail/locate.test.ts`; change `apps/server/src/modules/mail/index.ts`.
  - Interfaces:

    ```ts
    // sync-rules.ts
    export type IdentityMode = "strict" | "no_size";
    export const IDENTITY_MODE: IdentityMode = "strict"; // stage 1 result; "no_size" when Interia changes RFC822.SIZE (not INTERNALDATE) on a COPY
    export interface MailIdentity {
      messageId: string | null; // normalized, as stored in emails.message_id_header
      contentHash: string; // emails.content_hash
      from: string | null; // emails.from_address (no_size mode)
      receivedAt: Date; // emails.received_at = INTERNALDATE at store time (no_size mode)
    }
    export function sameMailIdentity(meta: MessageMeta, key: MailIdentity, mode?: IdentityMode): boolean;
    export function isDeleted(meta: FolderMessageMeta): boolean; // flags contain "\\Deleted"
    // locate.ts
    export interface LocateKey extends MailIdentity {
      hintUid: number | null; // the UID the row holds for this folder, when known
      // receivedAt also starts the search window: one day before it
    }
    export async function locateMessage(
      provider: MailProvider,
      folder: string,
      key: LocateKey,
      opts?: { excludeUids?: ReadonlySet<number> } // UIDs that other emails rows of the same identity hold in this folder
    ): Promise<FolderMessageMeta | null>;
    export const LOCATE_CHUNK = 100;
    ```

  - Decisions:
    - `sameMailIdentity` in `strict` mode: `normalizeMessageId(meta.messageId) === key.messageId && contentHash(meta) === key.contentHash`. In `no_size` mode: the same `messageId`, `meta.from` lower-cased equals `key.from` lower-cased, and `meta.internalDate` equals `key.receivedAt` to the second (both are INTERNALDATE; the ENVELOPE date is never compared, because no column stores the `Date` header); for a mail without a `Message-ID` (`key.messageId === null`) both modes compare the hash only (size included: such mail is rare and a size change then means "not found", which fails safe).
    - `locateMessage`: a meta counts only when it is not `\Deleted` (`isDeleted`: an expunge that failed, or another client's delete, M2), its UID is not in `excludeUids`, and `sameMailIdentity` holds. (1) when `hintUid` is not null and not in `excludeUids`: `fetchMetaIn(folder, hintUid)`; a counted meta → return it; (2) `searchSinceIn(folder, receivedAt − 1 day)`; `[]` → null; (3) `fetchByUidsIn` in chunks of `LOCATE_CHUNK`, ascending, UIDs in `excludeUids` left out before the fetch; the first counted meta wins; (4) null. `excludeUids` keeps two identical copies apart: the copy that another `emails` row holds is never this row's copy (B2). A second identical copy in the same folder that no row holds is treated as this mail. The search window starts a day early because `SINCE` compares dates in the server's timezone (S1a `fetchSince` trap); a COPY that changes INTERNALDATE to the copy time is still inside the window (later than `receivedAt`).
    - The key for a stored row: `{ messageId: row.message_id_header, contentHash: row.content_hash, from: row.from_address, receivedAt: row.received_at, hintUid: … }`. Helper `locateKeyOf(row, hintUid)` in `locate.ts` builds it.
    - Nothing in this step writes to the mailbox.
  - Test:
    - `sync-rules.test.ts`: `sameMailIdentity` strict: same id + same hash → true; same id + other size → false; no id + same hash → true; `no_size`: other size but same id, from and INTERNALDATE (`receivedAt`, the same second, other milliseconds) → true; other from → false; INTERNALDATE one second off → false; an ENVELOPE date that differs from `receivedAt` does not matter. `isDeleted` true only with `\Deleted`.
    - `locate.test.ts` (fake provider, no DB): hint hit → one `fetchMetaIn` call and no search; a hint whose UID is in `excludeUids` → no `fetchMetaIn` at that UID, the search path runs; two identical copies in the folder, the first UID in `excludeUids` → the second is returned; the only copy in the folder has `\Deleted` (fake `setFlags`) → null; hint miss (another mail at that UID, mimic Interia reuse with `keepUidOnCopy`) → search path finds the mail by identity; mail not in the folder → null with the calls `fetchMetaIn`, `searchSinceIn` and no `fetchByUidsIn` when the search is empty; 250 mails in the folder with the wanted one last → three `fetchByUidsIn` calls (chunks of 100); folder missing → null.
  - Check: `bun run lint && bun run typecheck && bun run test:unit`.
  - Done when: the tests pass.
  - Out of scope: callers (5.2), the returned check (stage 6).

- [x] **5.2 The sync uses `locateMessage`; `findByMessageId` is removed; `inbox_uid` on insert and update**
  - Goal: the S1a "known mail in INBOX" rule works at Interia (architecture §6.1), and every INBOX row carries `inbox_uid` (D2).
  - Files: change `apps/server/src/modules/mail/sync.ts`, `apps/server/src/modules/mail/sync-rules.ts`, `apps/server/src/modules/mail/repo.ts`, `apps/server/src/modules/mail/index.ts`, `apps/server/src/modules/mail/port.ts`, `apps/server/src/modules/mail/imap/client.ts`, `apps/server/src/modules/mail/fake/index.ts`, `apps/server/src/modules/mail/fake/fake.test.ts` (line 39 uses `findByMessageId`), `apps/server/test/contract/mail-provider.ts`, `apps/server/test/integration/imap-contract.test.ts`, `apps/server/test/integration/mail-backfill.test.ts` (lines 124 and 209 use `findByMessageId`), `apps/server/test/integration/mail-sync.test.ts`, `apps/server/test/integration/mail-repo.test.ts`.
  - Interfaces: `MailProvider.findByMessageId` is removed (port, adapter, fake, contract case "findByMessageId finds a mail in another folder…" and the GreenMail case "INBOX works again after a lookup in a missing folder" change to `fetchMetaIn` / `locateMessage` cases). `repo.ts`: `findCopies` also selects `uid`, `content_hash`, `from_address`, `received_at` (the `KnownCopy` type grows: `uid: number`, `contentHash: string`, `from: string | null`, `receivedAt: Date`); `insertEmail` sets `inbox_uid = row.uid`; `updateEmailUid` sets `uid` and `inbox_uid`; `markEmailReturned` sets `uid`, `inbox_uid`, `folder = INBOX`, `returned_at`. New: `listFolderUids(db, ctx, mailboxId, folder, key: { exceptEmailId: string; messageId: string | null; contentHash: string }): Promise<Set<number>>` = the `uid` of every other row of the same identity (`findCopies`) whose `folder` equals `folder` (the committer and stage 6 fill `excludeUids` with it); a pure `otherCopyUids(copies: KnownCopy[], exceptId: string, folder: string): Set<number>` in `sync-rules.ts` does the filter and serves the sync, which has the copies already. Export `listFolderUids` from `mail/index.ts`.
  - Decisions:
    - `planChunk`, branch `check_folder`: `stillInFolder = (await locateMessage(deps.provider, decision.folder, key, { excludeUids: otherCopyUids(copies, copy.id, decision.folder) })) !== null` where `copy` is the matched `KnownCopy`, `copies` is the `findCopies` result of the mail, and `key = { messageId, contentHash: copy.contentHash, from: copy.from, receivedAt: copy.receivedAt, hintUid: copy.uid }` (`messageId` = the incoming mail's normalized id: `findCopies` matches it, so it is the copy's id too; the row's `uid` is the hint: the UID in that folder, D2). `KnownCopy` is camelCase and has no `messageId`, so do not pass it to `locateKeyOf` (that helper takes the snake_case row shape of `MovedRow` and `ClaimedAction.email`). The `runCopies` of `planChunk` (`sync.ts:127`, the rows that this run stores) get the new `KnownCopy` fields from the meta (`uid`, `contentHash` = the hash, `from`, `receivedAt` = `internalDate`); they are INBOX rows and never reach `check_folder`. A mail without a `Message-ID` is located by its hash like any other (S1a treated it as returned without a check; now the check runs: the hash includes the size, so a copy with the same size is "still there"). The `resolveFolderCheck` rule is unchanged: still there → a new copy `#n`; gone → returned.
    - The `check_folder` branch runs only for a mail above the cursor (the S1a path). The below-cursor case is stage 6.
    - `backfillInbox` inherits the change (same `planChunk`).
  - Test:
    - `mail-sync.test.ts`: the S1a cases "second identical copy" and "user moved it back" now run with a fake whose folder holds (or does not hold) the mail; add the Interia shape: the copy in the folder keeps the INBOX UID (`keepUidOnCopy`) and a new identical copy arrives in INBOX with a new UID → stored as `#2`, the row in the folder untouched; a mail without a `Message-ID` that is still in its folder → `#2`, gone → returned; two rows of one identity in `AI/Spam` (`#1`, `#2`) and the fake holds only `#2`'s copy there → a new INBOX copy marks `#1` returned (its copy is gone; `#2`'s UID is excluded), not stored as `#3`.
    - `mail-repo.test.ts`: `insertEmail` sets `inbox_uid` = `uid`; `updateEmailUid` moves both; `markEmailReturned` sets `folder`, `uid`, `inbox_uid`, `returned_at`; `listFolderUids` returns the other rows' UIDs in that folder only, never the row itself, filtered by `org_id` and `mailbox_id`.
    - Contract: `fetchMetaIn` on a mail in another folder has the same identity (`sameMailIdentity` true) as before the move; `locateMessage` on the fake and on GreenMail finds a moved mail without a hint and returns null for a mail that was deleted from the folder.
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:unit && bun run test:int`. `grep -rn findByMessageId apps packages` prints nothing.
  - Done when: the tests pass and `findByMessageId` is gone.
  - Out of scope: the committer's use of `locateMessage` (stage 9).
