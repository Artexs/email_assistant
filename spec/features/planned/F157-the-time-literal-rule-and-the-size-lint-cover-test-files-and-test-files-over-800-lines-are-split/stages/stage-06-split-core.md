# F157 stage 06 — split: core digest, digits, notice registry

Needs stage 01: no time literal left in these files. Needs stage 05: `scripts/test-audit/split-proof.ts`. May run next to 07–19.

Part of [`../plan.md`](../plan.md). Steps: [`../procedures.md`](../procedures.md) § Split.

## Files (lines at ea317d34)

- `packages/core/src/digest/approvals.test.ts` 1,666
- `packages/core/src/digest/digest.test.ts` 1,344
- `packages/core/src/replies/digits.test.ts` 1,022
- `packages/core/src/notices/registry.test.ts` 876

## Step per file — split by topic

- **Goal:** each file over 800 lines becomes parts of at most 600 lines, by topic, with the same cases (plan D6, D7).
- **Decisions:** D5 (history merge, redo on a master change), D6 (names), D7 (same describe path and names; shared state stays together), D8 (helpers file), D11 (a file at or under 800 lines at `HEAD` is skipped).
- **Test:** no new test. The proof per file is `split-proof PASS` (procedures § Split steps 2–7).
- **Done when:** for each split file: the old file is gone; each part and the helpers file are at most 600 lines (`wc -l`); `split-proof PASS`; `git log --follow` of one part reaches the old file; the file has its entry in `split-log/stage-06.md`.

## Out of scope

Any change of what a case checks. Other files over 800 lines (their own stages, or stage 20).

## Proof

`bun run check:job`, last line in the final message. Never rebase or squash this branch.
