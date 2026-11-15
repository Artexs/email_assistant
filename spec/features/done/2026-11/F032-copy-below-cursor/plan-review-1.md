# F032 · Plan review 1

Job `2026-11-14-f032-plan-review-a8f35777` (claude-opus-5-5, high), candidate `d6965240`. The final message (`result`), filed whole:

PASS d696524058047b833eadb1864b538177e38381a1

The plan matches the F029 design: the copy numbering, the move marker, the cross-copy rule, the folder lock and no IMAP call inside the lock all follow it. Nothing in it is blocking. The five major findings below are plan gaps that a stage 02 build could ship as a duplicate row, a hidden return or a log leak. Fix them before stage 02 spawns.

HEAD = d6965240…, the same as the candidate, with a clean tree. `scripts/plan-drift.sh … 09789b10` reports no drift (exit 0).

## Blocking
None.

## Unverified
- Integration suites at HEAD (`mail-sync.test.ts` and the others): not run. The plan job has no code, so the fixed test values were checked by reading `fake/index.ts` and `mail-sync.test.ts` at HEAD, not by a run.

## Major

**M1 — Two runs at once can store a duplicate copy (plausible, from the code).**
- **Where:** `plan.md:37` says "the folder lock serializes; the unique `(mailbox_id, dedup_key)` makes the second insert `false`". That holds only when both runs compute the same key.
- **The race:**
  1. Run B does the D6 read (`listFolderRowsAtUids`) at the start of the chunk, before run A commits copy `#2` at (S, uid 10).
  2. Run B then makes IMAP calls (`isStillInFolder`).
  3. Run B calls `findCopies` after A's commit. It sees r1 and `#2` and computes `#3`.
  4. Run B's transaction checks the cursor. A copy insert does not move the cursor (unlike `applyChunk`, `sync.ts:354`), so the check passes.
  5. `#3` is inserted for the same physical mail: a duplicate row and a duplicate triage.
- **Why it can happen:** nothing serializes sync runs of one mailbox. A grep found no advisory lock for sync, and `CursorMovedError` exists for exactly this case.
- **Missing decision:** inside the lock, re-check that no row of the identity holds (S, uid) before the insert. This needs a test.
- **Stage:** 02.

**M2 — A `run:` id can put a Message-ID into a log line (proven from the code; the leak itself is plausible).**
- Test 1.5 (`stage-01-copy-rule.md:55`) returns `cross_copy` with a `run:` id, and `held` can return one too.
- A `run:` id is `run:${dedupKey}` (`sync.ts:241`), and `dedupKey` = `mid:<Message-ID>:<hash>` (`sync-rules.ts:23`).
- D7 (`plan.md:29`) logs `email_id` for each skipped copy and does not say which id. It also says "No … Message-ID".
- After F103 stage 01, `email_id` is a UUID field, so the value is either leaked or dropped.
- **Decide:** `email_id` = the moved row's id (`rowId`), never the id in the decision.
- **Stage:** 02.

**M3 — The order against F103 stage 10 is not decided, so test 2.2 can fail.**
- Test 2.2 (`stage-02-store-copy.md:16`) asserts the old-form text `checked 1, returned 0, copies 0`. The known-alerts entry in D10 (`plan.md:32`) quotes the same text.
- F103 stage 10 (`F103-e8a-logs/stages/stage-10-convert-mail.md:22`) converts that line to `sync_below_cursor_done` and the copy debug line to `sync_below_cursor_copy`.
- `ticket.md` § Sequenced (`ticket.md:36-40`) names no order. How to run step 5 (`plan.md:104`) only says "merge, prove again".
- If F103 stage 10 lands first, the worker must guess the assert and the alert text, and the rule "do not convert old-form lines" (`plan.md:61`) no longer applies to anything.
- **Decide:** name the order, or give test 2.2 for both forms. F029's How to run step 4 adds the F103 spawn sentences; F032 does not.

**M4 — The `held` rule "in any folder" is right only with one UID counter (plausible). Test 2.8 depends on it.**
- D2.2 (`plan.md:21`) gives an Interia-only reason. The INBOX describe uses `interia()` with per-folder UIDs (`fake/index.ts:137,188`).
- In test 2.8 (`stage-02:22`), the mapping r1.uid = 2, r2.uid = 1 in AI/Info (INBOX uids 1 and 2) puts r2 at the hit UID 1. That makes r1's copy `held`, so the test gives one store, not `#3` + `#4`. The result depends on a setup detail that the stage does not state.
- On a server with per-folder UIDs, a number that collides hides a true copy at every sync.
- **Decide:** limit `held` to a copy in a synced folder (where a user move keeps the UID), or state the per-folder behaviour. Fix the setup of test 2.8 and add a test for per-folder UIDs.

**M5 — A false "still in its folder" becomes permanent (plausible). The plan does not name this risk.**
- Under Interia's one UID counter (F6), a hit at the row's own `uid` while the row's mail is still in its folder means that two messages share one UID. That is possible only under NV1.
- Otherwise, it is a locate false positive: an untracked identical mail in the row's folder.
- Before F032 such a hit was only counted, and the next sync tried again.
- With F032, the steps are:
  1. The copy `#2` is stored and triaged again.
  2. The next check drops the meta by D6.
  3. The F064 finder drops the hit, because `#2` holds the UID (F029 D7, `F029 plan.md:47`).
  4. r1 never gets `returned` and stays stale: `mail_not_found` on its actions, and no "wrong" feedback.
- F029 D1 named the same kind of risk. F032 should name it and decide, for example: store only hits at `inbox_uid` on a one-counter server, or accept the risk with the NV1 count.
- **Stage:** 02 (D1/D2).

