# F125 plan review 1

> Scout job `2026-11-14-f125-plan-review-3dcd7e6e`, Opus 5.5 high, base a614e3c, 2026-11-14. Filed whole (its findings message).

Packet: Cold pre-mortem review of the F125 plan (ticket, plan, questions, stages 01–07). Which stage lets a lost check, a flaky CI, a wrong cut or an unfinishable stage through?
Base: a614e3c
Verified: `bun test packages/core --reporter=junit` in the main checkout (same commit a614e3c, has node_modules; this worktree has none) -> `Ran 834 tests across 68 files.` The static grep of `test(`/`it(` call sites over the same files gave `627`.
Unknowns: I did not run Stryker, so the F4 claim "Stryker line = JUnit line + 1" and N1 are unverified. I did not count cross-area B groups. I did not measure reader throughput for 250 items. The whole unit suite did not run (it needs .env/DB). /tmp (a shared 16G tmpfs) was full once during this session (`mkdir: cannot create directory '/tmp/f125-review-probe': No space left on device`). A minute later it had 15G free.

1. stages/stage-01-static-scan.md:70 vs :41/:27. **Major.** The check "row count is within 5 % of the JUnit totals … (`each` cases count once here)" contradicts itself. Each case and each loop body is one scan row but many JUnit rows. In core: 834 JUnit vs about 627 call sites (25 % gap). Repo: about 3,500 call sites vs about 3,990 (11 %). policy.test.ts:133 alone gives 46 JUnit rows. A Sonnet worker cannot meet "Done when". It can only guess or "fix" a correct scanner. — observed

2. stages/stage-03-mutation-core.md:3,35 and plan.md:101 (F4). **Major.** Stage 03 runs in parallel with stage 02 (plan.md:186). It joins `key` "to `cases.tsv`", but `cases.tsv` is a stage 02 output (stage-02:42). The only input on hand is `cases-static.tsv`. Its `name` is "the first argument text (template literals as written)" (stage-01:26). The F4 join needs the evaluated JUnit name, so loop and each cases (about 200 of 834 in core) go `unjoined`. Their kills then never reach a key. Also, S10/S11 never reach `cases.tsv`, but plan.md:80 selects S1–S11 from it. — observed

3. plan.md:36 (D9) and plan.md:89–91 (Cut stage rules). **Major.** The proof rules conflict with the actions. (1) "the delta equals the approved rows" fails for MERGE-TABLE (each table row is still a JUnit case), REWRITE-WEAK (delta 0) and MOVE-TO-UNIT (int −1, unit +1). (3) "hit-line count … does not drop (unit and int separately)" always fails for MOVE-TO-UNIT and for an int DELETE-DUP whose twin is a unit test. Those are the actions that stage 06 (stage-06:5) names as the main win. The phase B planner "only turns groups into stages" (D2), so it must guess. No N item checks that lcov is stable run to run (int, timing-dependent code). — observed (rules) / guessed (lcov noise)

4. plan.md:80–82, stage-05:13, stage-06:9, stage-07:10–12. **Major (wrong cut).** No rule stops a cut row from naming as "kept" a case that another row also cuts. B groups span files and areas (plan.md:48 "any file"). Stages 04, 05 and 06 run in parallel, and each reads the same cross-area B group as an item of its own area. Stage 07 merges pairs but does not check that each DELETE-DUP `kept` key is outside all cut rows. Outside core, only lcov guards a cut (D5: no mutation data). Both copies can go if other tests cover the lines. — observed (rules) / guessed (frequency)

5. plan.md:90–91, 127–128 and plan.md:36 ("before"). **Major.** Report and reject-list keys are `file:line` taken at the phase A base. Phase B starts only after F124 lands, and F124 edits test files (F124 stage-01:10,23,36: auth-mail, runtime, scheduler tests). In the 39 commits since plan base 54fe78f, 19 test files changed. The cut rules re-check open branches only (rule 2). No rule re-resolves a key by name after landed drift. "Killed before" can mean the committed `mutation-baseline.tsv` (stale) or a rerun at the cut base. A worker can delete the wrong case at a shifted line. — observed

Further findings (the format cap is 5):
- **Major (stage size).** stage-05:3 and stage-06:3, with plan.md:81–82: up to 250 items, each needing "the test, the code it calls, and the nearest other tests". That is about 1,000 file reads in 2 h, with no rule for partial commits or splits. Stage 04 has no timeout and three sections, and plan.md:81 does not say if the 250 cap is per stage or per section (Q3 says "per area"). — guessed
- **Major (guess).** plan.md:51 S8 "imports no module outside test helpers…". `bun:test` and `@playwright/test` are outside that list, so S8 either never fires or the worker guesses. `apps/web/e2e/seed.ts` and `env.ts` match no helper pattern, and e2e specs import `../../src/i18n/en` (12 of 13 files). — observed
- **Minor (conflict).** stage-07:10 "merge a smaller one with the nearest group of the same action" vs P2/Q2 "one rule and one action". — observed
- **Minor.** stage-03:12–17: with `set -euo pipefail`, a failed run never reaches step 6 `remove $work`, so Stryker temp folders stay on the shared tmpfs. — observed (rule) / guessed (impact)
- **Minor (facts).** At HEAD: 334 test-named files (F1 says 321 at base; I count 327 at 54fe78f). Core has 834 JUnit cases (F1: 787). e2e has 13 spec files in `apps/web/e2e/tests/` (F1: 12). `apps/server/test/contract/` holds only `mail-provider.ts`, no test (K4, plan.md:64). `mail-seed.test.ts` and `mail-check.test.ts` do not match `*-cli.test.ts` (stage-06:13). — observed
- **Note.** Two quarantined `test.skip` cases are S7 and skipped in CI: `mail-folders-cli.test.ts:41` and `main-start-log.test.ts:13`. FIX-NEVER-RUNS proposes "delete it" (plan.md:74). Only K5 (a comment names a ticket folder) keeps them, and readers must apply K5 first. F6 is right: E2E URLs exist only in the `e2e` job (ci.yml:86–87). The tool tests in `scripts/test-audit` run in no CI job, and `eslint .` gives typed lint only to apps/server, packages and tools (eslint.config.js:142,154). — observed

Checks: the Phase A Proof (plan.md:147) covers the tool tests, tsc, lint and the unchanged unit/int suites. It misses all of these:
- the stage 01 count contradiction
- the stage 02/03 join order
- cross-stage kept-case integrity
- key drift before phase B
- D9 delta and lcov rules that conflict with MERGE-TABLE, MOVE-TO-UNIT and int DELETE-DUP

The stage 07 review (plan.md:158) checks evidence and K rules only.

FAIL
