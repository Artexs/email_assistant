---
opened: 2026-11-20
landed: 2026-11-20
---

# F159 · The English approval text says "1 time", and an empty quote shows no false cut note

## Outcome

The English text for a failed send reads "1 time", not "1 times". A card with an empty quote and a too-long body no longer shows "Quoted original:" with an empty text and a false note that the quote was cut. Dead code that the mutation run found in the approval card is removed.

## Scope

- English `approvals.causes.tries` in `packages/core/src/texts/` (the Polish text is right).
- The quote shrink in `renderApprovalRequest` (`packages/core/src/channels` or its current home): an empty quote shows no quote block and no cut note.
- Remove the dead second rebuild after the body cut, the `view.subject !== null` check and the `quote === null` check inside the shrink loop, and the unused prefix arithmetic in `chatQuoteText`, only where a test proves they never change output.

## Out of scope

- Other texts, other cards, and the Polish text.
- The 16 equivalent mutants beyond this dead code.

## Acceptance

- `tries(1, "")` in English reads "1 time"; the exact text is asserted.
- A card with an empty quote and a body over the card limit has no "Quoted original:" line and no cut note; the exact card is asserted.
- The mutation results in `results/stage-05.md` of the weak-core-tests ticket (F154) list fewer survivors in `renderApprovalRequest` and `chatQuoteText` after the dead code is gone.

## Notes

Found by the F154 stage 05 mutation run; details in its `results/stage-05.md` § Bugs and `stage-05-question.md` option 2. Low priority.
