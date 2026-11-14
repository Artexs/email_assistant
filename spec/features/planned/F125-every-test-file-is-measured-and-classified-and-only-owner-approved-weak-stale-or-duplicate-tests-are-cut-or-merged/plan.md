# F125 · Test audit: measure, classify, cut only what the owner approves — plan

> **Status 2026-11-14 — planned.** Plan base: 54fe78f. Stages 01–07 written; the cut stages (08+) are written after gate G1 by a planner job.

## Input

Owner words that set the goal, word for word (chat 2026-11-14, handoff `~/.pi/agent/notes/2026-11-14-handoff-test-suite-audit.md`):

- "I am wondering if I should run some verification of all of those old tests and check if any of them are outdated or unnecessary or doesn't test anything and so on."
- "this could allow me to reduce number of unnecessary tests which will make the repositories smaller and easier to run so on the test cases, test suites will run faster and so on. Perhaps this would allow me to produce more accurate tests?"
- "I will just think about it with the stronger model analyze it and prepare a idea on or plan how to cut those tests and then there will be task for lineman to proceed with it"
- "It should also validate if this approach is correct and if there are any other or better ones."
- "I suppose that the changes will be approved later on in the lineman and in that case there will be some more detailed instructions about it in comparison to decisions and amount of tests removed or reshaped and so on."
- Answer to the four proposed defaults (aim both as two tickets; mutation tool allowed in `packages/core`; cuts per folder where no branch is open; the owner approves the cut list): "ok".

The approach check (the proposed method, the alternatives, why) is in `notes/2026-11-14-test-suite-audit.md` § 3–4. This plan applies its result.

### Product decisions

- **P1** This ticket serves signal quality and repo size. Speed is the parallel-runs ticket (F124): the probe shows that the count of tests is not what makes the suites slow (F124 `plan.md` F2–F6).
- **P2** The owner approves the cuts (owner, 2026-11-14). The approval unit is a **group** of rows with one rule and one action, not a single row: about 4,000 cases are too many to approve one by one. The owner may also reject single rows inside an approved group.
- **P3** A cut never loses what the suite catches today. Proof per cut stage: the killed core mutants stay killed, and the covered lines per source file do not drop (D9).
- **P4** Gaps (code changes that no test catches) are reported, not fixed here. They become a follow-up ticket proposal in the report.
- **P5** A test-quality rule for agents is part of this ticket. Reason: agents wrote about 60k test lines in 7 days; without a rule, new weak tests come back.

### Design decisions

