# F093 · CI green: plan input

> Written 2026-11-13 from the architecture review (`docs/product/stage-2/06-architecture-review.md` §3.1). This file is the input of the `plan-task` session, or the task of one worker job when the owner skips `plan-task` for a ticket this small. Ticket: [ticket.md](ticket.md).

## Why now

`gh run list --limit 40` on 2026-11-13: 36 failures, 0 successes, 4 running. The latest failure is the unit job: `[scheduler] throws failed: Error` lines, then the assertion `runs >= 2` after a fixed 2.5 s sleep on a slow runner. The e2e and image jobs pass. With about 250 Stage 2 stages landing through parallel lanes, a red `master` hides every new regression. The S6f plan (`tasks/planned/s6f-hosted-production.md`) owns the fix today; that is weeks away.

## Facts to check first

- The exact failing tests of the last five runs: `gh run view <id> --log-failed | grep "(fail)"`. The review saw the scheduler test; the S6f file names `runSend > 3` and `holdResponseNext`; `docs/known-alerts.md` has the `mailbox:seed` CLI entry (30 s own timeout).
- Whether `bun test` on the runner is slower than 2× local (the scheduler test sleeps 2.5 s for two 1 s ticks; a 1.2 s tick drift fails it).

## Design decisions

- **D1 Condition waits, not longer sleeps.** A test that waits for time-driven code polls its condition every 25 ms up to a bound (5 s), then asserts. Longer sleeps make the suite slow and still fail on a slow runner.
- **D2 Inject the clock where the code allows it.** `createScheduler` takes croner patterns; the test of "a throwing job does not stop the next tick" needs only two ticks: poll until `runs >= 2`. The outbox sender and the AgentMail fake tests take `now` and `sleep` already in places (`createLlmClient` pattern): use injected timers there instead of real waits.
- **D3 Quarantine rule.** A test that fails twice in CI without a code change gets `test.skip` with a comment that names the ticket, the same day, in a one-line commit. `master` is green or the next commit fixes it. No automatic retries in CI: a retry hides a real race.
- **D4 Measure.** Record the unit and integration run times in `spec/build.md` § TRACK after the fix, so a slowdown is visible.

## Stages

1. **Find and fix the timing tests.** Files: the three tests above, `docs/known-alerts.md` (close the entry). Check: `bun run test:unit` 5 times locally with `--timeout 5000`; CI green once.
2. **Rule and numbers.** Files: `docs/code-patterns.md` § Tests, `.agents/limen/styleguide.md` § Prefer, `spec/build.md` § TRACK. Check: three green runs in a row on `master` (`gh run list --limit 3`).

Parallel: stage 2 after stage 1. No migration, no `bun.lock` change. Safe next to any other job.

## Done when

- Three consecutive green CI runs on `master` without a re-run.
- No fixed `sleep` over 100 ms in the three tests.
- The quarantine rule is in both rule files; the alert entry is closed.
