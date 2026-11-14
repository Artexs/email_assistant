# F029 plan · cold review 1

Job `2026-11-14-f029-plan-review-6ea7c766` (Opus 5.5, high), candidate `20151cb`. Final message, filed whole:

FAIL 20151cb1ff99efbdbfd371b7035207a1a32cef17

The plan fails on one blocking finding: the ticket says a sync pass makes no new IMAP call, and stage 01 adds IMAP calls to a sync pass by design. The fix is one line in the ticket. The plan is sound in all other respects. The code line references hold, the F100 capture and the flag refresh stay intact, and the F032/F062 overlap is right. Four major findings and ten minor findings follow.

HEAD is `20151cb1ff99efbdbfd371b7035207a1a32cef17` and matches the candidate. The tree is clean.

## Blocking (1)

**B1. The ticket acceptance conflicts with stage 01. Proven by reading both.**
- `ticket.md:31` says: "A sync pass makes no new IMAP call; a flag refresh adds at most (synced folders) × 6 UID fetches."
- Stage 01 (D1, `plan.md` line 41) locates up to 5 copies in `planChunk`. That is a sync pass. Today it locates one copy (`sync.ts:244`).
- Stage 01's own test 1.3 (`stages/stage-01-later-copy.md:103`) asserts "two `fetchMetaIn` calls for `AI/Spam`" in one sync.
- So the plan cannot meet that acceptance bullet. A stage 01 reviewer who reads the ticket will FAIL stage 01.
- The intended limit is F064 done-when 3: no IMAP cost per pass that grows with the mailbox, and none from the move finder.
- **Fix:** "The move finder makes no IMAP call in a sync pass. The later-copy check adds at most 4 more locates for an incoming mail with several known copies. A flag refresh adds at most …"

## Major (4)

**M1. A global rule conflicts with stage 04 step 2. Proven by reading both.**
- `plan.md:123` says: "`mail-flags.test.ts` must pass unchanged except the five `toEqual` lines of fact F4."
- Stage 04 step 2 (`stage-04-wiring-and-docs.md:38`, `:61`) adds tests 4.1–4.4 to `mail-flags.test.ts` and extends case 4 (line 144).
- A worker who obeys "a deviation is a question, stop and report" (`plan.md` Rules, first bullet) stops at stage 04.
- **Fix:** let the rule say "old cases unchanged except …; stage 04 adds cases to the describe `flag refresh in the sync job`."

**M2. The cost check of NV2 and Q3 does not measure the cost. Proven by code and config.**
- Q3 is tagged `[important: production]`, and its default rests on "Stage 05 check 4 measures it".
- `stage-05-pilot-check.md:28` greps `dropped_fields`. That line says nothing about cost.
- The candidate count `user_moves_checked` is a debug line (D12). Production runs `LOG_LEVEL=info` (`.env.example:130`), so the line does not show.
- The SQL fallback is called "an upper bound" of gone mail, but it is not one. It counts only rows with `seen = false … AND first_seen_at IS NULL`.
- A mail the user read and then moved or deleted keeps `seen`/`first_seen_at`: `touchEmailFlags` only sets `checked_at` (`repo/flags.ts:96-99`, `:117`). That is the typical gone mail, and the query leaves it out.
- **Fix:** log the candidate count at info level when `gone.length > 0`, for example as a field of `user_moves_found` that is always written, or as an info `user_moves_checked`. Then make check 4 read that line.

**M3. Owner step O1 can record a wrong Interia fact. Proven by tracing the sync code.**
- O1 (`plan.md:146`) moves "one mail that the assistant stored in INBOX more than 10 minutes earlier" into `Oferty`.
- If that mail is newer than the newest `Oferty` mail, its kept UID is above the `Oferty` cursor (one UID counter, fact F6).
- The normal `Oferty` pass then handles the mail (`check_folder` → `relocated`, `sync.ts:233-263`) and writes no `user_moves_found` line.
- Step 6 (`stage-05-pilot-check.md:35`) then says "Interia gave the mail a new UID or re-sorted it". It writes that into `notes/2026-11-03-interia-imap-capabilities.md` and opens a ticket.
- **Fix:** tell the owner to pick a mail older than the newest `Oferty` mail. Or check `emails.uid <= offers.last_uid` first, and judge by the row's `folder`/`uid`, not by the log line.