- **D1** Two phases. Phase A (stages 01–07) is read-only on tests: it adds the audit tool, data, the report and the rule docs. Phase B (stages 08+) cuts. Gate G1 between them is a second-pass gate: the coordinator stops after stage 07 and asks the owner (execution plan § 2.4, "a ticket with a second-pass gate on a later stage builds up to that stage, then stops and asks the owner"). Reason: the cut list cannot exist before the data; a detached planner cannot ask the owner.
- **D2** The phase B stages are written after G1 by a `--role planner` job from the approved groups (How to run step 7). Each cut stage follows § Cut stage rules below, so that planner only turns groups into stages.
- **D3** The audit tool lives in `scripts/test-audit/` (TypeScript, run with `bun`), with its own `tsconfig.json` and unit tests run explicitly (`bun test scripts/test-audit`). Not a workspace. Reason: a new workspace changes `bun.lock`, and `deploy/Dockerfile` copies only the listed workspace `package.json` files (line 9), so `bun install --frozen-lockfile` in the image build could break. The tool stays in the repo after F125, so a later audit and the cut stages reuse it.
- **D4** Mutation testing runs in a temp folder, never in the repo: `scripts/test-audit/mutation.sh` copies `packages/core/src`, `packages/core/tsconfig.json` and `tsconfig.base.json` to a temp folder, writes a `package.json` with pinned `@stryker-mutator/core@10.1.1`, `@hughescr/stryker-bun-runner@1.6.0`, `typescript@5.9.3` and `zod` (the version of `packages/core/package.json`), installs, and runs Stryker with `disableBail: true` (every killing test is recorded, F3). Reason: no new dependency and no `bun.lock` change in the repo; this is stricter than the owner default "a dev dependency in `packages/core`" (log as a default for the owner). Rejected: a dev dependency in the repo (lock conflicts with parallel jobs, an image risk).
- **D5** Mutation only for `packages/core` (pure logic, 787 cases, 2 min, F3). Not for `apps/server` (DB, IMAP, preload; too slow and not proven to work) and not for `apps/web`. Rejected: a full-repo mutation run.
- **D6** Coverage: `bun test --coverage --coverage-reporter=lcov` for the unit paths and for the int paths, separately, serial. Used only as a baseline and a guard (D9), not to decide redundancy. Reason: coverage shows what runs, not what is checked. Rejected: "remove a file, and coverage stays the same, so it is redundant".
- **D7** Static scan with the TypeScript compiler API (`typescript` is a root dev dependency). Per test case it records the flags of § Flags. Key of a case: `file:line` of its `test(`/`it(` call, the same key as the JUnit `file` and `line` attributes.
- **D8** Reader review by workers. A worker reads each flagged case (and the groups it belongs to), decides the action by § Rules for the classes, and writes a row with evidence. A case with no flag is `KEEP (not read)`. The report states how many cases were read. Reason: a script cannot judge "this test checks something real"; a reader of every case (4,000) does not fit in jobs.
- **D9** Cut proof (per cut stage): (1) case count before/after from JUnit; the delta equals the approved rows of the stage; (2) for a stage in `packages/core`: re-run `mutation.sh` with `--mutate` limited to the source files under the changed tests; no mutant id that was `Killed` before is `Survived` or `NoCoverage` after (mutant ids are stable for unchanged source; compare by file, line, column and mutator name); (3) lcov: the hit-line count of every source file that the changed tests cover does not drop (unit and int separately); (4) the suite time before/after.
- **D10** Data files are committed as TSV in `audit/data/` of this folder, one row per case or group, so later stages in other worktrees read the same data. The raw `mutation.json`, JUnit XML and lcov files stay in `/tmp/f125-*/` (too big; regenerated by the tool).
- **D11** Open branches: phase A writes only new files (`scripts/test-audit/`, this folder) and the two rule docs, so it does not conflict. Phase B: a cut stage never changes a file that an open `limen/*` branch changes (§ Cut stage rules 2).

### Flags (static scan, stage 01)

| Flag | Meaning |
| --- | --- |
| `S1 no-assert` | The test body and the local helpers it calls hold no `expect(` and no `expect.assertions`. |
| `S2 weak-only` | Every matcher of the case is one of `toBeDefined`, `toBeTruthy`, `toBeFalsy`, `not.toBeNull`, `not.toBeUndefined`, `not.toThrow`, `toHaveBeenCalled` (no arguments). |
| `S3 mock-only` | Every matcher is a `toHaveBeenCalled*` matcher on a mock or spy. |
| `S4 snapshot` | Uses `toMatchSnapshot` or `toMatchInlineSnapshot`. |
| `S5 same-body` | The body, without whitespace and comments, is the same as the body of another case (any file). Group id `B<n>`. |
| `S6 same-shape` | The body AST, with each literal replaced by a placeholder, is the same as in 2 or more other cases of the same file, and the case is not already in a `test.each`. Group id `T<n>`. |
| `S7 skip` | `test.skip`, `.todo`, `.only`, `describe.skip`, `skipIf`/`if` with a condition. Record the condition text. |
| `S8 no-prod-import` | The file imports no module outside test helpers, fixtures and fakes (`test/`, `*fixtures*`, `*helpers*`, `fake/`, `tools/`). It may test only a fake. |
| `S9 slow` | JUnit time ≥ 1 s (unit) or ≥ 2 s (int). |
| `S10 no-unique-kill` | Core only, from stage 03: the case kills mutants, but every one is also killed by another case. |
| `S11 zero-kill` | Core only, from stage 03: the case kills no mutant. |

### Rules for the classes (reader stages 04–06)

Actions: `KEEP`, `DELETE-DUP`, `MERGE-TABLE`, `REWRITE-WEAK`, `DELETE-STALE`, `MOVE-TO-UNIT`, `FIX-NEVER-RUNS`. Info only, not a cut: `GAP`.

