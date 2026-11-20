---
opened: 2026-11-19
landed: 2026-11-20
---

# F136 · Every Limen job runs the Playwright suites in parallel with no shared lock

## Outcome

Two or more Limen jobs on the owner PC run the panel browser tests and the docs browser check at the same time, and each run passes. No job waits for the shared test lock. Web stages of parallel builds now queue behind each other for that lock; after this, they do not. The lock exists for fixed ports and the shared GreenMail, not for a Playwright limit.

## Scope

- Ports of both Playwright suites come from one place per suite, set per run; the present ports stay the default.
- Each job gets its e2e database without hand steps; the job prepare script is the seam.
- Mail of parallel runs does not mix on the shared GreenMail.
- The lock leaves the rules and docs once the proof holds.

## Out of scope

- Parallel specs inside one run (`workers > 1`): the seed is one organization that the specs change.
- Changes to the unit and integration suites; the parallel-suites ticket (F124) owns them.
- Deletion or merge of e2e specs; the test audit (F125) owns them.
- CI sharding.

## Acceptance

- Three job worktrees run `bun run test:e2e` at the same time with no lock, and all three pass.
- Two job worktrees run `bun run docs:test` at the same time with no lock, and both pass.
- Three such parallel rounds in a row pass.
- One run in the main checkout with no new env passes on ports 8081, 8092 and 8093.
- The first `master` CI run after the land is green.
- `grep -rn email-assistant-shared-tests.lock CLAUDE.md .agents docs` finds no e2e rule, except for a shared resource the plan names.

## Notes

Seams and open questions (mail, memory limit, port choice, active plan texts): [`notes.md`](notes.md).

Plan: [`plan.md`](plan.md), six stages; defaults taken in [`questions.md`](questions.md).

## Sequenced

Plan after: none.
Build after: none. Gate: none. Land before F121 stage 10, the demo recording (`notes/2026-11-20-replan-parallel.md` § 5 and § 7; F136 has no row in `docs/product/stage-2/05-execution-plan.md` § 2).
