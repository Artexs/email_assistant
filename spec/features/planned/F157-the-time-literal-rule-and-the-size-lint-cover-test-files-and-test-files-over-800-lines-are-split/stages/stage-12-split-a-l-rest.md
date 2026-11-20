# F157 stage 12 — split: reply review, follow-up cards, fixtures, lab seed

Needs stage 02: no time literal left in these files. Needs stage 05: `scripts/test-audit/split-proof.ts`. May run next to 06–11 and 13–19.

Part of [`../plan.md`](../plan.md). Steps: [`../procedures.md`](../procedures.md) § Split.

## Files (lines at ea317d34)

- `apps/server/test/integration/channels-reply-review.test.ts` 823
- `apps/server/test/integration/follow-up-cards.test.ts` 831
- `apps/server/test/integration/lab-demo-seed.test.ts` 1,122
- `apps/server/test/integration/fixtures.ts` 805 (a helper, not a test file: see below)

## Step per file — split by topic

- **Goal:** each file over 800 lines becomes parts of at most 600 lines, by topic, with the same cases (plan D6, D7).
- **Decisions:** D5 (history merge, redo on a master change), D6 (names), D7 (same describe path and names; shared state stays together), D8 (helpers file), D11 (a file at or under 800 lines at `HEAD` is skipped).
- **Test:** no new test. The proof per file is `split-proof PASS` (procedures § Split steps 2–7).
- **Done when:** for each split file: the old file is gone; each part and the helpers file are at most 600 lines (`wc -l`); `split-proof PASS`; `git log --follow` of one part reaches the old file; the file has its entry in `split-log/stage-12.md`.

## `fixtures.ts`

`fixtures.ts` holds no cases; 332 int files import `./fixtures`. It becomes `apps/server/test/integration/fixtures/<topic>.ts` plus `fixtures/index.ts`, which re-exports by name every export of the old file and nothing else (`docs/code-patterns.md` § Size and shape). No importer changes. Split proof: no JUnit step; instead the export names of the old file equal those of `fixtures/index.ts` (list both, `diff` prints nothing; write both lists' counts in the log). `check:job` then runs almost all int files: that run is its proof.

## Out of scope

Any change of what a case checks. Other files over 800 lines (their own stages, or stage 20).

## Proof

`bun run check:job`, last line in the final message. Never rebase or squash this branch.
