> **Status 2026-11-07 — planned.** Nothing started.

# Flaky CI test: mailbox:seed and mailbox:audit CLI

Scope: test reliability. Needs: nothing.

## Goal

Stop the CI timeout of `mailbox:seed and mailbox:audit CLI > seed exits 1 for a wrong or missing test address, and 0 with the right one; audit exits 2, then 0` in `apps/server/test/integration/mail-seed.test.ts`.

## Facts

- It timed out at 5000 ms (the Bun default) in CI run 42414616787 (`master`, 2026-11-07) and run 42417654598 (PR #1). The re-runs passed.
- The test starts several CLI processes one after the other. Probable cause (not measured): the sum of the process start times is near 5 s on a CI runner.
- Entry in `docs/known-alerts.md`.

## Plan idea

- Measure the time of each CLI process in the test (local and CI log).
- Give the test an own timeout (third argument of `test`, for example 20 000 ms), or split it into one test per CLI call.

## Done when

- The test has a timeout that covers the CI time with a margin, and 3 CI runs in a row are green.

## Log

- 2026-11-07: Created by the fake-telegram-followups task (found in its CI run).
