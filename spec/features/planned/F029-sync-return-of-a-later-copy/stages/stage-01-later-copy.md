# F029 stage 01 — Later copy: check every free copy

Part of [`../plan.md`](../plan.md). **[risky]**: sync dedup (review job before the land). Read D1–D4 of `plan.md` and facts F1, F2, F12 first, then `apps/server/src/modules/mail/sync-rules.ts` (`decideIncoming`, `resolveFolderCheck`) and `apps/server/src/modules/mail/sync.ts` (`planChunk`).

May build at the same time as stage 02 (both edit `sync-rules.ts` and `sync-rules.test.ts`, in other functions). The later land merges `master`.

## Step 1 — Candidates in `decideIncoming`

**Goal.** `check_folder` carries every free copy outside S, in copy order, at most 5.

**Files.** `apps/server/src/modules/mail/sync-rules.ts`, `apps/server/src/modules/mail/sync-rules.test.ts`.

**Interfaces.**

```ts
/** A free known copy outside the synced folder, in copy-number order. */
export interface FolderCandidate {
  emailId: string;
  folder: string;
  /** folder <> source_folder: the system moved it there. */
  systemMoved: boolean;
}

/** The folder check tries at most this many free copies of one mail. */
export const CHECK_FOLDER_MAX_CANDIDATES = 5;

export type IncomingDecision =
  | { kind: "move_in_flight"; emailId: string }
  | { kind: "update_uid"; emailId: string; isSource: boolean }
  | { kind: "check_folder"; candidates: FolderCandidate[]; seenElsewhere: boolean }
  | { kind: "cross_copy"; emailId: string }
  | { kind: "new"; dedupKey: string };
```

In `decideIncoming`, replace `const other = free[0]` and its return with: when `free.length > 0` (and no free copy in S, which the `here` check before it already rules out), return `{ kind: "check_folder", candidates: free.slice(0, CHECK_FOLDER_MAX_CANDIDATES).map((copy) => ({ emailId: copy.id, folder: copy.folder, systemMoved: copy.folder !== copy.sourceFolder })), seenElsewhere }`. `free` is already sorted by copy number (`sorted`). Everything else of the function stays. Update the doc comment of `decideIncoming` (one line: "check_folder lists the free copies outside S in copy order; the caller checks them until one is gone").

**Decisions.** D1, D2, D3.

**Test** (`sync-rules.test.ts`, describe `decideIncoming`; use the `copy()` helper and `BASE`):

- Update the existing assertions to the new shape, same meaning: line 213 test → `{ kind: "check_folder", candidates: [{ emailId: "e1", folder: "INBOX", systemMoved: false }], seenElsewhere: false }`; line 223 test → `candidates: [{ emailId: "e1", folder: "AI/Info", systemMoved: true }]`; line 241 → `toMatchObject({ kind: "check_folder", candidates: [{ emailId: "e1" }] })`; line 257 test ("the copy in S is matched") → `candidates: [{ emailId: "e2" … }]`; lines 298, 325, 335 tests the same way. Keep every test title.
- 1.a S `INBOX`, copies `e1` (`BASE`, `AI/Spam`) and `e2` (`${BASE}#2`, `AI/Spam`), none matched → `candidates` `[e1 systemMoved true, e2 systemMoved true]` in that order, `seenElsewhere: false`.
- 1.b S `INBOX`, copies `e2` (`${BASE}#2`, `AI/Info`) listed before `e1` (`BASE`, folder and source `Oferty`) → candidates `[e1 systemMoved false, e2 systemMoved true]` (copy order, not input order).
- 1.c S `INBOX`, 7 free copies `e1`…`e7` (`BASE`, `${BASE}#2` … `${BASE}#7`, all `AI/Spam`) → 5 candidates `e1`…`e5`.
- 1.d S `INBOX`, `e1` in `AI/Spam` matched in `Oferty`, `e2` in `AI/Spam` free → candidates `[e2]`, `seenElsewhere: true`.
- 1.e `CHECK_FOLDER_MAX_CANDIDATES` is 5.

**Check.** `bun test apps/server/src/modules/mail/sync-rules.test.ts`

