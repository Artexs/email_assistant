# F125 · Test audit: measure, classify, cut only what the owner approves — plan

> **Status 2026-11-20 — in progress.** Plan base: 1927d052, refreshed 2026-11-19 ([`plan-refresh-1.md`](plan-refresh-1.md); first base 54fe78f). Stages 01–07 landed; gate G1 answered 2026-11-20. Phase B plan base: 1685baff; cut stages 08–21 written 2026-11-20 (§ Phase B), fixed after plan review 3 (stage 08 split into 08 and 08b).

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
- **P2** The owner approves the cuts (owner, 2026-11-14). The approval unit is a **group** of rows with one rule and one action, not a single row: at least 12,800 cases (F1; the int part is a call-site count, its JUnit count is higher) are too many to approve one by one. The owner may also reject single rows inside an approved group.
- **P3** A cut never loses what the suite catches today. Proof per cut stage: the killed core mutants stay killed, and the covered lines per source file do not drop (D9).
- **P4** Gaps (code changes that no test catches) are reported, not fixed here. They become a follow-up ticket proposal in the report.
- **P5** A test-quality rule for agents is part of this ticket. Reason: agents wrote about 60k test lines in 7 days; without a rule, new weak tests come back.

### Design decisions

- **D1** Two phases. Phase A (stages 01–07) is read-only on tests: it adds the audit tool, data, the report and the rule docs. Phase B (stages 08+) cuts. Gate G1 between them is a second-pass gate: the coordinator stops after stage 07 and asks the owner (execution plan § 2.4, "a ticket with a second-pass gate on a later stage builds up to that stage, then stops and asks the owner"). Reason: the cut list cannot exist before the data; a detached planner cannot ask the owner.
- **D2** The phase B stages are written after G1 by a `--role planner` job from the approved groups (done 2026-11-20). Each cut stage follows § Cut stage rules below, so that planner only turns groups into stages.
- **D3** The audit tool lives in `scripts/test-audit/` (TypeScript, run with `bun`), with its own `tsconfig.json` and unit tests run explicitly (`bun test scripts/test-audit`). Not a workspace. Reason: a new workspace changes `bun.lock`, and `deploy/Dockerfile` copies only the listed workspace `package.json` files (line 9), so `bun install --frozen-lockfile` in the image build could break. The tool stays in the repo after F125, so a later audit and the cut stages reuse it. Its tests run in the F125 stage proofs only, not in CI: it is a maintenance tool, not product code (review 1, note).
- **D4** Mutation testing runs in a work folder outside the repo and outside `/tmp` (`${XDG_CACHE_HOME:-$HOME/.cache}/ea-test-audit/mutation.XXXXXX`; `/tmp` is a shared tmpfs that ran out of inodes on 2026-11-14, `notes/2026-11-14-handoff-after-compaction.md`), removed by an `EXIT` trap: `scripts/test-audit/mutation.sh` copies `packages/core/src`, `packages/core/tsconfig.json` and `tsconfig.base.json` to the work folder, writes a `package.json` with pinned `@stryker-mutator/core@10.1.1`, `@hughescr/stryker-bun-runner@1.6.0`, `typescript@5.9.3` and `zod` (the version of `packages/core/package.json`), installs, and runs Stryker with `disableBail: true` (every killing test is recorded, F3). Reason: no new dependency and no `bun.lock` change in the repo; this is stricter than the owner default "a dev dependency in `packages/core`" (log as a default for the owner). Rejected: a dev dependency in the repo (lock conflicts with parallel jobs, an image risk).
- **D5** Mutation only for `packages/core` (pure logic; 787 cases and 2 min in the F3 probe; 2,760 JUnit cases at 1927d052, so expect a longer run, stage 03 measures it). Not for `apps/server` (DB, IMAP, preload; too slow and not proven to work) and not for `apps/web`. Rejected: a full-repo mutation run.
- **D6** Coverage: `bun test --coverage --coverage-reporter=lcov` for the unit paths and for the int paths, separately, serial. Used only as a baseline and a guard (D9), not to decide redundancy. Reason: coverage shows what runs, not what is checked. Rejected: "remove a file, and coverage stays the same, so it is redundant".
- **D7** Static scan with the TypeScript compiler API (`typescript` is a root dev dependency). Per test case it records the flags of § Flags. Key of a case: `file:line` of its `test(`/`it(` call, the same key as the JUnit `file` and `line` attributes. Exception: a case in a shared suite module (`apps/server/test/contract/*.ts`) has the module key; Bun reports it with the runner `file` and the module `line`, so stage 02 joins it by line and name (plan review 2, item 1).
- **D8** Reader review by workers. A worker reads each flagged case (and the groups it belongs to), decides the action by § Rules for the classes, and writes a row with evidence. A case with no flag is `KEEP (not read)`. The report states how many cases were read. Reason: a script cannot judge "this test checks something real"; a reader of every case (at least 12,800, F1) does not fit in jobs.
- **D9** Cut proof (per cut stage). The "before" numbers are measured at the cut stage's own base commit (a fresh run of the tools), never taken from the committed phase A data. Coverage is the **union** of the unit and int hit lines per source file (an int case and its unit twin cover the same lines). Per action:

  | Action | JUnit case count | Core mutants (stage in `packages/core`) | Union lcov hit lines per source file |
  | --- | --- | --- | --- |
  | `DELETE-DUP` | drops by the `junit_count` of the rows | no `Killed` mutant becomes `Survived` or `NoCoverage` | no drop |
  | `MERGE-TABLE` | the same (each table row stays a case) | as above | no drop |
  | `REWRITE-WEAK` | the same | as above; more kills allowed | no drop |
  | `MOVE-TO-UNIT` | int drops by n, unit grows by at most n | as above | no drop |
  | `DELETE-STALE` | drops by the `junit_count` of the rows | as above | a drop only in lines that the stage also deletes; any other drop: stop |
  | `FIX-NEVER-RUNS` | grows by the cases that now run, or drops (owner chose delete) | — | — |

  Mutants compare by (file, line, column, mutator); a `Timeout` on either side is no change. Lcov noise: a source file whose hit lines differ between two runs on the same commit (stage 02 Step 2 lists them in `audit/data/coverage-noise.tsv`) is checked with that tolerance. Record the suite time before and after.
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
| `S8 no-prod-import` | Unit and int files only (never e2e). The file imports nothing except: runner and platform modules (`bun:test`, `@playwright/test`, `node:*`), and test support paths (anything under `apps/server/test/`, `apps/web/e2e/`, `tools/`, a path segment `fake`, or a file name with `fixture` or `helper`). Such a file may test only a fake or a helper. |
| `S9 slow` | JUnit time ≥ 1 s (unit) or ≥ 2 s (int). |
| `S10 no-unique-kill` | Core only, in `mutation-tests.tsv` (stage 03): the case kills mutants, but every one is also killed by another case. |
| `S11 zero-kill` | Core only, in `mutation-tests.tsv` (stage 03): the case kills no mutant. |

