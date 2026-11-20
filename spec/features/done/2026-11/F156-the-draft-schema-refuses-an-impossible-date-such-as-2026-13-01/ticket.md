---
opened: 2026-11-20
landed: 2026-11-20
---

# F156 · The draft schema refuses an impossible date such as 2026-13-01

## Outcome

The draft schema refuses an impossible date such as `2026-13-01`. Today it accepts it, and `triage/payloads.test.ts` pins that. Owner decision (F125 gate G1, 2026-11-20): refuse it. An unknown key in a web query stays accepted (`web/activity.test.ts:39` stays).

## Scope

- The date field of the draft payload schema in `@ea/core` (`packages/core/src/triage/payloads.ts` and what it uses).
- Flip the case in `triage/payloads.test.ts` that pins the old rule.
- Check that stored payloads with a valid date still parse.
- The delegation planner and the delegation chaser write no impossible date (`triage/planners.ts`, `delegation/chaser.ts`, their tests) and two capability pages state the rule.

## Out of scope

- Other date fields and other schemas.
- The web query schema.

## Acceptance

- `2026-13-01` and `2026-02-30` fail the schema; a valid date passes.
- The flipped case asserts the exact refusal.
- Every caller test that builds a draft payload passes.
- A bad date from the model or a stored draft gives an empty due date in the planner and the chaser, never an impossible one.

## Slices

One stage, one worker job: [`stages/stage-01-calendar-due-date.md`](stages/stage-01-calendar-due-date.md). No owner checkpoint. See [`plan.md`](plan.md) § How to run.

## Sequenced

Plan after: none (the plan uses no interface of another open ticket).
Build after: none. Gate: none. F156 is a follow-up of the test audit (F125 G1); it has no row in `docs/product/stage-2/05-execution-plan.md` § 2 or `07-foundation-plan.md`.
