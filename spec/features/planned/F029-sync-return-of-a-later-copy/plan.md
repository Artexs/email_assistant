> **Status 2026-11-14 — planned.** Plan base: d70e2bf. 5 stages; none built. One plan for F029 and F064; F032 is planned separately and builds after this plan.

# F029 + F064 · Sync sees every user move of a known mail

Ticket: [ticket.md](ticket.md). Second ticket planned here: `spec/features/planned/F064-sync-return-to-other-folder/ticket.md`. Related, planned separately: `spec/features/planned/F032-copy-below-cursor/`. (Repo paths, not links: this folder moves to `active/` and `done/`, the other two stay.) Questions with their defaults: [questions.md](questions.md).

## Input

### Words of the coordinator and the owner (word for word)

Job instruction (2026-11-14):

> Plan F029 (sync returns a later copy when two copies are in one folder) and F064 (sync sees a user move into a synced folder below that folder's cursor) as ONE sync plan: write the plan in spec/features/planned/F029-sync-return-of-a-later-copy and make F064's ticket.md point to it (## Sequenced: planned together with F029; F032 is planned separately: read spec/features/planned/F032-copy-below-cursor and keep the three consistent, list any overlap and which one builds first). F091 landed. The sync write path now also has the F100 capture (storeCapture savepoint) and the flag refresh (stage 06): the plan must not break them. […] Master moved a lot (F091, F100 stage 05/06 touch sync, F098 texts, F099 flags): check every path and name against HEAD.

Owner verdict (`docs/owner-decisions.md`, 2026-11-14, "Verdicts for the old planned tickets (F095)"):

> Choice: keep F029/F032/F064 (one sync ticket), F062, F068, F074, F085; […]

Old F029 task (the old `plan.md` of this folder, 2026-11-07):

> `decideIncoming` (`apps/server/src/modules/mail/sync-rules.ts`, S1a rule, kept by S3) checks only the lowest-numbered known copy in a folder. Case: rows `#1` and `#2` of one identity are both in `AI/Spam`; the user moves `#2`'s copy back to INBOX while `#1` stays. The sync then stores the incoming mail as `#3` and triages it again; `#2` keeps a stale location and gets no `returned_at`.
>
> Rare (two identical copies moved to one folder, then one put back). Possible fix: in `check_folder`, when the chosen copy is still there, also try the other copies in folders (with `excludeUids`) before `new #n`. Add a sync test for the case first.

Old F064 task (`../F064-sync-return-to-other-folder/plan.md`, 2026-11-09):

> Interia keeps the UID when the user moves a mail in webmail. If the user moves a mail into a synced folder that is not the row's source, and the UID is below that folder's cursor, the sync does not see the move. The row keeps its old folder, and an action on it ends `mail_not_found` (D24 (a) and (g)). Make the sync see such a move.
>
> - A mail that the system moved (or stored) and that the user then puts into another synced folder, with its UID below that folder's cursor, gets the new `folder` on its row.
> - A sync test pins the case (stage 8 test 4 pins the known limit today and changes to the new result).
> - The cost is measured: no extra IMAP call per sync pass that grows with the mailbox size.

F032 goal (`../F032-copy-below-cursor/plan.md`, for consistency only):

> S3 stage 6 only logs and counts a copy that lands below the UID cursor. Interia may keep the UID on a COPY back to INBOX. The sync then does not see the mail as new. Store such a copy as `#n` and triage it: body fetch and the chunk insert path.

The known limits that F064 closes (ADR 0014 § Known limits, D24 of `../../done/2026-11/F058-sync-sort-folders/plan.md`): (a) a return into a synced folder that is not the row's source, below that folder's cursor; (f) a spam-folder mail that the user moves into INBOX by hand; (g) a user move between two synced folders of a mail that the system did not move.

### Design decisions

- **D1 F029: check every free copy, first gone wins.** When an incoming mail in folder S has no free copy in S, `decideIncoming` returns all free copies (in copy-number order) as candidates. `planChunk` locates them one by one in their folders (each with its own `excludeUids`). The first candidate that is gone decides: `returned` (system-moved) or `relocated` (in its source folder), by `resolveFolderCheck`. When every candidate is still there, the result is the result of the first candidate, as today (`new #n`, or `cross_copy`). Rejected: try the other copies only when the first one is system-moved (the old "possible fix"): a first copy that sits in its own source folder (a cross copy) can hide a gone later copy in the same way. Rejected: one search for all copies (`locateMessage` works per folder and key). Risk: each extra locate is one more chance for the Interia SEARCH gap (ADR 0014 known limit (h)) to call a copy gone while it is still there, which gives a false `returned`. It is low: the locate tries the row's UID hint first, and the same risk exists for the one locate of today.
- **D2 At most 5 candidates** (`CHECK_FOLDER_MAX_CANDIDATES = 5`): copies #1–#5 of the free list. No case of more than 5 identical copies of one mail is known (not measured: stage 05 check 6 reads the largest copy count on the VPS); the cap bounds the locates per incoming mail. Default, owner to confirm (Q4).
- **D3 Decision shape.** `check_folder` becomes `{ kind: "check_folder"; candidates: FolderCandidate[]; seenElsewhere: boolean }` with `FolderCandidate = { emailId: string; folder: string; systemMoved: boolean }` (non-empty, copy order). Rejected: keep `emailId`/`folder`/`systemMoved` of the first copy and add a list of later ones (two shapes for one fact).
- **D4 F029 below the cursor needs no change.** With Interia (the user move keeps the UID), the later copy comes back below the INBOX cursor. `checkReturnedBelowCursor` already works per row (`matchReturned` by the row's own UID, `isStillInFolder` with `excludeUids`). Stage 01 pins it with a test; the code there stays.
- **D5 F064 source of candidates: the gone mail of the flag refresh.** The flag refresh (`refreshFlags`, `mail/flags.ts`, F100 stage 06) already reads every mail of the last 30 days by UID in its `emails.folder`, at most every 10 min per mailbox. A UID that the server no longer returns there (`notFound`) is a mail that left its folder. Only those rows are candidates of the move finder. Rejected: (a) extend `checkReturnedBelowCursor` to every synced folder in every pass: case (g) needs all recent mail as candidates, so the IMAP cost per pass grows with the mail volume (F064 done-when 3); (b) a separate presence scan: it reads the same UIDs a second time; (c) `SEARCH HEADER`: Interia finds nothing (fact F6).
- **D6 Where the finder looks.** At the row's own `uid` (Interia: one UID counter per mailbox, a webmail move keeps the UID; fact F6), in each enabled synced folder S in `listSyncFolders` order (INBOX, sort folders, junk). It skips: the row's own folder; S without a cursor (`uidvalidity` or `last_uid` null); S that failed or was skipped in this run (`MailboxSyncResult.failed`, `.skipped`); a row whose `uid` is above S's `last_uid` (the next normal pass of S sees that mail above its cursor and the folder check of D1 handles it). A row found in one folder is not looked for in the later folders.
- **D7 Identity of a hit** (pure `matchMoved`, `sync-rules.ts`): a meta of S that is not `\Deleted`, whose UID equals the row's `uid`, and whose identity matches the row (`sameMailIdentity`, mode `strict`). A hit is dropped when another row of the same identity holds that UID in S (`listFolderUids`): that mail belongs to the other row.
- **D8 Write of a hit.** The row is system-moved (`folder <> source_folder`) → `markEmailReturned` into S (`returned_at` = now, `folder` = `source_folder` = S, `uid` = `inbox_uid` = the hit UID); the job `triage.returned` then marks the system move undone (`user_moved_back`) and writes the "wrong" feedback, as for every return, also into a folder that is not the old source (ADR 0014 D8, decided 2026-11-08). This also covers a mail that the system moved to `AI/Spam` and the user files into the provider spam folder (role `junk`): the user agrees with the category but still gets a "wrong" row. Below the junk cursor the finder makes this case more common than before. Default, owner to confirm (Q5, important): keep the owner's rule; stage 05 check 5 counts the case; an exception is a new ticket that changes both paths (the folder check of D1 and the finder). Else → `markEmailRelocated` from the row's folder to S (no feedback, no triage). Both writes get a new optional guard: they change the row only while it still has the `folder` and `uid` that the finder read. One transaction per folder S: `lockSyncFolder`, then the cursor must equal the one the finder read (else the writes of S do not run, `retry` counts them, and the next refresh finds the rows again because they are still gone), then the guarded writes. This is the lock order of `applyChunk` and `checkReturnedBelowCursor` (folder row first, then `emails`).
- **D9 Skipped rows.** A row with a fresh move marker (`undo_pending_at` younger than `MOVE_PENDING_MAX_AGE_MS`, 24 h: a system move into a synced folder is in flight). A row whose `folder` or `uid` in the DB differ from the gone target (it moved after the refresh read it).
- **D10 Wiring.** `FlagsRefreshResult` gains `gone: FlagTarget[]` (the targets counted in `notFound`, in read order; `mismatch` targets are not gone). In `syncOne` (`mail/jobs.ts`), after a refresh that did not throw and has `gone.length > 0`, call `findUserMoves(…, refreshed.gone, { skipFolders: [...result.failed, ...result.skipped] })` in its own `try`/`catch`: an error is one `user_moves_failed` warning and never fails the sync, the refresh line or `markSynced`. Rejected: the finder inside `refreshFlags` (it would mix a read-only flag reader with location writes, and the F100 refresh tests are about flags).
- **D11 Cost.** `MOVE_CHECK_CHUNK = 500` UIDs per `fetchByUidsIn` call (the IMAP adapter sends one `UID FETCH` with the whole set; fact F7). Calls per refresh ≤ (folders searched) × ⌈candidates of that folder / 500⌉ ≤ 5 × 6 = 30 at `FLAGS_RUN_LIMIT` 3,000. No call when `gone` is empty or no row qualifies for a folder. No call in a sync pass. The candidate read is one DB query per 500 ids. No extra cap on gone rows. Default, owner to confirm (Q3).
- **D12 Logs** (event form, `docs/code-patterns.md` § Logs; field names that exist in `platform/log-fields.ts`): `log.info("user_moves_checked", { mailbox_id, count })` with the kept candidate count, once per call with `gone.length > 0` (the cost on the VPS: production runs at `LOG_LEVEL=info`, so the count must be an info line; cold review M2); `log.info("user_moves_found", { mailbox_id, count })` when `returned + relocated > 0`; `log.info("user_moves_retry", { mailbox_id, count })` when `retry > 0`; `log.debug("user_move_found", { mailbox_id, email_id, folder_key, kind })` per write that changed a row (`kind` `returned` or `relocated`; `folder_key` = the S key, never the path); `log.warn("user_moves_failed", { mailbox_id, ...errorFields(error) })`. Never a path, subject, address or `error.message`.
- **D13 Flags of a found mail** are not written by the finder. The next refresh reads them in the new folder (the row's `email_flags.checked_at` was just touched, so it comes at its turn). Rejected: write the flags from the hit meta (one more writer of `email_flags` with its own guard for a delay of one refresh). Default, owner to confirm (Q6).
- **D14 Limits that stay.** Only mail received in the last 30 days (`FLAGS_WINDOW_MS`); found at the next refresh after the move (≤ 10 min, plus the queue rotation when a mailbox has more than 3,000 mails in 30 days); a deleted mail or a mail in a folder that is not synced stays gone and is looked for at each refresh while it is in the window (cost bound of D11). Default, owner to confirm (Q1, Q2).
- **D15 Files.** Pure rules in `mail/sync-rules.ts`; the finder in a new `mail/moves.ts` (`sync.ts` is 636 lines; code patterns § Size and shape); `listMoveCandidates` in `mail/repo/copies.ts` (the location reads of rows); the guards in `mail/repo/emails.ts`; exports in `mail/repo/index.ts` and `mail/index.ts`.
- **D16 Docs** (same change as the behaviour, PD-009): `docs/capabilities/sync.md` (rule 11 for D1, rule 6 for the finder, Entry points, Limits, Tests, "Checked against" line), `docs/architecture.md` §6.1 ("Known mail" and "Returned below the cursor" bullets), ADR 0014 § Known limits ((a), (f), (g) closed by this plan), `docs/modules.md` §3 mail rows, `docs/known-alerts.md` (`user_moves_failed`).
- **D17 Order with F032 and F062.** This plan builds first (§ Overlap with F032 and F062).

### Edge cases (states × events)

| Row state before | User action | Seen by | Result |
| --- | --- | --- | --- |
| In its source folder A (synced) | moves to synced B, UID above B's cursor | the pass of B (`check_folder`) | `relocated` (as today) |
| In its source folder A | moves to synced B, UID below B's cursor | finder (D5–D8) | `relocated` (new, limit (g)) |
| In the spam folder (its source) | moves to INBOX below the cursor | finder | `relocated`, `source_folder` = INBOX (new, limit (f)) |
| System-moved to `AI/x` | moves back to its source S below the cursor, moved ≤ 7 days ago | `checkReturnedBelowCursor` in the pass of S | `returned` (as today) |
| System-moved to `AI/x` | moves back to its source below the cursor, moved > 7 days ago | finder | `returned` (new) |
| System-moved to `AI/x` | moves to another synced folder below its cursor | finder | `returned` into that folder (new, limit (a)) |
| System-moved to `AI/Spam` | files it into the provider spam folder (role `junk`) | the junk pass above the cursor, the finder below | `returned` with "wrong" feedback (the owner's rule; Q5) |
| Two identical rows #1, #2 in `AI/Spam` | #2's copy back to INBOX above the cursor | the INBOX pass (D1) | #2 `returned`, no #3 (new, F029) |
| Two identical rows #1, #2 in `AI/Spam` | #2's copy back to INBOX below the cursor | `checkReturnedBelowCursor` | #2 `returned` (as today, pinned by a test, D4) |
| Any | moves to Trash, a user folder or `AI/*`; deletes | finder finds nothing | no write; the row stays gone in the window (D14) |
| Any | moves out and later back into a synced folder | finder at the next refresh | as the rows above |
| Move marker fresh | — | finder skips (D9) | the committer writes the location |
| Committer forward move to `AI/*` between its IMAP call and its commit | — | finder: `AI/*` is not searched | no write |

- **Before the first run / folder states:** a folder with no cursor is not searched; a disabled folder is not listed; a folder switched on again starts a new 24 h first sync, and its pass handles the mail by D1.
- **Crash and repeat:** a crash after the fetch and before the commit writes nothing; the row is still gone, so the next refresh repeats the search. A repeat after a commit changes no row (the D8 guard: the row's `folder`/`uid` changed). No dedup key is needed: the writes are conditional updates, never inserts.
- **Two runs at once:** the folder lock serializes the writes per folder; the guards make the second write a no-op. A cursor that moved between the read and the lock skips the writes of that folder (D8).
- **Restart:** the in-memory refresh map is empty, so the first run after a restart refreshes and runs the finder.
- **Tenants:** `listMoveCandidates` filters `org_id` and `mailbox_id`; the writes filter `org_id` (existing). A tenant-filter test for the new function (stage 02).
- **Secrets and private data:** no path, address, subject, Message-ID or mail text in a log line, an error text or a test name (D12).

## Facts checked

All at `d70e2bf` (2026-11-14) unless a source says otherwise.

- **F1** `decideIncoming` (`mail/sync-rules.ts` lines 90–124) takes `free[0]` (line 112) for `check_folder`; the type is at line 75. `resolveFolderCheck` lines 137–152. `otherCopyUids` line 68.
- **F2** `planChunk` (`mail/sync.ts` lines 180–281): the `check_folder` branch (lines 233–263) makes one `locateMessage` call (line 244) and pushes `returned`, `relocated` or sets `dedupKey`. The insert branch (lines 269–278) calls `fetchContent` and pushes `{ kind: "insert", row, capture }`; `applyChunk` (lines 284–347) calls `storeCapture` only for an insert that stored a row (line 309). D1 changes only the `check_folder` branch, so the capture path is untouched.
- **F3** `checkReturnedBelowCursor` (`mail/sync.ts` lines 367–436) lists only rows whose `source_folder` is the synced folder (`listRecentlyMoved`, `repo/copies.ts` lines 68–110: `folder <> source_folder`, `moved_at` ≥ 7 days ago, ≤ 500). It runs only in incremental mode (line 518). The F032 "copy below cursor" count is at lines 401–403.
- **F4** `refreshFlags` (`mail/flags.ts`, 98 lines) returns `{ checked, written, notFound, mismatch }`; a target not returned by `fetchFlagsIn` counts `notFound` and goes to `touchEmailFlags`. Five `toEqual` assertions of that result in `apps/server/test/integration/mail-flags.test.ts`: lines 228, 238, 259, 341, 350.
- **F5** `syncOne` (`mail/jobs.ts` lines 27–70): `syncMailbox` → `markSynced` → the job line → failure counters → the flag block (lines 54–64, its own `try`/`catch`, `flags_refresh_failed`). `result.failed` and `result.skipped` are `SyncFolderKey[]` (`MailboxSyncResult`, `sync.ts` lines 93–102).
- **F6** Interia: all folders share one UID counter, and a webmail move keeps the UID (`notes/2026-11-03-interia-imap-capabilities.md` lines 47–49, 64, 115 "F3 One UID counter"); a protocol `UID COPY` gives a new UID (`notes/2026-11-07-assist-actions-facts.md` line 17). `SEARCH HEADER Message-ID` finds nothing (same file, line 23).
- **F7** `ImapMailProvider.fetchByUidsIn` (`mail/imap/client.ts` lines 382–389) sends one fetch with `uids.join(",")` and `FOLDER_META_QUERY` (line 60, with `flags`); `[]` for an empty list; `withFolder(folder, [], …)` gives `[]` for a missing folder. `fetchFlagsIn` uses chunks of 500 (`FLAGS_CHUNK`, line 58).
- **F8** The fake (`mail/fake/index.ts`) has `globalUids`, `keepUidOnUserMove`, `userMove`, `remove`, `folderCalls` (method and folder of each read), `fetchByUidsIn` (line 370) and `fetchFlagsIn` (line 312); a missing folder gives `[]`.
- **F9** `markEmailReturned` (`repo/emails.ts` lines 58–75) guards `folder <> source_folder`; `markEmailRelocated` (lines 76–92) guards `folder = source_folder` and `folder = change.from`. Neither guards `uid`. Their tests: `apps/server/test/integration/mail-repo.test.ts` lines 575–673.
- **F10** `listSyncFolders(db, ctx, mailboxId, { enabledOnly })` (`repo/folders.ts` lines 91–113) orders INBOX, then `sort` rows in `SYNC_FOLDER_DEFAULTS` order, then `junk`. `SyncFolderRow` has `id`, `key`, `path`, `uidvalidity`, `last_uid` (lines 29–38). `lockSyncFolder` exists (`repo/index.ts`).
- **F11** Log field names `mailbox_id`, `email_id`, `count`, `kind`, `folder_key` exist in `platform/log-fields.ts` (flat list; F103 stage 01 has not split it yet). `errorFields` is in `platform/errors` (used in `jobs.ts` line 5).
- **F12** Test 8.4 is `apps/server/test/integration/mail-sync.test.ts` lines 2006–2027 ("is not seen (known limit)"); helpers `folderSetup` (line 1213), `addFolderRow` (1225), `movedFromFolder` (1903), `markMoved` (1923), `rowById` (1927) in the `syncMailbox: sync folders` describe. The incremental describe has the F029-like test "two rows of one identity in AI/Spam and only the copy of #2 there: a new INBOX copy marks #1 returned" (line 356). `sync-rules.test.ts` asserts `check_folder` at lines 213–231, 241, 257–266, 298–310, 325–347.
- **F13** Docs to change: `docs/capabilities/sync.md` rule 6 (flag refresh), rule 11 (returned mail), Limits lines 89 and 91 (F029, F064), Entry points, Tests; `docs/architecture.md` lines 332–344 ("Known mail" at 332); `docs/decisions/0014-sync-provider-sort-folders.md` lines 58–67; `docs/modules.md` lines 141 (`sync-rules.ts`), 142 (`sync.ts`), 144 (`repo/`) of the mail module table; `docs/known-alerts.md` (no `flags_refresh_failed` entry exists; the `returned below cursor` entries are at lines 516–532). `apps/server/src/capability-map.test.ts` checks every repo path and name on a capability page.
- **F14** The `emails.uid` column is `bigint`; repo code reads it with `Number(row.uid)` (`repo/copies.ts` line 35, `repo/flags.ts` line 43).
- **F15** `mail/index.ts` line 21 exports the flag refresh names; `sync.ts` names are exported at lines 108–115.

## Not verified

- **NV1** A webmail move into an Interia tab folder (`Oferty`) keeps the UID and is not re-sorted by Interia. Checked only for INBOX ↔ a user folder (2026-11-04) and for a COPY (re-sorted, F12 of ADR 0014). Stage 05 owner step O1 checks it on the pilot mailbox (optional). If Interia re-sorts the mail into INBOX with a new UID, the normal INBOX pass sees it above the cursor and D1 handles it.
- **NV2** The real count of gone mail per refresh on the pilot mailbox (deleted mail of 30 days). Stage 05 check 4 reads the info line `user_moves_checked` (D12).

## Done when

1. Two identical rows in `AI/Spam`; the user moves #2's copy back to INBOX above the cursor: #2 is `returned`, #1 is unchanged, no `#3` row. Shown by: stage 01 test 1.1.
2. The old folder-check results stay: one copy still there → `new #2`; a cross copy → `cross_copy`; a first gone copy → `returned`. Shown by: the existing tests of `mail-sync.test.ts` and `sync-rules.test.ts` pass with the new shape (stage 01).
3. A user move below a synced folder's cursor gets the new `folder`: `relocated` for (g) and (f), `returned` for (a). Shown by: stage 03 tests 3.1–3.4.
4. Test 8.4 of `mail-sync.test.ts` asserts the new result. Shown by: stage 04 step 2.
5. The move finder makes no IMAP call in a sync pass (the later-copy check of D1 adds at most 4 locates for a mail with several known copies); per refresh the finder makes at most ⌈n/500⌉ `fetchByUidsIn` calls per searched folder, and none when nothing is gone. Shown by: stage 03 tests 3.10–3.11.
6. The guards hold: a moved row, a fresh marker, a moved cursor, a UID held by an identical row → no write. Shown by: stage 02 tests 2.4–2.6 and stage 03 tests 3.5–3.9.
7. The capture and the flag refresh keep their behaviour: `mail-sync-capture.test.ts` and `mail-flags.test.ts` pass (the latter with the `gone` field added); a refresh that throws starts no finder. Shown by: the stage 04 proof and stage 04 tests 4.2–4.3.
8. The docs describe the new rules and `capability-map.test.ts` passes. Shown by: the stage 01 and stage 04 proofs.
9. On the VPS, 24 h after the deploy: no `user_moves_failed` line. Shown by: stage 05 check 2.

## Rules for every stage

- Read `ticket.md`, this file and your one stage file. A gap or a deviation from a decision is a question in your final message, not a choice. Stop and report it.
- The sync write path keeps its shape: do not change the insert write, `applyChunk`'s insert branch, `storeCapture` or `capture-store.ts`; do not change what `refreshFlags` writes (stage 04 only adds the `gone` field to its result). `mail-sync-capture.test.ts` must pass unchanged. In `mail-flags.test.ts` the old cases stay unchanged except the five `toEqual` lines of fact F4 and one added assertion in case 4 (stage 04 step 2); stage 04 adds new cases to the describe `flag refresh in the sync job`.
- No migration, no `bun.lock` change, no new dependency.
- Logs: event form `log.<level>("event_code", { fields })` (`docs/code-patterns.md` § Logs) for every new line; field names from `platform/log-fields.ts` only (after F103 stage 01 has landed: the kind list of the value). Never a folder path, address, subject, Message-ID, mail text or `error.message`; errors as `...errorFields(error)`. Do not convert the old-form lines of `sync.ts` (F103 does that).
- Every new repository function takes a `TenantContext`, filters `org_id` and gets a tenant-filter test (two organizations).
- Tests: integration tests in `withRollback(db, …)` with the fake provider (`createFakeMailProvider`); fixed clocks (`NOW`/`FOLDER_NOW` of the file you extend); the Interia shape is `globalUids: true, keepUidOnUserMove: true, uidNextValue: 1, capabilities: { move: false }` (the `folderSetup` helper of `mail-sync.test.ts`). No sleep.
- Format only the files of your stage (`bunx prettier --write <files>`), never the repo.
- No bare codes in code comments (`D4`, `F064`): state the rule, or name the ticket folder path when a source is needed.
- When another ticket landed a change in your files, merge `master` before the proof (advisory overlaps: § How to run step 4).
- End the final message with `Decisions for the owner` (`.agents/limen/styleguide.md`).

## Proof

Run after the last commit, as one bash call with nothing after it; read the logs in a separate call. List as proven only what a saved log shows. `NN` = the stage number.

```
mkdir -p /tmp/f029-sNN && bun run lint > /tmp/f029-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f029-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f029-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f029-sNN/int.log 2>&1 && echo PROOF_OK
```

While working, run only the tests of the files you changed (for example `bun test apps/server/src/modules/mail/sync-rules.test.ts`, `bun test apps/server/test/integration/mail-sync.test.ts`); the full chain runs once, as the proof. If `/tmp` is out of inodes (`df -i /tmp`), remove `/tmp/node-compile-cache`.

## Owner checkpoints and owner steps

- No owner checkpoint (owner decision 2026-11-13: checkpoints are not a stop).
- **O1 (optional, not a stop; stage 05):** in Interia webmail, move one INBOX mail that arrived before the newest mail in `Oferty` (so its kept UID is below the `Oferty` cursor) into `Oferty`. The coordinator then checks the row (stage 05 steps 7–9). It needs the owner's hands: only a webmail move keeps the UID (fact F6); a script move is a protocol COPY with a new UID.

## Review

A review job before the land for stages 01 (`[risky]` dedup), 03 (`[risky]` location writes) and 04 (`[risky]` job wiring next to the flag refresh). Model: the board's reviewer (`spec/build.md` § TRACK: `claude-sonnet-5-5`, high). The reviewer may run `bun run test:int:ci` at the candidate commit. Stage 02 lands on the worker's proof. Stage 05 is a coordinator runbook.

## Stages

| # | Stage | Size | Marks |
| --- | --- | --- | --- |
| 01 | [Later copy: check every free copy](stages/stage-01-later-copy.md) (F029) | ~280 lines | [risky], review |
| 02 | [Move rule and repository](stages/stage-02-move-rule-and-repo.md) (F064) | ~220 lines | — |
| 03 | [Move finder](stages/stage-03-move-finder.md) (F064) | ~320 lines | [risky], review |
| 04 | [Wiring, test 8.4, docs](stages/stage-04-wiring-and-docs.md) (F064) | ~260 lines | [risky], review |
| 05 | [Pilot check](stages/stage-05-pilot-check.md) (coordinator runbook) | runbook | coordinator |

Order: 01 and 02 may build at the same time (both edit `sync-rules.ts` and `sync-rules.test.ts`, in different functions: the later land merges `master`). 03 after 02 has landed. 04 after 01 and 03 have landed. 05 after 04 is deployed to the VPS.

## Overlap with F032 and F062

| Ticket | Shared place | What each does | Order |
| --- | --- | --- | --- |
| F032 copy below cursor (planned separately) | `mail/sync.ts` `checkReturnedBelowCursor` (the `copiesBelowCursor` branch, fact F3) | This plan does not change that function (D4: a test only). F032 turns its copy branch into an insert of `#n` (with `fetchContent` and `storeCapture`, in the folder lock). | This plan first. |
| F032 | `mail-sync.test.ts` stage-8 tests (8.1 "copies 0" log line, 8.2 copy, 8.4) | Stage 04 changes 8.4 only. F032 changes 8.2 and the `copies` count. | F032 merges `master` after stage 04. |
| F032 | `docs/capabilities/sync.md` Limits, `docs/architecture.md` line 344, `docs/known-alerts.md` "returned below cursor" entry | This plan removes the F029 and F064 Limits lines and adds the finder text. F032 removes its own line and fixes line 344. | Either order; the later one merges. |
| F032 | Copy numbering `copyDedupKey(base, copies.length + 1)` | D1 keeps it. F032 uses the same rule for a below-cursor `#n`. | — |
| F032 | The finder (stage 03) | A gone row cannot be a copy (its mail left its folder), so the finder has no copy branch. F032's copy case (the original still in its folder) is never a finder hit. | — |
| F062 column renames | `emails.inbox_uid`, `emails.undo_pending_at` (read by `listMoveCandidates`, written by the guards) | This plan uses the current names. F062 renames them later in every query, this plan's new ones included. | This plan first (no migration here; F062 has one). |

Note for the F032 planner: F032's premise "Interia may keep the UID on a COPY back to INBOX" does not match fact F6 (a protocol COPY gets a new UID). The case that does put a copy below the INBOX cursor is the Interia re-sort after a COPY into a tab folder (ADR 0014 F12: the mail lands in INBOX with its `Oferty` COPYUID, minutes later, possibly after newer INBOX mail moved the cursor).

What the F032 plan should take from here (an outside edit for the coordinator, § Outside edits): `Plan after: F029` (it reads D1 and the stage 01 shape of `check_folder`) and `Build after: F029`.

## How to run (coordinator)

1. Before stage 01: `scripts/plan-drift.sh spec/features/planned/F029-sync-return-of-a-later-copy d70e2bf`; exit 1 → a refresh job (`.agents/limen/planner.md` § Refresh job). Move the folder to `spec/features/active/` and commit before the first spawn (a worktree sees only committed files).
2. Per stage (one job each; 01 and 02 may run at the same time; see § Stages for the order):
   ```
   limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
     --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
     --prepare 'bash scripts/limen-prepare.sh' --label "<what the stage changes> · F029" \
     'Implement F029 stage NN. Read spec/features/active/F029-sync-return-of-a-later-copy/ticket.md, plan.md and stages/stage-NN-<slug>.md; build every step of that stage. Final proof: the Proof command of plan.md for your stage (/tmp/f029-sNN), one bash call with nothing after it, run after the last commit; read the logs in a separate call. In the final message, list as proven only what a saved log shows.'
   ```
3. Review before the land for 01, 03, 04 (§ Review). Land with `limen land <job> --yes --keep-open`; drop the job DB after the land (`spec/build.md` TRACK). No DB migration, so no `db:migrate` step.
4. Advisory overlaps (start anyway; a land conflict → `limen continue <job> "merge master, resolve, prove again"`): `mail/jobs.ts` (F100 stage 07, F103 stage 10, F104 stage 06, F085 when planned), `mail/sync.ts` (F103 conversion, F032), `docs/capabilities/sync.md` (F100 stage 07, F104, F032), `mail-sync.test.ts` (F032), `mail/flags.ts` and `mail-flags.test.ts` (F100 stage 15 reads `email_flags`; no edit known). Add the F103 spawn sentences of `spec/features/planned/F103-e8a-logs/plan.md` § How to run step 8 that apply at spawn time (after F103 stage 01: the field kind lists; after the conversion stage of `mail/`: the lint error level).
5. Stage 05 is no worker job: the coordinator runs its checks after the next VPS deploy that holds stage 04 (pre-approved). Owner step O1 is optional and not a stop.
6. Land stage 04 with `--keep-open` too. After the stage 05 checks, write their results into this file's Log (the folder is still in `active/`), then close both tickets: move `spec/features/planned/F064-sync-return-to-other-folder/` to `spec/features/active/`, commit, and run `limen ticket done F029 F064`.

## Outside edits for the coordinator

- `spec/features/planned/F032-copy-below-cursor/ticket.md`: add `## Sequenced` with `- Plan after: F029 (its plan: spec/features/planned/F029-sync-return-of-a-later-copy/plan.md, D1 and § Overlap with F032 and F062).`, `- Build after: F029.` and `- Gate: —.`
- `spec/build.md` NEXT, line of `F029-sync-return-of-a-later-copy`: replace `needs plan` with `plan landed, 5 stages, F029 + F064, no migration`; line of `F064-sync-return-to-other-folder`: `planned in F029 (one plan)`; line of `F032-copy-below-cursor`: it says `plan landed`, but its folder holds only the old one-job task file; write `needs plan; plan after F029`.

## Planning progress

- [x] Collect: ticket F029, F064, F032 (old task files), F058 plan D4–D9, D24, ADR 0014, architecture §6.1, Interia notes, F100 plan D6 and stage 06 code, F103 D19, F104 jobs wiring, F062 goal, code at `d70e2bf` (sync, sync-rules, flags, jobs, repo copies/emails/folders/flags, locate, imap client, fake, the sync and flag tests).
- [x] ticket.md, plan.md, questions.md
- [x] stage files 01–05 (2026-11-14)
- [x] cold review 1 (`plan-review-1.md`): findings fixed (§ Cold review)

## Cold review

Review 1 ([plan-review-1.md](plan-review-1.md), job `2026-11-14-f029-plan-review-6ea7c766`, Opus 5.5 high, candidate `20151cb`): FAIL, 1 blocking, 4 major, 10 minor. All fixed or answered; none rejected. Its checks: no line drift at `d70e2bf` (plan-drift exit 0), the capture and the flag refresh untouched, the F032 and F062 overlap right.

| Finding | What changed |
| --- | --- |
| B1 ticket says no IMAP call in a pass; D1 adds locates | Ticket acceptance and Done when 5: the finder adds no call in a pass; the later-copy check adds at most 4 locates for a mail with several copies |
| M1 rule "mail-flags.test.ts unchanged" vs stage 04 new cases | Rules for every stage: old cases unchanged except the five `toEqual` lines and one assertion; stage 04 adds cases; stage 04 step 2 says so |
| M2 cost not measurable at `LOG_LEVEL=info` | D12: `user_moves_checked` and `user_moves_retry` are info lines; stage 03 algorithm and tests 3.9, 3.14; stage 05 check 4 reads the line; the wrong SQL estimate is gone |
| M3 O1 can record a wrong Interia fact | O1 asks for a mail older than the newest `Oferty` mail; stage 05 steps 7–9 judge by the row's UID against the `Oferty` cursor |
| M4 `AI/Spam` → provider spam folder gets "wrong" | Kept the owner's rule (ADR 0014 D8, not re-opened); the case is in D8, the edge table and Q5 (now `[important: user-visible]`, with the "filed" option as a new ticket); stage 05 check 5 counts it |
| m1 line references | F4 (98 lines), F5 (27–70, 54–64), F13 (`modules.md` 141/142/144, `architecture.md` 332); stage 01 docs line 332 |
| m2 `retry` not logged | `user_moves_retry` info line (D12, stage 03) |
| m3 test 3.11 counts setup calls | Stage 03 test 3.11 counts only the calls after the setup |
| m4 relative links break after the move to `active/` | `plan.md` header and the F064 ticket use repo paths |
| m5 F032 board word and premise | § Overlap: a note for the F032 planner (a COPY gets a new UID; the real case is the re-sort); § Outside edits: the F032 board line says `needs plan; plan after F029` |
| m6 D2 fact without a source | D2 says "not measured"; stage 05 check 6 measures the largest copy count |
| m7 rollback ignores its tag | Stage 05 rollback uses `ea-server:pre-f029` and removes it after 24 h |
| m8 `listMoveCandidates` missing in the `repo/` row | Stage 04 step 4 adds it to `modules.md` line 144 |
| m9 more locates, more false "gone" | D1 names the risk (ADR 0014 limit (h)) and why it is low |
| m10 stage 05 log after the folder moved to `done/` | How to run step 6: stage 04 lands with `--keep-open`; both tickets close after stage 05 |

## Log

- 2026-11-14: Plan written at `d70e2bf` (the planning branch was fast-forwarded from `2170da8` to `master` to read the F100 stage 06 flag refresh).
- 2026-11-14: Cold review 1 (FAIL, 1 blocking, 4 major, 10 minor) filed as `plan-review-1.md`; all findings fixed (§ Cold review).
