# F125 stage 17 — G06: the e2e seed cases run in the CI e2e job

Part of [`../plan.md`](../plan.md) § Phase B. Needs stage 08: `cut-keys.ts` (step S2); `.github/workflows/ci.yml` job `e2e` (on master). May run next to 08b, 09–16, 18–20. Gets a review job (plan § Review).

Group G06 (`FIX-NEVER-RUNS`, rule F6). Owner answer (G1, 2026-11-20): "run `int/e2e-seed.test.ts` in the CI `e2e` job (it sets the E2E database URLs). No case is deleted." Rows: `audit/review-int-e2e.md` row for `e2e-seed.test.ts:91`. Follow plan § Cut stage steps S1–S3 and S6–S7; S4/S5 (`cut-run`, `cut-proof`) do not apply: no test file changes.

## Rows of this stage

`apps/server/test/integration/e2e-seed.test.ts`: the two cases of `describe.skipIf(e2eAppUrl === "" || e2eMigratorUrl === "")("e2e seed of the plan states")` ("seeds a trial and a paused organization, and a second run works" and "a second seed run gives new two-factor owners with the second factor off").

## Step 1 — A step in the `e2e` job

- Add one step to the `e2e` job of `.github/workflows/ci.yml` that runs `bun test apps/server/test/integration/e2e-seed.test.ts`.
- **D20** Place: after `bun run db:migrate` and before `bun run web:build` and `bun run test:e2e`. Reason: the seed needs the schema; the file wipes and refills the e2e database (its first `describe` also deletes the e2e owner user), and the Playwright global setup seeds again before the browser tests, so nothing the browser tests need is lost. Rejected: after `test:e2e` (a failed browser run would skip it, and its `if: failure()` upload step follows `test:e2e`).
- **D21** The step fails when any case of the file is skipped (for example by a check of the JUnit `skipped` count or of the Bun summary line). Reason: the two cases ran nowhere because an env condition turned them off in silence; a lost E2E URL must not do that again. Rejected: trust the env block of the job.
- The `ci` job is unchanged: `test:int` still holds the file, and there the two cases skip (no E2E URLs). Write that in one comment line above the new step, by rule name (no bare codes in `ci.yml`).
- Add one line to the capability page that names the CI suites, if one does (grep `docs/capabilities/` for `test:e2e`); else none.

## Check

- Local, in the job worktree (`scripts/limen-prepare.sh` wrote the job's own E2E URLs into `.env`; read nothing from it): run the new step's exact command; 0 skip, all pass. Log: `/tmp/f125-s17/seed.log`.
- Make the skip check fail once: run the step's command with `E2E_DATABASE_URL=` (empty) and see it exit non-zero. Log: `/tmp/f125-s17/skip-check.log`.
- `actionlint` if it is installed; else say so.

## Coordinator record (not a stage dependency)

The first master CI run after the land shows the step green with 2 more passing cases in the `e2e` job (CI lines of `scripts/coord-scan.sh`). A red step is fixed by a repair job, not by a skip.

## Done when

- `audit/cut-s17.md` holds the case names, the two log lines (pass, skip check failed) and the step text.
- One commit, message `F125 G06 FIX-NEVER-RUNS: e2e seed cases run in the CI e2e job`.
- Last step: `bun run check:job`; copy its last line.
