# F143 stage 01 — size lint rule and its test

Needs: nothing. May run next to every other stage.
Part of [`../plan.md`](../plan.md). Review: Sonnet, before the land.

## Goal

`bun run lint` warns for a non-test source file over 400 lines and fails for one over 800. The old group list goes. Decisions D1–D4, D13.

## Step 1 — the rule

- **Files:** `eslint.config.js`.
- **Interfaces:** a local plugin `size` with one rule `max-lines-hard` = the core `max-lines` rule (`builtinRules.get("max-lines")` from `eslint/use-at-your-own-risk`). One config block for the D2 file set: `"max-lines": ["warn", { max: 400, skipBlankLines: false, skipComments: false }]` and `"size/max-lines-hard": ["error", { max: 800, skipBlankLines: false, skipComments: false }]`. The test globs of D2 are its `ignores`.
- `SIZE_EXCEPTIONS`: an exported-in-file constant (array of `{ file, stage }`), one entry for each non-test file over 800 lines at `HEAD` (D4; expected `apps/server/src/modules/delegation/repo.ts` → 02, `apps/server/src/scripts/e2e-seed-args.ts` → 10, `apps/server/src/scripts/e2e-seed.ts` → 11; drop an entry whose file is already split). A second block for those files sets `size/max-lines-hard` to `off`. A comment names D4 and says: the stage that splits the file deletes its entry; the last deletion deletes the constant and the block.
- If a file not named above is over 800 lines at `HEAD`, stop and ask (final message).
- No `--max-warnings` change: warnings never fail lint.

## Step 2 — the test

- **Files:** `apps/server/src/file-size.test.ts` (rewritten; same path). Pattern: `apps/server/src/platform/log-lint.test.ts` (`new ESLint({ cwd: repoRoot })`, `lintText(text, { filePath })`).
- A helper builds a text of N lines: N lines of `export const aK = K;` (K = 1…N), each ending in `\n`, so `wc -l` gives N.
- **Test** (filter messages by `ruleId` `max-lines` and `size/max-lines-hard`; severity 1 = warn, 2 = error):
  1. `apps/server/src/__size-fixture.ts`, 400 lines → no size message.
  2. Same path, 401 lines → one `max-lines` warning, no error.
  3. Same path, 800 lines → one warning, no error.
  4. Same path, 801 lines → one warning and one `size/max-lines-hard` error.
  5. `packages/core/src/__size-fixture.ts`, 801 lines → warning and error (the rule is not server-only).
  6. `apps/web/src/lib/__size-fixture.tsx`, 801 lines → warning and error.
  7. `apps/server/src/__size-fixture.test.ts`, 801 lines → no size message (D2).
  8. `apps/server/test/integration/__size-fixture.ts`, 801 lines → no size message.
  9. Each path in `SIZE_EXCEPTIONS` (if the constant exists), 801 lines → warning, no error. If the constant is gone, the case asserts that `eslint.config.js` holds no `SIZE_EXCEPTIONS` text, so a later stage cannot bring it back unseen.
  10. 801 lines with a last line that has no `\n` → error (fixes the Not verified item of `plan.md`).
- **Guard check:** set the hard rule to `off` in a scratch copy, run the test: cases 4–6 and 10 fail. Revert. Write the run in the final message.

## Step 3 — the docs

- `docs/code-patterns.md` § Size and shape, first bullet: add one sentence: `bun run lint` warns over 400 lines and fails over 800 for every non-test source file (`eslint.config.js`, the `size` rule); a file in `SIZE_EXCEPTIONS` is a split in progress.
- No edit of `.agents/limen/styleguide.md` (it points to this page).

## Done when

- `bun run lint` exits 0 at `HEAD` and lists size warnings for the files over 400 lines (count them in the final message).
- Test cases 1–10 pass; the guard check fails them as stated.
- Proof: `mkdir -p /tmp/f143-s01 && bun run lint > /tmp/f143-s01/lint.log 2>&1 && bun run typecheck > /tmp/f143-s01/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f143-s01/unit.log 2>&1 && bun run test:int:ci > /tmp/f143-s01/int.log 2>&1 && echo PROOF_OK`

## Out of scope

Splitting any file. Test files. A size rule for `md`, `sql` or `json`.
