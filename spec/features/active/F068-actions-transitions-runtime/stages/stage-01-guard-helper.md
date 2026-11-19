# F068 stage 01 — every status writer reads its guard row through one helper

Needs: nothing open. Reads `WRITER_GUARDS` in `apps/server/src/modules/actions/transitions.ts` at HEAD.

Part of [`../plan.md`](../plan.md). `[risky]`: send path. Decisions: D1–D6, D10.

## Goal

The ten status writers build their `(type, status)` guard from a `WRITER_GUARDS` row. The admitted edge set stays the same (D6 names the two differences, on rows that never occur).

## Interfaces (stage 02 and later writers use them)

In the new file `apps/server/src/modules/actions/repo/guard.ts`:

```ts
// The one row of (writer, variant); throws Error(`WRITER_GUARDS has no row for ${writer} / ${variant}`) for none,
// and a similar error for two rows.
export function writerGuard(writer: ActionWriter, variant: string): WriterGuard;
// Pure. Types grouped by an equal from-list after the narrowing, in `actionTypes` order; empty lists dropped.
export function guardGroups(
  guard: WriterGuard,
  narrow?: readonly ActionStatus[]
): { types: ActionType[]; statuses: ActionStatus[] }[];
// OR over the groups of (type IN types AND status IN statuses); no group → a false literal.
export function statusGuard(
  eb: ExpressionBuilder<DB, "actions">,
  guard: WriterGuard,
  narrow?: readonly ActionStatus[]
): Expression<SqlBool>;
```

`actions/repo/index.ts` exports `statusGuard`.

## Map change (`transitions.ts`, D4)

- Replace the three `finishAction` rows (`default`, `from ["applying"]`, `from ["approved"]`) with three rows keyed by target: `to "applied"`, `to "failed"`, `to "expired"`. Each has `to` with that one status and `from`: `move`, `mark_read`, `flag`, `save_summary`, `create_draft` → `["ready", "applying"]`; `send` → `["applying", "approved"]`. Test A (f) must show the same key set as before; the `LATENT_EDGES` stay as they are.
- Keep the other rows and `variant` names. The header comment says the runtime reads `WRITER_GUARDS`.

## Writers

Each writer resolves its rows in module-level constants and uses `statusGuard` in place of its literal status list. Other conditions stay (D3).

| Writer | Row(s) | Note |
| --- | --- | --- |
| `markApplying` | `markApplying default` | keep `approved_at IS NOT NULL` for a send |
| `finishAction` | `to "<next.status>"` | narrowing `opts.from ?? ["ready", "applying"]` |
| `releaseAction` | `toStatus "<opts.toStatus>"` | — |
| `expireStaleReady`, `expireReadyOriginals` | their `default` | keep `filter.types`, mailbox, lock, `created_at`, `reverses_action_id` |
| `expireReadyDraft` | `default` | keep `reverses_action_id IS NULL` |
| `setExpired` | `from "<opts.from>"` | keep the held rule and `ignoreLock` |
| `setApproved` | `default` | — |
| `setRejected` | both rows | `awaiting_approval` row OR (`approved` row AND not held) |
| `markUndone` | `default` | — |

`releaseActions` (lock release, no status change) keeps its list (D11).

## Tests

Unit, `actions/repo/guard.test.ts` (no DB; a literal `WriterGuard`, not a map row):

1. `G = { writer: "finishAction", variant: "t", from: { move: ["ready","applying"], flag: ["ready","applying"], send: ["applying"] }, to: ["failed"] }`: `guardGroups(G)` → `[{ types: ["move","flag"], statuses: ["ready","applying"] }, { types: ["send"], statuses: ["applying"] }]`.
2. `guardGroups(G, ["ready"])` → `[{ types: ["move","flag"], statuses: ["ready"] }]`.
3. `guardGroups(G, ["approved"])` → `[]`.
4. `writerGuard("markUndone", "nope")` throws; the message holds `markUndone / nope`.
5. Every `(writer, variant)` of `WRITER_GUARDS` resolves with `writerGuard`, and no pair appears twice.
6. `statusGuard` for `G`, compiled with Kysely's `DummyDriver`: two `type in` groups joined by `or`; for case 3 a false literal.

Unit, `transitions.test.ts` (D10): 7. a literal sorted list of every `writer type: from -> to` key of `ACTION_EDGES`, written once from the map at HEAD before any change, equals the keys computed from `ACTION_EDGES`.

Integration, `actions-transitions.test.ts` (test B):

8. `finishAction`: for each `to` row × narrowing `none`, `["applying"]`, `["approved"]`, the admitted set is row.from ∩ narrowing (none = `["ready","applying"]`); all `actionTypes` are driven.
9. `releaseAction` `toStatus "ready"`: a `send` row in `approved` or `applying` is refused (`false`, status unchanged), no `23514` (D6 b).
10. Every other test B case passes unchanged.

## Check

`bun test` on the changed test files while you work; the Proof at the end.

## Done when

- No status writer in `actions/repo/` has a literal status list in the `WHERE` of its status `UPDATE` (`releaseActions` excepted).
- Test A (f) passes with the `LATENT_EDGES` of HEAD unchanged; test 7 passes.
- The send and approval suites pass with no edit (plan § Rules).
- The Proof (`plan.md`, `NN` = `01`) prints `PROOF_OK`.

## Out of scope

Closing latent edges and docs (stage 02). Any caller file.
