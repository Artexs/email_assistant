# F157 stage 19 — split: web two-factor and HTTP

Needs stage 04: no time literal left in these files. Needs stage 05: `scripts/test-audit/split-proof.ts`. May run next to 06–18.

Part of [`../plan.md`](../plan.md). Steps: [`../procedures.md`](../procedures.md) § Split.

## Files (lines at ea317d34)

- `apps/server/test/integration/web-two-factor.test.ts` 1,215
- `apps/server/test/integration/web-http.test.ts` 803

## Step per file — split by topic

- **Goal:** each file over 800 lines becomes parts of at most 600 lines, by topic, with the same cases (plan D6, D7).
- **Decisions:** D5 (history merge, redo on a master change), D6 (names), D7 (same describe path and names; shared state stays together), D8 (helpers file), D11 (a file at or under 800 lines at `HEAD` is skipped), D14 (references).
- **Test:** no new test. The proof per file is `split-proof PASS` (procedures § Split steps 2–9).
- **Done when:** for each split file: the old file is gone; each part and the helpers file are at most 600 lines (`wc -l`); `split-proof PASS`; `git log --follow` of one part reaches the old file; every reference to the old file outside the history folders names a part (procedures § Split step 10); the reference checks of step 11 pass; the file has its entry in `split-log/stage-19.md`.

## Note

`two-factor-helpers.ts` and `web-helpers.ts` exist: shared code goes there while each stays at most 600 lines (D8).

## Ledger row C070

`docs/legal/claims.md` row C070 cites `web-two-factor.test.ts`: it names the part that holds the TOTP turn-on cases. The claim text does not change.

## References at ea317d34

A lead; step 10 greps again at `HEAD`. `web-two-factor.test.ts`: `docs/capabilities/web-panel.md`, `docs/legal/claims.md` row C070, a comment in `two-factor-helpers.ts`. `web-http.test.ts`: `web-panel.md`, a comment in `apps/web/integrations/pwa-shell.test.ts`.

## Out of scope

Any change of what a case checks. Other files over 800 lines (their own stages, or stage 20).

## Proof

First the reference checks of procedures § Split step 11 (`check:job` does not run them). Then `bun run check:job`, last line in the final message. Never rebase or squash this branch.