Hard keep rules (they win over every flag):
- **K1** A core case with a unique kill (the only case that kills some mutant). `MERGE-TABLE` is allowed if the table keeps its inputs.
- **K2** Registry, enum and completeness checks ("every kind", "one case per kind", "the list is fixed", a test that iterates a registry or enum). Mutation testing cannot see their value: they guard the next change, not the current code. Probe: 23 core cases with zero kills are mostly of this kind (F3).
- **K3** Security, privacy and the safety rules of `spec/vision.md`: tenant isolation, RLS, auth, lockout, secrets, "no leak" marker checks, log redaction, no send without approval, LLM text never a recipient, folder or command, whitelisted mail never spam.
- **K4** Contract suites that run the same cases against a fake and a real adapter (`apps/server/test/contract/`, `imap-contract.test.ts`): they are duplicates by design.
- **K5** A case whose comment or name names a bug, an incident, an alert of `docs/known-alerts.md` (empty on 2026-11-14) or a ticket folder.
- **K6** The only test of a behaviour that a `docs/capabilities/` page states.

Classes:
- **`DELETE-DUP`**: same behaviour and the same input class as a kept case; the kept case asserts at least the same. Core: `S10` and no K rule. Name the kept case (`file:line`) in the row.
- **`MERGE-TABLE`**: an `S6` group of 3 or more cases → one `test.each` table. Each row keeps the old case name as its label.
- **`REWRITE-WEAK`**: `S1`, `S2` or `S3` where a stricter assertion is possible (an exact value). Write the proposed assertion in the row.
- **`DELETE-STALE`**: tests code, a flag or a behaviour that no longer exists, or tests only a fake (`S8`) whose real counterpart has its own test. Name the evidence (a missing symbol, a dropped ticket, a capability page).
- **`MOVE-TO-UNIT`**: an int case whose behaviour is pure logic that a unit test in `packages/core` or `apps/server/src` can check without the DB or IMAP. Only if a unit test of the same behaviour does not exist yet; else `DELETE-DUP`.
- **`FIX-NEVER-RUNS`**: an `S7` case that is skipped in CI too. Known: `apps/server/test/integration/e2e-seed.test.ts:89` `describe.skipIf(e2eAppUrl === "" || e2eMigratorUrl === "")`; the CI `ci` job sets no E2E URL (`.github/workflows/ci.yml`), so the case runs nowhere (F6). Propose: run it in the `e2e` job, or delete it.
- **`GAP`**: a cluster of survived core mutants (stage 03) in one function: the report lists the function and the mutant count.
- **`KEEP`**: the rest. A flagged case that a K rule keeps names the rule.

### Reader method (stages 04–06)

1. Input: `audit/data/cases.tsv`, `groups.tsv`, and for core `mutation-tests.tsv` and `mutation-survived.tsv`. Select the rows of the stage's area that have a flag (S1–S11, `not-run`, `unscanned`).
2. An **item** is one flagged case, or one B or T group (all its cases at once). Order the items: (a) `S1`, `S7`, `S8`, `not-run`; (b) `S2`, `S3`, `S4`; (c) B groups; (d) T groups; (e) core `S11`, then core cases with `S10` and no other flag, grouped by test file (one item per file); (f) `S9`, slowest first. Read at most 250 items; list the rest in the review file as `not read` with their flags.
3. For each item: read the test, the code it calls, and the nearest other tests of that code (same file, the file next to the code, the int test of the same module). Apply the K rules first, then the class rules. One row per item.
4. Evidence is concrete: the `file:line` of the kept case for `DELETE-DUP`; the proposed `test.each` table header for `MERGE-TABLE`; the proposed assertion for `REWRITE-WEAK`; the missing symbol, the dropped ticket or the capability page for `DELETE-STALE`; the unit file that would hold it for `MOVE-TO-UNIT`.
5. Not sure: `KEEP` with rule `unsure` and one line why. A wrong `KEEP` costs nothing; a wrong cut costs a lost check.
6. Review file columns: `Item | Keys | Flags | Action | Rule | Evidence | Lines | Time (s)`. `Lines` = test lines the action removes (estimate for MERGE-TABLE). End with a summary: items read, not read, rows per action, lines and time per action.

### Cut stage rules (phase B; the planner after G1 writes stages from them)

