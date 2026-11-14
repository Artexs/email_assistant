---
opened: 2026-11-07
---

# F032 · Store and triage a copy that lands below the UID cursor

## Outcome

A copy of a system-moved mail that sits in the mail's source folder below that folder's UID cursor is stored as a new identical copy (`#n`) and triaged. Today the end-of-run check of the sync only logs and counts such a copy, so the user never gets a triage of it. The store uses the same row, body fetch, header capture and `pending` status as any new mail, and a later sync does not count or store it again.

## Scope

- The copy branch of the end-of-run check `checkReturnedBelowCursor` (`mail/sync.ts`): a hit whose row's mail is still in its system folder.
- One pure rule for the copy (store, move in flight, UID held by another row, cross copy) and one repository read.
- A meta at a UID that a row of the same identity already holds in the folder is dropped before the return match, so a stored copy cannot hide a real return.
- Docs of the sync capability, architecture §6.1 and the known alert of the check.
- Decisions, tests and stages: [plan.md](plan.md).

## Out of scope

- A mail that the database does not know and that lands below a cursor (for example an Interia re-sort into INBOX, ADR 0014 limit (h)).
- Copies of mail that the system moved more than 7 days ago (the window of the check).
- Any change to the return branch beyond the held-meta filter, to the move finder (F029/F064) or to triage.
- No migration, no `bun.lock` change.

## Acceptance

- A copy below the cursor gets a row `#n` with body, capture row and status `pending`; the moved row is unchanged.
- The next sync counts `copies 0` for it and stores nothing.
- A move in flight, a UID held by another row and a cross copy store nothing.
- A row whose copy holds its `inbox_uid` is still `returned` when the user moves its mail back.
- All checks: `plan.md` § Done when (7 items).

## Slices

Two worker jobs in order (`plan.md` § Stages, § How to run): 01 pure rules and the repository read; 02 `[risky]` the store in the sync, tests and docs. No owner checkpoint, no owner step.

## Sequenced

- Plan after: F029 (stages exist; this plan uses its D1 copy numbering and its stage 01–04 code).
- Build after: F029 stages 01–04 (on `master` at the plan base `09789b10`). F029 stage 05 (pilot check runbook) does not block.
- Gate: —.

## Notes

- Owner verdict 2026-11-14: keep F029, F032 and F064 as one sync ticket (`docs/owner-decisions.md`); F029 and F064 share one plan in `spec/features/active/F029-sync-return-of-a-later-copy/`.
- Moved from `tasks/planned/copy-below-cursor.md` on 2026-11-12. The old idea note was the first `plan.md` of this folder (git history).
