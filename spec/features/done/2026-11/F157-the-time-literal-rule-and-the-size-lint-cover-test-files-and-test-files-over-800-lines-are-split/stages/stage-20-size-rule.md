# F157 stage 20 — the size rule covers test code

Needs stages 06–19: no test-code file over 800 lines (their `split-log/stage-NN.md` entries).

Part of [`../plan.md`](../plan.md). Steps for a late split: [`../procedures.md`](../procedures.md) § Split.

## Step 1 — measure again

- **Goal:** no test-code file (plan D1) is over 800 lines at this stage's `HEAD`.
- **Check:** `git ls-files` of the D1 globs `| xargs wc -l`, list each file over 800.
- **Decision D11:** at most 2 such files: split them here (procedures § Split, all steps, with the references of step 10 and the checks of step 11; log in `split-log/stage-20.md`). More than 2: commit nothing for this step, list them in the final message, and stop: the coordinator adds a split stage.

## Step 2 — rule on for test code

- **Goal:** `bun run lint` warns over 400 lines and fails over 800 in test code too (D12).
- **Change:** delete `sizeIgnores` and its use in the size block of `eslint.config.js`; the size block covers every file of `sizeFiles`. Change the comment "Test code is outside the rule".
- **Docs (D13):** `docs/code-patterns.md` § Size and shape: the size rule covers test code; a split test file follows plan D6–D8 of this ticket (name the ticket folder, not its number alone).
- **Test** (`apps/server/src/file-size.test.ts`):
  1. "a test file of 801 lines" (`apps/server/src/__size-fixture.test.ts`) → `[warning, failure]`.
  2. "a file under apps/server/test of 801 lines" → `[warning, failure]`.
  3. New: `apps/web/e2e/tests/__size-fixture.spec.ts`, 801 lines → `[warning, failure]`; `packages/core/src/__size-fixture.test-helper.ts`, 401 lines → `[warning]`.
  4. "no source file disables a size rule": the scan drops its test-file filter, so it reads test code too; it still skips `file-size.test.ts` itself.
  Restore one ignore and see case 2 fail.
- **Done when:** `bun run lint` over the whole repo passes with no `size/max-lines-hard` error (save `/tmp/f157-s20/lint.log`); `bun test apps/server/src/file-size.test.ts` passes.

## Step 3 — close the counts

- **Goal:** the ticket acceptance is shown in one place.
- **Change:** append to `plan.md` § Log: the count of test-code files over 800 (0), over 400, the sum of `cases=` of all `split-proof PASS` lines in `split-log/`, and the `check:job` line.

## Out of scope

Splitting test files of 401–800 lines (they warn; D12). Any change of what a case checks.

## Review

`claude-sonnet-5-5` review before the land (lint config).

## Proof

`bun run check:job`, last line in the final message. This stage closes the ticket (`limen land` without `--keep-open`).
