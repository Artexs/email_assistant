PASS b5de14849152c04b9731a623cf057f81fc8609f2

I reviewed commit `b5de14849152c04b9731a623cf057f81fc8609f2`. It merges master into the stage 04 branch, and the stage work is in commit `3ee80e7e`. `git rev-parse HEAD` in the review worktree returns the same sha.

Blocking findings: none.

Unverified:
- I did not see the worker's `bun run check:job` run. The worker's job result reports `check:job PASS master=f4f22c37ed tip=b5de148491 full=0`. The worker also says the line came from a piped call and that they saved no log. I ran no suite, lint or typecheck, because this is a review.

Acceptance checks against stage-04-scan-extension.md and ticket.md. Each one is proven by reading `apps/server/src/bare-codes.test.ts` and by a run of that file:
- **Test-file skips cover only strings and JSON (D3).** `TEST_FILE` (line 27) covers `*.test.ts(x)`, `*.test-helper.ts`, and files under `test/` or `e2e/`. It guards only the string scan (line 134) and the JSON branch (line 128). The comment loop (lines 141-146) still runs for test files, and `FIXTURE_LABELS` is kept.
- **A JSON parse error gives one hit (D14).** When `ts.parseConfigFileTextToJson(...).error` is set, `jsonHits` returns exactly one `${file}: cannot parse` (line 106). The row `{"a": ` → 1 passes.
- **Tagged templates count (D13).** `tsStrings` walks every node with `forEachChild`, so it also reaches the template under a `TaggedTemplateExpression`. The row ``sql`SELECT 1 -- open loops stage 10/11` `` → 1 passes.
- **No runbook in the file set.** The set is the four roots `{ts,tsx,mjs,js,astro,css,sh,json}`, plus `apps/docs/src/content/**/*.{md,mdx}`, plus `docs/modules.md` (lines 150 and 192). `apps/docs/src/content` has no symlinks and no copy of `deploy/README.md` or `docs/release-checklist.md`. The docs site shows those pages in place through `apps/docs/src/in-place.ts`, which is outside the glob.
- **Test rows.** The required rows are in one `test.each` table: `a.test-helper.ts`, `test/a.ts`, `e2e/a.json`, `a.test.tsx`, the JSX text in `a.tsx`, and the JSON key `{"F115 stage 09": 1}` → 1 (lines 169-178). The table also has every row of stage cases 1-9, with exact counts. Case 9 changed as the stage says: `const x = "D12";` → 0.
- **Rename.** `git diff -M20%` shows the file as a rename. `git grep comment-codes` outside `spec/` and `docs/owner-decisions.md` finds nothing.

Checks I ran, all in a scratch detached worktree at b5de1484 (`/tmp/f150-review-scratch`, removed afterwards). Limen's proof format does not accept these runs: they ran in calls that used `|` or `;`, and I saved no log.
- `bun install --frozen-lockfile`: 991 packages installed.
- Baseline `bun test apps/server/src/bare-codes.test.ts`: 26 pass, 0 fail.
- Break check 1: I added `export const breakCheck = "F999";` to `packages/core/src/index.ts`. Case 10 ("no scanned file holds one") failed with hit `packages/core/src/index.ts:28: "F999"`. I reverted it.
- Break check 2: I added a line `S4` to `docs/modules.md`. Case 10 failed with hit `docs/modules.md:494: S4`. I reverted it.
- Break check 3: I added `F999` to a `why` value in `apps/server/src/modules/layers.json`. Case 10 failed with hit `apps/server/src/modules/layers.json:15: F999 Organization settings ...`. I reverted it. After each revert, `git status` was clean.

Notes:
- **No row shows that comments in test files are still scanned (plausible gap in the tests, not a bug).** The code keeps them scanned. A row such as `a.test.ts`, `// F115 stage 09` → 1 would fail if a later edit moved the `TEST_FILE` guard to the top of `bareCodes`.
- **The skip list is narrower than "every test file" (plausible).** `TEST_FILE` does not skip `*.test.mjs`/`*.test.js` or `tests/` and `__tests__/` folders. The stage list does not name them, and the repo scan passes today. If such files gain fixture strings later, they will be reported as hits.
- **The rule text still says "Bare codes in comments" (not drift).** `.agents/limen/styleguide.md:57` and `docs/code-patterns.md` § Comments still use the old wording. Stage 05 step 2 owns that update, so it is not drift in stage 04.

Decisions for the owner: none.

Note check
- HEAD is b5de1484: proven. `git rev-parse HEAD` printed `b5de14849152c04b9731a623cf057f81fc8609f2` (standalone call, exit 0).
- D3, test-file skips only for strings and JSON: proven. `apps/server/src/bare-codes.test.ts` lines 27, 128, 134, 141-146.
- D14, a JSON parse error is one hit: proven. `apps/server/src/bare-codes.test.ts` line 106, plus the table row at line 180.
- D13, tagged templates count: proven. `apps/server/src/bare-codes.test.ts` lines 91-99, plus the row at line 170.
- No runbook in the set: proven. `apps/server/src/bare-codes.test.ts` lines 150 and 192. The glob does not name `deploy/README.md` or `docs/release-checklist.md`.
- Test rows for test-helper, test/, e2e/, tsx and JSON keys: proven. `apps/server/src/bare-codes.test.ts` lines 169-178.
- Three break checks (optional, "only if cheap"): not proven by Limen's format. I ran them in calls with `;` and `|`, and I saved no log. The hit lines are quoted above. I did not rerun them, because that would repeat a test run.
- Final message names the commit and each check: proven. This message.
- Easy-to-miss rule "run no suite": followed. The only test command was `bun test apps/server/src/bare-codes.test.ts`, run in the scratch worktree. I ran no `test:unit`, `test:int`, `test:e2e`, lint or typecheck. There is no log file; the evidence is the command list of this session.
- Reminder, tests run once per job and only single files while working: followed. I ran one file only, the baseline and the three break checks. I made no commit.
- Reminder, `check:job` before the final message: not applicable. This is a review job, and it committed nothing.
- Reminder, a review job runs no suite, lint or typecheck: followed. See the easy-to-miss line.
- Reminder, never delete `node_modules/.cache/`: followed. I deleted no cache. The scratch worktree and its own fresh install were removed with `git worktree remove`.
