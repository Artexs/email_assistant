---
opened: 2026-11-13
---

# F093 · CI on master is green and a flaky test is quarantined the same day

## Outcome

Every push to `master` gets a green CI run, so a red run means a real regression again. CI, the server image and the agents' local checks run the same Bun version, and the tests that hung on that version are fixed. A test that waits for time-driven code waits for its condition, not a fixed sleep. A test that fails twice in CI without a code change is quarantined with a ticket the same day, by rule.

## Scope

- Starting seam: `apps/server/src/modules/testmail/agentmail/fake.ts` (with `send.test.ts` test 3 and `fake.test.ts` `holdResponseNext`), `apps/server/src/modules/mail/imap/smtp-starttls.test.ts` (three STARTTLS tests), `apps/server/src/platform/scheduler.test.ts`, and the AgentMail timeout entry in `docs/known-alerts.md` (plus a new STARTTLS entry).
- One Bun pin: `.bun-version`, `scripts/ci-bun.sh`, the `test:unit:ci` and `test:int:ci` scripts, `.github/workflows/ci.yml`.
- The integration suite on the pinned Bun (it has not run in CI since 2026-11-08).
- The rules in `docs/code-patterns.md` § Tests, `.agents/limen/styleguide.md` and `CLAUDE.md`; the CI run time for `spec/build.md` § TRACK.

## Out of scope

- A Bun upgrade of the server image (question Q1 in `questions.md`).
- Product code changes. The two S6f CI items that are not tests (env split, backup check) stay in E7. New CI jobs: E8 and E10.

## Acceptance

- Three CI runs in a row on `master` are green, each with `attempt` 1.
- Each fixed test waits for its condition (or the fake releases its hold) and has no fixed sleep longer than 100 ms.
- `docs/code-patterns.md` and the styleguide state the quarantine rule and the pinned-Bun checks; `docs/known-alerts.md` closes the AgentMail entry and a new STARTTLS entry, each with its commit.
- `spec/build.md` § TRACK names the CI run time.
- Every line of "Done when" in [plan.md](plan.md) holds.

## Slices

Three worker jobs, one per stage, in order, each landed with `limen land --keep-open`: `stages/stage-01-bun-pin-and-fakes.md`, `stage-02-waits-and-integration.md`, `stage-03-rules-and-numbers.md`. No stage runs in parallel with another F093 stage. No migration, no `bun.lock` change. The ticket stays open after stage 3 until three green runs; then `limen ticket done F093`. No owner checkpoint. Commands: [plan.md](plan.md) § "How to run".

## Sequenced

- Plan after: none.
- Build after: none.
- Gate: "F093 first and alone" (`docs/product/stage-2/07-foundation-plan.md` §2): no other Stage 2 foundation ticket builds next to it; the module-border lint (F086) builds after this ticket is in `done/`.

## Notes

Design, facts and probes: [plan.md](plan.md). Defaults to confirm: [questions.md](questions.md). Source: `docs/product/stage-2/06-architecture-review.md` §3.1; the ticket group: `docs/product/stage-2/07-foundation-plan.md`.
