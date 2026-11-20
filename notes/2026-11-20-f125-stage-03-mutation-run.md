# F125 stage 03: mutation run notes

Map for the next worker. Ticket: `spec/features/active/F125-*/stages/stage-03-mutation-core.md`.

## Facts measured on 2026-11-20 (core at the stage 03 base, 2,763 tests, 21,724 mutants)

- The F3 probe numbers (5,230 mutants, 2 min) are out of date. At this base `packages/core` has 21,724 mutants in 238 files; 7,918 (36 %) are static (module-level code). With `disableBail: true` each static mutant runs the whole suite, so a run takes hours on a loaded machine, not minutes.
- Two core tests read repo files by a relative path: `src/changelog.test.ts` (`CHANGELOG.md`) and `src/sim/plan-sent.test.ts` (`evals/sim/lab-01/scenario.json`, `sent-plan-spec.json`). Stryker runs tests in `<work>/.stryker-tmp/sandbox-*/src`, so the dry run needs those files in `<work>/` (`mutation.sh` copies them; never `holdout/` data). Without them the dry run fails with "2 failing tests that could not be attributed".
- Under load the dry run can fail on a 5 s test timeout (`src/replies/digits.test.ts`); a re-run passes. A load fault, not a code fault.
- `bun.timeout` (dry run only) is set to 300000 and `timeoutMS` to 20000 in the generated `stryker.conf.mjs`; the default dry-run limit of 40 s failed under load. `progress-append-only` is an extra reporter so a poll can read progress from the log.
- Stryker names tests `<file> > <describe> > <test>`; its line is the JUnit line + 1. A repeated `each` name gets a ` [n]` suffix; `joinKey` strips it when the full name has no JUnit row.
- `mutation.sh` writes `mutation.json` to `<out dir>` only; delete nothing else. The work folder is removed by the `EXIT` trap.
