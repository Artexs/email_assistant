---
opened: 2026-11-13
---

# F091 · The big repositories are split by aggregate and action handling is table-driven with a completeness test

## Outcome

`actions/repo.ts` (1,776 lines, 49 functions) and `mail/repo.ts` (1,251 lines, 55 functions) become folders of files under 400 lines, one aggregate each, behind the same module index. The committer dispatches an action type through a typed handler table instead of an if-chain, and one test fails when an action type lacks a handler, a transitions entry, a database CHECK member or a renderer. Adding a draft kind or an action type (E5b `follow_up`, E6a `reply`, ADR 0022 report mail, E4-B unsubscribe) follows a written checklist. No behaviour changes.

## Scope

- Starting seam: `apps/server/src/modules/actions/{repo,apply}.ts`, `apps/server/src/modules/mail/repo.ts`, the module `index.ts` files, `actions/transitions.ts`.
- The split by aggregate: `actions/repo/` and `mail/repo/`, one file per aggregate behind `repo/index.ts` (file list: [plan.md](plan.md) D9, D10).
- The handler table in `apply.ts`, read by `applyAction` and the committer, and the completeness tests for action types and draft kinds.
- The checklist "add an action type or draft kind" in `docs/code-patterns.md`.

## Out of scope

- Any new action type or draft kind. `channels/notices.ts` (F088 splits it). `transitions.ts` as runtime code (F068 stays planned).

## Acceptance

- No file under `apps/server/src/modules/actions/repo/` or `mail/repo/` is over 400 lines.
- `git log --follow` keeps the history of the moved functions (moves, not rewrites).
- Every import of `../actions` and `../mail` from other modules is unchanged; `bun run typecheck`, `bun run test:unit` and `bun run test:int` pass with no test edited except import paths.
- `apply.ts` dispatches through `Record<ActionType, ApplyHandler>`; a unit test enumerates `actionTypes` against the handler table, `ACTION_ENTRIES` of `transitions.ts` and the core payload kinds; an integration test compares `actionTypes` with the `actions.type` CHECK list in `pg_constraint`.
- `docs/code-patterns.md` has the checklist and the file-size standard; `docs/modules.md` §3.5 and §3.2 name the new files.

## Slices

Five stages, one worker job each: 01 split `actions/repo.ts`; 02 split `mail/repo.ts`; 03 the handler table and the action-type completeness test; 04 one list of draft kinds; 05 the checklist and the docs. 01 and 02 may run at the same time; 03 and 04 run in order after 01; 05 after 02 and 04. No migration, no `bun.lock` change, no owner checkpoint. Stages 01–03 get a review job before the land. Commands: [plan.md](plan.md) § "How to run (coordinator)".

## Sequenced

- Plan after: the notices-as-facts ticket (F088) and the LLM-roles ticket (F090), both with `stages/`. This plan names F088's new notice files (stage 04) and its "Add a notice kind" checklist (stage 05).
- Build after: the module-borders lint (F086), notices as facts (F088) and LLM roles (F090), all in `spec/features/done/` (`docs/product/stage-2/07-foundation-plan.md` §1 row 7, §2 lane B).
- Gate: no other job in build edits files under `modules/actions/`, `modules/mail/`, `triage/service.ts`, `channels/notices/` or `packages/core/src/{triage,outgoing,digest,notices}/` while an F091 stage runs; at most two Stage 2 tickets in build (`05-execution-plan.md` §2.4).

## Notes

Design and stages: [plan.md](plan.md); split scripts: [tools.md](tools.md); open defaults: [questions.md](questions.md). Source: review §3.3, §3.8. The order inside the foundation group is in `docs/product/stage-2/07-foundation-plan.md`.
