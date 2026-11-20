---
opened: 2026-11-20
---

# F154 · The core functions with 5 or more surviving mutants get tests that fail when the code breaks

## Outcome

The core code that no test catches is covered. The 122 functions with 5 or more surviving mutants get cases that fail when the code breaks, starting with the 10 largest, and a mutation rerun shows the survivors fall. The test audit (F125) found these gaps (`spec/features/active/F125-every-test-file-is-measured-and-classified-and-only-owner-approved-weak-stale-or-duplicate-tests-are-cut-or-merged/audit/report.md` § 4).

## Scope

- Start with `replies/schema.ts`, `sim/checks.ts`, `sim/sent-slot.ts`, `digest/approvals.ts`, `triage/suspicious.ts`, `testmail/batch.ts`, `web/public-content.ts`, `changelog.ts`, `replies/views.ts`.
- The function list and example mutants: `audit/review-core-web-tools.md` § GAP.
- Measure with `bash scripts/test-audit/mutation.sh`.

## Out of scope

- Mutation runs outside `packages/core`.
- A change of product code to make a mutant easier to kill.

## Acceptance

- A mutation rerun shows fewer survived or no-coverage mutants in each named function.
- Each new case has an exact expected value and fails when its function is broken once.
- The mutation score of `packages/core` does not fall below 86.45 %.
