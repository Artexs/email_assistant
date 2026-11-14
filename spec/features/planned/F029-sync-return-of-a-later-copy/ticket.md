---
opened: 2026-11-07
---

# F029 · Sync sees every user move of a known mail: a later identical copy, and a move below a folder's cursor

## Outcome

When the user moves a known mail back or between folders, the stored row follows the mail, also in two cases that the sync misses today. First: two identical copies sit in one folder and the user moves the later one back. Second: the user moves a mail into a synced folder that is not the row's source, and the mail keeps a UID below that folder's cursor (the follow-up ticket F064 of the sort-folder sync, ADR 0014 known limits (a), (f), (g)). No identical copy is stored and triaged again, and an action on such a row no longer ends `mail_not_found` because the row names the wrong folder.

## Scope

- The later-copy case: the folder check of an incoming mail tries every known identical copy in copy order (at most 5), not only the first one. Seam: `decideIncoming` in `mail/sync-rules.ts`.
- The below-cursor case: a move finder takes the mail that the flag refresh of the measure ticket (F100, stage 06) could not find in its folder, and looks for it at the same UID in the synced folders. Seam: the flag block of `syncOne` in `mail/jobs.ts`.
- Both cases use the existing writes `returned` (a system-moved row) and `relocated` (a row in its source folder).
- The F064 ticket is planned in this folder.
- Decisions, stages and the overlap with F032: [plan.md](plan.md).

## Out of scope

- Store and triage a copy that lands below the cursor (F032): its own plan, built after this one.
- The column renames and the end of the cursor dual write (F062): no migration here.
- A user move of mail received more than 30 days ago (outside the flag refresh window).

## Acceptance

- Two identical copies in `AI/Spam`, the later one moved back to INBOX: that row is `returned`, and no `#3` row exists.
- A mail moved by the user into a synced folder below that folder's cursor: after the next flag refresh (at most 10 min), the row has the new `folder`.
- That row is `returned` when the system had moved it, else `relocated`.
- Test 8.4 of `mail-sync.test.ts` asserts the new result instead of the known limit.
- The move finder makes no IMAP call in a sync pass; a flag refresh adds at most (synced folders) × 6 UID fetches.
- The later-copy check adds at most 4 more locates, and only for an incoming mail with several known identical copies in other folders.
- All checks: `plan.md` § Done when (9 items).

## Slices

One worker job per stage (`plan.md` § Stages, § How to run). Stages 01 and 02 may build at the same time; 03 after 02; 04 after 01 and 03; 05 is a coordinator check after 04 is deployed. No migration and no `bun.lock` change. No owner stop; owner step O1 (one webmail move) is optional.

## Sequenced

- Plan after: none. F091 (repository split) and F100 stage 06 (flag refresh) are on `master` at the plan base `d70e2bf`.
- Build after: F091 (in `done/`). Only stage 06 of F100 is needed, and it has landed.
- Gate: —. This plan builds before F032 and F062 (`plan.md` § Overlap with F032 and F062).

## Notes

- Owner verdict 2026-11-14: keep F029, F032 and F064 as one sync ticket (`docs/owner-decisions.md`). The coordinator plans F032 separately (job instruction 2026-11-14).
