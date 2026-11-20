# F157 stage 13 — split: mail sync and history backfill

Needs stage 03: no time literal left in these files. Needs stage 05: `scripts/test-audit/split-proof.ts`. May run next to 06–12 and 14–19.

Part of [`../plan.md`](../plan.md). Steps: [`../procedures.md`](../procedures.md) § Split.

## Files (lines at ea317d34)

- `apps/server/test/integration/mail-sync.test.ts` 3,043
- `apps/server/test/integration/mail-history-backfill.test.ts` 816

## Step per file — split by topic

- **Goal:** each file over 800 lines becomes parts of at most 600 lines, by topic, with the same cases (plan D6, D7).
- **Decisions:** D5 (history merge, redo on a master change), D6 (names), D7 (same describe path and names; shared state stays together), D8 (helpers file), D11 (a file at or under 800 lines at `HEAD` is skipped).
- **Test:** no new test. The proof per file is `split-proof PASS` (procedures § Split steps 2–7).
- **Done when:** for each split file: the old file is gone; each part and the helpers file are at most 600 lines (`wc -l`); `split-proof PASS`; `git log --follow` of one part reaches the old file; the file has its entry in `split-log/stage-13.md`.

## Note

`mail-sync-capture.test.ts` already exists: a part name must not be `capture`. Expect about 6 parts for `mail-sync.test.ts`.

## Out of scope

Any change of what a case checks. Other files over 800 lines (their own stages, or stage 20).

## Proof

`bun run check:job`, last line in the final message. Never rebase or squash this branch.