### Rules for the classes (reader stages 04–06)

Actions: `KEEP`, `DELETE-DUP`, `MERGE-TABLE`, `REWRITE-WEAK`, `DELETE-STALE`, `MOVE-TO-UNIT`, `FIX-NEVER-RUNS`. Info only, not a cut: `GAP`.

Hard keep rules (they win over every flag):
- **K1** A core case with a unique kill (the only case that kills some mutant). `MERGE-TABLE` is allowed if the table keeps its inputs.
- **K2** Registry, enum and completeness checks ("every kind", "one case per kind", "the list is fixed", a test that iterates a registry or enum). Mutation testing cannot see their value: they guard the next change, not the current code. Probe: 23 core cases with zero kills are mostly of this kind (F3).
- **K3** Security, privacy and the safety rules of `spec/vision.md`: tenant isolation, RLS, auth, lockout, secrets, "no leak" marker checks, log redaction, no send without approval, LLM text never a recipient, folder or command, whitelisted mail never spam.
- **K4** Contract suites that run the same cases against a fake and a real adapter: the suite modules in `apps/server/test/contract/` (`mail-provider.ts`, `mail-sender.ts`) and every test file that runs them (at 1927d052: `imap-contract.test.ts`, `smtp-send.test.ts`, `graph-send.test.ts` in `apps/server/test/integration/`; `mail/fake/fake.test.ts`, `mail/fake/sender.test.ts` in `apps/server/src/modules/`). They are duplicates by design. The conditional `test.skip` inside `mail-sender.ts` (an adapter that cannot refuse a login) is K4, not `FIX-NEVER-RUNS`.
- **K5** A case whose comment or name names a bug, an incident, an alert of `docs/known-alerts.md` (empty on 2026-11-14) or a ticket folder. A quarantined case (`// Quarantined YYYY-MM-DD … Fix: spec/features/…`; none at 1927d052, the two of 54fe78f are fixed) is K5: its own ticket fixes it; never `FIX-NEVER-RUNS` or a cut.
- **K6** The only test of a behaviour that a `docs/capabilities/` page states.

