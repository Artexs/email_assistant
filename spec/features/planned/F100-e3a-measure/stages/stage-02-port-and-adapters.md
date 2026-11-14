# F100 stage 02 — Port and adapters: `fetchContent`, `fetchFlagsIn`

Part of [`../plan.md`](../plan.md). Review job before the land (a port change in both adapters).

After this stage the `MailProvider` port returns a mail's text and its capture in one call, and reads the IMAP flags of many UIDs in one call, in the IMAP adapter and the fake, both under the contract suite. The sync keeps its behaviour: it uses only `text` (stage 05 stores the capture, stage 06 uses the flags).

Shared files: `mail/sync.ts` and `mail/fake/index.ts` are also edited by F097 stage 01 (`mail/repo/emails.ts` only) and later by F100 stages 05 and 06. Merge `master` before the proof if a job on these files landed meanwhile.

## Step 1 — Port and IMAP adapter

**Goal.** `fetchBodyText` becomes `fetchContent`; `fetchFlagsIn` exists (D3).

**Files.** `apps/server/src/modules/mail/port.ts`, `apps/server/src/modules/mail/imap/client.ts`, `apps/server/src/modules/mail/sync.ts` (the one call site), `apps/server/src/modules/mail/index.ts` (exports), every other caller that `bun run typecheck` names.

**Interfaces.**

```ts
// port.ts — replaces fetchBodyText (remove it; sync.ts is its only caller).
/** Text and capture of one mail. Over the size limit: text null and the capture of the header block (`partsKnown` false).
 *  `{ text: null, capture: null }` when the UID is not in the folder or the source does not parse. Throws MailFolderMissingError. */
fetchContent(folder: string, uid: number): Promise<MailContent>;
/** IMAP flags of the given UIDs in `folder` with the identity of each mail (to check that a UID still names the same mail),
 *  ascending by uid; unknown UIDs are left out; [] for [] or a missing folder. */
fetchFlagsIn(folder: string, uids: number[]): Promise<FlagsOfMessage[]>;

export interface FlagsOfMessage {
  uid: number;
  flags: string[];
  messageId: string | null; // the envelope Message-ID, as MessageMeta.messageId
  internalDate: Date;
}
```

IMAP (`client.ts`):

- `fetchContent`: inside `withExistingFolder`, as `fetchBodyText` did: `fetchOne(uid, { uid, size })`; `false` → `{ text: null, capture: null }`; size over `bodyLimitBytes` → `fetchOne(uid, { uid: true, headers: true })` and `contentFromHeaderBlock(msg.headers)` (stage 01); else `fetchOne(uid, { uid: true, source: true })` and `contentFromSource(source)`; a null parse → `{ text: null, capture: null }`. Wrap in `guard("fetchContent", …)`.
- `fetchFlagsIn`: `[]` input → `[]` without a SELECT. `withFolder(folder, [], …)`; chunks of 500 UIDs; per chunk `this.client.fetch(chunk.join(","), { uid: true, flags: true, envelope: true, internalDate: true }, { uid: true })`; map to `{ uid, flags: [...(msg.flags ?? [])].sort(), messageId: <as toMessageMeta>, internalDate }` (reuse the mapper's helpers); drop UIDs that were not asked; sort ascending. `guard("fetchFlagsIn", …)`.
- `sync.ts` `planChunk`: `const content = await deps.provider.fetchContent(folder, meta.uid);` and `newRow(…, content.text)`. Keep `content.capture` unused in this stage (stage 05 stores it); no other change in `sync.ts`.

**Decisions.** D3.

**Test.** Step 2 runs the contract suite on the IMAP adapter (GreenMail, `apps/server/test/integration/imap-contract.test.ts`).

**Check.** `bun run typecheck`

**Done when.** Typecheck passes with no `fetchBodyText` left in `apps/server/src` (`grep -rn fetchBodyText apps/server/src` prints nothing).

**Out of scope.** Storing the capture; reading flags in the sync.

## Step 2 — Fake adapter and contract

**Goal.** The fake behaves like the IMAP adapter for both methods; one contract suite checks both (code patterns § Tests).

**Files.** `apps/server/src/modules/mail/fake/index.ts`, `apps/server/test/contract/mail-provider.ts`, `apps/server/test/integration/imap-contract.test.ts` (only if the seed helper needs headers), every test that names `fetchBodyText` (at HEAD: `apps/server/test/integration/mail-sync.test.ts` more than 20 times, among them `failOn("fetchBodyText")`, and `mail-backfill.test.ts`; `grep -rn fetchBodyText apps/server` finds them all). Rename only; no other change to their assertions.

**Interfaces.**

- Fake `fetchContent`: `existingFolder(folder)`; no stored mail → `{ text: null, capture: null }`; `text` as `fetchBodyText` gave it before (text, else `stripTags(html)`, null over `bodyLimitBytes`); `capture` = `(await contentFromSource(stored.raw ?? renderSeedMessage(stored.msg)))?.capture ?? null` when within the size limit, else `contentFromHeaderBlock` of the header part of that raw (the bytes before the first `\r\n\r\n`). The fake may import `../imap/capture` (a file in the same module; only `imap/` imports `mailparser` itself).
- Fake `fetchFlagsIn`: a missing folder → `[]`; else the stored messages whose uid is in the list, `flags` sorted, `messageId` and `internalDate` as `toMeta` gives them, ascending by uid.

**Decisions.** D3.

**Test** (contract suite, both adapters; extend `describeMailProviderContract`):

1. Rename the two `fetchBodyText` cases to `fetchContent` and assert `.text` as before (text mail; HTML-only mail without tags).
2. A seeded mail with `headers: { "Reply-To": "Desk <desk@example.test>", "List-Unsubscribe": "<https://u.example.test/x>" }` → `capture.replyTo = ["desk@example.test"]`, `capture.listUnsubscribe = "<https://u.example.test/x>"`, `capture.partsKnown = true`.
3. An unknown uid → `{ text: null, capture: null }`; a missing folder → `MailFolderMissingError` (add `fetchContent` to the "missing folder" case).
4. `fetchFlagsIn(INBOX, [uidA, uidB, 999999])` after `setFlags(INBOX, uidA, { add: ["\\Seen", "\\Answered"] })` → two entries ascending; entry A's flags include `\Seen` and `\Answered`; entry B's do not include `\Answered`; each entry's `messageId` equals the seeded Message-ID; 999999 is left out.
5. `fetchFlagsIn(INBOX, [])` → `[]`; `fetchFlagsIn("No/Such", [1])` → `[]`.
6. Fake only (unit, next to the fake's tests): `bodyLimitBytes: 10` and a 2 KB mail with a `Reply-To` header → `text = null`, `capture.partsKnown = false`, `capture.replyTo` set.

**Check.** `bun test apps/server/src/modules/mail/ apps/server/test/integration/imap-contract.test.ts apps/server/test/integration/mail-sync.test.ts` (GreenMail runs from the job's prepare).

**Done when.** Cases 1–6 pass on the fake and cases 1–5 on GreenMail; `mail-sync.test.ts`, `mail-backfill.test.ts` and `imap-sync-greenmail.test.ts` pass with only the method rename.

**Out of scope.** A flags read in `fetchAbove` (the refresh of stage 06 covers new mail within 10 min).

## Done when (stage)

Steps 1–2 done; the Proof command of `plan.md` passes (`/tmp/f100-s02`).
