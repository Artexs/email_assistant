# F145 stage 05 — Rule at error, docs lines

Needs stages 02, 03 and 04: no `ea/no-time-literals` warning left in their areas. Last stage; land without `--keep-open`.

Part of [`../plan.md`](../plan.md).

## Step 1 — Severity error

- **Goal:** the `ea/no-time-literals` block in `eslint.config.js` has severity `error` (D9). `bun run lint` exits 0.
- **Edge case:** a literal that another ticket landed after stages 02–04 now fails lint. Rewrite it here by D6, or give it a D8 disable when it is not a time; list it in the final message.
- **Test:** in `apps/server/src/platform/time-lint.test.ts`, every expected `[1]` becomes `[2]`. The `[]` cases stay `[]`.
- **Guard check:** set the block back to `warn`, run the test, see T1 fail with `[1]` against `[2]`; restore `error`. Name it in the final message.

## Step 2 — One rule line in the docs

- **Goal:** `docs/code-patterns.md` § Size and shape gets one bullet: minutes, hours and days in milliseconds come from `MINUTE_MS`, `HOUR_MS`, `DAY_MS` in `packages/core/src/time.ts`; the lint rule `ea/no-time-literals` bans the literals, the folded chains and local copies outside test code; a non-time value uses a disable comment with its reason. `.agents/limen/styleguide.md` § Prefer gets one line that points to it.
- **Test:** none (text).

## Check

`bun run lint` (exit 0), `bun test apps/server/src/platform/time-lint.test.ts`.

## Done when

- Lint exits 0 with the rule at error.
- T1–T15 expect `[2]` where they expected `[1]` and pass; the guard check failed and was restored.
- The Proof of `plan.md` for stage 05 prints `PROOF_OK`.

## Out of scope

Widening the rule to test files (plan D3, Q1: after F125); seconds (D5).