1. One stage = one approval group or one area folder, about 300 changed lines or less.
2. Before the first edit: `git branch --no-merged master --list 'limen/*'`, then `git diff --name-only master...<branch>` for each. A file in that list is not changed; its rows go to a later stage, listed in the final message.
3. The D9 proof, saved in `/tmp/f125-sNN/` and summarised in the final message (counts, mutant ids that changed state: must be none, lcov drops: must be none, times).
4. A rewrite makes the assertion stricter. A rewrite that fails because the code is wrong: revert the rewrite, stop, report the bug. No product code change in a cut stage.
5. One commit per approval group; the message names the group id and the action.
6. A group that the owner marked `no`, or a row in the owner's reject list, is not touched.

## Facts checked

- **F1** Counts, 2026-11-14, HEAD 54fe78f: 321 test files (`git ls-files '*.test.*' '*.spec.*'`), 73,477 lines. JUnit: unit 2,262 cases in 177 files (`packages/core` 787, `apps/server/src` 1,261, `apps/web/src` 154, `tools/fake-telegram/src` 57, `apps/web/integrations` 3); int 1,683 cases in 135 files (`apps/server/test` 1,680, `tools/fake-telegram/test` 3; 1 skipped). Playwright `apps/web/e2e`: 12 files, about 41 `test(` calls (grep). Total about 3,990 cases. The handoff count (about 3,400, grep of `it(`/`test(`) was low.
- **F2** `bun test --reporter=junit --reporter-outfile=<f>` (Bun 1.4.4) writes per case `name`, `classname`, `time`, `file`, `line`, `assertions`, and `<skipped />` (probe /tmp/ta, 2026-11-14).
- **F3** Mutation probe, 2026-11-14, temp copy of `packages/core` (HEAD 54fe78f), Node 26.13.1, Bun 1.4.4, `@stryker-mutator/core` 10.1.1, `@hughescr/stryker-bun-runner` 1.6.0 (peer `typescript <7`, `@stryker-mutator/core ^9 || ^10`; npm 2026-11-14), TypeScript 5.9.3: config `{ appendPlugins: ['@hughescr/stryker-bun-runner'], testRunner: 'bun', mutate: ['src/**/*.ts', '!src/**/*.test.ts'], reporters: ['json', 'clear-text'], concurrency: 8, disableBail: true }`. Result: 5,230 mutants, score 85.53 % (killed 4,455, timeout 18, survived 672, no coverage 85), 2 m 2 s wall on 16 cores. Of 787 cases: 23 kill no mutant (mostly registry and schema checks, K2), 397 kill mutants but none uniquely; a greedy set of 449 cases kills every mutant that the 787 kill. A few mutants log "no killing test identifiable — emitting empty killedBy" (static mutants). The `digest/` folder alone: 12 s, score 87.15 %.
- **F4** The JSON report (`reports/mutation/mutation.json`) has `files.<path>.mutants[]` with `id`, `mutatorName`, `replacement`, `location` (`start`/`end` line and column), `static`, `status`, `coveredBy`, and `killedBy` (on killed mutants), and `testFiles.<path>.tests[]` with `id`, `name` (`<file> > <describe> > <test>`) and `location.start.line` (probe F3). Paths are relative to the temp folder (`src/…`); prefix `packages/core/` to join. Join to `cases.tsv` by file, the last ` > ` part of the Stryker name equal to the JUnit `name`, and the nearest line: in the probe the Stryker line was the JUnit line + 1 (`ai-text.test.ts` "below the threshold": JUnit 31, Stryker 32, the `test(` call on line 31). A case that does not join gets the key `unjoined` and a row in the stage's final message.
- **F5** `bunfig.toml` `[test] preload = ["./apps/server/test/preload.ts"]`. The core copy in F3 had no bunfig and passed 787/787 (core needs no preload).
- **F6** `.github/workflows/ci.yml`: the `ci` job env has no `E2E_DATABASE_URL`/`E2E_MIGRATOR_DATABASE_URL`; `e2e-seed.test.ts:89` skips there (and in the local int run, F1: 1 skipped).
- **F7** `docs/known-alerts.md` holds only its template (2026-11-14). `backend/` no longer exists (`CLAUDE.md` still names it).
- **F8** `deploy/Dockerfile` line 9 copies `tools/fake-telegram/package.json` by name; root `package.json` workspaces are `apps/*`, `packages/*`, `tools/*` (D3).

