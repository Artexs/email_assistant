# s1b-shadow-triage — Stage 14

Part of [`../plan.md`](../plan.md). Read that file's "Input" and "Rules for every step" first.

## Stage 14 — Eval cases: `info` and `notification` [risky]

- [x] **14.1 At least 30 synthetic cases for `info` and `notification`**
  - Goal: labeled synthetic cases for the next two categories.
  - Files: change `evals/cases/synthetic.json`, `apps/server/src/modules/triage/eval-cases.test.ts`.
  - Interfaces: none new.
  - Decisions:
    - At least 15 cases `info` (ids `syn-info-01` …) and at least 15 `notification` (ids `syn-notif-01` …); at least half in Polish.
    - At least 3 borderline cases per category, for example a newsletter with a question (`info` vs `needs_reply`), a system notice that asks for an action, a shipping notice from a person.
    - At least 6 whitelist/VIP cases in these two categories whose text looks like marketing or spam (expected not `spam`). Together with stage 13 this gives at least 10.
    - Other rules as in step 13.1.
  - Test (add to `eval-cases.test.ts`): `info` ≥ 15; `notification` ≥ 15; Polish ≥ half of the cases of these two categories; borderline ≥ 3 per category; whitelist/VIP cases with expected not `spam` ≥ 6 in these two categories.
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bunx prettier --check evals/cases/synthetic.json`
  - Done when: the tests pass.
  - Out of scope: `spam` and injection cases (stage 15), any LLM call.
