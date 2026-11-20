# F157 stage 11 — split: channels callbacks, card sync, sender

Needs stage 02: no time literal left in these files. Needs stage 05: `scripts/test-audit/split-proof.ts`. May run next to 06–10 and 12–19.

Part of [`../plan.md`](../plan.md). Steps: [`../procedures.md`](../procedures.md) § Split.

## Files (lines at ea317d34)

- `apps/server/test/integration/channels-callbacks.test.ts` 1,493
- `apps/server/test/integration/channels-card-sync.test.ts` 1,042
- `apps/server/test/integration/channels-sender.test.ts` 1,007

## Step per file — split by topic

- **Goal:** each file over 800 lines becomes parts of at most 600 lines, by topic, with the same cases (plan D6, D7).
- **Decisions:** D5 (history merge, redo on a master change), D6 (names), D7 (same describe path and names; shared state stays together), D8 (helpers file), D11 (a file at or under 800 lines at `HEAD` is skipped), D14 (references), D15 (bare-codes allowance).
- **Test:** no new test. The proof per file is `split-proof PASS` (procedures § Split steps 2–9).
- **Done when:** for each split file: the old file is gone; each part and the helpers file are at most 600 lines (`wc -l`); `split-proof PASS`; `git log --follow` of one part reaches the old file; every reference to the old file outside the history folders names a part (procedures § Split step 10); the reference checks of step 11 pass; the file has its entry in `split-log/stage-11.md`.

## Bare-codes allowance (D15)

`FIXTURE_LABELS` in `apps/server/src/bare-codes.test.ts` keys `channels-card-sync.test.ts` to `/\b[UC]\d\b/`. Each part whose comments use a `U1`/`C1` label gets its own entry with the same pattern and comment; the old key goes. `bun test apps/server/src/bare-codes.test.ts` passes.

## References at ea317d34

A lead; step 10 greps again at `HEAD`. `channels-callbacks.test.ts`: `docs/capabilities/digest-and-notices.md`. `channels-card-sync.test.ts`: `digest-and-notices.md`, `drafts-and-send.md`, `FIXTURE_LABELS` in `apps/server/src/bare-codes.test.ts`. `channels-sender.test.ts`: `digest-and-notices.md`, `trust.md`.

## Out of scope

Any change of what a case checks. Other files over 800 lines (their own stages, or stage 20).

## Proof

First the reference checks of procedures § Split step 11 (`check:job` does not run them). Then `bun run check:job`, last line in the final message. Never rebase or squash this branch.