**Done when.** All `decideIncoming` tests pass; `bun run typecheck` shows only the errors of `sync.ts` that step 2 fixes.

**Out of scope.** `resolveFolderCheck`, `matchReturned`, the move marker rule.

## Step 2 — Locate the candidates in `planChunk`

**Goal.** The first candidate that is gone decides; with none gone, the first candidate's result stands (the old rule).

**Files.** `apps/server/src/modules/mail/sync.ts`.

**Interfaces.** Replace the body of the `check_folder` branch of `planChunk` (lines 233–263 at the plan base) by a call of a new private helper and the same three outcomes:

```ts
// The free copies outside S, in copy order: the first one that is gone is the mail the user moved into S.
// With none gone, the first copy decides as before (an identical new copy, or a cross copy).
async function checkFolders(
  deps: SyncDeps,
  decision: Extract<IncomingDecision, { kind: "check_folder" }>,
  copies: KnownCopy[],
  messageId: string | null,
  baseKey: string
): Promise<{ check: FolderCheckResult; copy: KnownCopy }>
```

Body: `let first: { check: FolderCheckResult; copy: KnownCopy } | null = null;` then for each `candidate` of `decision.candidates` in order: find `copy` in `copies` by `candidate.emailId` (missing → `throw new HardError("matched copy is missing")`); build the `LocateKey` exactly as the old branch did (`messageId`, `copy.contentHash`, `copy.from`, `copy.receivedAt`, `hintUid: copy.uid`); `excludeUids = otherCopyUids(copies, copy.id, candidate.folder)`; `stillInFolder = (await locateMessage(deps.provider, candidate.folder, key, { excludeUids })) !== null`; `check = resolveFolderCheck({ emailId: candidate.emailId, stillInFolder, systemMoved: candidate.systemMoved, seenElsewhere: decision.seenElsewhere, baseKey, copyCount: copies.length })`. If `!stillInFolder` → return `{ check, copy }` at once (no more locates). Else keep the first such pair in `first`. After the loop return `first` (the list is never empty: throw `HardError("check_folder without candidates")` when `first` is null).

In `planChunk`, the branch becomes: `const { check, copy } = await checkFolders(deps, decision, copies, messageId, baseKey);` and then the old handling, with `decision.emailId` replaced by `check.emailId` and `copy.folder` as the `from` of `relocated`:

- `cross_copy` → `countCrossCopy(mailboxId, result, check.emailId)` (no `matched` entry, as now).
- else `state.matched.set(check.emailId, folder)`, then `returned` → push `{ kind: "returned", emailId: check.emailId, uid: meta.uid, folder }`; `relocated` → push `{ kind: "relocated", emailId: check.emailId, uid: meta.uid, from: copy.folder, to: folder }`; `new` → `dedupKey = check.dedupKey`.

Import `FolderCheckResult` and `IncomingDecision` as types from `./sync-rules`. Nothing else in `sync.ts` changes: not the insert branch, not `applyChunk`, not `storeCapture`, not `checkReturnedBelowCursor` (fact F2, D4).

**Decisions.** D1, D4.

**Test.** Step 3.

**Check.** `bun run typecheck`

**Done when.** Typecheck passes; `git diff` of `sync.ts` touches only `planChunk`'s `check_folder` branch, the new helper and the imports.

**Out of scope.** The below-cursor check; log lines (no new line in this stage).

## Step 3 — Sync tests and docs

**Goal.** The F029 case is pinned above and below the cursor; the docs say the new rule.

**Files.** `apps/server/test/integration/mail-sync.test.ts`, `docs/capabilities/sync.md`, `docs/architecture.md`.

**Test** (`mail-sync.test.ts`, describe `syncMailbox: incremental`, next to the test "two rows of one identity in AI/Spam and only the copy of #2 there" at line 356; same helpers `setup`, `deps`, `seed`, `emails`; one `withRollback` each). Common setup for 1.1–1.3, RFC shape (`s.fake` of `setup`, a user move gives a new UID): `first = s.fake.deliver("INBOX", seed(1))`, `second = s.fake.deliver("INBOX", seed(1))`; `syncMailbox` → rows `#1` (base key) and `#2`; `spamFirst = s.fake.userMove("INBOX", first, "AI/Spam")`, `spamSecond = s.fake.userMove("INBOX", second, "AI/Spam")`; update row `#1` to `folder: "AI/Spam", uid: spamFirst, moved_at: hoursAgo(1)` and row `#2` to `folder: "AI/Spam", uid: spamSecond, moved_at: hoursAgo(1)` (by `dedup_key`).