Classes:
- **`DELETE-DUP`**: same behaviour and the same input class as a kept case; the kept case asserts at least the same. Core: `S10` and no K rule. Name the kept case (`file:line`) in the row.
- **`MERGE-TABLE`**: an `S6` group of 3 or more cases → one `test.each` table. Each row keeps the old case name as its label.
- **`REWRITE-WEAK`**: `S1`, `S2` or `S3` where a stricter assertion is possible (an exact value). Write the proposed assertion in the row.
- **`DELETE-STALE`**: tests code, a flag or a behaviour that no longer exists, or tests only a fake (`S8`) whose real counterpart has its own test. Name the evidence (a missing symbol, a dropped ticket, a capability page).
- **`MOVE-TO-UNIT`**: an int case whose behaviour is pure logic that a unit test in `packages/core` or `apps/server/src` can check without the DB or IMAP. Only if a unit test of the same behaviour does not exist yet; else `DELETE-DUP`.
- **`FIX-NEVER-RUNS`**: an `S7` case that is skipped in CI too. Known: `apps/server/test/integration/e2e-seed.test.ts:90` `describe.skipIf(e2eAppUrl === "" || e2eMigratorUrl === "")`; the CI `ci` job sets no E2E URL, and the `e2e` job sets them but runs only `test:e2e` (`.github/workflows/ci.yml`), so the case runs nowhere (F6). Also: a test file in no suite path of `package.json` (`not-run`; at 1927d052 `tools/mail-oauth-spike/*.test.ts`, 2 files). Propose: run it in the `e2e` job, or delete it. Not for quarantined cases (K5).
- **`GAP`**: a cluster of survived core mutants (stage 03) in one function: the report lists the function and the mutant count.
- **`KEEP`**: the rest. A flagged case that a K rule keeps names the rule.

### Reader method (stages 04–06)

1. Input: `audit/data/cases.tsv` (flags S1–S9, `not-run`, `unscanned`), `groups.tsv`, and for core `mutation-tests.tsv` (S10, S11, joined by `key`) and `mutation-survived.tsv`. Select the rows of the stage's area that have a flag.
2. An **item** is one flagged case, or one B or T group (all its cases at once). A B group that spans areas belongs to the area of its first key (sorted by file, then line); only that stage reads it, and it reads all its keys. Order the items: (a) `S1`, `S7`, `S8`, `not-run`; (b) `S2`, `S3`, `S4`; (c) B groups; (d) T groups; (e) core `S11`, then core cases with `S10` and no other flag, grouped by test file (one item per file); (f) `S9`, slowest first. Read at most **150 items per stage** (all sections together). Commit the review file after every 50 items, so a stopped job loses little. List the rest as `not read` with their flags; the coordinator may spawn a continuation job for the next 150 (at most two per stage).
3. For each item: read the test, the code it calls, and the nearest other tests of that code (same file, the file next to the code, the int test of the same module). Apply the K rules first, then the class rules. One row per item.
4. Evidence is concrete: the `file:line` of the kept case for `DELETE-DUP`; the proposed `test.each` table header for `MERGE-TABLE`; the proposed assertion for `REWRITE-WEAK`; the missing symbol, the dropped ticket or the capability page for `DELETE-STALE`; the unit file that would hold it for `MOVE-TO-UNIT`.
5. Not sure: `KEEP` with rule `unsure` and one line why. A wrong `KEEP` costs nothing; a wrong cut costs a lost check.
6. Review file columns: `Item | Keys | Flags | Action | Rule | Kept key | Evidence | Lines | Time (s)`. `Kept key` is required for `DELETE-DUP` and `MOVE-TO-UNIT` (the case that keeps the check); a kept key must not be a key that this or another row cuts. `Lines` = test lines the action removes (estimate for MERGE-TABLE). End with a summary: items read, not read, rows per action, lines and time per action.

