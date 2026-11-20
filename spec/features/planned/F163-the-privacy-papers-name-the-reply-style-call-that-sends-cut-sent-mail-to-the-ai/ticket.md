---
touches:
  - packages/core/src/legal
  - apps/web/src/legal
  - docs/legal
opened: 2026-11-20
---
# F163 · The privacy papers name the reply-style call that sends cut Sent mail to the AI

## Outcome
The privacy page, the sub-processor rows, the DPIA and the ledger say what the reply-style suggestion sends to the AI provider: the cut texts of the user's own Sent mail. This must be true before the `style_from_sent` flag goes on for anyone. It follows the same method as the earlier papers ticket for the extractor and the one-click request.

## Scope
- Read `apps/server/src/modules/replies/stylist.ts` and the style suggestion service for the exact input, the limits and the retry rule.
- Update the privacy and terms pages (en, pl), the `openai` and `gemini` registry rows, the DPIA, record B, and add ledger rows.
- Add one legal version entry; add a case to `apps/server/src/legal-outside-calls.test.ts`.

## Out of scope
- Changing the style code or turning on the flag.
- The public security page claim, unless the stylist call changes what it says.

## Acceptance
- The privacy page (en and pl) names the style call and its input.
- `openai` and `gemini` `dataReceived` name it.
- The tie test fails when the stylist input limit changes.
- `bun run check:job` passes.

## Notes
Best built before the next release that carries a legal version, so members accept the terms once.

## Sequenced

Plan after: none.
Build after: none (the papers fix for the open-loops extractor, the one-click request and report mail is in `done/`, F162). Gate: none; stage 01 appends a legal version, which the coordinator names in the notes of the release after v0.4.4 (with `2026-11-20.2`, one re-acceptance).
