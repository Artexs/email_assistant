---
opened: 2026-11-14
---

# F125 · Every test file is measured and classified, and only owner-approved weak, stale or duplicate tests are cut or merged

## Outcome

The owner gets one report that classifies the about 3,950 test cases of the repo, with evidence for each candidate: its time, what it asserts, whether it catches a code change that no other test catches, and its duplicates. The owner approves groups of candidates. Only the approved groups are then cut, merged into table tests or rewritten, each with a before/after proof that nothing the suite caught is lost. A short test-quality rule in the agent styleguide stops new weak tests.

## Scope

- A reusable audit tool in `scripts/test-audit/`: case timings (JUnit), a static scan of every test case, a line-coverage baseline, and mutation testing of `packages/core` in a temp folder (no new dependency in the repo).
- Read-only review stages that classify the flagged cases by the rules of `plan.md` and write `audit/report.md` in this folder.
- The test-quality rule in `docs/code-patterns.md` § Tests and `.agents/limen/styleguide.md`.
- Cut stages, written after the owner marks the report, one area per stage, only in files that no open branch changes.

## Out of scope

- Faster runs through `--parallel` and short injected timeouts: the parallel-runs ticket (F124) does that.
- New tests for the gaps the mutation run finds: the report lists them; a later ticket adds them.
- A fix of production code that a rewritten test shows to be wrong: stop and report it.

## Acceptance

- `audit/report.md` exists, names every approval group with its rule, row count, lines and time saved, and the count of cases read versus flagged.
- `bash scripts/test-audit/mutation.sh` reproduces the `packages/core` mutation score of the report within 1 point.
- No cut stage starts before the owner has marked the groups in `audit/report.md`.
- After each cut stage, the core mutants that were killed stay killed and the covered lines per source file do not drop (stage log).
- `docs/code-patterns.md` § Tests holds the test-quality rule.

## Slices

Seven read-only stages build first (01; then 02 and 03 in parallel; then 04–06 in parallel; then 07). Then the coordinator stops for the owner (second pass, gate G1). A planner job then writes the cut stages from the approved groups. Details and the spawn commands: `plan.md` § Stages and § How to run.

## Sequenced

- Plan after: none.
- Build after: none for stages 01–07. The cut stages build after the parallel-runs ticket (F124) has landed.
- Gate: G1, second pass after stage 07: the owner marks the approval groups in `audit/report.md` (owner decision 2026-11-14).

## Notes

Origin: owner chat 2026-11-14, `~/.pi/agent/notes/2026-11-14-handoff-test-suite-audit.md`, analysis in `notes/2026-11-14-test-suite-audit.md`.
