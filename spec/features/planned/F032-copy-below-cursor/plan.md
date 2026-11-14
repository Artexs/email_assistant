> **Status 2026-11-15 — planned.** Plan base: 09789b10. 2 stages; none built.

# F032 · Store and triage a copy that lands below the UID cursor

Ticket: [ticket.md](ticket.md). Questions with defaults: [questions.md](questions.md). Sibling plan (same sync design, built first): `spec/features/active/F029-sync-return-of-a-later-copy/plan.md` (repo path: that folder moves to `done/`).

## Input

Job instruction (2026-11-14), word for word:

> Plan F032 (a copy that lands below the UID cursor is stored and triaged). […] It is one sync ticket with F029 and F064: read spec/features/active/F029-sync-return-of-a-later-copy and F064 (stages 01-04 landed, F091 landed) and keep one design with them; do not redo what they built.

Old F032 goal (2026-11-07):

> S3 stage 6 only logs and counts a copy that lands below the UID cursor. Interia may keep the UID on a COPY back to INBOX. The sync then does not see the mail as new. Store such a copy as `#n` and triage it: body fetch and the chunk insert path.

F029 plan § Overlap: "F032 turns its copy branch into an insert of `#n` (with `fetchContent` and `storeCapture`, in the folder lock)"; "Copy numbering `copyDedupKey(base, copies.length + 1)`. D1 keeps it. F032 uses the same rule."

### Decisions

