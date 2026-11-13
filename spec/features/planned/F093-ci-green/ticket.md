---
opened: 2026-11-13
---

# F093 · CI on master is green and a flaky test is quarantined the same day

## Outcome

Every push to `master` gets a green CI run, so a red run means a real regression again. The three timing tests that failed in 36 of the last 40 runs wait for a condition instead of a fixed sleep. A test that fails twice in CI without a code change is quarantined with a ticket the same day, by rule.

## Scope

- Starting seam: `apps/server/src/platform/scheduler.test.ts` ("a throwing job does not stop the next tick"), `apps/server/src/modules/testmail/send.test.ts` (`runSend > 3`), `apps/server/src/modules/testmail/agentmail/fake.test.ts` (`holdResponseNext`), and the entry in `docs/known-alerts.md` that records the flaky `mailbox:seed` CLI test.
- The quarantine rule in `docs/code-patterns.md` § Tests and `.agents/limen/styleguide.md`.
- The CI run time and the date of the last green run in `spec/build.md` § TRACK.

## Out of scope

- The two S6f CI items that are not tests (env split, backup verification): they stay in E7.
- New CI jobs (security scans, docs site): E8 and E10.

## Acceptance

- Three CI runs in a row on `master` are green, with no re-run.
- Each fixed test waits for its condition with a bounded poll (or an injected clock) and has no fixed `sleep` longer than 100 ms.
- `docs/code-patterns.md` and the styleguide state the quarantine rule; `docs/known-alerts.md` closes the flaky-test entry with the commit.
- `spec/build.md` § TRACK names the CI run time.

## Notes

Design and stages: [plan.md](plan.md). Source: `docs/product/stage-2/06-architecture-review.md` §3.1; the ticket group: `docs/product/stage-2/07-foundation-plan.md`.