**M4. A gap with wrong feedback: the user moves an `AI/Spam` mail into the provider spam folder. Plausible.**
- D8 (`plan.md` D8) and Q5 (`questions.md:21`) keep the rule that "a return into another synced folder counts as wrong" (ADR 0014 D8, `F058 plan.md:178-179`).
- Neither one names this case: the system moved a mail to `AI/Spam`, and the user files it into `Wiadomości-śmieci` (role `junk`, synced).
- That user agrees with the system. Yet `triage.returned` marks the move `user_moved_back` and writes `verdict: "wrong"` (`triage/returned.ts:43`, `:57-63`).
- Today this happens only above the junk cursor. With one UID counter and a junk folder that gets mail all the time, most such moves fall below the cursor. So the finder (stage 03) turns this into the common path.
- F100 measures accuracy from feedback rows, so these wrong rows reach the metrics.
- **Fix:** add the case to Q5 as an owner question, or skip feedback when S has role `junk` and the category was spam.

## Minor (10)

1. **Line references have drifted. Proven by reading the files.**
   - F4 (`plan.md:90`) says "flags.ts, 90 lines"; the file has 98.
   - F5 (`plan.md:91`) says `syncOne` is at 27–68 and the flag block at 51–61; they are at `jobs.ts:27-70` and `:54-64`.
   - F13 (`plan.md:99`) says "docs/modules.md lines 137 and 141". Line 137 is the `locate.ts` row; the rows that change are 141, 142 and 144.
   - F13 also says "architecture.md lines 333–344"; the "Known mail" bullet is at 332.
   - All other cited lines match HEAD: F1–F3, F7–F10, F12, F14, F15, `mail-flags.test.ts` 228/238/259/341/350, `sync-rules.test.ts` 213/223/241/257/298/325/335, `mail-repo.test.ts` 575–673/631, `mail-sync.test.ts` 356/1213/1225/1903/1923/1927/2006–2027, and ADR 0014 lines 58–67.
2. **`findUserMoves`'s result is discarded in the job (`stage-04-wiring-and-docs.md:45`).** `retry` (cursor moved) appears in no log line, so a retry that happens again and again cannot be seen. Add `retry` to a line.
3. **Test 3.11 can fail as written (`stage-03-move-finder.md:89`).** It asserts "no `fetchMetaIn` … call", but the `stored` helper (`:72`) calls `fake.fetchMetaIn` during setup. Say "after setup (note `folderCalls.length`)".
4. **Relative links break when F029 moves to `active/` (How to run step 1).** `plan.md:5` links `../F064-…/` and `../F032-…/`, and F064 `ticket.md` links `../F029-…/`. F064 and F032 stay in `planned/`.
5. **F032 board and premise do not agree.**
   - `spec/build.md:71` says F032 "plan landed", but `F032-copy-below-cursor/plan.md` says "Write the file-level plan when the task starts". The outside edits (`plan.md` § Outside edits) do not fix that word.
   - F032's premise "Interia may keep the UID on a COPY" contradicts fact F6 (a COPY gets a new UID, `notes/2026-11-07-assist-actions-facts.md` line 17). The overlap table should say so for the F032 planner.
6. **One fact has no source.** D2 (`plan.md:42`) says "More than 5 identical copies of one mail do not occur in the pilot data", but no query is cited.
7. **The stage 05 rollback does not use the tag it makes.** Step 3 tags `ea-server:pre-f029` (`stage-05-pilot-check.md:15`), but step 7 rebuilds from git (`:19`), and no step removes the tag. Compare F099 stage 15, which rolls back with `docker tag ea-server:pre-f099 ea-server`.
8. **One docs row is missing.** Stage 04 step 4 (`stage-04-wiring-and-docs.md:106`) does not add `listMoveCandidates` to the `repo/` row of `docs/modules.md:144`, which lists the names in `copies.ts`.
9. **More locates mean more chances of a false "gone". Plausible.** D1 locates up to 5 copies per incoming mail. Each locate is one more chance for Interia SEARCH limit (h) (ADR 0014 line 71) to miss a mail that is still there, which gives a false `returned`. The risk is low because the hint UID is tried first. Mention it in D1.
10. **Stage 05 writes to a folder that has already moved.** How to run step 6 (`plan.md:190`) closes F029 at the stage 04 land, but stage 05 results "go to this file's Log", and the folder is in `done/` by then. Say so, or close after stage 05.