- 1.1 The user moves `#2`'s copy back: `back = s.fake.userMove("AI/Spam", spamSecond, "INBOX")` (a new UID above the INBOX cursor). `syncMailbox` → `returned` 1, `stored` 0; 2 rows; row `#2`: `folder` `INBOX`, `uid` = `back`, `returned_at` = `NOW`; row `#1`: `folder` `AI/Spam`, `uid` = `spamFirst`, `returned_at` null. No row with a key ending `#3`. (Before the fix: `stored` 1 and a `#3` row; the test must fail on the plan base. Run it once on the base to see it fail, and say so in the final message.)
- 1.2 The user moves `#1`'s copy back instead → row `#1` `returned`, row `#2` untouched, and the fake's `folderCalls` show exactly one `fetchMetaIn` call for `AI/Spam` in this sync (the first candidate was gone: no second locate). Note `s.fake.folderCalls.length` right before the second `syncMailbox` and count only the calls after it.
- 1.3 Both stay in `AI/Spam` and a third identical copy is delivered (`s.fake.deliver("INBOX", seed(1))`) → `stored` 1, the new row's key is `${base}#3`, rows `#1` and `#2` unchanged; two `fetchMetaIn` calls for `AI/Spam` (both candidates located).
- 1.4 Interia shape below the cursor (D4): `fake = createFakeMailProvider({ uidValidity: UID_VALIDITY, keepUidOnUserMove: true })`. Deliver `seed(1)` twice, sync, move both into `AI/Spam` with `userMove` (UIDs kept), set both rows to `folder: "AI/Spam", moved_at: hoursAgo(1)`, deliver `seed(2)` and sync (the INBOX cursor passes both UIDs). Then `s.fake.userMove("AI/Spam", second, "INBOX")` (UID kept, below the cursor) → `syncMailbox`: `returnedBelowCursor` 1, `stored` 0; row `#2` `folder` `INBOX`, `returned_at` = `NOW`; row `#1` unchanged. No code change is needed for it; if it fails, stop and report (D4 is then wrong).
- 1.5 A first copy in its source folder hides a gone later copy: deliver `seed(1)` into INBOX twice and sync; set row `#1` to `folder: "Oferty", source_folder: "Oferty"` and put its mail there (`s.fake.userMove("INBOX", first, "Oferty")`, then row `uid` = the returned UID); set row `#2` to `folder: "AI/Info", moved_at: hoursAgo(1)` with `s.fake.userMove("INBOX", second, "AI/Info")` and its UID; then `s.fake.userMove("AI/Info", <its uid>, "INBOX")` → `syncMailbox`: `returned` 1, `crossCopies` 0, `stored` 0; row `#2` back in INBOX with `returned_at`; row `#1` unchanged in `Oferty`.

The existing tests of the file keep passing unchanged.

**Docs.**

- `docs/capabilities/sync.md` rule 11: add one sentence after the first: "When the mail has two or more known identical copies outside the synced folder, the sync checks them in copy order (at most 5) and the first one that is gone is the mail that came back; only when all are still there does it store a new identical copy (`#n`)." Remove the Limits line that starts with `` `F029-sync-return-of-a-later-copy` ``. Update the "Checked against" line to your base commit.
- `docs/architecture.md` §6.1, bullet "Known mail" (line 332): after "locate the mail in that folder by identity", add "(with several identical copies outside S, each in copy order, at most 5, until one is gone)".

**Check.** `bun test apps/server/test/integration/mail-sync.test.ts` and `bun test apps/server/src/capability-map.test.ts`

**Done when.** Tests 1.1–1.5 and all old tests pass; the capability-map test passes; then the Proof command of `plan.md` (`/tmp/f029-s01`) prints `PROOF_OK`.

**Out of scope.** The F064 finder (stages 02–04); the F032 copy branch; ADR 0014.
