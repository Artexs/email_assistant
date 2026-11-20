Review verdict, resent in full because the first copy was not filed:

PASS 73dab91b62ba1403cc083eb287f171a203be5695

There is no blocking finding. The review rule fails a plan only on a proven break of an acceptance bullet, and none is proven. Notes 1 and 2 are proven plan errors. Fix them before stages 11–17 spawn.

## Findings
1. **Proven: stage 12 expected values do not match the code.**
   - `stages/stage-12-notices.md:19-21` describes `evidenceItems` with "both flags false" and `renderWeeklyReport` with a "no-important line".
   - `digest/weekly.ts:114` has one `noMail` line, shown only when `m1.important` and `m4.triaged` are both 0. The mixed cases (0 and 5, 3 and 0) take the `else` branch.
   - `digest/weekly.ts:58-90` has no "flags". It loops `barCategories` over `trip`, `auto`, `global.decision` and `history.outcome`.
2. **Proven: stages 11–17 name private functions without an exported caller.**
   - `plan.md:14` (P2) says to test private helpers through the exported function.
   - Private at `HEAD`: `base64UrlToUuid` and `uuidToBase64Url` (`digest/callback.ts:159,167`), `messageIdsOf` (`loops/replies.ts:50`), `oldestFirst`, `normalizeAnswer`, `uniqueIds`, `threadOf`, `byId`, `prioritize`, `kindOf`, `byRank`, `cutToLimit`, `briefOptions`, `sortItems`.
   - `stage-11-digest.md:32` says to take the encoder from `callback.ts`, but it is not exported.
   - Add a "Through" column to stages 11–17.
3. **Plausible: D5 conflicts with the ticket acceptance.**
   - `plan.md:23` lets a function stay at 29 if every mutant is classed `equivalent`, `unreachable`, `bug` or `unstable`. `ticket.md:24` requires fewer mutants in each named function.
   - No cap on self-classed `equivalent` or `unreachable`. Stages 02–17 land without review.
4. **Plausible: D6 does not prove a case kills a surviving mutant.**
   - `plan.md:24` and `stage-01-gap-tool.md:21,38` count any mutant in `killedBy`.
   - A near-copy of an existing case passes. Count only mutants that were `Survived` or `NoCoverage` before and `Killed` after.
5. **Plausible: the plan has no rule about the bare-code scan.**
   - `scripts/check-job.sh:57` (master) runs `apps/server/src/bare-codes.test.ts`. It scans comments in `.ts` files, test files included.
   - Its pattern matched all four plan-style snippets I tried. One is the `// D1;` comment in `stage-01-gap-tool.md:16`. Add: no D/P/stage codes in code, comments or test names.
6. **Plausible: same-name functions merge under D1.**
   - `texts/approvals-en.ts` has `rejected` at lines 16, 132 and 144. `stages/stage-05-approvals.md:99` covers one of them.
7. **Plausible: D8 names no test file where none exists.**
   - `texts/approvals`, `notices`, `minimal` and `loop-taps` have no own test file.
   - Parallel stages 05 and 13 may collide on `texts/index.test.ts`.
8. **Plausible: stage 04 omits `sentLabelSchema`.**
   - `sim/sent-slot.ts:144-150` is in the same `(module level)` bucket. `stage-04-sim-slots.md:23-34` does not cover it.
9. **Unverified: unstable-mutant arithmetic.**
   - `plan.md:19` says 1,260 = 1,257 + 3 unstable. `/tmp/f125-s03/compare-3-4.txt` shows 5 flips one way and 1 the other, net +4.
   - I did not re-run the probe: `node_modules` is not installed.
10. **Note: the score floor is noisy.** Run 4 scores 86.42 % against 86.45 % for the audit run, from the unstable mutants. Stage 18 should still rise above both.
11. **Note: run cost is unmeasured.** Two or more Stryker runs per stage sit behind one lock (D4), and no wait budget is set (`plan.md:39`).

Checks that held: expected values for stages 02, 06, 07 (part), 09, 14 and 17, and the stage 03 and 04 constants and messages, match the code at `HEAD`. All stage-glob source files exist. Plan size is within the limit.

## Note check
- Final message starts `PASS <sha>`, sha `73dab91b…`: proven. `git rev-parse HEAD` printed `73dab91b62ba1403cc083eb287f171a203be5695` in a single bash call (exit 0).
- Findings cover gaps, rule conflicts, guess-needed steps, unsourced facts, impossible values and stage size, each with file:line: proven. Evidence is `spec/features/planned/F154-the-core-functions-with-5-or-more-surviving-mutants-get-tests-that-fail-when-the-code-breaks/plan.md`, the `ticket.md` beside it, the 18 `stages/*.md` files and `packages/core/src/digest/weekly.ts`. Each finding quotes a line I read there. The `cat -n` calls used `;` or pipes, so I name the files, not the commands.
- Facts about the base are checked against the repo: not proven. Every command I used joined with `;` or a pipe, or ran from `bun -e`/`bun /tmp/probe*.ts` over a path outside the repo. Only the files exist as evidence: `/tmp/probe1.ts`, `/tmp/probe2.ts`, `/tmp/f125-s03/run-4/mutation.json`. The unstable-mutant count (finding 9) stays unverified.
- Added check: stage files ask nothing the bare-code scan rejects. Not proven, and the check failed. The regex run on plan snippets matched all four (`bun -e`, no `&&`), so the plan has a gap (finding 5). Evidence file: `apps/server/src/bare-codes.test.ts` on master.
- Easy-to-miss rule (missing code detail is not a finding): followed. Findings 1–8 each name a wrong value, a missing decision, a test or an interface. None complains only about missing code detail.

My own `note.md` says "Not proven yet: none". It overstates the facts check and the bare-code check, so this report overrides it.

## Reminders
- Run no suites, lint or typecheck in a review: followed. I ran no test, lint or typecheck, and no install. I ran only probe scripts and `bun -e` reads.
- `check:job` is for code jobs: not applicable. This is a review and I committed nothing.
- Never delete `node_modules/.cache/`: followed. I did not touch it.
- Tests run once per job, no `--no-verify`: followed. I made no commit and no suite run.
