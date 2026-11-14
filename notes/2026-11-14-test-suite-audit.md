# Test suite audit: approach check and plan shape

> 2026-11-14. Input: `~/.pi/agent/notes/2026-11-14-handoff-test-suite-audit.md`. Status: the owner accepted the defaults of § 5 ("ok"). Planned as two tickets: `spec/features/planned/F124-…` (parallel runs, short waits) and `spec/features/planned/F125-…` (audit, approval gate G1, cuts). No test changed.

## 1. Differences between the handoff and the repo (checked 2026-11-14)

| Handoff says | Repo now | Command |
| --- | --- | --- |
| HEAD `bef425e` | HEAD `5e90345` (F097 s02 and F098 s06 merged) | `git log --oneline -5` |
| 319 test files, `packages/core/src` 59 | 321 files, `packages/core/src` 61, plus 1 in `apps/web/integrations` | `git ls-files '*.test.*' '*.spec.*'` |
| CI: both jobs have `timeout-minutes: 20` | The `ci` job has no timeout. Only `e2e` and `image` have 20 | `.github/workflows/ci.yml` |
| F092 branch open | F092 landed (PROVEN 2026-11-14). Open job worktrees now: F097 s01/s05, F098 s04/s07, F099 s08 review, F100 refresh, F105 plan, plus ~20 old plan-review worktrees | `git worktree list` |
| — | `spec/build.md` TRACK says Bun pin 1.3.14; `.bun-version` is 1.4.4. The board line is stale | `cat .bun-version` |
| — | Untracked `notes/decision-docs/` (not ours) | `git status` |
| Not in handoff | CI time (build.md TRACK, run 43449221495): unit 30 s, int 191 s, e2e 3 m 0 s, ci job 4 m 56 s | `spec/build.md` |
| skip/todo: 0 | Confirmed: 0 `.skip`, `.todo`, `.only` in apps, packages, tools | grep |

## 2. Facts checked (web, 2026-11-14)

