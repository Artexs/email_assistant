# F145 stage 06 — Rule at error, docs lines, the value check goes

Needs stages 03, 04 and 05: no `ea/no-time-literals` warning left in their areas. Needs stage 02: `time-rewrite-check` (run once, then deleted). Last stage; land without `--keep-open`.

Part of [`../plan.md`](../plan.md).

## Step 1 — Severity error

- **Goal:** the `ea/no-time-literals` block in `eslint.config.js` has severity `error` (D9). `bun run lint` exits 0.
- **Edge case:** a literal that another ticket landed after stages 03–05 now fails lint. Rewrite it here by D6, or give it a D8 disable when it is not a time; list it in the final message.
- **Test:** in `apps/server/src/platform/time-lint.test.ts`, every expected `[1]` becomes `[2]`. The `[]` cases stay `[]`.
- **Guard check:** set the block back to `warn`, run the test, see T1 fail with `[1]` against `[2]`; restore `error`. Name it in the final message.

## Step 2 — One rule line in the docs

- **Goal:** `docs/code-patterns.md` § Size and shape gets one bullet: minutes, hours and days in milliseconds come from `MINUTE_MS`, `HOUR_MS`, `DAY_MS` in `packages/core/src/time.ts`, folded to the largest whole unit; the local lint rule `ea/no-time-literals` bans the literals, the folded chains and local copies outside test code; a non-time value uses a disable comment with its reason; new local rules join the `ea` plugin in `tools/eslint-rules/index.js`. `.agents/limen/styleguide.md` § Prefer gets one line that points to it, and § Shape names `tools/eslint-rules/` as the home of the local lint plugin.
- **Test:** none (text).

## Step 3 — Delete the value check

- **Goal:** run `bun apps/server/src/scripts/time-rewrite-check.ts > /tmp/f145-s06/values.log 2>&1` after the step 1 rewrites and before this step's commit; it must exit 0. Then delete `apps/server/src/scripts/time-rewrite-check.ts` and its test in the last commit (plan D12).
- **Test:** none; the log is the evidence. Name its path and last line in the final message.

## Check

`bun run lint` (exit 0), `bun test apps/server/src/platform/time-lint.test.ts`.

## Done when

- Lint exits 0 with the rule at error.
- Every `[1]` of T1–T15 is `[2]` and passes; the guard check failed and was restored.
- `values.log` ends with `time values equal`; the tool and its test are gone.
- The Proof of `plan.md` for stage 06 prints `PROOF_OK`.

## Out of scope

Widening the rule to test files (plan D3, Q1: after the test audit, F125); seconds and division chains (D5).
