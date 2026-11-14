> **Status 2026-11-15 — planned.** Plan base: 09789b10. 2 stages; none built.

# F032 · Store and triage a copy that lands below the UID cursor

Ticket: [ticket.md](ticket.md). Questions: [questions.md](questions.md). Sibling plan (built first): `spec/features/active/F029-sync-return-of-a-later-copy/plan.md`.

## Input

Job instruction (2026-11-14), word for word:

> Plan F032 (a copy that lands below the UID cursor is stored and triaged). […] It is one sync ticket with F029 and F064: read spec/features/active/F029-sync-return-of-a-later-copy and F064 (stages 01-04 landed, F091 landed) and keep one design with them; do not redo what they built.

Old goal (2026-11-07): "Store such a copy as `#n` and triage it: body fetch and the chunk insert path."

### Decisions

- **P1 (owner, ticket).** A copy below the cursor is stored as `#n` and triaged like any new mail.
- **D1 What a copy is.** Only the existing copy hit of `checkReturnedBelowCursor` (`mail/sync.ts`): a non-`\Deleted` meta of folder S at a moved row's `inbox_uid` or `uid`, with the row's identity, while the row's mail is still in its system folder. Rejected: a scan of all UIDs below the cursor (cost grows with the folder). Unknown mail below a cursor stays out (Q1).
- **D2 Copy rule** (pure `decideBelowCursorCopy`, `sync-rules.ts`), in order:
  1. a copy of the identity has a fresh move marker (`MOVE_PENDING_MAX_AGE_MS`) → `move_in_flight` (as `decideIncoming`);
  2. a copy other than the moved row has `uid` = the hit UID, in any folder → `held` (at Interia the user moved that copy's mail into S; the move finder owns it; a store would make a duplicate that blocks it);
  3. a copy that this run matched or stored in a folder other than S → `cross_copy` (one mail in two synced folders is stored once per run; Q3);
  4. else `store`, key `copyDedupKey(baseKey, copies.length + 1)`.
  Rejected: pass the hit through `planChunk`: its `update_uid` would give a row in S at another UID the copy's UID and lose that mail.
- **D3 Key and row.** Base key from the meta's own Message-ID and hash. `copies` = DB rows of that identity + copies planned earlier in this check + this run's stores (`state.newKeys`, merged as `planChunk` does). Row = `newRow(...)`: `folder` = `source_folder` = S, `uid` = `inbox_uid` = hit UID, `received_at` = INTERNALDATE, status `pending`.
- **D4 Write.** `fetchContent(S, uid)` outside the transaction. Insert, then `storeCapture` only when the insert stored the row, in the existing per-chunk transaction of the check (folder lock, cursor check), after that chunk's returns. An insert that answers `false` (key conflict, tombstone) stores nothing and raises nothing. `CursorMovedError`: today's warning and end of the check; nothing of the chunk is stored.
- **D5 Run state.** After the commit, each stored copy enters `RunState` as a chunk insert does (`newKeys`; `matched` `run:<key>` → S); never before it. `checkReturnedBelowCursor` gets the run state as a parameter.
- **D6 Held metas before the match.** Per chunk one read `listFolderRowsAtUids(S, uids)` and pure `dropHeldMetas`: a meta at a UID that a row of the same identity holds in S is dropped before `matchReturned`. Reason: `matchReturned` gives each row one hit; a stored copy at the row's `inbox_uid` would take it and hide a real return at the row's `uid` (test 2.9). Replaces the per-hit `listFolderUids` read, which skips only after the hit is used.
- **D7 Counts and logs.** `copiesBelowCursor` keeps its meaning (found), so the old info line keeps its shape (F103 stage 10 converts it). New `SyncResult.copiesStored`; `stored` and `captureMissing` include copies. New event-form lines: `log.info("sync_below_cursor_copies_stored", { mailbox_id, folder_key, count })` when the count is above 0; `log.debug("sync_below_cursor_copy_skipped", { mailbox_id, email_id, kind })` per copy not stored, `kind` ∈ `move_in_flight`, `held`, `cross_copy`, `not_inserted`. No path, address, subject or Message-ID.
- **D8 Triage.** No change: `triage.worker` claims the `pending` row; the age rules apply (Q4).
- **D9 Cost.** Per chunk one DB read (replaces up to 100); per copy one `findCopies`; per stored copy one `fetchContent`.
- **D10 Docs** (PD-009, stage 02): `docs/capabilities/sync.md` rule 11, Limits, "Checked against"; `docs/architecture.md` §6.1 "Returned below the cursor"; `docs/known-alerts.md` entry `… returned below cursor: checked <n>, returned <m>, copies <c>`; `docs/modules.md` mail rows that list functions.

### Edge cases

- **Repeat:** the stored row holds the UID in S, so the next check drops the meta (D6): `copies 0`. A crash before the commit stores nothing; the next sync repeats.
- **Two runs at once:** the folder lock serializes; the unique `(mailbox_id, dedup_key)` makes the second insert `false`.
- **Copy deleted before `fetchContent`:** stored with a null body, counted in `captureMissing` (F4, as the chunk path).
- **Modes:** incremental only; a rescan sees the copy through the chunk path.
- **Tenants:** `listFolderRowsAtUids` filters `org_id` and `mailbox_id`; a two-organization test.

## Facts and not verified

In [plan-facts.md](plan-facts.md) (F1–F7 at `09789b10`; NV1: whether copies below the cursor happen at Interia, read by How to run step 4).

## Done when

1. A copy in INBOX and in a sort folder is stored as `#2` with body, capture row and `pending`; the moved row is unchanged. Tests 2.1, 2.3, 2.8, 2.10.
2. The next sync shows `copies 0` and stores nothing. Test 2.2.
3. Move in flight, held UID, cross copy, key conflict and a moved cursor store nothing. Tests 2.4–2.7, 2.11.
4. A stored copy does not hide a real return. Tests 2.9, 2.12.
5. `mail-sync-capture.test.ts`, `mail-flags.test.ts`, `mail-moves.test.ts` pass unchanged.
6. The D10 docs are changed; `capability-map.test.ts` passes.
7. The Proof of each stage ends `PROOF_OK`.

## Rules for every stage

- Read `ticket.md`, this file and your one stage file. A gap or a deviation from a decision is a question in your final message, not a choice.
- Do not change the return branch beyond D6, `planChunk`/`applyChunk` behaviour, `storeCapture`, `moves.ts` or `flags.ts`.
- No migration, no `bun.lock` change, no new dependency.
- New log lines in event form; do not convert the old-form lines of `sync.ts`.
- A new repository function takes a `TenantContext`, filters `org_id`, and gets a tenant-filter test.
- Integration tests: `withRollback`, the fake provider, the describe's clock and fake. No sleep.
- Format only your stage's files. No bare ticket or decision codes in code comments.
- End the final message with `Decisions for the owner` (`.agents/limen/styleguide.md`).

## Proof

One bash call after the last commit, nothing after it; read the logs in a separate call. `NN` = stage number.

```
mkdir -p /tmp/f032-sNN && bun run lint > /tmp/f032-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f032-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f032-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f032-sNN/int.log 2>&1 && echo PROOF_OK
```

## Owner checkpoints and owner steps

None.

## Review

Stage 02: a review job before the land, `claude-opus-5-5`, high (`[risky]` sync and dedup). It may run `bun run test:int:ci`. Stage 01 lands on the worker's proof.

## Stages

| # | Stage | Size | Marks |
| --- | --- | --- | --- |
| 01 | [Copy rule and held rows](stages/stage-01-copy-rule.md) | ~200 lines | — |
| 02 | [Store the copy, tests, docs](stages/stage-02-store-copy.md) | ~300 lines | [risky], review |

02 after 01 has landed.

## How to run (coordinator)

1. `scripts/plan-drift.sh spec/features/planned/F032-copy-below-cursor 09789b10`; exit 1 → a refresh job. Move the folder to `active/`, commit.
2. Per stage:
   ```
   limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
     --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
     --prepare 'bash scripts/limen-prepare.sh' --label "<what the stage changes> · F032" \
     'Implement F032 stage NN. Read spec/features/active/F032-copy-below-cursor/ticket.md, plan.md and stages/stage-NN-<slug>.md; build every step. Final proof: the Proof command of plan.md (/tmp/f032-sNN), one bash call with nothing after it, after the last commit. In the final message, list as proven only what a saved log shows.'
   ```
3. Land 01 with `--keep-open`; review 02, then land it (closes the ticket). Drop each job DB.
4. After the deploy of stage 02: count 7 days of `copies` above 0 and `sync_below_cursor_copies_stored` lines into the open row of `notes/2026-11-07-assist-actions-facts.md`. Not a stop.
5. Advisory overlaps (conflict → merge `master`, prove again): `mail/sync.ts` (F103 stage 10), `sync.md`, `known-alerts.md`.

## Planning progress

- [x] ticket.md, plan.md, questions.md
- [x] stage 01 [written]
- [x] stage 02 [written]
- [ ] cold review 1
- Word counts (`wc -w`, before the review): plan.md 1377, stage 01 695, stage 02 686, ticket.md 436.

## Cold review

Not run yet.

## Log

- 2026-11-15: plan written at `09789b10`; the old idea note is replaced.
