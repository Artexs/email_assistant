---
opened: 2026-11-13
---

# F091 · The big repositories are split by aggregate and action handling is table-driven with a completeness test

## Outcome

`actions/repo.ts` (1,776 lines, 49 functions) and `mail/repo.ts` (1,251 lines, 55 functions) become folders of files under 400 lines, one aggregate each, behind the same module index. The committer dispatches an action type through a typed handler table instead of an if-chain, and one test fails when an action type lacks a handler, a transitions entry, a database CHECK member or a renderer. Adding a draft kind or an action type (E5b `follow_up`, E6a `reply`, ADR 0022 report mail, E4-B unsubscribe) follows a written checklist. No behaviour changes.

## Scope

- Starting seam: `apps/server/src/modules/actions/{repo,apply}.ts`, `apps/server/src/modules/mail/repo.ts`, the module `index.ts` files, `actions/transitions.ts`.
- The split by aggregate: `actions/repo/{claims,sends,drafts,notify,expiry,retention,undo,index}.ts`; `mail/repo/{mailboxes,folders,credentials,emails,claims,retention,index}.ts` (names decided in the plan-task session from the function list).
- The handler table in `apply.ts` and the completeness test.
- The checklist "add an action type or draft kind" in `docs/code-patterns.md`.

## Out of scope

- Any new action type or draft kind. `channels/notices.ts` (F088 splits it). `transitions.ts` as runtime code (F068 stays planned).

## Acceptance

- No file under `apps/server/src/modules/actions/repo/` or `mail/repo/` is over 400 lines.
- `git log --follow` keeps the history of the moved functions (moves, not rewrites).
- Every import of `../actions` and `../mail` from other modules is unchanged; `bun run typecheck`, `bun run test:unit` and `bun run test:int` pass with no test edited except import paths.
- `apply.ts` dispatches through `Record<ActionType, ApplyHandler>`; a unit test enumerates `actionTypes` against the handler table, `ACTION_ENTRIES` of `transitions.ts` and the core payload kinds; an integration test compares `actionTypes` with the `actions.type` CHECK list in `pg_constraint`.
- `docs/code-patterns.md` has the checklist and the file-size standard; `docs/modules.md` §3.5 and §3.2 name the new files.

## Notes

Design and stages: [plan.md](plan.md). Source: review §3.3, §3.8. The order inside the foundation group is in `docs/product/stage-2/07-foundation-plan.md`.
