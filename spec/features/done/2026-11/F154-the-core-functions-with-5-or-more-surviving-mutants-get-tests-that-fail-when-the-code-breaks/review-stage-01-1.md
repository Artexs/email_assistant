PASS 0c58878dcb678292d9bac53fe272465cb0c0f822

This review covers the stage 01 candidate of F154: the per-function mutation gap tool and the run lock in `mutation.sh`. `git rev-parse HEAD` returned 0c58878dcb678292d9bac53fe272465cb0c0f822, which matches the given candidate. HEAD merges master into the worker branch. I compared the merge result with its master parent (`git diff HEAD^2 HEAD`). That diff holds only the six stage files.

Blocking findings: none.

Unverified:
- The worker's `check:job` result. I did not get the worker's final message, and `results/stage-01.md` does not hold the `check:job PASS` line. The coordinator must confirm that line before it lands the branch. This is not blocking.
- The real 2-hour wait. I did not run it. The exit-3 logic is proven on a copy (see below).

Proven (seen in this session; the Note check below lists which proofs meet the Limen proof format):
- **Gap counts match.** I ran `bun scripts/test-audit/mutation-gaps.ts --in /tmp/f125-s03/run-4/mutation.json --min 5 --by fn` again. It gave 122 data rows, and column 5 sums to 1,260. The top rows match `results/stage-01.md`: `replies/schema.ts` (module level) 42, `checkSpread` 38, `sent-slot.ts` (module level) 33. The tool counts only `SURVIVED_STATUSES` = `["Survived", "NoCoverage"]` (`scripts/test-audit/mutation-summary.ts:190`).
- **The newCaseKills rule holds.** A case is new when its (file, name) pair is only in `after`. A kill counts when the mutant key (file:line:column, mutator, replacement) was Survived or NoCoverage before, the mutant is `Killed` after, and the case is in `killedBy`. I ran `bun test scripts/test-audit/mutation-gaps.test.ts` once: 17 pass, 0 fail. Then I made a temp copy without the `wasCounted` check, and 3 tests failed: the two newCaseKills cases and the CLI exit-1 case. So tests 9 and 10 do fail when the rule breaks.
- **The run lock behaves as specified.** I read the lock block in `scripts/test-audit/mutation.sh` and ran a copy of it with `-w 2` instead of `-w 7200`. With the lock held, it printed `mutation.sh: waiting for the mutation lock`, then `mutation.sh: mutation lock busy for 2 hours`, and exited 3. With the lock free, it continued and exited 0. The lock is taken after the Node version check and before the copy of the sources. Usage, outputs and the EXIT trap did not change.
- **No plan codes.** A grep of the added lines under `scripts/` for `\b[A-Z]{1,2}[0-9]{1,4}\b` found nothing. The README bullets contain no codes; the `S10`/`S11` text in the README was there before this change.
- Stage tests 1–10 are all present in `mutation-gaps.test.ts`, with exact expected values.

Notes (not blocking):
- Proven gap, low impact: no test covers the `mutant.status !== "Killed"` part of the after-check in `newCaseKills`. I removed it in a temp copy and all 17 tests still passed. Stryker normally gives `killedBy` only to Killed mutants, so the real risk is small. A case with a Survived or Timeout mutant whose `killedBy` lists the new test would close the gap.
- Plausible: the script holds the lock on file descriptor 9, and Stryker's child processes inherit it. If `mutation.sh` is killed with SIGKILL and a child keeps running, the lock stays held until that child ends. Later runs would then wait up to 2 hours and exit 3. A fix is to start children with fd 9 closed (`9>&-`), or to document this case.
- `functionOf` returns the full dotted chain as `id`, for example `texts.tries`. The row id in `functionGaps` is the short name unless that name repeats in the file. The two id meanings differ, but the README documents this, and it matches stage tests 1 and 6.
- In compare mode, `--min` defaults to 1, not 5. `results/stage-01.md` records this. Later stages must pass `--min` if they want the gap-list threshold.
- Small: `--in` with no value reaches `Bun.file(undefined)` instead of printing the usage line.
- Style: the test "a chain that repeats in one file gets the start line" sits outside its `describe("functionGaps")` block. This is cosmetic.

Checks run:
- `git rev-parse HEAD`: 0c58878d…, a match.
- `bun install --frozen-lockfile`: OK. It was needed because the test preload imports `@ea/core`.
- `bun test scripts/test-audit/mutation-gaps.test.ts`: 17 pass, 0 fail.
- Break 1, a temp copy without the before-status check: 3 fail. Break 2, a temp copy without the after-`Killed` check: 17 pass (see the first note). I deleted both copies, and the worktree is clean.
- CLI rerun on `/tmp/f125-s03/run-4/mutation.json`: 122 rows, 1,260.
- The extracted lock block with a short wait: exit 3 with the busy line, and exit 0 when the lock is free.
- Not run: lint, typecheck, `bunx tsc -p scripts/test-audit`, and any suite. A review runs none of them.

Note check
- Reviewed HEAD is 0c58878d…: proven. `git rev-parse HEAD` (a single command that exited 0).
- Gap counts 122 rows and 1,260 mutants: not proven by the Limen standard. The CLI rerun ran in this session, but the bash call joined commands with `;` and a pipe, and I saved no log file. I did not rerun it only to clear the note.
- newCaseKills rule and CLI exit 1: not proven by the Limen standard. The one-file run (17 pass) and the break run (3 fail) ran in calls joined with `;` and pipes, and I saved no log file. Rerunning would break the run-once rule.
- Lock wait line and exit 3: not proven by the Limen standard. The extracted-block run printed both lines and `exit=3`, but the call used `;` and I saved no log. The real `-w 7200` path is unverified.
- Easy-to-miss rule (no plan codes in code or README): followed, but not proven by the Limen standard. The grep of the added lines found no match (rc=1), and I saved no log.
- Reminder, tests run once per job: followed. The one test file ran once; the break runs used temp copies to see the tests fail; I ran no `test:unit`, `test:int` or `test:e2e`.
- Reminder, `check:job` as the last step: does not apply. This review job committed nothing.
- Reminder, a review runs no suite, lint or typecheck: followed. I ran one test file only, to prove the newCaseKills doubt.
- Reminder, never delete `node_modules/.cache/`: followed. I did not touch it.
