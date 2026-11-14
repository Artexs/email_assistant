---
opened: 2026-11-14
---

# F124 · The unit and integration suites run in parallel, and no unit test waits for a real multi-second timeout

## Outcome

`bun run test:unit` and `bun run test:int` run their files in 4 worker processes (`bun test --parallel=4`). Every Limen stage proof and every CI run gets faster: the probe on 2026-11-14 cut unit from 27 s to 8 s and int from 183 s to 56 s. No unit test waits for a fixed production timeout of several seconds: the code takes the timeout as a parameter, and the test passes a short one.

## Scope

- Seams for three production timeouts that unit tests now wait for in real time: `platform/auth-mail.ts` (outer timer extra, 5 s), `modules/channels/telegram/runtime.ts` (`getMe` timeout, 3 s), `platform/scheduler.ts` tests (real one-second cron ticks).
- `--parallel=4` in the `test:unit` and `test:int` scripts of `package.json`; fixes for the tests that share state across files (probe: one, `mail-jobs.test.ts` › `countSyncTargets`).
- A stability proof: 5 full parallel int runs in a row, all green.

## Out of scope

- Deletion or merge of tests: the test audit (F125) does that.
- `test:e2e` (Playwright, fixed ports, its own runner).
- A split of `imap-contract.test.ts` (43 s, the longest file and the new critical path): a later ticket if the owner wants int under 45 s.
- CI sharding over several runners.

## Acceptance

- `bun run test:unit:ci` passes and its log shows `4× PARALLEL` (or the Bun 1.4.4 banner for `--parallel=4`) and a total under 12 s on the owner PC.
- `bun run test:int:ci` passes 5 times in a row with `--parallel=4`; each run is under 80 s on the owner PC.
- No unit test case takes longer than 3 s in a JUnit report of `test:unit` (serial run).
- The first `master` CI run after the land is green, and its `test:int` step is shorter than 191 s.
- `plan.md` § Done when holds the full list.

## Slices

Two stages, one worker job each, in order: [`stages/stage-01-unit-waits.md`](stages/stage-01-unit-waits.md), then [`stages/stage-02-parallel-runs.md`](stages/stage-02-parallel-runs.md). No migration, no `bun.lock` change: both may run next to other builds. Stage 02 gets a review job before the land. How to run: `plan.md` § How to run.

## Sequenced

- Plan after: none.
- Build after: none.
- Gate: —

## Notes

Origin: owner chat 2026-11-14 (test suite audit), `notes/2026-11-14-test-suite-audit.md`. Decisions and the probes: [`plan.md`](plan.md). The cut stages of the test audit (F125) build after this ticket lands, because they may touch the same test files.
