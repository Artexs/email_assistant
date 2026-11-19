# F125 · Plan review 2 (refresh 1)

Job 2026-11-19-f125-plan-review-10321061, Sonnet 5.5 high, on fdb50594. Final message, verbatim:

FAIL fdb50594d90705d80d98b355f8f18da8c4be6c43

HEAD matches the candidate. `git diff --stat 1927d052..HEAD` touches only the F125 folder. One blocking finding, then minor findings, then the note check.

**Blocking**

1. **Major, proven.** `stages/stage-01-static-scan.md` file list and `stages/stage-02-timings-and-coverage.md` Step 3.
   - Bun's JUnit reports `file` as the running test file and `line` as the line inside the shared contract module. A probe with a helper module gave `file="a.test.ts" line="4"` for two runs.
   - `apps/server/test/contract/mail-provider.ts` (34 call sites) and `mail-sender.ts` (6) are not `*.test.ts`, so the scan never reads them. They run about 150 times (`fake.test.ts` ×2, `imap-contract.test.ts` ×2, `sender.test.ts`, `smtp-send.test.ts`, `graph-send.test.ts`).
   - Those JUnit rows become `unscanned` (about 1.2 %, above the stage 02 limit of 1 %). Some join to the wrong row: provider-contract lines 119, 179 and 365 equal `test(` lines in `fake.test.ts`, and sender-contract line 135 equals one in `graph-send.test.ts`. Those get a wrong `junit_count`, `time_s` and `S9`.
   - Fix: stage 01 scans non-test files that hold `test(` calls (the two contract modules) as `kind` `int`. Stage 02 joins a JUnit row with no scan row at (file, line) to the contract row by `name` plus `classname`, and counts contract rows apart from the 1 % check. Add a fixture test for both.

**Minor and notes**

2. **Minor, proven.** The N4 estimate and Q5 leave out `S8` (priority (a), one item per case). A regex import check gives `S8` call sites: stage 04 area about 99, stage 05 area 72, stage 06 area 49.
   - Stage 04 comes to about 380 items, so it needs two continuations, not one. Stage 05 comes to about 120. Stage 06 comes to about 210 plus int `S9`. All still fit the 450 cap.
   - Fix: add `S8` to N4. Say "one or two continuations" for stage 04 and "zero or one" for stage 05. Update Q5.
3. **Minor, plausible.** "About 5,500 integration cases" counts call sites, while the unit figure counts JUnit cases. Int JUnit is likely 6,500–7,300, so 12,800 is a floor. Fix: say "at least" in the ticket and P2.
4. **Minor.** Stage 04 Step 2 has no rule for `apps/web/src/i18n` (key-parity tests, K2) or for docs `src` and `integrations` (content and link checks, K2; CSP check, K3). It also does not say `apps/docs/e2e` belongs to stage 06. Each new area still has exactly one owner.
5. **Minor.** The F136 note in stage 06 is enough for key drift, because Cut stage rules 2 and 3 cover it. Add `apps/docs/e2e/site.ts` with its config, and `e2e-seed.test.ts`, to the files F136 may change.
6. **Minor.** Needs lines meet notes/2026-11-20-replan-parallel.md § 8.3 and none says "stages landed". Two weak spots:
   - Stage 06 says "if stage 05 has landed". Better: "if the file exists in master at start".
   - Stage 07 Needs `unit-int-pairs.tsv`, but stage 05 writes it only when pairs exist. Stage 05 should write it, empty if none.
7. **Note, proven.** K4 holds at HEAD: both contract modules exist, the five runner files are right, and `mail-sender.ts:133` is the only conditional skip. FIX-NEVER-RUNS facts hold: `e2e-seed.test.ts:90`, the `ci` job has no E2E URLs, the `e2e` job (lines 94–95) runs only `test:e2e` (line 118), and `limen-prepare.sh` has no E2E keys. No `Quarantined` comment remains. `tools/mail-oauth-spike` is in no suite, and it came from the dropped F117.
8. **Note.** `plan.md` is 5,249 words against the 1,500 cap. Stages 01, 02, 03 and 07 exceed 700. This is acknowledged in the refresh. Trim F1 to a pointer to `plan-refresh-1.md`.
9. **Unverified.** Int `S9` counts, because int was not run. The Stryker and coverage runtime against the 2 h timeout. The actual scan flag counts; my `S8` estimate is regex-based.

**Note check**

- Every count in ticket.md, plan.md and stages 04-06 matches the code at HEAD: not proven. The unit counts are saved: `~/.cache/f125-review/junit/packages_core.xml` and the nine sibling XML files and logs in that folder match the plan, including 17 cases ≥ 1 s. The int, e2e and file-list counts came from piped or `;`-joined commands with no saved log, so they have no qualifying evidence. They matched the plan in the transcript.
- The new unit areas have exactly one reader stage and a stage 01 kind rule: proven. See `spec/features/planned/F125-every-test-file-is-measured-and-classified-and-only-owner-approved-weak-stale-or-duplicate-tests-are-cut-or-merged/stages/stage-04-review-core-web-tools.md` and `.../stage-01-static-scan.md`. Finding 4 is a minor gap in the rules, not in ownership.
- The 150-item cap and two-continuation rule hold: proven. The estimate is wrong and the cap still holds: `~/.cache/f125-review/s8.mjs` gives about 380 items for stage 04, within 450 (finding 2).
- Each Needs line names a real file or interface (§ 8.3): proven. See the stage files `.../stages/stage-01-static-scan.md` through `.../stage-07-report-and-rule.md`. Findings 6 are minor wording gaps.
- K4 and FIX-NEVER-RUNS facts hold: proven. See `apps/server/test/contract/mail-sender.ts`, `apps/server/test/integration/e2e-seed.test.ts` and `.github/workflows/ci.yml`.
- The F136 note in stage 06 is enough: proven. See `.../stages/stage-06-review-int-e2e.md`. Finding 5 lists two files to add.
- The final message starts with PASS or FAIL plus sha, with numbered findings: not proven. This message is the deliverable and no file records it.
- Obligation missing from the note: the contract-module join, which became finding 1. Evidence: the probe was in a temp folder that I removed afterwards. The line overlaps come from `grep` output in the transcript, with no saved log. Treat the probe as reproducible, not as a saved artifact.

**Easy-to-miss rule** ("Do not run the integration suite, read .env or change files"): followed. I ran no `test:int` or Playwright. I only checked that `.env` does not exist, and I never read it. `git status --short` was empty after the install and the unit runs. The `bun install --frozen-lockfile` wrote only ignored `node_modules`. The probes and `s8.mjs` live in `~/.cache/f125-review/`, outside the repo. I wrote only the required note file, under `.limen/jobs/` in the main checkout, which is outside the worktree. The evidence is transcript output with no saved log.
