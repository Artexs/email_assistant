# s3-assist-actions — Stage 5

Part of [`../s3-assist-actions.md`](../s3-assist-actions.md). Read that file's "Input" and "Rules for every step" first.

## Stage 5 — `locateMessage`, identity rules, sync without `findByMessageId` [risky]

Checkpoint 1 input: if stage 1 found `targetMeta.sameSize` false at Interia, the identity mode below is `no_size`; else `strict`. If `searchSinceInFolder.found` was false, the main session adds the fallback decided at checkpoint 1 to 5.1 before the build.

- [ ] **5.1 Pure identity rules and `locateMessage` (D3)**
  - Goal: the system finds a known mail in any folder without a header search, and tells a second identical copy from a returned mail with the same rule as S1a.
  - Files: change `apps/server/src/modules/mail/sync-rules.ts`, `apps/server/src/modules/mail/sync-rules.test.ts`; create `apps/server/src/modules/mail/locate.ts`, `apps/server/src/modules/mail/locate.test.ts`; change `apps/server/src/modules/mail/index.ts`.
  - Interfaces:

    ```ts
    // sync-rules.ts
    export type IdentityMode = "strict" | "no_size";
    export const IDENTITY_MODE: IdentityMode = "strict"; // stage 1 result; "no_size" when Interia changes RFC822.SIZE on a COPY
    export interface MailIdentity {
      messageId: string | null; // normalized, as stored in emails.message_id_header
      contentHash: string; // emails.content_hash
      from: string | null; // emails.from_address (no_size mode)
      date: Date | null; // the Date header, else INTERNALDATE at store time (no_size mode); receivedAt is the fallback
    }
    export function sameMailIdentity(meta: MessageMeta, key: MailIdentity, mode?: IdentityMode): boolean;
    // locate.ts
    export interface LocateKey extends MailIdentity {
      hintUid: number | null; // the UID the row holds for this folder, when known
      receivedAt: Date; // emails.received_at: the search window starts one day before it
    }
    export async function locateMessage(
      provider: MailProvider,
      folder: string,
      key: LocateKey
    ): Promise<FolderMessageMeta | null>;
    export const LOCATE_CHUNK = 100;
    ```

  - Decisions:
    - `sameMailIdentity` in `strict` mode: `normalizeMessageId(meta.messageId) === key.messageId && contentHash(meta) === key.contentHash`. In `no_size` mode: the same `messageId`, `meta.from` lower-cased equals `key.from` lower-cased, and the ENVELOPE date (else INTERNALDATE) equals `key.date` to the second; for a mail without a `Message-ID` (`key.messageId === null`) both modes compare the hash only (size included: such mail is rare and a size change then means "not found", which fails safe).
    - `locateMessage`: (1) when `hintUid` is not null: `fetchMetaIn(folder, hintUid)`; a match → return it; (2) `searchSinceIn(folder, receivedAt − 1 day)`; `[]` → null; (3) `fetchByUidsIn` in chunks of `LOCATE_CHUNK`, ascending; the first match wins (a folder holds one copy of a mail: a second copy in the same folder is a user copy and is treated as the same mail); (4) null. The search window starts a day early because `SINCE` compares dates in the server's timezone (S1a `fetchSince` trap); a COPY that changes INTERNALDATE to the copy time is still inside the window (later than `receivedAt`).
    - The key for a stored row: `{ messageId: row.message_id_header, contentHash: row.content_hash, from: row.from_address, date: null, hintUid: …, receivedAt: row.received_at }`; `date` null in `no_size` mode falls back to `receivedAt` to the second (the stored `received_at` is INTERNALDATE; the Date header is not stored). Helper `locateKeyOf(row, hintUid)` in `locate.ts` builds it.
    - Nothing in this step writes to the mailbox.
  - Test:
    - `sync-rules.test.ts`: `sameMailIdentity` strict: same id + same hash → true; same id + other size → false; no id + same hash → true; `no_size`: other size but same id, from and date → true; other from → false; other date (one second) → false.
    - `locate.test.ts` (fake provider, no DB): hint hit → one `fetchMetaIn` call and no search; hint miss (another mail at that UID, mimic Interia reuse with `keepUidOnCopy`) → search path finds the mail by identity; mail not in the folder → null with the calls `fetchMetaIn`, `searchSinceIn` and no `fetchByUidsIn` when the search is empty; 250 mails in the folder with the wanted one last → three `fetchByUidsIn` calls (chunks of 100); folder missing → null.
  - Check: `bun run lint && bun run typecheck && bun run test:unit`.
  - Done when: the tests pass.
  - Out of scope: callers (5.2), the returned check (stage 6).

