# F143 stage 01 — size lint rule and its test

Needs: nothing. May run next to every other stage. Overlap (advisory): the time-constant ticket (F145) and the stale-statements ticket (F150) also add lint rules to `eslint.config.js`; on a land conflict merge `master` and re-prove.
Part of [`../plan.md`](../plan.md). Review: Sonnet, before the land.

## Goal

Lint warns for a non-test source file over 400 lines and fails over 800; the old group list goes (D1–D4, D13).

## Step 1 — the rule

- **Files:** `eslint.config.js`.
- **Interfaces:** a local plugin `size` with one rule `max-lines-hard` = the core `max-lines` rule (`builtinRules.get("max-lines")` from `eslint/use-at-your-own-risk`). One config block for the D2 file set: `"max-lines": ["warn", { max: 400, skipBlankLines: false, skipComments: false }]` and `"size/max-lines-hard": ["error", { max: 800, skipBlankLines: false, skipComments: false }]`. The test globs of D2 are its `ignores`.
- **Exceptions (D4):** the data file `size-exceptions.json` at the repo root: `[{ "file": "<repo path>", "stage": "NN" }]`, one entry for each non-test file over 800 lines at `HEAD` (expected `apps/server/src/modules/delegation/repo.ts` → 02, `apps/server/src/scripts/e2e-seed-args.ts` → 10, `apps/server/src/scripts/e2e-seed.ts` → 11; leave out a file that is already split). `eslint.config.js` reads it (as it reads `layers.json`) into one block that sets `size/max-lines-hard` to `off` for those files. A comment names D4: the stage that splits a file deletes its entry; the stage that deletes the last entry deletes the JSON file, the read and the block.
- If a file not named above is over 800 lines at `HEAD`, stop and ask (final message).
- After the job's final `git merge master`, build the list again from `wc -l` (a split stage may have landed meanwhile).

## Step 2 — the test

- **Files:** `apps/server/src/file-size.test.ts` (rewritten). Pattern: `platform/log-lint.test.ts` (`lintText(text, { filePath })`).
- A helper builds a text of N lines: N lines of `export const aK = K;` (K = 1…N), each ending in `\n`, so `wc -l` gives N.
- **Test** (filter messages by `ruleId` `max-lines` and `size/max-lines-hard`; severity 1 = warn, 2 = error):
  1. `apps/server/src/__size-fixture.ts`, 400 lines → no size message.
  2. Same path, 401 lines → one `max-lines` warning, no error.
  3. Same path, 800 lines → one warning, no error.
  4. Same path, 801 lines → one warning and one `size/max-lines-hard` error.
  5. `packages/core/src/__size-fixture.ts` and 6. `apps/web/src/lib/__size-fixture.tsx`, 801 lines each → warning and error.
  7. `apps/server/src/__size-fixture.test.ts`, 801 lines → no size message (D2).
  8. `apps/server/test/integration/__size-fixture.ts`, 801 lines → no size message.
  9. If `size-exceptions.json` exists: it is non-empty; each `file` is one of the three D4 paths, exists, and has more than 800 lines (`wc -l`); linting that path with 801 lines gives a warning and no error. If it does not exist: `eslint.config.js` holds no `size-exceptions` text, and `apps/server/src/scripts/e2e-seed.ts` with 801 lines gives the error.
  10. 801 lines with a last line that has no `\n` → error.
  11. 801 lines of which 300 are blank → error; 801 lines of which 300 are `// comment` lines → error (a switch to `skipBlankLines` or `skipComments` fails this).
  12. `apps/web/src/components/__size-fixture.astro`, 801 lines (frontmatter fence and plain markup) → warning and error.
  13. No tracked non-test source file holds an `eslint-disable` comment that names `max-lines` or `size/max-lines-hard` (scan of `git ls-files`; must find nothing).
- **Guard check:** set the hard rule to `off` in a scratch copy: cases 4–6, 10–12 fail. Set `skipComments: true`: case 11 fails. Revert. Write both runs in the final message.

## Step 3 — the docs

- `docs/code-patterns.md` § Size and shape, first bullet, one sentence: `bun run lint` warns over 400 lines and fails over 800 for every non-test source file (`eslint.config.js`, the `size` rule); a file in `size-exceptions.json` is a split in progress; an `eslint-disable` of the size rules is not allowed.
- No edit of `.agents/limen/styleguide.md` (it points to this page).

## Done when

- `bun run lint` exits 0 at `HEAD` and lists size warnings for the files over 400 lines (count them in the final message).
- Test cases 1–13 pass; the guard check fails them as stated.
- Proof: `plan.md` § Proof with `NN=01`.

## Out of scope

Splitting any file. Test files.