- Bun 1.4 has `bun test --parallel[=N]` (files across worker processes, implies `--isolate`), `--shard=i/n`, `--timings`, and `--changed[=ref]` (import-graph test selection, since 1.3.13). Sources: https://bun.com/docs/test/parallel, https://bun.com/blog/bun-v1.3.13. The repo pins 1.4.4, so all four flags exist. Not verified: that the int suite is safe under `--parallel` with one shared DB and one GreenMail.
- Mutation testing: StrykerJS has no official Bun runner (stryker-js issues #4439, #5424 still open). A community plugin exists: `stryker-bun-runner` (https://github.com/hughescr/stryker-bun-runner), with per-test coverage. Not verified: that it works with Bun 1.4.4 and this repo's `bunfig.toml` preload.
- `bun test --coverage` gives per-file line coverage (lcov). Not per test file. Per-test-file coverage needs one run per test file.

## 3. Check of the proposed approach

| Step | Verdict | Why |
| --- | --- | --- |
| 1 Timing | Keep, run first | Cheap (`--timings` / JUnit report). It shows where the 191 s int time goes. |
| 2 Mutation testing | Keep, but narrow | Only `packages/core` (pure logic, no mocks). The runner is a community plugin: stage 01 probes it on one small folder first. Int suite: no mutation (too slow, DB state). |
| 3 Coverage per test file | Change | "Remove the file, coverage stays the same" is a weak test of redundancy: coverage shows what runs, not what is checked. Use it only to pair test files that hit the same lines, then let mutation (core) or a reader (server) decide. |
| 4 Staleness | Keep | Add: tests that import paths of removed code, tests that name a dropped ticket, tests of `backend/` (old). |
| 5 Pattern grep | Keep | Add: tests whose only `expect` is `toBeDefined`/`toBeTruthy`, tests that assert a mock was called and nothing else, tests that check copy text that another test already ties (`activity-text.test.ts`). |

### Better or missing approaches

1. **Speed comes from parallel runs, not from deletion.** Unit is 30 s; int is 191 s. Deleting 20 % of tests saves perhaps 20–40 s. `--parallel` on the int suite can save more than that in one line of `package.json`, if the tests are isolated. Recommendation: a separate small ticket "int suite runs with `--parallel`" (probe, fix shared-state tests, measure). It does not touch test bodies, so it does not conflict with open branches.
2. **Merge near-duplicates into table tests** (`test.each`) instead of deleting them. It keeps the cases and cuts lines and setup cost.
3. **Prevent new weak tests.** About 60k test lines came in 7 days from agents. Without a rule, the audit result decays in a week. Add a short test-quality rubric to `.agents/limen/styleguide.md` and the reviewer preamble (one behaviour per test, a real assertion, no copy of an existing case, no test that only restates the implementation). This serves "more accurate tests" best.
4. **`--changed` for local worker proofs** is tempting but risky: a stage proof must run the full suite, because CI does. Rejected for proofs; possible later for a fast pre-check.

## 4. Plan shape: who writes the detailed plan

Question from the owner: (a) we write product decisions and the approach here, and the Limen planner writes the detailed plan; or (b) we write the detailed removal plan here, and Limen only runs workers.

Recommendation: **neither as stated; a two-phase ticket.**

- The cut list cannot exist before the measurements. A detailed removal plan written now is a guess. So (b) is not possible now.
- A detached planner job cannot ask the owner (`notes/2026-11-13-limen-planner-role.md`: "plan-task §2 is lost in a detached job"). The open questions in § 5 are owner choices. So (a) loses them.
- Therefore: in this interactive session, run `plan-task` with the owner's answers. It writes `ticket.md` (aims, keep rules, what "weak" means), `plan.md` (decisions), and the read-only stages (timings, mutation probe, scans, report). The report is a table with one row per candidate: file, test, reason, evidence, action (delete / merge / rewrite / keep), time saved, open branches that touch the file.
- After the report, the owner marks the rows. The approved rows are the removal plan. A planner refresh job (no owner questions left) turns them into cut stages, one directory per stage, only where no open branch touches the files. Workers then do mechanical cuts with a before/after proof.
- Result: decisions with the owner here, measurement by Limen workers, mechanical cuts by Limen workers. No stage needs the agent to guess.

## 5. Questions for the owner (with defaults)

1. Aim: speed or signal quality? Default: both, as two tickets. Speed = `--parallel` ticket. Quality = this audit + rubric.
2. May stage 01 add a dev dependency (`@stryker-mutator/core` + `stryker-bun-runner`) and a script? Default: yes, in `packages/core` only; removed again if the probe fails.
3. Cuts: wait for all open branches, or go per directory with no open branch? Default: per directory; each cut stage checks `git worktree list` and `git diff master...<branch> --name-stat` first.
4. Who approves the cut rows: the owner, or the coordinator by the rules? Default: the owner (the handoff decision), because deletion of tests is hard to judge later.

## 6. Probe results (2026-11-14, owner PC, HEAD 54fe78f)

- Unit serial: 2,262 cases, 27.3 s wall, 4.7 s CPU. 9 cases = 21.4 s (real production timeouts). `--parallel` (16): 8.4 s, all pass.
- Int serial: 1,683 cases, 183 s wall, 54 s CPU; top 10 files = 72 %; `imap-contract.test.ts` 43.5 s. `--parallel=4`: 56 s, 1 fail (`mail-jobs.test.ts:299`, a global count).
- Core mutation (temp copy, Stryker 10.1.1 + `@hughescr/stryker-bun-runner` 1.6.0, `disableBail`): 5,230 mutants, 85.5 %, 2 min. 23 of 787 cases kill nothing (mostly registry checks); a greedy set of 449 cases kills every mutant the 787 kill.
- Conclusion: speed is F124 (parallel + injected timeouts); quality and size is F125. Details and sources: the two `plan.md` files.