- [ ] **5.2 The sync uses `locateMessage`; `findByMessageId` is removed; `inbox_uid` on insert and update**
  - Goal: the S1a "known mail in INBOX" rule works at Interia (architecture §6.1), and every INBOX row carries `inbox_uid` (D2).
  - Files: change `apps/server/src/modules/mail/sync.ts`, `apps/server/src/modules/mail/repo.ts`, `apps/server/src/modules/mail/port.ts`, `apps/server/src/modules/mail/imap/client.ts`, `apps/server/src/modules/mail/fake/index.ts`, `apps/server/test/contract/mail-provider.ts`, `apps/server/test/integration/imap-contract.test.ts`, `apps/server/test/integration/mail-sync.test.ts`, `apps/server/test/integration/mail-repo.test.ts`.
  - Interfaces: `MailProvider.findByMessageId` is removed (port, adapter, fake, contract case "findByMessageId finds a mail in another folder…" and the GreenMail case "INBOX works again after a lookup in a missing folder" change to `fetchMetaIn` / `locateMessage` cases). `repo.ts`: `findCopies` also selects `uid`, `content_hash`, `from_address`, `received_at` (the `KnownCopy` type grows: `uid: number`, `contentHash: string`, `from: string | null`, `receivedAt: Date`); `insertEmail` sets `inbox_uid = row.uid`; `updateEmailUid` sets `uid` and `inbox_uid`; `markEmailReturned` sets `uid`, `inbox_uid`, `folder = INBOX`, `returned_at`.
  - Decisions:
    - `planChunk`, branch `check_folder`: `stillInFolder = (await locateMessage(deps.provider, decision.folder, locateKeyOf(copy, copy.uid))) !== null` where `copy` is the matched `KnownCopy` (the row's `uid` is the hint: the UID in that folder, D2). A mail without a `Message-ID` is located by its hash like any other (S1a treated it as returned without a check; now the check runs: the hash includes the size, so a copy with the same size is "still there"). The `resolveFolderCheck` rule is unchanged: still there → a new copy `#n`; gone → returned.
    - The `check_folder` branch runs only for a mail above the cursor (the S1a path). The below-cursor case is stage 6.
    - `backfillInbox` inherits the change (same `planChunk`).
  - Test:
    - `mail-sync.test.ts`: the S1a cases "second identical copy" and "user moved it back" now run with a fake whose folder holds (or does not hold) the mail; add the Interia shape: the copy in the folder keeps the INBOX UID (`keepUidOnCopy`) and a new identical copy arrives in INBOX with a new UID → stored as `#2`, the row in the folder untouched; a mail without a `Message-ID` that is still in its folder → `#2`, gone → returned.
    - `mail-repo.test.ts`: `insertEmail` sets `inbox_uid` = `uid`; `updateEmailUid` moves both; `markEmailReturned` sets `folder`, `uid`, `inbox_uid`, `returned_at`.
    - Contract: `fetchMetaIn` on a mail in another folder has the same identity (`sameMailIdentity` true) as before the move; `locateMessage` on the fake and on GreenMail finds a moved mail without a hint and returns null for a mail that was deleted from the folder.
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:unit && bun run test:int`. `grep -rn findByMessageId apps packages` prints nothing.
  - Done when: the tests pass and `findByMessageId` is gone.
  - Out of scope: the committer's use of `locateMessage` (stage 9).