### Cut stage rules (phase B; the planner after G1 writes stages from them)

1. One stage = one approval group or one area folder, about 300 changed lines or less.
2. Key drift: keys are `file:line` at the phase A base. Before the first edit, re-run `bun scripts/test-audit/scan-cli.ts` at the stage base and re-resolve each approved key by file, `describePath` and `name`. A key that resolves to no case, or to two, is deferred (listed in the final message), never guessed. A kept key that no longer resolves defers its row too.
3. Before the first edit: `git branch --no-merged master --list 'limen/*'`, then `git diff --name-only master...<branch>` for each. A file in that list is not changed; its rows go to a later stage, listed in the final message.
4. The D9 proof, saved in `/tmp/f125-sNN/` and summarised in the final message (counts, mutant ids that changed state: must be none, lcov drops: must be none, times).
5. A rewrite makes the assertion stricter. A rewrite that fails because the code is wrong: revert the rewrite, stop, report the bug. No product code change in a cut stage.
6. One commit per approval group; the message names the group id and the action.
7. A group that the owner marked `no`, or a row in the owner's reject list, is not touched.

## Phase B (cut stages; written 2026-11-20 at 1685baff)

Input: `audit/report.md` § 2 and § Owner answers: all ten groups `ok`; G06 runs `e2e-seed.test.ts` in the CI `e2e` job; G07 and G08 add `tools/mail-oauth-spike` to `test:unit`; the three `main.test.ts` rows of G09 and the stale `time-rewrite-check.test.ts:43` are on the reject list (§ 3). Follow-up tickets exist and are not stages here: F154 (core mutation gaps), F155 (source regexes), F156 (draft date), F157 (time and size rules for tests).

### Decisions

- **D12** Stage-local proof. `cut-run` runs only the stage's test files: the files it changes, the files of its kept keys and its new files; "before" twice before the first edit, "after" once. Reason: the owner rule "tests run once per job" (2026-11-20, `notes/2026-11-20-test-cpu-load.md`) forbids full suites in a job, and the subset check is never weaker: the rest of the suite does not change, so a line the subset still hits is still hit by the suite. It can only raise a false drop: then widen the "after" run with the test files that import that source file; still unhit → revert the rows that cause it and defer them. Rejected: full `coverage.sh` before and after (about 40 min of serial int per stage). D9's per-action table stays; `--expect` states its count rule per stage.
- **D13** The stage log is `audit/cut-sNN.md` in this folder (committed; the ticket acceptance "stage log"). Raw JUnit, lcov and `mutation.json` stay in `/tmp/f125-sNN/`.
- **D14** Mutation scope (core stages 16, 20): `mutation.sh --mutate` with the non-test files in the import closure of the changed test files. A test kills mutants only in code it runs. Rejected: a full core run twice per stage (about 1 h). Each Stryker run starts with a dry run of the whole core suite (about 2.8 k cases, with per-test coverage); in stages 16 and 20 it runs twice. It is the audit tool, not `test:unit`, and it is the only full-suite run in phase B (plan review 3, note 2).
- **D15–D23** Stage decisions: the fake lab mail client (09), the stats:week int case cut to one spawn for the exit-2 wiring, with no new unit row (11, Q7), Bun fake timers for the bounded close (11, Q8), the duplicate pair check (12), the table rules (13, for 13–16), the CI step place and its no-skip check (17), the spike README line (18), the rewrite rules (19, for 19–20).
- **D24** Phase B proof: the stage's `cut-proof` PASS section in its log, then `bun run check:job` as the last step (its last line in the final message). This replaces the Phase A § Proof chain (full `test:unit:ci` and `test:int:ci`) for phase B, by the same owner rule. GitHub CI runs every suite on master.
- **D25** Stage cut: G01 is three stages (a move counts twice in the about-300-lines limit: 09 builds the fake and moves six cases, 10 moves five, 11 the two other files); G03 three by area so they run in parallel; G04 and G05 one stage (two of their files hold both groups; one mutation pair); G07 and G08 one stage (one path change). Stages 08 (`cut-keys`, the old key names) and 08b (`cut-run`, `cut-proof`) build the shared tools first, in parallel; one stage was over the size cap.
- **D26** The core gap ticket (F154) writes some of the same core test files. Stage 16 waits for F154 stages 11, 12 and 14, stage 20 for F154 stage 12. Reason: Cut stage rule 3 would defer every row in a file of an open F154 branch, and the mutant "before" must include the new F154 cases. Rejected: run now and defer.
- **D27** No new questions block a stage. Defaults: `questions.md` Q7–Q10.
- **D28** The old name of an approved key comes from `audit/data/approved-keys.tsv` (scans at the bases of the core/web/tools and server-unit reviews), then `cases.tsv`; a kept case is named `<file>::<name>` at the stage base (stage 08). Reason: those reviews keyed on fresh scans; 11 approved keys have no `cases.tsv` row (plan review 3, finding 1).

