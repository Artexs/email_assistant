# F157 stage 18 — split: trust history and regate

Needs stage 04: no time literal left in these files. Needs stage 05: `scripts/test-audit/split-proof.ts`. May run next to 06–17 and 19.

Part of [`../plan.md`](../plan.md). Steps: [`../procedures.md`](../procedures.md) § Split.

## Files (lines at ea317d34)

- `apps/server/test/integration/trust-regate.test.ts` 894
- `apps/server/test/integration/trust-history-classify.test.ts` 894
- `apps/server/test/integration/trust-history-job.test.ts` 828

## Step per file — split by topic

- **Goal:** each file over 800 lines becomes parts of at most 600 lines, by topic, with the same cases (plan D6, D7).
- **Decisions:** D5 (history merge, redo on a master change), D6 (names), D7 (same describe path and names; shared state stays together), D8 (helpers file), D11 (a file at or under 800 lines at `HEAD` is skipped), D14 (references).
- **Test:** no new test. The proof per file is `split-proof PASS` (procedures § Split steps 2–9).
- **Done when:** for each split file: the old file is gone; each part and the helpers file are at most 600 lines (`wc -l`); `split-proof PASS`; `git log --follow` of one part reaches the old file; every reference to the old file outside the history folders names a part (procedures § Split step 10); the reference checks of step 11 pass; the file has its entry in `split-log/stage-18.md`.

## Note

`trust-history-helpers.ts` and `trust-history-classify-helpers.ts` exist: shared code of `trust-history-job` and `trust-history-classify` goes there while each stays at most 600 lines (D8).

## References at ea317d34

A lead; step 10 greps again at `HEAD`. `trust-regate.test.ts`, `trust-history-classify.test.ts`, `trust-history-job.test.ts`: `docs/capabilities/trust.md`; a comment in `trust-history-classify.test.ts` names `trust-history-job.test.ts`.

## Out of scope

Any change of what a case checks. Other files over 800 lines (their own stages, or stage 20).

## Proof

First the reference checks of procedures § Split step 11 (`check:job` does not run them). Then `bun run check:job`, last line in the final message. Never rebase or squash this branch.
