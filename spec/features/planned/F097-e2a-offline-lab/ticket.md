---
opened: 2026-11-13
---

# F097 · Every category has a measured precision and recall on a frozen synthetic corpus, and real labels start

## Outcome

An agent or the owner runs one command and gets, in under 10 minutes, per-category precision and recall of the running classifier on a frozen holdout of about 1,400 made-up executive mails, with urgent recall per urgency source and the Wilson bound that ADR 0028 uses as global evidence for `auto`. A prompt or model change cannot merge without such a report. In parallel, the pilot starts collecting unbiased real labels through a Telegram `/review` command, and test mail no longer counts as real labels. This is E2a, the first half of the quality lab (E2b, the live lab, is a later ticket).

## Scope

- Real labels: test mail by sender, `delegation` in testmail batches, feedback source `review`, `/review` behind a flag.
- Shapes later epics read: the urgency profile and the sender history (counts only).
- Scenario, seeded label-first planner, writer and blind-checker procedure, code checks, freeze and owner audit, for one scenario `lab-01` (bank dev + holdout, realistic week).
- `eval --sim` with a worker pool, budget caps, sim gate, gate file, draft judge, gap check against real labels.
- Starting seam: `apps/server/src/modules/triage/eval.ts`, `packages/core/src/triage/`, `apps/server/src/scripts/eval.ts`, `channels/commands.ts`.

## Out of scope

- The sim stack, injector, delegate bots, scripted executive, week scorer and demo organization (E2b).
- Any classifier prompt, model or threshold change because of the numbers (E3b).
- Storing or editing the urgency profile in the product (E3b, E4-B).

## Acceptance

- `bun run eval --sim lab-01 --part holdout` finishes in under 10 min and its report has the sim gate table with the Wilson lower bound, urgent recall per source, and per-language and per-hard-case tables.
- `bun run sim status lab-01` shows ≥ 200 holdout and ≥ 50 dev cases per value category, frozen as v1.
- CI fails when the current classifier prompt version has no gate file in `evals/results/gate/`.
- `/review` on a chat whose organization has the flag shows up to 10 unlabelled real mails; a tap writes `source = 'review'`.
- `eval --real` no longer counts mail from `TEST_SENDER_ADDRESSES`.
- A sim-vs-real gap report for `notification` and `spam` is in `evals/results/`.

## Slices

19 stages, one worker job each, except stages 15 (writer) and 16 (blind checker): several jobs each, by batch range. Lanes, parallel rules, the only migration (stage 03), review jobs and coordinator steps: [plan.md](plan.md) § "How to run". No owner checkpoint; owner step O1 (audit 50 cases) after stage 17 does not stop the build.

## Sequenced

- Plan after: none (the plan uses no interface of another unplanned ticket).
- Build after: F095 (E1 Close the MVP) in `spec/features/done/`.
- Gate: Owner audit of 50 cases per corpus version — it runs after stage 17 (the corpus freeze) and does not stop the build (plan D36, questions Q1).

## Notes

Design, decisions and facts: [plan.md](plan.md); defaults to confirm: [questions.md](questions.md). Absorbs the dropped tickets F028 (`/review`), F057 (test mail kind) and F065 (testmail `delegation` label). Sources: `docs/product/stage-2/epics/E02-quality-lab.md`, `E02-discovery-notes.md`, PD-013–PD-028, ADR 0028.
