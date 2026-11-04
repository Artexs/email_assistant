# s1b-shadow-triage — Stage 13

Part of [`../s1b-shadow-triage.md`](../s1b-shadow-triage.md). Read that file's "Input" and "Rules for every step" first.

## Stage 13 — Eval cases: `urgent` and `needs_reply` [risky]

- [ ] **13.1 At least 30 synthetic cases for `urgent` and `needs_reply`**
  - Goal: labeled synthetic cases for the first two categories, Polish and English.
  - Files: change `evals/cases/synthetic.json`, `apps/server/src/modules/triage/eval-cases.test.ts`.
  - Interfaces: none new (cases follow `evalCaseSchema`, step 12.1).
  - Decisions:
    - At least 15 cases with `expected.category` `urgent` (ids `syn-urgent-01` …) and at least 15 with `needs_reply` (ids `syn-reply-01` …); at least half of these cases with `lang: "pl"`.
    - At least 3 borderline cases per category (`note: "borderline: …"`), for example an automatic invoice due today (`urgent`, not `notification`), a meeting request (`needs_reply`), a newsletter with a direct question to the user.
    - At least 4 whitelist/VIP cases in these two categories whose text looks like marketing (expected not `spam`).
    - At least 3 cases with `thread` entries. Dates in the text relative to 2026-11-02 (`EVAL_RECEIVED_AT`). `to` holds `szef@firma.test`. Bodies of 2–10 lines. Made-up persons and companies only; reserved domains only (step 12.1).
  - Test (add to `eval-cases.test.ts`): `urgent` ≥ 15; `needs_reply` ≥ 15; Polish ≥ half of the cases of these two categories; borderline ≥ 3 per category; whitelist/VIP cases with expected not `spam` ≥ 4 in these two categories.
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bunx prettier --check evals/cases/synthetic.json`
  - Done when: the tests pass.
  - Out of scope: other categories (stages 14–15), real mail, any LLM call.
