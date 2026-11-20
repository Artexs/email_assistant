# F157 stage 09 — split: actions committer, follow-up, move, drafts

Needs stage 02: no time literal left in these files. Needs stage 05: `scripts/test-audit/split-proof.ts`. May run next to 06–08 and 10–19.

Part of [`../plan.md`](../plan.md). Steps: [`../procedures.md`](../procedures.md) § Split.

## Files (lines at ea317d34)

- `apps/server/test/integration/actions-committer.test.ts` 1,135
- `apps/server/test/integration/actions-follow-up.test.ts` 996
- `apps/server/test/integration/actions-move.test.ts` 960
- `apps/server/test/integration/actions-drafts.test.ts` 810

## Step per file — split by topic

- **Goal:** each file over 800 lines becomes parts of at most 600 lines, by topic, with the same cases (plan D6, D7).
- **Decisions:** D5 (history merge, redo on a master change), D6 (names), D7 (same describe path and names; shared state stays together), D8 (helpers file), D11 (a file at or under 800 lines at `HEAD` is skipped), D14 (references).
- **Test:** no new test. The proof per file is `split-proof PASS` (procedures § Split steps 2–9).
- **Done when:** for each split file: the old file is gone; each part and the helpers file are at most 600 lines (`wc -l`); `split-proof PASS`; `git log --follow` of one part reaches the old file; every reference to the old file outside the history folders names a part (procedures § Split step 10); the reference checks of step 11 pass; the file has its entry in `split-log/stage-09.md`.

## `PAIR_RULES` pointers

As in stage 08: each `test:` string of `PAIR_RULES` (`transitions.ts`) that names `actions-move.test.ts` or `actions-drafts.test.ts` names the part that holds the case.

## References at ea317d34

A lead; step 10 greps again at `HEAD`. `actions-committer.test.ts`: `docs/capabilities/actions-and-undo.md`. `actions-follow-up.test.ts`: `open-loops.md`. `actions-move.test.ts`: `actions-and-undo.md`, `PAIR_RULES`. `actions-drafts.test.ts`: `drafts-and-send.md`, `PAIR_RULES`.

## Out of scope

Any change of what a case checks. Other files over 800 lines (their own stages, or stage 20).

## Proof

First the reference checks of procedures § Split step 11 (`check:job` does not run them). Then `bun run check:job`, last line in the final message. Never rebase or squash this branch.
