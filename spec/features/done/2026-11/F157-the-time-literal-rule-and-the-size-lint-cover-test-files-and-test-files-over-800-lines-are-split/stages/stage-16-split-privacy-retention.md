# F157 stage 16 — split: privacy erase, retention, reply lifetime

Needs stage 03: no time literal left in these files. Needs stage 05: `scripts/test-audit/split-proof.ts`. May run next to 06–15 and 17–19.

Part of [`../plan.md`](../plan.md). Steps: [`../procedures.md`](../procedures.md) § Split.

## Files (lines at ea317d34)

- `apps/server/test/integration/privacy-dsr-erase.test.ts` 895
- `apps/server/test/integration/retention-clear.test.ts` 811
- `apps/server/test/integration/replies-lifetime.test.ts` 823

## Step per file — split by topic

- **Goal:** each file over 800 lines becomes parts of at most 600 lines, by topic, with the same cases (plan D6, D7).
- **Decisions:** D5 (history merge, redo on a master change), D6 (names), D7 (same describe path and names; shared state stays together), D8 (helpers file), D11 (a file at or under 800 lines at `HEAD` is skipped), D14 (references).
- **Test:** no new test. The proof per file is `split-proof PASS` (procedures § Split steps 2–9).
- **Done when:** for each split file: the old file is gone; each part and the helpers file are at most 600 lines (`wc -l`); `split-proof PASS`; `git log --follow` of one part reaches the old file; every reference to the old file outside the history folders names a part (procedures § Split step 10); the reference checks of step 11 pass; the file has its entry in `split-log/stage-16.md`.

## Public claim C060

`apps/docs/src/security/claims.ts` cites `privacy-dsr-erase.test.ts` as a proof, and the docs build fails when a proof file is gone or the ledger row does not name it (`apps/docs/integrations/claim-check.ts`). Decision: the `proofs` of that claim and the source cell of row C060 in `docs/legal/claims.md` name every part that holds a case for rules 7–12 of `docs/capabilities/account-data.md` (mail goes, address leaves, digests blanked, tombstone); the same list in both. `bun test apps/docs/src/security/claims.test.ts` (it runs the claim check on the real claims) and `apps/server/src/legal-papers.test.ts` pass. The claim text does not change.

## References at ea317d34

A lead; step 10 greps again at `HEAD`. `privacy-dsr-erase.test.ts`: `apps/docs/src/security/claims.ts` (a public-claim proof), `docs/legal/claims.md` row C060, `docs/capabilities/account-data.md`, a comment in `danger-cli-confirm.test.ts`. `retention-clear.test.ts`: `retention.md`, `sent-mail.md`. `replies-lifetime.test.ts`: `reply-drafts.md`.

## Out of scope

Any change of what a case checks. Other files over 800 lines (their own stages, or stage 20).

## Proof

First the reference checks of procedures § Split step 11 (`check:job` does not run them). Then `bun run check:job`, last line in the final message. Never rebase or squash this branch.
