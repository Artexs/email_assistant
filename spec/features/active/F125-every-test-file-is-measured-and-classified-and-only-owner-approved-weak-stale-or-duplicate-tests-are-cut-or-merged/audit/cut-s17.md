# Cut record: the e2e seed cases run in the CI e2e job

Group: never-run tests that need a fix (owner answer 2026-11-20: run the file in the CI `e2e` job; no case is deleted). No test file changed.

## Cases

File `apps/server/test/integration/e2e-seed.test.ts`, `describe.skipIf(...)("e2e seed of the plan states")`:
- seeds a trial and a paused organization, and a second run works
- a second seed run gives new two-factor owners with the second factor off

## Proof

Pass (`/tmp/f125-s17/seed.log`, the step command with the job worktree E2E URLs): `5 pass`, `0 fail`, final line `exit=0`.
Skip check fails (`/tmp/f125-s17/skip-check.log`, same command with `E2E_DATABASE_URL=` empty): `3 pass`, `2 skip`, message `e2e seed cases were skipped`, final line `exit=1`.

## Step text (`.github/workflows/ci.yml`, job `e2e`, after `bun run db:migrate`, before `bun run web:build`)

```yaml
# The seed cases skip in the ci job (no e2e URLs there, so test:int skips them); here they must run, and a skip fails the step.
- name: Run the e2e seed cases and fail on a skip
  run: |
    log=$(mktemp)
    bun test apps/server/test/integration/e2e-seed.test.ts 2>&1 | tee "$log"
    if grep -Eq '^ *[0-9]+ skip' "$log"; then echo "e2e seed cases were skipped"; exit 1; fi
```

Place: before `test:e2e`, so a failed browser run cannot skip it. The seed wipes and refills the e2e database; the Playwright global setup seeds again before the browser tests.