## Pre-mortem

The feature shipped and a bug reached the user. These stages let it through:
- **Stage 03 / D8:** wrong "wrong" feedback for `AI/Spam` → junk moves (M4).
- **Stage 05:** the cost of permanently gone mail was never measured, because the debug count is not visible at info level (M2).
- **Stage 05 O1:** a false "Interia changed the UID" fact went into notes (M3).
- **Stage 01 review:** it fails on, or ignores, the conflicting ticket acceptance (B1).

## Topics checked with no finding

- **F100 header capture (storeCapture savepoint):** not affected. Stage 01 changes only the `check_folder` branch of `planChunk` (`sync.ts:233-264`). The insert branch, `applyChunk` (`:305-310`) and `capture-store.ts:20-26` stay unchanged. Fewer inserts only means fewer captures.
- **Flag refresh:** not affected.
  - Only `gone` is added to `FlagsRefreshResult`. `writeEmailFlags` and `touchEmailFlags` stay unchanged.
  - The finder runs after `flags_refreshed`, inside its own `try`/`catch`.
  - A refresh that throws goes to `flags_refresh_failed` before the finder.
  - No other code compares `FlagsRefreshResult` with `toEqual` (grep).
- **Locks:** the order is folder row, then `emails`, the same as `applyChunk` and `checkReturnedBelowCursor`. The committer (`actions/apply.ts`) takes no folder lock, so no deadlock can occur.
- **Move markers:** the rescue (`apply.ts:255`) and Undo (`undo.ts:69`) set them before the IMAP move. Forward moves go to `AI/*` only (`moveTargets`, `packages/core/src/triage/planners.ts:26`), and the finder does not search there.
- **F032 overlap:** correct. The finder sees only gone rows, and the F032 copy case keeps its original in its folder. The `copyDedupKey` rule is shared. The order "this plan first" fits.
- **F062 overlap:** correct. The plan uses the current column names and adds no migration, and it reads cursors only from `mailbox_folders`.
- **Stage sizes:** each stage fits one job. Stage 03 (one module and 14 cases) is the biggest, and it is still acceptable.
- **Steps a worker could not do without guessing:** only minors 2 and 3, plus M1 (the worker may stop).
- **Test traces:** stage 01 tests 1.1–1.5, stage 04 tests 4.1, 4.3 and 8.4 work as written against the fake's behaviour:
  - the `relocate`/keep-UID logic, and the `fetchAbove` filter;
  - discovery, and the initial cursor `max(uidNext-1, highest)` with `uidNextValue: 1`;
  - the `locateMessage` hint, then search.

## Checks run

- `git rev-parse HEAD` → `20151cb1ff99efbdbfd371b7035207a1a32cef17`.
- `bash scripts/plan-drift.sh spec/features/planned/F029-sync-return-of-a-later-copy d70e2bf` → "named paths: 21; changed since base: 0; gone: 0 / no drift", exit 0. It ran in a bash call joined with `;`, so it does not count as proof for the note check below.
- I verified the line references by reading the cited files at HEAD with `grep` and `sed`.
- I ran no JavaScript test suite. This is a plan review with no code change, so a test run would prove nothing about the plan.

## Counts

blocking 1, major 4, minor 10.

## Note check

- refs-checked (every path, function, line and test name checked at 20151cb): not proven. I did the reads in this session (findings above, minor 1), but no qualifying command (one bash call joined only with `&&`, exit 0) or saved log file holds that evidence. The plan-drift run was joined with `;`.
- sections-covered (a verdict on pre-mortem, gaps, conflicts, guess steps, unsourced facts, stage size, F100 capture / flag refresh, F032/F062): not proven. Each topic has a section in this message, but this message is not a file or a command.
- verdict-format (first line `PASS/FAIL <sha>`, ends with counts): not proven. This message has both, but no file or command holds them.
- Easy-to-miss rule "Quote file and line for each finding": not proven. Each finding above names a file:line, but no file or command holds that evidence.
