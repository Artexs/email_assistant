---
opened: 2026-11-13
---

# F115 · E6a Reply drafts

## Outcome

E6a Reply drafts: the Stage 2 ticket in row 21 of `docs/product/stage-2/05-execution-plan.md` §2.1 (about ≈ 17 stages). The outcome, the user value and the acceptance come from the epic page `docs/product/stage-2/epics/E06-reply-drafts.md` and its discovery notes `docs/product/stage-2/epics/E06-discovery-notes.md`; the planning job turns them into stages.

## Scope

- The epic page and discovery notes above set the boundary. The planning job reads them first, then the repo at HEAD, and splits the work into stages of at most one worker job each.
- Product questions are answered in those pages. A planning job only turns decisions into stages and records small defaults in `questions.md`.

## Out of scope

- Work that belongs to other rows of §2.1. The plan names the seams.

## Acceptance

- The planned stages together deliver the epic outcome for this row, each stage with its own proof, as `plan-task` requires.

## Sequenced

- Plan after: none (planning may run ahead of the build).
- Build after: E2a, E3a, E4-A, E5a, E7-T2 (landed, in `spec/features/done/`).
- Gate: Stage 1 is the prototype; second pass after it (PD-071, PD-072, PD-083) before the later stages

## Notes

Source row: §2.1 # 21. Needs plan: run the planner job (`notes/2026-11-13-limen-planner-role.md`).
