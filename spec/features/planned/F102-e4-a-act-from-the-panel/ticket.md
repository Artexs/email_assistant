---
opened: 2026-11-13
---

# F102 · E4-A Act from the panel

## Outcome

E4-A Act from the panel: the Stage 2 ticket in row 8 of `docs/product/stage-2/05-execution-plan.md` §2.1 (about ≈ 20 stages). The outcome, the user value and the acceptance come from the epic page `docs/product/stage-2/epics/E04-control-surface.md` and its discovery notes `docs/product/stage-2/epics/E04-discovery-notes.md`; the planning job turns them into stages.

## Scope

- The epic page and discovery notes above set the boundary. The planning job reads them first, then the repo at HEAD, and splits the work into stages of at most one worker job each.
- Product questions are answered in those pages. A planning job only turns decisions into stages and records small defaults in `questions.md`.

## Out of scope

- Work that belongs to other rows of §2.1. The plan names the seams.

## Acceptance

- The planned stages together deliver the epic outcome for this row, each stage with its own proof, as `plan-task` requires.

## Sequenced

- Plan after: none (planning may run ahead of the build).
- Build after: E1, E7-T1, Astro 7 (landed, in `spec/features/done/`).
- Gate: —

## Notes

Source row: §2.1 # 8. Needs plan: run the planner job (`notes/2026-11-13-limen-planner-role.md`).

Design input from the architecture review (`docs/product/stage-2/06-architecture-review.md` §3.8, §8 decision 4): an approval edit is a new draft row that supersedes the old one (`supersedes_action_id`, the shape of "Send again"), never a payload change. Versions, the Drafts copy replacement and the new tap then follow the existing action rules. New action types or draft kinds follow the checklist in `docs/code-patterns.md` § "Add an action type or a draft kind".
