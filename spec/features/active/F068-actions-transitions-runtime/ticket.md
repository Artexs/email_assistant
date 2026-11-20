---
opened: 2026-11-11
---

# F068 · The `actions.status` writers take their guards from the transitions map, and no writer admits an edge that no caller uses

## Outcome

Every function that changes the status of an action (a mailbox change, a draft, a send) checks the move against one table of allowed moves, at the moment of the write. Today that table is only compared with the code by tests, and the writers admit about 70 moves that no code path uses; a wrong call could, for example, mark an approved send as applied. After this change such a call changes nothing. The moves that the product uses behave as before.

## Scope

- One shared guard helper for the status writers in `apps/server/src/modules/actions/repo/`, fed by `WRITER_GUARDS` in `actions/transitions.ts`.
- The map rows that the runtime now reads, keyed so that a guard can depend on the target status.
- Closing the latent edges, with one test per closed edge.
- The capability page and the data-access rule that describe the runtime guard.

## Out of scope

- A DB migration or trigger.
- Entry writers (inserts) and the other state machines (mail location flags, mailbox status, delegations).
- Any change to the callers in the committer, the draft and send steps or the approval code.

## Acceptance

- No status writer in `actions/repo/` keeps its own literal status list in the `WHERE` of its status update.
- The guard edges equal the drawn edges: test A passes with no latent edge list.
- The closed-edge test drives all 70 closed moves; each returns `false` and leaves the row unchanged.
- The pinned list of drawn edges passes unchanged, and the send and approval suites pass with no edit.
- `docs/capabilities/actions-and-undo.md` says the writers check the map at runtime.

## Notes

Plan: [plan.md](plan.md); stages in `stages/`. Defaults for the owner: [questions.md](questions.md). Follows the state-machine map that landed earlier (`spec/features/done/2026-11/F067-state-machine-transitions/`, decision D3).

## Sequenced

Plan after: none.
Build after: none. Gate: none (no migration, no owner step); it reaches the VPS with the next release.