- **P1 (owner, ticket).** A copy below the cursor is stored as `#n` and triaged like any new mail. Not re-opened.
- **D1 What a copy is.** Only the existing copy hit of the end-of-run check (`checkReturnedBelowCursor`, `mail/sync.ts`): a non-`\Deleted` meta of folder S at a moved row's `inbox_uid` or `uid`, with the row's identity, while the row's mail is still in its system folder. No new detection. Rejected: a scan of all UIDs below the cursor of S (cost grows with the folder). Out: mail that no row knows (ticket § Out of scope).
- **D2 Copy rule** (pure, `sync-rules.ts`, `decideBelowCursorCopy`, stage 01), in this order:
  1. any copy of the identity has a fresh move marker (`movePendingAt` younger than `MOVE_PENDING_MAX_AGE_MS`) → `move_in_flight` (as `decideIncoming`; architecture §6.1 D22);
  2. a copy other than the moved row has `uid` equal to the hit UID, in any folder → `held` (at Interia that copy's mail was moved into S; the move finder of F064 owns it; a store would make a duplicate that blocks the finder);
  3. a copy that this run matched or stored in another folder than S → `cross_copy` (D7 of the sort-folder sync: one mail in two synced folders is stored once);
  4. else `store` with `copyDedupKey(baseKey, copies.length + 1)`.
  Rejected: run the hit through `planChunk`/`decideIncoming`. Its `update_uid` outcome would give a row in S at another UID the copy's UID and lose that mail, and its folder check locates the row's folder a second time.
- **D3 Key and row.** The base key comes from the meta's own Message-ID and hash (as for any incoming mail). `copies` = the DB rows of that identity, plus the copies that this check planned earlier, plus this run's stores (as `planChunk` merges `state.newKeys`). The row is `newRow(...)` of the chunk path: `folder` = `source_folder` = S, `uid` = `inbox_uid` = hit UID, `received_at` = INTERNALDATE, body ≤ 100 000 characters, status `pending`.
- **D4 Write.** `fetchContent(S, uid)` outside the transaction. The insert and `storeCapture` (only when the insert stored the row) run in the existing per-chunk transaction of the check (folder lock, cursor equality), after the returns of that chunk. An insert that answers `false` (key conflict, tombstone trigger) stores nothing and raises nothing. `CursorMovedError` keeps today's path (warning, end of the check); nothing of that chunk is stored.
- **D5 Run state.** After the commit, each stored copy enters `RunState` as a chunk insert does (`newKeys`, `matched` `run:<key>` → S). Never before the commit (a failed chunk leaves no entry). `checkReturnedBelowCursor` gets the run state as a new parameter.
- **D6 Held metas before the match.** Per chunk, one read `listFolderRowsAtUids` (S, fetched UIDs) and a pure `dropHeldMetas`: a meta at a UID that a row of the same identity holds in S is dropped before `matchReturned`. Reason: `matchReturned` gives each row one hit; after F032 stores a copy at a row's `inbox_uid`, that meta would take the row's hit and hide a real return at the row's `uid` (test 2.9). It replaces the per-hit `listFolderUids` read. Rejected: keep the per-hit check (it skips the hit after the row is used up).
- **D7 Counts and logs.** `copiesBelowCursor` keeps its meaning (copies found), so the old info line keeps its shape (F103 stage 10 converts it). New `SyncResult.copiesStored`. `stored` and `captureMissing` include stored copies. New lines (event form, `platform/log-fields.ts` names): `log.info("sync_below_cursor_copies_stored", { mailbox_id, folder_key, count })` once per check when the count is above 0; `log.debug("sync_below_cursor_copy_skipped", { mailbox_id, email_id, kind })` per copy not stored, `kind` ∈ `move_in_flight`, `held`, `cross_copy`, `not_inserted`. Never a path, address, subject, Message-ID or `error.message`.
- **D8 Triage.** No triage change. The `triage.worker` claims the `pending` row; the age rules apply as to any stored mail (a copy of mail older than 7 days ends `too_old`). Same as a `#n` above the cursor.
- **D9 Cost.** Per chunk of the check: one DB read (replaces up to 100). Per copy: one `findCopies` read; per stored copy one `fetchContent`. No IMAP call added when the check has no copy hit.
- **D10 Docs** (PD-009, stage 02): `docs/capabilities/sync.md` rule 11, Limits (the F032 line goes), "Checked against" line; `docs/architecture.md` §6.1 "Returned below the cursor"; `docs/known-alerts.md` entry of the `returned below cursor: checked …` line (Cause, Fix, new info line); `docs/modules.md` mail rows when they name functions.

### Edge cases

- **Repeat:** the stored row holds the UID in S, so the next check drops the meta (D6): `copies 0`. A crash before the commit stores nothing; the next sync repeats the check.
- **Two runs at once:** the folder lock serializes; the unique `(mailbox_id, dedup_key)` makes the second insert `false`.
- **Copy deleted before `fetchContent`:** empty content, the row is stored with a null body and counts in `captureMissing` (as the chunk path).
- **Gap in copy numbers** (`#1`, `#3`): the key `#3` conflicts, nothing is stored, the copy is counted again each sync while the row is in the 7-day window (Q2).
- **Modes:** the check runs only in incremental mode (as today). A rescan sees the copy above its window start and the chunk path handles it.
- **Tenants:** `listFolderRowsAtUids` filters `org_id` and `mailbox_id`; a two-organization test.

## Facts checked (at `09789b10`, 2026-11-15)

- **F1** `checkReturnedBelowCursor`: chunks of 100 rows (`RETURN_CHECK_CHUNK`); per hit `listFolderUids`, then `isStillInFolder`; the copy branch only counts and logs debug; per chunk one transaction with `lockSyncFolder` and the cursor check; `CursorMovedError` → warning and `break`; called only in incremental mode, after the last chunk.
- **F2** `matchReturned` skips `\Deleted`, takes each row once (`!hits.has(candidate.id)`), and an `inbox_uid` match wins over a `uid` match.
- **F3** The chunk insert: `planChunk` calls `fetchContent` and pushes `{ kind: "insert", row, capture }`; `applyChunk` calls `storeCapture` only when `insertEmail` stored the row, else counts `missing`. `insertEmail` sets `inbox_uid` = `uid` and does `ON CONFLICT DO NOTHING`.
- **F4** `fetchContent` gives `{ text: null, capture: null }` for a missing UID (IMAP adapter and fake).
- **F5** `findCopies` returns `movePendingAt`; `listRecentlyMoved` does not read `undo_pending_at`.
- **F6** Interia: a protocol COPY gets a new UID; a webmail move keeps it (`notes/2026-11-07-assist-actions-facts.md`). The UID of a webmail copy is not known.
- **F7** Tests that assert today's copy result: in `mail-sync.test.ts`, "a copy back to INBOX that leaves the mail in its folder is counted, not returned" and "8.2 a mail still in AI/Info with an identical copy in Oferty at its UID is a copy, not a return".
- **F8** `mailbox_id`, `email_id`, `count`, `kind`, `folder_key` are in `platform/log-fields.ts`.
- **F9** The tombstone trigger makes `insertEmail` answer `false` (`docs/capabilities/sync.md` rule 19).

## Not verified

- **NV1** Whether copies below the cursor happen at Interia at all: the stage-20 week of S3 never ran. How to run step 4 reads it after the deploy.

## Done when

1. A copy below the cursor in INBOX and in a sort folder is stored as `#2`, with body, capture row and `pending`; the moved row is unchanged. Tests 2.1, 2.3, 2.10.
2. The second sync shows `copies 0` and stores nothing. Test 2.2.
3. Move in flight, held UID, cross copy and a key conflict store nothing. Tests 2.4–2.8.
4. A real return is not hidden by a stored copy. Test 2.9.
5. `mail-sync-capture.test.ts`, `mail-flags.test.ts` and `mail-moves.test.ts` pass unchanged.
6. The docs of D10 are changed and `capability-map.test.ts` passes.
7. The Proof of each stage ends `PROOF_OK`.

## Rules for every stage

- Read `ticket.md`, this file and your one stage file. A gap or a deviation from a decision is a question in your final message, not a choice.
- Do not change the return branch beyond D6, `planChunk`, `applyChunk`, `storeCapture`, the move finder (`moves.ts`) or the flag refresh.
- No migration, no `bun.lock` change, no new dependency.
- New log lines in event form only; do not convert the old-form lines of `sync.ts` (F103 does that).
- Every new repository function takes a `TenantContext`, filters `org_id`, and gets a tenant-filter test.
- Integration tests: `withRollback(db, …)`, the fake provider, the fixed clock of the describe you extend, the Interia shape of that describe. No sleep.
- Format only your stage's files (`bunx prettier --write <files>`).
- No bare ticket or decision codes in code comments: state the rule.
- End the final message with `Decisions for the owner` (`.agents/limen/styleguide.md`).

## Proof

One bash call after the last commit, nothing after it; read the logs in a separate call. `NN` = stage number.

```
mkdir -p /tmp/f032-sNN && bun run lint > /tmp/f032-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f032-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f032-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f032-sNN/int.log 2>&1 && echo PROOF_OK
```

## Owner checkpoints and owner steps

None.

## Review

Stage 02 gets a review job before the land: `claude-opus-5-5`, high (`[risky]`: sync and dedup, `spec/build.md` TRACK). It may run `bun run test:int:ci`. Stage 01 lands on the worker's proof (no caller yet).

## Stages

| # | Stage | Size | Marks |
| --- | --- | --- | --- |
| 01 | [Copy rule and held rows](stages/stage-01-copy-rule.md) | ~200 lines | — |
| 02 | [Store the copy, tests, docs](stages/stage-02-store-copy.md) | ~300 lines | [risky], review |

02 after 01 has landed.

## How to run (coordinator)

1. Drift check: `scripts/plan-drift.sh spec/features/planned/F032-copy-below-cursor 09789b10`; exit 1 → a refresh job. Move the folder to `active/`, commit.
2. Per stage:
   ```
   limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
     --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
     --prepare 'bash scripts/limen-prepare.sh' --label "<what the stage changes> · F032" \
     'Implement F032 stage NN. Read spec/features/active/F032-copy-below-cursor/ticket.md, plan.md and stages/stage-NN-<slug>.md; build every step. Final proof: the Proof command of plan.md (/tmp/f032-sNN), one bash call with nothing after it, after the last commit. In the final message, list as proven only what a saved log shows.'
   ```
3. Land 01 with `--keep-open`; review 02, then land it (closes the ticket). Drop each job DB after the land.
4. After the next VPS deploy that holds stage 02, read 7 days of the info lines `returned below cursor` (`copies` above 0) and `sync_below_cursor_copies_stored`; write the counts into the open row of `notes/2026-11-07-assist-actions-facts.md`. Not a stop.
5. Advisory overlaps (start anyway; a land conflict → merge `master`, prove again): `mail/sync.ts` (F103 stage 10), `docs/capabilities/sync.md`, `docs/known-alerts.md`.

## Planning progress

- [x] ticket.md, plan.md, questions.md
- [x] stage 01 [written]
- [ ] stage 02
- [ ] cold review 1

## Cold review

Not run yet.

## Log

- 2026-11-15: plan written at `09789b10`; the old idea note is replaced.