## Not verified

- **N1** Mutant ids stay stable between two runs on unchanged source (D9 compares by file, line, column, mutator instead). Checked by: stage 03 Step 3 runs `mutation.sh` twice on the same commit and compares; the result goes to `scripts/test-audit/README.md`.
- **N2** `bun test --coverage` with the int suite and its preload on Bun 1.4.4. Checked by: stage 02 Step 2. If it fails, the cut proof uses unit lcov and mutation only; the stage writes that in the README.
- **N3** The share of reader decisions that are right. The owner's marks at G1 are the check; the report shows evidence per row so the owner can sample.
- **N4** How many cases the scan flags (it decides the reader workload). Stage 01 prints the counts; if an area has more than 250 flagged cases, its reader stage reads the 250 with the highest priority (§ Reader method, step 2) and lists the rest as `not read`.

## Done when

1. `scripts/test-audit/` holds the scan, timing, coverage and mutation tools, each with a usage line in `scripts/test-audit/README.md`; `bun test scripts/test-audit` passes.
2. `audit/data/cases.tsv` has one row per bun test case (unit and int, about 3,945) with key, time and flags; `audit/data/mutation-tests.tsv` one row per core case with kills and unique kills.
3. `audit/review-core-web-tools.md`, `audit/review-server-unit.md`, `audit/review-int-e2e.md` exist with one row per read case.
4. `audit/report.md` exists with the approval group table (§ Report shape) and the GAP list.
5. `docs/code-patterns.md` § Tests and `.agents/limen/styleguide.md` hold the test-quality rule (stage 07).
6. Gate G1 asked; the owner marked the groups.
7. Phase B: each approved group is done or listed as deferred with its reason; `bun run test:unit:ci` and `bun run test:int:ci` pass on `master`.

## Report shape (`audit/report.md`, stage 07)

1. Summary: cases total, read, flagged; per action: groups, rows, test lines, time; core mutation score; open branches that block rows.
2. Approval table, one row per group: `Group | Action | Rule | Area | Rows | Lines | Time saved | Example (file:line) | Evidence | Owner`. The `Owner` cell is empty; the owner writes `ok`, `no` or `ask`.
3. Reject list: an empty list where the owner can name single `file:line` keys to leave alone inside an `ok` group.
4. GAP list (P4) and the follow-up ticket proposal.
5. What the audit cannot see (N3, K2, the unread cases).

## Rules for every stage

- Phase A never changes a test file (`*.test.*`, `*.spec.*`) or production code. Stage 07 changes only the two rule docs and this folder.
- Change only the files of the stage. Format only those files; never run `bun run format` or `prettier --write .`.
- No new dependency in any `package.json`; no `bun.lock` change (D3, D4). Mutation installs happen only in the temp folder.
- No `.env` reads or prints. The tools never print env values. No VPS, no push.
- `test:e2e` is not run (static scan only for `apps/web/e2e`).
- Data paths: committed data in `spec/features/active/F125-every-test-file-is-measured-and-classified-and-only-owner-approved-weak-stale-or-duplicate-tests-are-cut-or-merged/audit/data/` (D10); raw files in `/tmp/f125-sNN/`.
- A gap or a deviation is a question in the final message, not a choice.
- While you work, run only the tool's own tests. The full Proof runs once, after the last commit.

## Proof

Phase A stages (replace `NN`):
```
mkdir -p /tmp/f125-sNN && bun test scripts/test-audit > /tmp/f125-sNN/tool-tests.log 2>&1 && bunx tsc -p scripts/test-audit --noEmit > /tmp/f125-sNN/tool-tsc.log 2>&1 && bun run lint > /tmp/f125-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f125-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f125-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f125-sNN/int.log 2>&1 && echo PROOF_OK
```
Stages 04–06 add no code; their proof is the same command (it shows that nothing else changed). Run it after the last commit, with nothing after it.

## Owner checkpoints and owner steps

- **G1 (owner, after stage 07):** read `audit/report.md`, write `ok`/`no`/`ask` in the `Owner` column of each group, optionally add `file:line` keys to the reject list, commit or tell the coordinator. This is a real stop (second-pass gate, D1). Expected effort: the table, not the rows; one example per group is linked for a sample.

## Review

