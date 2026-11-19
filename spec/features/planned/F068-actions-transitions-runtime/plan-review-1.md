# F068 plan review 1

Job `2026-11-19-f068-plan-review-57187d32` (claude-opus-5-5, thinking high), candidate 46df391a. Final message, filed whole:

PASS 46df391ac224def1841d452a5b57e079e516d01d

The plan holds against the code at HEAD. HEAD matches the candidate (`/tmp/f068-review/head.log` = 46df391a). I found no blocking finding. Every real call of the ten status writers lands on an edge that stage 02 keeps, and the stage 02 guard table equals `ACTION_EDGES` exactly. One test assert in stage 01 cannot hold after stage 02. Fix it in the plan before stage 02 starts.

## Blocking findings

None.

## Unverified checks

- `bun run lint`, `typecheck`, `test:unit:ci` and `test:int:ci` did not run. This is a plan review with no product code, and the worktree has no `node_modules`. The stage Proofs run them.

## Findings (notes)

1. **Proven: stage 01 test 8 cannot hold after stage 02. Fix before stage 02.**
   - Stage 01 test 8 (`stages/stage-01-guard-helper.md:72`) drives each `finishAction` `to` row × the narrowings `none`, `["applying"]` and `["approved"]` through test B.
   - Test B's `checkWriter` asserts `expect(admittedCases).toBeGreaterThan(0)` (`apps/server/test/integration/actions-transitions.test.ts:246`).
   - After the stage 02 data change, the pair `finishAction to "applied"` × `from ["approved"]` admits nothing. In stage 02, `send` is `[applying]` and the other types never hold `approved`.
   - Proven by `/tmp/f068-review/probe2.ts`. Its output in `/tmp/f068-review/probe2.log` has the line `applied approved 0`. The other eight pairs admit 1 to 7 rows.
   - Stage 02 "Done when" (`stage-02-close-latent-edges.md:53`) requires test B to pass. The plan rule "a gap or a deviation is a question" (`plan.md` § Rules) makes the worker stop and ask.
   - Fix: let stage 02 drop that one pair from test 8, or make test 8 accept zero admitted rows when the admitted set is empty. The closed-edge case 3 (L5) already covers that pair.

2. **Proven by reading: D8 understates the original/reverse blind spot. The planned doc line will be wrong.**
   - D8 (`plan.md:22`) keeps open only L8: an original draft `ready → applied` or `ready → failed`.
   - Stage 02 step 3 (`stage-02-close-latent-edges.md:43`) tells the capability page "the guards admit exactly the drawn edges, except L8".
   - The map has no original/reverse field, so the same gap also admits these moves, and no caller uses them:
     - a reverse `create_draft` row `ready → applying` through `markApplying`. E2 is for originals only: `applyDraft` runs only for `reverses_action_id === null` (`apply.ts` `APPLY_HANDLERS`). Claims skip a reverse row in `applying` (`repo/claims.ts:123`), so that row would stay stuck.
     - a reverse `create_draft` row `ready → expired` through `finishAction`. E22 is the claimed original of a follow-up.
     - a reverse row `applied → undone` through `markUndone`. E20 is used only on originals.
   - Fix: write D8 as "any `create_draft` or reverse-row edge that is for originals only or for reverse rows only". Make the doc line say the same. Optionally add a control case "`markApplying` on a reverse `create_draft` `ready` → `true` (admitted, no caller)" so that the limit is recorded.

3. **Plausible: the no-edit suite list does not cover the Undo and draft paths.**
   - The pre-mortem question asks which stage would let a broken Undo through.
   - `plan.md` § Rules forbids edits only in the send and approval suites. These suites call or exercise the changed writers on the Undo and draft paths, and an edit there could hide a regression:
     - `actions-repo.test.ts`: direct calls of `finishAction`, `releaseAction`, `markApplying` and `markUndone`, for example lines 440–505 and 1640–1725.
     - `actions-apply.test.ts`, `actions-move.test.ts`, `actions-undo.test.ts`, `actions-drafts.test.ts`, `actions-follow-up.test.ts` and `triage-returned.test.ts`.
   - Each direct call in `actions-repo.test.ts` and `actions-send-started.test.ts` uses a drawn edge (checked by reading), so no edit should be needed.
   - Fix: add these files to the no-edit list.

4. **Proven: plan size is over the cap.** `/tmp/f068-review/wc.log` = 1504 words for `plan.md`. The cap in `.agents/limen/planner.md` § Plan size is 1,500. `plan.md` § Log says "1,495+". Trim 4 words and write the real count.

