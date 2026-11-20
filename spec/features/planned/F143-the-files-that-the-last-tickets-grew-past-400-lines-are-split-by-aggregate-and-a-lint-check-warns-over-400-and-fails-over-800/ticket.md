---
opened: 2026-11-19
---

# F143 · The files that the last tickets grew past 400 lines are split by aggregate, and a lint check warns over 400 and fails over 800

## Outcome

The source files that the last ten tickets grew past 400 lines are split by aggregate, with their history kept and their behaviour unchanged. `bun run lint` warns for every non-test source file over 400 lines and fails for one over 800, so a ticket can no longer grow a file in silence. Quality pass 2 findings 3 and 11 (`spec/quality/2026-11-20-pass-2.md`) are closed.

## Scope

- One ESLint size rule for every linted non-test source file; it replaces the fixed group list of the old file-size test.
- Repository splits: delegation, audit, push subscriptions.
- Composition roots: the server start-up (`main.ts`) by runtime, the web root (`web.ts`) by part.
- Text and view tables in `@ea/core`; the privacy maps; the digest, command and rule-suggestion files of the server.
- The sign-in wiring of the auth setup, split along its existing `auth-*.ts` files.
- The two e2e seed scripts, which are over 800 lines.

## Out of scope

- `contacts/activity.ts`: the sender-activity split ticket (F144) owns it.
- The other files between 400 and 800 lines: they stay as warnings.
- Test files (the test audit, F125, owns them).
- Any behaviour change, rename of an export, or new feature.

## Acceptance

- `bun run lint` exits 1 for a non-test source file of 801 lines and prints a warning, not an error, for one of 401 lines (`apps/server/src/file-size.test.ts` proves both).
- `bun run lint` at the last land has no size error and no size exception list.
- No file that this ticket splits, and no file it creates, is over 400 lines.
- Every file made by a move keeps its history: `git log --follow` reaches the first commit of the old file.
- `bun run typecheck`, `bun run test:unit:ci` and `bun run test:int:ci` pass with no test assert changed, except the tests the stages name.

## Slices

Eleven stages, one worker job each; all may run in parallel (plan § Stages). Stages 03 and 09 are `[risky]` and get a review. No owner checkpoint. See `plan.md` § How to run.

## Sequenced

Plan after: none.
Build after: none. Gate: none. Conflict note: the one-address-rule ticket (F142 stage 02) edits `delegation/repo.ts`, the cursor-column drop (F062 stages 04–05) edits `privacy/export-map.ts`, the public pages (F121 stage 09) and the demo-video ticket (F151) edit the e2e seed; the coordinator does not run a split stage next to an open stage that edits the same file.

## Notes

Source: `spec/quality/2026-11-20-pass-2.md` findings 3 and 11. Defaults: `questions.md`.