### Cut stage steps (every stage 09–20; 17 and 18 skip S4–S5 as their files say)

- **S1** `bun scripts/test-audit/scan-cli.ts --out /tmp/f125-sNN/scan` at the stage base.
- **S2** `cut-keys.ts` for the stage's rows. `rejected` keys are never touched. `deferred-*` rows go to the log.
- **S3** Open branches (Cut stage rule 3): rows in a file that an unmerged `limen/*` branch changes are deferred.
- **S4** `cut-run.sh /tmp/f125-sNN/before-1 …` and `before-2` on the stage's files, before the first edit.
- **S5** Edits, one commit per group; then `cut-run.sh …/after` and `cut-proof.ts` with the stage's `--expect`; a FAIL is fixed or its rows reverted and deferred, never passed by a changed `--expect`.
- **S6** Write and commit `audit/cut-sNN.md`: resolved keys, deferred and rejected rows with reasons, the `cut-proof` section, the break-once lines.
- **S7** `bun run check:job` last.

## Facts checked

Phase A facts F1–F5 (counts, the JUnit attributes of Bun 1.4.4, the mutation probe and its JSON shape, the preload) were checked on 2026-11-14 and 2026-11-19; the full text is in Git history of this file before plan review 3 and in `scripts/test-audit/README.md`. Counts move fast; each stage prints its own.

- **F6** `.github/workflows/ci.yml` (checked at 1927d052): the `ci` job env has no `E2E_DATABASE_URL`/`E2E_MIGRATOR_DATABASE_URL`; `e2e-seed.test.ts:90` skips there (and in the local int run). The `e2e` job sets both URLs but runs only `test:e2e`. The parallel-Playwright ticket (F136, not planned yet) may set per-job E2E URLs in `scripts/limen-prepare.sh`: then the case runs in Limen jobs, still not in CI. Stage 06 reads `ci.yml` and `limen-prepare.sh` at its own base for the evidence.
- **F7** `docs/known-alerts.md` held only its template (2026-11-14).
- **F8** `deploy/Dockerfile` copies workspace `package.json` files by name (D3).

## Not verified

- **N1** Mutant stability between two runs: checked in stage 03 (6 status differences; `scripts/test-audit/README.md` § Mutation notes, `audit/data/mutation-unstable.tsv`).
- **N2** Int coverage with the preload on Bun 1.4.4: holds (README § Coverage notes).
- **N3** The share of reader decisions that are right. The owner's marks at G1 are the check.
- **N4** Flagged items per reader stage: 150 per job, at most two continuations (`questions.md` Q5).
- **N5** Lcov noise between two runs: `audit/data/coverage-noise.tsv` (stage 02).

## Done when

1. `scripts/test-audit/` holds the scan, timing, coverage and mutation tools, each with a usage line in `scripts/test-audit/README.md`; `bun test scripts/test-audit` passes.
2. `audit/data/cases.tsv` has one row per test call site (unit, int and e2e) with key, time and flags; `audit/data/junit-cases.tsv` one row per JUnit case with its scan key; `audit/data/mutation-tests.tsv` one row per core case with kills and unique kills.
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

