---
opened: 2026-11-13
---

# F095 · E1 Close the MVP (capability map, docs boundary, NEXT sweep of the old planned tickets)

## Outcome

E1 Close the MVP (capability map, docs boundary, NEXT sweep of the old planned tickets): the Stage 2 ticket in row 1 of `docs/product/stage-2/05-execution-plan.md` §2.1 (about ≈ 10 stages). The outcome, the user value and the acceptance come from the epic page `docs/product/stage-2/epics/E01-close-the-mvp.md` and its discovery notes `docs/product/stage-2/epics/E01-discovery-notes.md`; the planning job turns them into stages.

## Scope

- The epic page and discovery notes above set the boundary. The planning job reads them first, then the repo at HEAD, and splits the work into stages of at most one worker job each.
- Product questions are answered in those pages. A planning job only turns decisions into stages and records small defaults in `questions.md`.

## Out of scope

- Work that belongs to other rows of §2.1. The plan names the seams.

## Acceptance

- The planned stages together deliver the epic outcome for this row, each stage with its own proof, as `plan-task` requires.

## Sequenced

- Plan after: none (planning may run ahead of the build).
- Build after: — (F077 landed) (landed, in `spec/features/done/`).
- Gate: Owner: F047 A phone test; vision text OK (owner-owned)

## Notes

Source row: §2.1 # 1. Input: the handoff `~/.pi/agent/notes/2026-11-12-handoff-stage2-e01-close-the-mvp.md` (copy what you need into the plan; later agents may not read that path). Needs plan: run the planner job (`notes/2026-11-13-limen-planner-role.md`).