- Stages 01–06: no review job (new tool files and review files only); the tool tests and the proof decide.
- Stage 07: a review job (board reviewer model) checks that every group row has evidence and that no K rule is broken, before the coordinator asks the owner.
- Phase B: every cut stage gets a review job (deletion of tests is hard to judge later).

## Stages

Phase A:
- [ ] [Stage 01 — Audit tool: static scan of every test case](stages/stage-01-static-scan.md)
- [ ] [Stage 02 — Audit tool: timings, coverage baseline, `cases.tsv`](stages/stage-02-timings-and-coverage.md)
- [ ] [Stage 03 — Audit tool: mutation run of `packages/core`](stages/stage-03-mutation-core.md)
- [ ] [Stage 04 — Reader review: `packages/core`, `apps/web`, `tools`](stages/stage-04-review-core-web-tools.md)
- [ ] [Stage 05 — Reader review: `apps/server/src` unit tests](stages/stage-05-review-server-unit.md)
- [ ] [Stage 06 — Reader review: integration and e2e tests](stages/stage-06-review-int-e2e.md)
- [ ] [Stage 07 — Report, approval groups and the test-quality rule](stages/stage-07-report-and-rule.md)

Gate G1 (owner).

Phase B: stages 08+ written by a planner job after G1 (D2).

## How to run (coordinator)

1. Move the ticket to `spec/features/active/` and commit before the first spawn. Run `scripts/plan-drift.sh <ticket folder> 54fe78f` first (plan-refresh rule until 21 Nov).
2. Spawn stage 01 (standing models of `spec/build.md` TRACK):
   ```
   limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
     --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
     --prepare 'bash scripts/limen-prepare.sh' --label "test audit scan · F125" \
     'Implement F125 stage 01. Read spec/features/active/F125-every-test-file-is-measured-and-classified-and-only-owner-approved-weak-stale-or-duplicate-tests-are-cut-or-merged/ticket.md, plan.md and stages/stage-01-static-scan.md; build every step of that stage. Final proof: the Phase A command of plan.md § Proof with NN=01. In the final message, list as proven only what a saved log shows.'
   ```
   Order: 01 → (02 and 03 at the same time) → (04, 05 and 06 at the same time) → 07. Each later stage needs the data files of the stages before it in `master`.
3. Land each stage with `limen land --keep-open` before you spawn the stages that need it. Use `--timeout 2h` for 05 and 06.
4. Land 04–06, then spawn stage 07, then its review job, then land it.
5. **Stop (G1).** Tell the owner: "The test audit report is ready: `spec/features/active/F125-every-test-file-is-measured-and-classified-and-only-owner-approved-weak-stale-or-duplicate-tests-are-cut-or-merged/audit/report.md`. Mark each group ok / no / ask." Do not build further until the owner has marked it. Add an entry to `docs/owner-decisions.md` only for defaults taken in phase A (D4 is one: mutation outside the repo instead of a dev dependency).
6. If the parallel-runs ticket (F124) has not landed yet, wait for it before phase B.
7. After G1: spawn a planner job: `limen spawn --role planner --engine pi --provider claude-bridge --model claude-opus-5-5 --thinking high --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge --timeout 3h --label "plan cuts · F125" "Plan F125 phase B: write stages/stage-08+ for spec/features/active/F125-every-test-file-is-measured-and-classified-and-only-owner-approved-weak-stale-or-duplicate-tests-are-cut-or-merged/ from the groups the owner marked ok in audit/report.md, by plan.md § Cut stage rules and D9. Keep stages 01–07 as they are."` Then build the cut stages one by one; each gets a review job (§ Review).
8. Drop each job DB after its land.

## Planning progress

- [x] ticket.md
- [x] plan.md
- [x] stages/stage-01-static-scan.md [written]
- [x] stages/stage-02-timings-and-coverage.md [written]
- [x] stages/stage-03-mutation-core.md [written]
- [x] stages/stage-04-review-core-web-tools.md [written]
- [x] stages/stage-05-review-server-unit.md [written]
- [x] stages/stage-06-review-int-e2e.md [written]
- [x] stages/stage-07-report-and-rule.md [written]
- [ ] cold review

## Log

- 2026-11-14: planned in an interactive owner session (Opus 5.5), from the probes in F1–F6.
