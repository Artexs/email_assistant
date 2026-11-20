# F157 stage 14 — split: mail jobs and OAuth

Needs stage 03: no time literal left in these files. Needs stage 05: `scripts/test-audit/split-proof.ts`. May run next to 06–13 and 15–19.

Part of [`../plan.md`](../plan.md). Steps: [`../procedures.md`](../procedures.md) § Split.

## Files (lines at ea317d34)

- `apps/server/test/integration/mail-jobs.test.ts` 1,261
- `apps/server/test/integration/mail-oauth-connect.test.ts` 1,259
- `apps/server/test/integration/mail-oauth-refresh.test.ts` 923

## Step per file — split by topic

- **Goal:** each file over 800 lines becomes parts of at most 600 lines, by topic, with the same cases (plan D6, D7).
- **Decisions:** D5 (history merge, redo on a master change), D6 (names), D7 (same describe path and names; shared state stays together), D8 (helpers file), D11 (a file at or under 800 lines at `HEAD` is skipped), D14 (references).
- **Test:** no new test. The proof per file is `split-proof PASS` (procedures § Split steps 2–9).
- **Done when:** for each split file: the old file is gone; each part and the helpers file are at most 600 lines (`wc -l`); `split-proof PASS`; `git log --follow` of one part reaches the old file; every reference to the old file outside the history folders names a part (procedures § Split step 10); the reference checks of step 11 pass; the file has its entry in `split-log/stage-14.md`.

## References at ea317d34

A lead; step 10 greps again at `HEAD`. `mail-jobs.test.ts`: `docs/capabilities/sent-mail.md`, `sync.md`. `mail-oauth-connect.test.ts`: a comment in `mail-history-connect.test.ts`. `mail-oauth-refresh.test.ts`: none found.

## Out of scope

Any change of what a case checks. Other files over 800 lines (their own stages, or stage 20).

## Proof

First the reference checks of procedures § Split step 11 (`check:job` does not run them). Then `bun run check:job`, last line in the final message. Never rebase or squash this branch.