5. **Proven by reading: a small scope conflict.** Stage 02 step 1 (`stage-02-close-latent-edges.md:22`) adds `createPlanned` callers to `ACTION_ENTRIES`. Ticket Out of scope and D11 exclude entry writers. The change is caller text only and has no risk. Either keep it and say "caller text only" in D11, or drop it.

6. **Plausible: test B coverage gets smaller after stage 02.** `checkWriter` drives only `Object.keys(guard.from)` plus `extraTypes`. After stage 02, several rows keep only one or two types: `releaseAction toStatus "approved"` (send only), `markApplying`, `markUndone` and `finishAction to "expired"`. Test B then no longer drives the dropped types through the real writer. The closed-edge test covers the 70 moves that were open before, so nothing is lost today. Passing `extraTypes: actionTypes` in test B would keep the full type × status matrix. This is a hardening idea.

## Pre-mortem

- **A send that went twice.** No stage plausibly causes it.
  - Stage 02 only removes admitted moves.
  - Stage 01 keeps the admitted set, except the two D6 differences on rows that cannot occur. Test 8, the send suites and the CHECK `approved_at` on `approved`/`applying`/`applied` sends (`db/migrations/20261108000001_delegation.sql:20`) guard this.
  - A wrong refusal of `send applying → applied` leaves the row `applying`. The recovery then locates the sent copy (`send.ts:46`) and does not send again.
- **A send or draft stuck.** It would need a closed edge on a real path.
  - I checked every call of the ten writers at HEAD: `apply.ts`, `drafts.ts`, `send.ts`, `send-limit.ts`, `send-failure.ts`, `send-finish.ts`, `send-close.ts`, `expiry.ts`, `replace.ts`, `approvals.ts` and `triage/returned.ts`. Each one maps to a kept E edge, as plan § Facts checked says.
  - The one real hazard is the reverse-draft `markApplying` hole in finding 2. It is unused and was also open before this plan.
- **Undo no longer works.** E1 and E5 (reverse rows), E9 and E20 stay open in stage 02. The Undo suites are outside the no-edit rule (finding 3).

## Checks I ran

- `git rev-parse HEAD > /tmp/f068-review/head.log && bun /tmp/f068-review/probe.ts > /tmp/f068-review/probe.log && bun /tmp/f068-review/probe2.ts > /tmp/f068-review/probe2.log && wc -w …/plan.md > /tmp/f068-review/wc.log` exited 0.
- `head.log`: the HEAD sha matches the candidate.
- `probe.log`: `probe.ts` imports `transitions.ts` at HEAD and applies the stage 02 table. Result:
  - guard keys minus edges = `[]`, and edges minus guard keys = `[]`.
  - Latent keys = 70 in 18 rows, and the stage 02 table closes 70 keys.
  - The closed set equals `LATENT_EDGES` in both directions.
  - So the stage 02 table and the "70 keys" claim are correct.
- `probe2.log`: the admitted set of each stage 02 `finishAction` row × narrowing, as in finding 1.
- `grep` in the bun cache (`~/.bun/install/cache/kysely@0.29.8@@@1/dist/index.d.ts:68,88,90`): Kysely 0.29.8 exports `DummyDriver`, `PostgresQueryCompiler` and `PostgresAdapter` from its root, as the plan says.
- `grep` for `updateTable("actions")` in `apps/server/src`: the only status writers are the ten that the plan names. `releaseActions` changes no status. The `scripts/e2e-delegations-rows.ts` update changes only the payload.

## Facts confirmed by reading

- D6 (a): `setApproved` and `insertSendAgain` write `approved` only for a send.
- D6 (b): test B today expects `23514` (`actions-transitions.test.ts:309-311`).
- `MAILBOX_ACTION_TYPES` is `move`, `mark_read`, `flag`.
- `actionTypes` order is `move, mark_read, flag, save_summary, create_draft, send`, which matches stage 01 test 1.

## Decisions for the owner

None.

## Note check

- HEAD is the candidate: proven. `/tmp/f068-review/head.log` holds 46df391ac224def1841d452a5b57e079e516d01d.
- Findings checked against code at HEAD: proven. `/tmp/f068-review/probe.log`, `/tmp/f068-review/probe2.log`, plus the file:line reads cited in each finding.
- Pre-mortem covered: proven. This message, § Pre-mortem.
- First line is PASS/FAIL with the sha: proven. Line 1 of this message.
- Easy-to-miss rule (code detail is not a finding): followed. Each finding names a test assert, a decision scope, a rule gap or a size cap. None asks for line numbers, edit text or file lists.
