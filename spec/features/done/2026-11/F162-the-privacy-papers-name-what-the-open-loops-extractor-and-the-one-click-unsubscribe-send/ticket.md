---
opened: 2026-11-20
landed: 2026-11-20
---

# F162 · The privacy papers name what the open-loops extractor and the one-click unsubscribe send

## Outcome

The privacy page, the claims ledger and the DPIA draft say what the open-loops extractor sends to the model and what request the server sends after a one-click unsubscribe tap. The `open_loops` flag is already on for the pilot organization, but the papers do not name the extractor call. The legal papers fix (F153) left these items out and promised this ticket before either flag went on.

## Scope

- Items left out by plan P8 of the claims-ledger ticket (`spec/features/done/2026-11/F153-…/plan.md`, `questions.md`): the one-click unsubscribe line, `members` in `unsubscribe-data`, the report-mail line, the open-loops extractor call.
- Start at `docs/legal/claims.md` (new rows after C262) and the text tables in `packages/core/src/legal/`.
- Read the code to state each field that leaves the server: the extractor prompt input in the open-loops module, the unsubscribe request in the mail module.
- A changed privacy text adds a terms version, like the earlier legal batches.

## Out of scope

- A change to what the extractor or the unsubscribe sends.
- Turning `open_loops` or `bulk_unsubscribe` on or off.

## Acceptance

- Each new claim row names the code that proves it, and the claims checks pass.
- The privacy page in en and pl names the extractor call and its fields.
- The privacy page in en and pl names the one-click unsubscribe request.
- The `deploy/README.md` line "The privacy text does not yet name the one-click request" is gone.

## Notes

- Source: `docs/owner-decisions.md`, entry "F153 plan P8" (2026-11-20).

## Slices

Four stages, one worker job each: 01 first; then 02 and 04 next to each other; 03 after 02. No DB migration, no `bun.lock` change. Detail: `plan.md` § How to run.

## Sequenced

Plan after: none.
Build after: none (the legal papers fix that added rows C261, C262 and the first version of 2026-11-20 is in `done/`, F153). Gate: none; stage 01 adds a legal version, which the coordinator names in the notes of the release after v0.4.4.
