> **Status 2026-11-15 — planned.** Plan base: 09789b10. 3 stages; none built.

# F032 · Store and triage a copy that lands below the UID cursor

Questions: [questions.md](questions.md). Facts: [plan-facts.md](plan-facts.md). Sibling plan: `spec/features/<lane>/F029-sync-return-of-a-later-copy/plan.md`.

## Input

Job instruction (2026-11-14): "keep one design with them; do not redo what they built." Old goal: "Store such a copy as `#n` and triage it: body fetch and the chunk insert path."

### Decisions

- **P1 (owner, ticket).** A copy below the cursor is stored as `#n` and triaged like any new mail.
- **D1 What a copy is.** The existing copy hit of `checkReturnedBelowCursor` (`mail/sync.ts`): a meta of folder S at a moved row's `inbox_uid` or `uid`, with its identity, while the row's mail is still in its system folder. Rejected: a scan below the cursor (cost grows with the folder). Unknown mail stays out (Q1).
- **D2 Copy rule** (pure `decideBelowCursorCopy`, `sync-rules.ts`), in order:
  1. a copy of the identity has a fresh move marker → `move_in_flight` (as `decideIncoming`);
  2. a copy other than the moved row has `uid` = the hit UID, in any folder → `held`. With one UID counter (Interia) the user moved that copy's mail into S; the move finder owns it, and a duplicate would block it. With per-folder UIDs an equal number can hide a true copy; it stays counted (Q5). Rejected: only copies in synced folders (a mail moved back from `AI/*` would get a duplicate);
  3. a copy that this run matched or stored in a folder other than S → `cross_copy` (Q3);
  4. else `store`, key `copyDedupKey(baseKey, copies.length + 1)`.
  Rejected: pass the hit through `planChunk` (its `update_uid` would move a row in S to the copy's UID and lose that mail).
- **D3 Key and row.** Base key from the meta's Message-ID and hash. `copies` = the DB rows of that identity, the copies planned earlier in this check and this run's stores (`state.newKeys`), deduplicated by dedup key. Row = `newRow(...)`: `folder` = `source_folder` = S, `uid` = `inbox_uid` = hit UID, `received_at` = INTERNALDATE, status `pending`.
- **D4 Write.** `fetchContent(S, uid)` outside the transaction. In the existing per-chunk transaction of the check (folder lock, cursor check), after that chunk's returns: read the copies again and run the rule again; only a second `store` inserts, with its key; then `storeCapture` when the insert stored the row. Reason: sync runs are not serialized and a copy insert does not move the cursor, so a run that read before another run's commit would store a second copy; the re-read also sees a new Undo marker. An insert that answers `false` (key conflict, tombstone) stores nothing, no error. `CursorMovedError`: today's warning and end of the check.
- **D5 Run state.** After the commit only, each stored copy enters `RunState` as a chunk insert does (`newKeys`; `matched` `run:<key>` → S); the check gets the run state as a parameter.
- **D6 Held metas before the match.** Per chunk one read `listFolderRowsAtUids(S, uids)` and pure `dropHeldMetas`: a meta at a UID that a row of the same identity holds in S is dropped before `matchReturned`. Reason: `matchReturned` gives each row one hit; a stored copy at the row's `inbox_uid` would take it and hide a real return at the row's `uid`. Replaces the per-hit `listFolderUids` read.
- **D7 Counts and logs.** `copiesBelowCursor` keeps its meaning (found) and the old line its shape. New `SyncResult.copiesStored`; `stored` and `captureMissing` include copies. New event lines: `log.info("sync_below_cursor_copies_stored", { mailbox_id, folder_key, count })` when the count is above 0; `log.debug("sync_below_cursor_copy_skipped", { mailbox_id, email_id, kind })` per copy not stored, `email_id` = the moved row's id (never a `run:` id: it holds the Message-ID), `kind` ∈ `move_in_flight`, `held`, `cross_copy`, `uncertain`, `not_inserted`. No order with F103 stage 10: use the log form at HEAD. No path, address or subject.
- **D8 Triage.** No change: the worker claims the `pending` row; age rules apply (Q4).
- **D9 Cost.** Per chunk one DB read (replaces up to 100); per copy two reads; per stored copy one `fetchContent`.
- **D10 Docs** (PD-009, stage 02): `docs/capabilities/sync.md` rule 11 and Limits; `docs/architecture.md` §6.1; the `known-alerts.md` entry of the `returned below cursor` done line; `docs/modules.md` mail rows.
- **D11 Store only a sure copy.** Store only when the folder check found the row's mail at the row's own `uid`. Found only at another UID (the SEARCH fallback) → kind `uncertain`, not stored: it can be an untracked twin while the row's mail came back; a store would triage it twice and hide the return from the move finder. The folder check returns the found UID, not a boolean.

### Edge cases

- **Repeat:** the stored row holds the UID, so the next check drops the meta (D6). A crash before the commit stores nothing; the next sync repeats.
- **Two runs at once:** the folder lock serializes; the re-read (D4) and the unique `(mailbox_id, dedup_key)` stop a second row.
- **Copy deleted before `fetchContent`:** null body, counted in `captureMissing`.
- **Modes:** incremental only; a rescan uses the chunk path.
- **Copy and move back in one interval:** the row is `returned` at the copy's UID; its own mail stays untracked below the cursor. Accepted, as at the plan base.

## Done when

1. A copy in INBOX and in a sort folder becomes `#n` with body, capture row and `pending`. Tests 2.1, 2.3, 2.5, 3.5, 3.6.
2. The next sync shows `copies 0` and stores nothing. Test 2.2.
3. The skip cases of D2, D4 and D11 store nothing. Tests 2.7, 3.1–3.4, 3.7–3.9.
4. A stored copy does not hide a real return. Tests 2.4, 2.6.
5. `mail-sync-capture.test.ts`, `mail-flags.test.ts`, `mail-moves.test.ts` pass unchanged.
6. The D10 docs are changed; `capability-map.test.ts` passes.
7. Each stage's Proof ends `PROOF_OK`.

## Rules for every stage

- A gap or a deviation from a decision is a question in your final message, not a choice.
- Do not change the return branch beyond D6 and D11, `planChunk`/`applyChunk` behaviour, `storeCapture`, `moves.ts` or `flags.ts`.
- No migration, no `bun.lock` change, no new dependency.
- New log lines in event form; do not convert old-form lines. After F103 stage 01, its field kind lists apply.
- A new repository function takes a `TenantContext`, filters `org_id`, and gets a tenant-filter test.
- Integration tests: `withRollback`, the fake provider, the describe's clock, no sleep. Format only your stage's files. No ticket or decision codes in code comments.
- End the final message with `Decisions for the owner` (`.agents/limen/styleguide.md`).

## Proof

One bash call after the last commit; read the logs in a separate call.

```
mkdir -p /tmp/f032-sNN && bun run lint > /tmp/f032-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f032-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f032-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f032-sNN/int.log 2>&1 && echo PROOF_OK
```

## Review

Stage 02: a review job before the land, `claude-opus-5-5`, high (`[risky]` sync and dedup); it may run `bun run test:int:ci`. Stage 01 lands on the proof (no caller; the stage 02 review reads its rules). Stage 03 lands on the proof unless it fixes code; then it gets the same review.

## Stages

| # | Stage | Size | Marks |
| --- | --- | --- | --- |
| 01 | [Copy rule and held rows](stages/stage-01-copy-rule.md) | ~200 lines | — |
| 02 | [Store the copy, core tests, docs](stages/stage-02-store-copy.md) | ~280 lines | [risky], review |
| 03 | [Edge-case tests](stages/stage-03-edge-tests.md) | ~250 lines | — |

In order; each after the one before lands. No owner checkpoint or owner step.

## How to run (coordinator)

1. `scripts/plan-drift.sh spec/features/planned/F032-copy-below-cursor 09789b10`; exit 1 → a refresh job. Move the folder to `active/`, commit.
2. Per stage: `limen spawn` with the TRACK worker flags, `--prepare 'bash scripts/limen-prepare.sh'`, label `<change> · F032`, task "Implement F032 stage NN. Read spec/features/active/F032-copy-below-cursor/ticket.md, plan.md and stages/stage-NN-<slug>.md. Final proof: plan.md § Proof with /tmp/f032-sNN, after the last commit." If F103 stage 10 is on `master`, add: "Follow the F103 event names of `mail/` at HEAD."
3. Land 01 and 02 with `--keep-open` (02 after its review); 03 closes the ticket. Drop each job DB.
4. After the deploy: count 7 days of `copies` above 0 and `sync_below_cursor_copies_stored` lines into the open row of `notes/2026-11-07-assist-actions-facts.md`. Not a stop.
5. Advisory overlaps: `mail/sync.ts` (F103 stage 10), `sync.md`, `known-alerts.md`; a conflict → merge `master`, prove again.

## Planning progress

- [x] ticket, plan, questions, facts; stages 01–03 [written]; cold review 1. Word counts: § Log.

## Cold review

Review 1 ([plan-review-1.md](plan-review-1.md)): `claude-opus-5-5`, high, because stage 02 is `[risky]` (sync and dedup). PASS, 0 blocking, 5 major, 6 minor. All fixed; one suggested fix (M4: `held` only in synced folders) rejected with its reason in D2. The fix per finding: the § Planner response at the end of `plan-review-1.md`.

## Log

- 2026-11-15: plan written at `09789b10`; the old idea note is replaced.
- 2026-11-15: cold review 1 filed and fixed. `wc -w`: plan.md 1500, stage 01 695, stage 02 697, stage 03 547, ticket.md 441.