Phase B: D24 (the stage's `cut-proof` section, then `bun run check:job`; stage 21 has no code and no `check:job`).

## Owner checkpoints and owner steps

- **G1 (owner, after stage 07):** read `audit/report.md`, write `ok`/`no`/`ask` in the `Owner` column of each group, optionally add `file:line` keys to the reject list, commit or tell the coordinator. This is a real stop (second-pass gate, D1). Expected effort: the table, not the rows; one example per group is linked for a sample.

## Review

- Stages 01–06: no review job (new tool files and review files only); the tool tests and the proof decide.
- Stage 07: a review job (board reviewer model) checks that every group row has evidence, that no K rule is broken, and that no kept key is cut by any group, before the coordinator asks the owner.
- Phase B: stages 08, 08b and 09–20 each get a review job (deletion of tests is hard to judge later; stages 08 and 08b build the tools that every cut trusts). Model `claude-sonnet-5-5`, except stages 19 and 20 on `claude-opus-5-5`: their rewrites change asserts of TLS, config secret, SSO, mailbox OAuth and trust tests (board TRACK: security). No stage is `[risky]`: no product code, data, migration or send. Stage 21 gets none. Review text: "Review F125 stage NN at the candidate commit. Check: every changed case maps to an approved key of the stage file; no key of `audit/reject.tsv` and no other case changed; tables keep each old name and input (D19); rewrites assert exact values and each has a break-once line (D23); the `cut-proof` section shows PASS for the stage's `--expect`; each deferred row has a reason. The plan follows `.agents/limen/planner.md` § Plan size." plus the board's BLOCKING / TEST GAP / NOTE line.

## Stages

Phase A:
- [ ] [Stage 01 — Audit tool: static scan of every test case](stages/stage-01-static-scan.md)
- [ ] [Stage 02 — Audit tool: timings, coverage baseline, `cases.tsv`](stages/stage-02-timings-and-coverage.md)
- [ ] [Stage 03 — Audit tool: mutation run of `packages/core`](stages/stage-03-mutation-core.md)
- [ ] [Stage 04 — Reader review: `packages/core`, `apps/web`, `apps/docs`, `deploy/test`, `tools`](stages/stage-04-review-core-web-tools.md)
- [ ] [Stage 05 — Reader review: `apps/server/src` unit tests](stages/stage-05-review-server-unit.md)
- [ ] [Stage 06 — Reader review: integration and e2e tests](stages/stage-06-review-int-e2e.md)
- [ ] [Stage 07 — Report, approval groups and the test-quality rule](stages/stage-07-report-and-rule.md)

Gate G1 (owner).

Phase B (§ Phase B; Needs lines in each file):
- [ ] [Stage 08 — Cut tools part 1: approved keys and key resolve](stages/stage-08-cut-tools.md)
- [ ] [Stage 08b — Cut tools part 2: stage run and before/after proof](stages/stage-08b-cut-run-and-proof.md)
- [ ] [Stage 09 — G01 part 1: fake lab mail client, six lab bot cases to unit](stages/stage-09-lab-bots-unit-1.md)
- [ ] [Stage 10 — G01 part 2: five lab bot cases to unit](stages/stage-10-lab-bots-unit-2.md)
- [ ] [Stage 11 — G01 part 3: stats:week argument case to one spawn, the bounded close to unit](stages/stage-11-stats-week-and-bounded-close.md)
- [ ] [Stage 12 — G02: five duplicate cases go](stages/stage-12-delete-dups.md)
- [ ] [Stage 13 — G03 part 1: server unit tables](stages/stage-13-tables-server-unit.md)
- [ ] [Stage 14 — G03 part 2: web, docs and deploy tables](stages/stage-14-tables-web-docs-deploy.md)
- [ ] [Stage 15 — G03 part 3: CLI stream tables](stages/stage-15-tables-cli-streams.md)
- [ ] [Stage 16 — G04 and G05: core tables, mutants still killed](stages/stage-16-tables-core.md)
- [ ] [Stage 17 — G06: e2e seed cases in the CI e2e job](stages/stage-17-e2e-seed-in-ci.md)
- [ ] [Stage 18 — G07 and G08: OAuth spike tests in `test:unit`](stages/stage-18-oauth-spike-in-unit.md)
- [ ] [Stage 19 — G09: exact asserts in server unit cases](stages/stage-19-rewrite-server-unit.md)
- [ ] [Stage 20 — G10: exact asserts in core, fake Telegram and int cases](stages/stage-20-rewrite-core-tools-int.md)
- [ ] [Stage 21 — Phase B result in the report](stages/stage-21-phase-b-result.md)

Order: 08 and 08b at once; 17 and 18 after 08; 09, 11–15 and 19 after 08 and 08b; 10 after 09; 16 after 08, 08b and F154 stages 11, 12, 14; 20 after 08, 08b and F154 stage 12; 21 last.

## How to run (coordinator)

Phase A, G1 and the phase B planner are done; their steps are in Git history of this file before plan review 3. Drop each job DB after its land.

Phase B spawn, per stage (`NN` is the stage number, `08b` included):
```
limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
  --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
  --prepare 'bash scripts/limen-prepare.sh' --label "<what it cuts> · F125" \
  'Implement F125 stage NN. Read spec/features/active/F125-every-test-file-is-measured-and-classified-and-only-owner-approved-weak-stale-or-duplicate-tests-are-cut-or-merged/ticket.md, plan.md and its stage file; build every step of that stage. Final proof: plan.md § Phase B D24. In the final message, list as proven only what a saved log shows.'
```
Spawn a stage when its Needs line holds. Add the board line for reviewed stages. `--timeout 3h` for 16 and 20 (two mutation runs and the mutation lock wait of up to 2 h), default for the rest. Review each of 08, 08b and 09–20 (§ Review), then land with `--keep-open`; stage 21 lands last and closes the ticket.

## Planning progress

- [x] ticket.md, plan.md, stages 01–07 [written], refresh 1 (`plan-refresh-1.md`), reviews 1 and 2. Stages 01–03 and 07 are over the 700-word cap; they landed, so they are not restructured.
- [x] Phase B, 2026-11-20 at 1685baff: stages 08–21 [written], scouts 0. Facts read at 1685baff: the `LabMailClient` port, `parseStatsWeekArgs`, `CLOSE_LOGOUT_TIMEOUT_MS`, the `e2e` job of `ci.yml`, the `e2e-seed.test.ts` skip, the `test:unit` paths, the spike imports, the F154 stage files, Bun 1.4.4 fake timers (probe).
- [x] Fixes after plan review 3, 2026-11-20 at 20bf2f52: stage 08 split into 08 and 08b; stages 11, 12, 16, 17, 18, 20, 21 changed. Words: plan.md 5,561; stage 08 579, 08b 571, 09 533, 10 351, 11 618, 12 536, 13 414, 14 270, 15 303, 16 480, 17 522, 18 446, 19 471, 20 440, 21 389.

## Cold review

- Round 1, 2026-11-14, Opus 5.5 high, on a614e3c: FAIL; major 7, minor 2, notes 1; all fixed ([`plan-review-1.md`](plan-review-1.md)).
- Refresh 1 review: [`plan-review-2.md`](plan-review-2.md), all fixed (`plan-refresh-1.md`).

- Phase B, 2026-11-20, on 96ebacd8: FAIL; 3 blocking findings, 7 notes ([`plan-review-3.md`](plan-review-3.md)). All blocking findings are fixed: 1 by D28 and the stage 08 split (08: `approved-keys.tsv`, reject check first, `<file>::<name>` keys, a no-`missing` Done-when check; 08b: run and proof); 2 in stage 11 (no unit row, one spawn, `--expect unit=+1,int=-1`; Q7 text); 3 in stage 21 (189 keys). Notes: 1 in stage 12 (expected D18 deferrals, kept keys by name); 2 in D14, stages 16 and 20, Q9; 3 in stage 08b (a missing lane counts as 0); 4 in stage 08b ("the places listed there"); 5 and 6 need no change; 7: this file was trimmed (phase A history moved to pointers). Stages 17 and 18 now need stage 08 (they run step S2, `cut-keys`).

## Log

- 2026-11-14: planned in an interactive owner session (Opus 5.5), from the probes in F1–F6.
- 2026-11-19: refreshed to 1927d052 (`plan-refresh-1.md`): counts, new unit areas in stage 04, K4/K5/F6 facts, Needs lines, F136 overlap in stage 06.
- 2026-11-20: phase B planned at 1685baff by a planner job (Opus 5.5): stages 08–21 from the ten approved groups; no scouts and no cold review (the job could not wait for other jobs).