## Minor

- **m1 — Gap: a copy and a move back in the same check (plausible).**
  - If the copy at `inbox_uid` and the user's move back at `uid` are both present at the first check, `matchReturned` takes the meta at `inbox_uid` first: the fake sorts by UID (`fake/index.ts:375`).
  - `isStillInFolder` is then false, so r1 is `returned` at the copy's UID. The real mail at `uid` stays unknown below the cursor and gets no triage.
  - D6 and test 2.9 cover only the order "copy first, then move back". The plan names no rule for this event.
- **m2 — Race with an Undo (plausible).** If the user taps Undo between the `findCopies` read and the commit, `ensureMoved` can take INBOX `inbox_uid` as r1's target before `#2` is in the `exclude.to` set. Then two rows point at one UID. The chunk path has the same race, so this is only a note. A re-read of the marker inside the lock (see M1) would close both.
- **m3 — D3 needs a dedupe rule.** D3 merges three sources (DB rows, copies planned in this check, `newKeys`), but "merged as `planChunk` does" (`plan.md:25`) covers only two. After a commit, a copy from an earlier chunk is in both the DB and `newKeys`. State "dedupe by `dedupKey`", or test 2.8 across two chunks can get `#5`.
- **m4 — Stage 02 is probably too big.** Stage 02 holds the risky change to the check, 12 integration tests and 4 doc pages under "~300 lines" (`plan.md:88`). Twelve sync tests in this file alone take about 300 lines. The stage file is within 700 words, but the work is about 450 lines or more. Think about moving Step 2 (docs) into its own job.
- **m5 — Board drift.** `spec/build.md:73` still says `needs plan; plan after F029`. The plan names no outside edit for that line.
- **m6 — Stage 01 lands without review.** Stage 01 lands on the worker's proof (`plan.md:81`), but it holds the dedup rule `decideBelowCursorCopy`. The board puts sync or dedup under the Opus reviewer. Only the stage 02 review sees the rule. This is acceptable, but write it down as a decision.

Things I checked and found correct:
- D6 drops the same metas as today's `listFolderUids` per hit.
- The new D6 code leaves three tests at their current results: line 483 (later copy back below the cursor), 2.12, and "another mail at the uid".
- These tests hold against the fake and the code at HEAD: 2.1, 2.2, 2.3 (test 8.2 setup), 2.6 (r1 is matched to INBOX by `sync.ts:277`, so `cross_copy`, then `#3` in the next run), 2.7, 2.9 (with `globalUids`, D6 decides the result) and 2.11.
- Only `mail-sync.test.ts:632` builds a full `SyncResult`.
- F3 is true: a tombstone exists (`erase.ts:130`), and the only delete of `emails` rows is the DSR erase (Q2).
- F7 is true: the log field names are in `log-fields.ts`.

## Checks run
- `git rev-parse HEAD && git status --short | wc -l` → `d696524058047b833eadb1864b538177e38381a1`, 0 changed files.
- `bash scripts/plan-drift.sh spec/features/planned/F032-copy-below-cursor 09789b10` → "no drift", exit 0. It ran in a call joined with `;`.
- `bun install --frozen-lockfile` (Bun 1.4.4 = `.bun-version`) → exit 0.
- `bun test apps/server/src/modules/mail/sync-rules.test.ts` → 77 pass, 0 fail. This is only the baseline at HEAD; it ran in a call joined with `;`.
- `wc -w` → plan.md 1395 (≤ 1500), stage 01 695, stage 02 686 (≤ 700 each).
- Not run: `test:int:ci` (a plan job has no code to prove).

## Note check
- Verdict line starts with the sha and HEAD matches the candidate: proven. `git rev-parse HEAD && git status --short | wc -l` printed d696524058047b833eadb1864b538177e38381a1 and 0.
- Each finding quotes file and line, with a severity and a label: proven. `/home/artek/Documents/repos/email_assistant/.limen/jobs/2026-11-14-f032-plan-review-a8f35777/review-draft.md` (M1–M5, m1–m6).
- Coverage of the categories (pre-mortem, gaps, rule conflicts, guess steps, unsourced facts, fixed test values, stage size, F029 consistency): proven. `review-draft.md`, same path: M1/M5 pre-mortem, m1 gap, M4 rule against provider, M2/M3/m3 guess steps, the test checks, m4 size, the F029 D1/D7 cross-checks.
- Easy-to-miss rule "Missing code detail … is not a finding": followed. `review-draft.md`: no finding asks only for line numbers, edit text or file lists; each names a decision, edge case, test or interface.


---

## Planner response (added by the planning job, not part of the review message)

- M1 concurrent duplicate → D4 re-read and second rule run in the lock; test 2.7.
- M2 `run:` id in a log → D7 `email_id` = the moved row's id.
- M3 order with F103 stage 10 → D7 "log form at HEAD"; test 2.2 names both forms; How to run step 2.
- M4 `held` on per-folder UIDs → D2 names the risk (Q5); tests 3.2, 3.5 use `globalUids`; test 3.8 pins the per-folder case. The suggested limit to synced folders is rejected (D2).
- M5 a false "still there" becomes permanent → D11 (store only at the row's own `uid`); test 3.9.
- m1 copy and move back in one interval → accepted limit (§ Edge cases).
- m2 Undo race → closed by the D4 re-read.
- m3 merge dedupe → D3; test 3.6 across two chunks.
- m4 stage 02 too big → edge tests moved to stage 03.
- m5 board line → outside edit in the final message.
- m6 stage 01 without review → § Review states why.
