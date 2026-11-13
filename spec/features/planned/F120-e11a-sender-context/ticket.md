---
opened: 2026-11-13
---

# F120 · E11a Sender context

## Outcome

E11a Sender context: the Stage 2 ticket in row 26 of `docs/product/stage-2/05-execution-plan.md` §2.1 (about ≈ 10 stages). The outcome, the user value and the acceptance come from the epic page `docs/product/stage-2/epics/E11-contacts-and-context.md` and its discovery notes `docs/product/stage-2/epics/E11-discovery-notes.md`; the planning job turns them into stages.

## Scope

- The epic page and discovery notes above set the boundary. The planning job reads them first, then the repo at HEAD, and splits the work into stages of at most one worker job each.
- Product questions are answered in those pages. A planning job only turns decisions into stages and records small defaults in `questions.md`.

## Out of scope

- Work that belongs to other rows of §2.1. The plan names the seams.

## Acceptance

- The planned stages together deliver the epic outcome for this row, each stage with its own proof, as `plan-task` requires.

## Sequenced

- Plan after: none (planning may run ahead of the build).
- Build after: E3a, E5a, E4-B (landed, in `spec/features/done/`).
- Gate: —

## Notes

Source row: §2.1 # 26. Needs plan: run the planner job (`notes/2026-11-13-limen-planner-role.md`).
