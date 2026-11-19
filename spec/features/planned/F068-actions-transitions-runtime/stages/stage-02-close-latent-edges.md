# F068 stage 02 — close the latent edges and test each one

Needs stage 01: `actions/repo/guard.ts` (`writerGuard`, `statusGuard`) and the `finishAction` rows keyed `to "<status>"` in `WRITER_GUARDS`.

Part of [`../plan.md`](../plan.md). `[risky]`: send path guards change. Decisions: D7–D10, D13.

## Step 1 `[risky]` — tighten the rows

Goal: `WRITER_GUARDS` admits exactly the `ACTION_EDGES`. Change only these rows.

| Row | `from` after this stage | Closes |
| --- | --- | --- |
| `markApplying default` | `create_draft: [ready]`, `send: [approved]` | L2, mailbox and summary `ready → applying` |
| `finishAction to "applied"` | `move, mark_read, flag, save_summary: [ready]`; `create_draft: [ready, applying]`; `send: [applying]` | L5, non-draft `applying → applied` |
| `finishAction to "failed"` | `move, mark_read, flag: [ready]`; `create_draft: [ready, applying]`; `send: [approved, applying]` | summary `ready → failed`, non-draft `applying → failed` |
| `finishAction to "expired"` | `create_draft: [ready, applying]`; `send: [approved]` | L3, L6 |
| `releaseAction toStatus "ready"` | `move, mark_read, flag: [ready]`; `create_draft: [ready, applying]` | L1 (to `ready`), summary self-loop |
| `releaseAction toStatus "approved"` | `send: [approved, applying]` | L1 (to `approved`) |
| `releaseAction toStatus "applying"` | `create_draft: [applying]`; `send: [applying]` | L1 (to `applying`) |
| `markUndone default` | `move, mark_read, flag, create_draft: [applied]` | L4, L7 |

Remove `LATENT_EDGES` and `LatentEdge` (D9); test A (f) compares guard keys with `ACTION_EDGES` keys only; delete the test "no latent edge repeats". The L8 limit (D8) becomes a comment on E1 and E5. Add the missing `createPlanned` callers to `ACTION_ENTRIES` (grep at HEAD).

Check each call of the ten writers at HEAD against plan § Facts checked. A call that lands on a closed key is a stop: report it, do not widen a row.

## Step 2 — the closed-edge test

In `actions-transitions.test.ts`, a new `describe("transitions map: closed latent edges")`. A literal table `CLOSED` holds the 18 `LATENT_EDGES` rows of plan base `b1003651` (`git show b1003651:<path>`), each `{ writer, from, to, types }`: 70 keys; a test asserts the count.

For each key, in a rolled-back transaction: insert a row `(type, from)` with the claim token as `locked_at` (a send with `approved_at`), call the real writer so that only the guard can refuse it, and assert `false` with status and `locked_at` unchanged:

- `markApplying(row, TOKEN)`.
- `finishAction(row, TOKEN, next = <to>, { from: [<from>] })`: the explicit `from` makes the row the only filter.
- `releaseAction(row, TOKEN, { toStatus: <to>, nextAttemptAt: null, countAttempt: false, now })`.
- `markUndone(row, { reason: "undo" })` (row with `applied_at`).

Named cases inside the table (each → `false`, row unchanged): 1. `markApplying`, `move` `ready`. 2. `finishAction` `expired` `from: ["ready"]`, `flag` `ready`. 3. `finishAction` `applied` `from: ["approved"]`, `send` `approved` (L5). 4. `finishAction` `expired` `from: ["applying"]`, `send` `applying` (L6). 5. `releaseAction` to `applying`, `send` `approved`. 6. `releaseAction` to `ready`, `save_summary` `ready`. 7. `markUndone`, `send` `applied` (L4). 8. `markUndone`, `save_summary` `applied` (L7).

Control cases (the row changes): 9. `finishAction` `failed` `from: ["approved"]`, `send` `approved` (E7). 10. `finishAction` `expired` `from: ["approved"]`, `send` `approved` (E21). 11. `releaseAction` to `ready`, `create_draft` `applying` (E10). 12. `finishAction` `applied`, default `from`, original `create_draft` `ready` (L8 stays open, D8).

## Step 3 — docs

- `docs/capabilities/actions-and-undo.md` § Data: the writers build their type and status guard from `WRITER_GUARDS` through `statusGuard`; the guards admit exactly the drawn edges, except L8 (D8).
- `docs/code-patterns.md` § Data access: a function that changes `actions.status` builds its guard with `statusGuard` from a `WRITER_GUARDS` row and gets a test B case (D13). § Add an action type, row 5: drop `LATENT_EDGES`; a new type needs its `WRITER_GUARDS` rows, else every writer refuses it.

## Check

`bun test` on the changed test files while you work; the Proof at the end.

## Done when

- `LATENT_EDGES` and `LatentEdge` exist nowhere in `apps/` (a search that must find nothing).
- Test A (f), test B, the closed-edge test (70 keys, cases 1–12) and stage 01 test 7 pass.
- The send suites named in stage 01 pass with no edit.
- The Proof (`plan.md`, `NN` = `02`) prints `PROOF_OK`.

## Out of scope

A `reverse` dimension for L8; entry writers; any caller file.
