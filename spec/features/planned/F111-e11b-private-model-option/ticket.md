---
opened: 2026-11-13
---

# F111 · E11b Private model option

## Outcome

E11b Private model option: the Stage 2 ticket in row 17 of `docs/product/stage-2/05-execution-plan.md` §2.1 (about ≈ 5 stages). The outcome, the user value and the acceptance come from the epic page `docs/product/stage-2/epics/E11-contacts-and-context.md` and its discovery notes `docs/product/stage-2/epics/E11-discovery-notes.md`; the planning job turns them into stages.

## Scope

- The epic page and discovery notes above set the boundary. The planning job reads them first, then the repo at HEAD, and splits the work into stages of at most one worker job each.
- Product questions are answered in those pages. A planning job only turns decisions into stages and records small defaults in `questions.md`.

## Out of scope

- Work that belongs to other rows of §2.1. The plan names the seams.

## Acceptance

- The planned stages together deliver the epic outcome for this row, each stage with its own proof, as `plan-task` requires.

## Sequenced

- Plan after: none (planning may run ahead of the build).
- Build after: E2a (landed, in `spec/features/done/`).
- Gate: Owner: OpenAI Europe project request (PD-111); second pass on the answer (PD-110) before the EU stage

## Notes

Source row: §2.1 # 17. Needs plan: run the planner job (`notes/2026-11-13-limen-planner-role.md`).
