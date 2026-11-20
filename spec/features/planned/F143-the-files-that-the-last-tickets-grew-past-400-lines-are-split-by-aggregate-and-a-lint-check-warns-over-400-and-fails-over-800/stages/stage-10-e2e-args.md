# F143 stage 10 — e2e seed constants by area

Needs: nothing. Reads `SIZE_EXCEPTIONS` of stage 01 only if it exists at `HEAD`. May run next to every other stage (stage 11 imports the same names from `./e2e-seed-args`); not next to an open F121 stage 09 or an F151 stage (they edit the seed).
Part of [`../plan.md`](../plan.md).

## Goal

`apps/server/src/scripts/e2e-seed-args.ts` (957 lines, 118 exports) becomes area files with the same exports at the same path (D5, D7, D12).

## Step 1 — the split

- **Files:** `apps/server/src/scripts/e2e-seed/args-<area>.ts`, one per seeded area, in the order of the `HEAD` file: `args-core.ts` (the main organization, projects, mail tag helpers, the member, terms, two-factor, delete, other, trial, paused and stats organizations), then one file per spec area that has its own block (approvals, delegates, delegations, open loops, urgency, the rest the worker finds). Each ≤ 400 lines; a block over 400 splits by its sub-blocks.
- `e2e-seed-args.ts` keeps its path and becomes `export { … } from "./e2e-seed/args-<area>";` lines that name every export (no `export *`), nothing else.
- Each area file imports only what the `HEAD` file imports. This file is read by `apps/web/e2e/` (`env.ts`, `helpers.ts`, `seed.ts`) and must stay free of DB, server-module and test-tool imports.
- The comments above each block move with the block.
- If `SIZE_EXCEPTIONS` exists in `eslint.config.js`, delete the `e2e-seed-args.ts` entry; if it was the last entry, delete the constant and its config block (D4).

## Method

D5: copy the F091 scripts to `/tmp/f143-s10/`; `history-copies.sh` with the target dir `apps/server/src/scripts/e2e-seed` and the area names; trim right after the history merge. Adapt the `/tmp` copy of `same-bodies.ts` so it reads the old file and `e2e-seed/args-*.ts`. D6 if `master` changes the file first.

## Test

No new test: behaviour does not change. Move proofs in `/tmp/f143-s10/`:

1. Adapted `same-bodies.ts`: `SAME_BODIES 118` (or the count of top-level declarations at `HEAD`), exit 0.
2. `exports-of.ts` of the base file equals that of the new `e2e-seed-args.ts`.
3. Each new file: `git log --follow` reaches the first commit of `e2e-seed-args.ts`.
4. `wc -l` of each new file ≤ 400 and of `e2e-seed-args.ts` ≤ 400.
5. `git diff --name-only <base> HEAD -- apps/web apps/server/test` prints nothing.
6. Value proof: a `/tmp` script imports `e2e-seed-args.ts` at base and head and prints every export (a function as its source text with whitespace collapsed); `diff` prints nothing.

Existing guards, unchanged: `apps/server/test/integration/e2e-seed.test.ts` and `e2e-suggestion-rows.test.ts` (both import these names).

## Done when

- Checks 1–6 passed; the logs are named in the final message.
- Proof: `mkdir -p /tmp/f143-s10 && bun run lint > /tmp/f143-s10/lint.log 2>&1 && bun run typecheck > /tmp/f143-s10/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f143-s10/unit.log 2>&1 && bun run test:int:ci > /tmp/f143-s10/int.log 2>&1 && echo PROOF_OK`

## Out of scope

`e2e-seed.ts` (stage 11). A changed value, address or organization name.
