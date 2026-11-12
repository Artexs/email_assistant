> **Status 2026-11-11 — done — stages 1–5, group review PASS, merged into `master`.** Follow-up: `spec/features/planned/F068-actions-transitions-runtime/plan.md` (D3, `[risky]`).

# Explicit state machine for `actions.status`

Scope: user request 2026-11-11 ("find all of the implicit state machines in my app", then "prepare … an implementation plan for … this refactor"). Inventory: [`notes/2026-11-11-implicit-state-machines.md`](../../../../../notes/2026-11-11-implicit-state-machines.md). Handoff: [`notes/2026-11-11-handoff-state-machine-plan.md`](../../../../../notes/2026-11-11-handoff-state-machine-plan.md). Needs: nothing. See D7 for the timing.

Git mode: master for this plan file. The build uses `Git mode: worktree` (branch `task/state-machine-transitions`, folder `../email_assistant-wt/state-machine-transitions`, own database from `bun run db:worktree state-machine-transitions`).
Run mode: normal (plan → build → review per stage). See D11.

## Goal

Make the implicit state machine of `actions.status` explicit: one map in code of the states, the entry states, the allowed edges and the guard of each writer function. Tests compare the map with the real guards in Postgres. The task adds a safety net only: **it must not change runtime behavior.**

## Why

- `actions` sends mail to real people (exactly-once for drafts, at-most-once for send, `docs/architecture.md` §4.1 rule 6).
- Ten repository functions in `actions/repo.ts` (1623 lines) and callers in five other files change the status. There is no single list of legal edges. `docs/architecture.md` §4.6 is the only written map, and nothing checks the code against it.
- No bug is known. This is a future-risk reduction (the user accepted this view on 2026-11-11). When someone adds an edge and forgets the map, a test must fail.

## Done when

- `apps/server/src/modules/actions/transitions.ts` exists and holds the map (interfaces in stage 2).
- `bun run test:unit` runs the consistency test of the map (test A) and it passes.
- `bun run test:int` runs the schema test (test C) and the guard test (test B) for each writer in the "Writers" table, and they pass.
- Each pair rule (P1–P7) names an integration test that proves it.
- `docs/architecture.md` §4.6 and `docs/code-patterns.md` name the map and the rule "a new status write updates `transitions.ts`".
- `git diff master --stat -- apps/server/src` shows changes only in `modules/actions/transitions.ts` and `modules/actions/transitions.test.ts` (no runtime change).
- `bun run lint && bun run typecheck && bun run test:unit && bun run test:int` passes.

## Rules for this task

- **No runtime change.** No changed line in a file that the server runs, except the new `transitions.ts` (which no runtime code imports in this task). A finding that needs a code fix becomes a new task in `tasks/planned/` and a question to the user.
- No migration, no change to `bun.lock`, no new package.
- Do not parse TypeScript or SQL source text in a test. Test B compares the map with the behavior of the real functions in Postgres. Test C reads the CHECK definition from the Postgres catalog (`pg_get_constraintdef`), which is DB output, not repo source.
- Integration tests use `withRollback` (`apps/server/test/integration/helpers.ts`) and the fixtures in `fixtures.ts` (`createOrgWithMailbox`, `insertTestEmail`, `insertAction`, `insertDraftAndSend`).
- Repository functions keep their `TenantContext` and `org_id` filter (`docs/code-patterns.md`). This task adds no repository function.
- `[risky]` areas (`tasks/README.md`): this task touches none at runtime. The stages are normal stages (2–4 steps). The later runtime step (D3) is `[risky]`.
- Docker on this PC: run `docker` and `bun run dev:up` inside `newgrp docker <<'EOF' … EOF` (`notes/2026-11-08-docker-socket-newgrp.md`). Git push: `export GIT_SSH_COMMAND="ssh -i $HOME/.ssh/github -o IdentitiesOnly=yes"` (`notes/2026-11-10-git-ssh-push.md`).

## Facts (read 2026-11-11, plan session; line numbers can move, re-grep `\.set\(.*status` and `status:` in `actions/`)

### States and types

- States (10), CHECK in `db/migrations/20261104000001_triage.sql:63-76`: `ready, applying, applied, awaiting_approval, approved, rejected, expired, undone, logged, failed`. No later migration changes this CHECK.
- Types (6): `move, mark_read, flag, save_summary, create_draft, send` (`actions_type_check`, `20261108000001_delegation.sql:16`; the const array `actionTypes` in `@ea/core`, `packages/core/src/triage/planners.ts:6`). Correction (planner check 2026-11-11): `actionTypeSchema` is not in `@ea/core`; it is a local, not exported `z.enum(actionTypes)` in `actions/repo.ts:20`.
- The status CHECK is an inline column CHECK (no explicit name; Postgres default name `actions_status_check`, confirmed by test C in stage 3).
- CHECKs on edges: `actions_applied_at_check` (`applied`, `undone` need `applied_at`; `20261107000001_assist_actions.sql:3`), `actions_send_approved_check` (a send in `approved`, `applying`, `applied` has `approved_at`; `20261108000001_delegation.sql:19-20`) and `actions_send_never_ready_check` (a send is never `ready`; `:21`). These three CHECKs also name `status` and quote status values.
- Terminal states (no edge leaves them on the same row): `rejected, expired, undone, logged, failed`. `applied` is not terminal (→ `undone`).

### Entry writers (insert a new row)

| Writer            | File                   | Status                                 | Callers                                                                                                                                                                                      |
| ----------------- | ---------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createPlanned`   | `actions/repo.ts:79`   | `ready`, `awaiting_approval`, `logged` | `triage/service.ts:232` (status from `actionStatusFor`, `packages/core/src/triage/policy.ts:55`); `delegation/chaser.ts:160` (reminder: draft `ready`, send `awaiting_approval`, hard-coded) |
| `insertReverse`   | `actions/repo.ts:838`  | `ready` (reverse row)                  | `undo.ts:51`, `expiry.ts:117` (`closeDraftOfSend`), `send.ts:202`                                                                                                                            |
| `insertSendAgain` | `actions/repo.ts:1396` | `approved` (send, key `<id>:again`)    | `approvals.ts:240`                                                                                                                                                                           |

### Writers (change the status of a row) and their guards

Read with the section 'Stage 1 result': it corrects rows of this table (guard facts in correction 8).

| Writer                 | File                   | Guard: from                                                                                   | To                                                                  | Other guard                                                                                                                                    |
| ---------------------- | ---------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `markApplying`         | `actions/repo.ts:587`  | send: `approved` with `approved_at`; other types: `ready`, `approved`                         | `applying`                                                          | `locked_at` = claim token                                                                                                                      |
| `finishAction`         | `actions/repo.ts:633`  | `opts.from`, default `ready`, `applying`; callers also pass `["applying"]` and `["approved"]` | `applied`, `failed`, `expired` (`send_closed`)                      | `locked_at` = claim token                                                                                                                      |
| `releaseAction`        | `actions/repo.ts:682`  | `ready`, `approved`, `applying`                                                               | `opts.toStatus` ∈ `ready`, `approved`, `applying`                   | `locked_at` = claim token                                                                                                                      |
| `expireStaleReady`     | `actions/repo.ts:751`  | `ready`                                                                                       | `expired` (`stale`)                                                 | original row, `MAILBOX_ACTION_TYPES`, `created_at` older than `CLAIM_MAX_AGE_MS`, not held (`locked_at` null or before `staleBefore`), mailbox |
| `markUndone`           | `actions/repo.ts:775`  | `applied`                                                                                     | `undone` (`undo`, `user_moved_back`, `sent`, `rejected`, `expired`) | none (no type guard)                                                                                                                           |
| `expireReadyOriginals` | `actions/repo.ts:1033` | `ready`                                                                                       | `expired` (`policy_changed`, `undo`, `manual`)                      | original row, filter types, not held, mailbox, optional email and category                                                                     |
| `setExpired`           | `actions/repo.ts:1271` | `opts.from`: `awaiting_approval` or `approved`                                                | `expired` (send close reasons)                                      | type `send`; `approved` only when not held                                                                                                     |
| `expireReadyDraft`     | `actions/repo.ts:1292` | `ready`                                                                                       | `expired` (`send_closed`)                                           | type `create_draft`, original row                                                                                                              |
| `setApproved`          | `actions/repo.ts:1334` | `awaiting_approval`                                                                           | `approved`                                                          | type `send`                                                                                                                                    |
| `setRejected`          | `actions/repo.ts:1359` | `awaiting_approval`; `approved` when not held                                                 | `rejected`                                                          | type `send`                                                                                                                                    |

Not status writers (lock or flag only): `claimActions` (sets `locked_at`), `releaseActions` (clears the lock), `markNotified`, `markResultNotified`, `updateProviderResult`, `setDelegationId`.

### Edges that callers use (the design map; stage 1 confirms each)

Read with the section 'Stage 1 result': it corrects rows of this table (E1, E5, E6, E7, E9–E14, E18, E19 callers and types).

| #   | From → to                      | Types                                                                         | Writer                                                         | Reasons                                                                           | Callers                                                                                                                               |
| --- | ------------------------------ | ----------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | `ready → applied`              | move, mark_read, flag, save_summary; reverse rows (also reverse create_draft) | `finishAction` (default `from`)                                | —                                                                                 | `apply.ts:95,243,332`, `drafts.ts:302`                                                                                                |
| E2  | `ready → applying`             | create_draft (original)                                                       | `markApplying`                                                 | —                                                                                 | `drafts.ts:150`                                                                                                                       |
| E3  | `approved → applying`          | send                                                                          | `markApplying`                                                 | —                                                                                 | `send.ts:380`                                                                                                                         |
| E4  | `applying → applied`           | create_draft, send                                                            | `finishAction` (send: `from: ["applying"]`)                    | send recovery: `recovered` in `provider_result`                                   | `drafts.ts:204`, `send.ts:162`                                                                                                        |
| E5  | `ready → failed`               | mailbox types, reverse create_draft                                                 | `finishAction`                                                 | `hard_error`, `mail_not_found`, `bad_payload`                                     | `apply.ts:138,183`, `drafts.ts:74`                                                                                                    |
| E6  | `applying → failed`            | create_draft, send                                                            | `finishAction` (send: `from: ["applying"]`)                    | `hard_error`, `bad_payload`, `smtp_rejected`, `smtp_error`, `outcome_unknown`     | `drafts.ts:74`, `send.ts:88` (via `failSend`)                                                                                         |
| E7  | `approved → failed`            | send                                                                          | `finishAction` (`from: ["approved"]`)                          | `bad_payload`, `smtp_error` (third compose error)                                 | `send.ts:88` (via `failSend` from `send.ts:143,263`)                                                                                  |
| E8  | `applying → expired`           | create_draft                                                                  | `finishAction`                                                 | `send_closed`                                                                     | `drafts.ts:242`                                                                                                                       |
| E9  | `ready → ready` (retry)        | mailbox types, create_draft                                                   | `releaseAction`                                                | soft: no count; hard: `attempts + 1`                                              | `apply.ts:126,164,395`, `drafts.ts:132`                                                                                               |
| E10 | `applying → ready` (retry)     | create_draft                                                                  | `releaseAction`                                                | error before the APPEND in a row that started in this call                        | `drafts.ts:132`                                                                                                                       |
| E11 | `applying → applying` (retry)  | create_draft, send                                                            | `releaseAction`                                                | draft: error at the APPEND; send: error in the recovery                           | `drafts.ts:132`, `send.ts:455`                                                                                                        |
| E12 | `approved → approved` (retry)  | send                                                                          | `releaseAction`                                                | no sender, draft not applied, compose error                                       | `send.ts:274,345,360`                                                                                                                 |
| E13 | `applying → approved` (retry)  | send                                                                          | `releaseAction`                                                | login error, known stage before the content                                       | `send.ts:300,310`                                                                                                                     |
| E14 | `ready → expired`              | mailbox types; create_draft                                                   | `expireStaleReady`, `expireReadyOriginals`, `expireReadyDraft` | `stale`; `policy_changed`, `undo`, `manual`; `send_closed`                        | `committer.ts:126`; `expire.ts:30` (from `undo.ts:73`, `config/service.ts:161`, `scripts/mailbox-settings.ts:69,78,87`; `manual`: `scripts/mailbox-settings.ts:111`); `expiry.ts:97` |
| E15 | `awaiting_approval → approved` | send                                                                          | `setApproved`                                                  | —                                                                                 | `approvals.ts:79`                                                                                                                     |
| E16 | `awaiting_approval → rejected` | send                                                                          | `setRejected`                                                  | `rejected`                                                                        | `approvals.ts:118`                                                                                                                    |
| E17 | `approved → rejected`          | send                                                                          | `setRejected` (not held)                                       | `rejected`                                                                        | `approvals.ts:118`                                                                                                                    |
| E18 | `awaiting_approval → expired`  | send                                                                          | `setExpired` (via `expireSend`)                                | `timeout`, `draft_missing`, `not_notified`, `policy_changed`, `delegation_closed` | `expiry.ts:52`                                                                                                                        |
| E19 | `approved → expired`           | send                                                                          | `setExpired` (via `expireSend`, not held)                      | `held_timeout`, `delegation_closed`                                               | `expiry.ts:52`                                                                                                                        |
| E20 | `applied → undone`             | mailbox types, create_draft                                                   | `markUndone`                                                   | `undo`; `user_moved_back`; `sent`, `rejected`, `expired` (draft)                  | `apply.ts:252,342`; `triage/returned.ts:43`; `drafts.ts:311`                                                                          |

### Latent edges (a guard admits them; no caller uses them; stage 1 confirms)

L5–L8 are added in "Stage 1 result", correction 9.

- L1. `releaseAction`: `ready → approved`, `ready → applying`, `approved → ready`, `approved → applying` (the target is a parameter). A send never goes `→ ready` (CHECK).
- L2. `markApplying`: a non-send row `approved → applying`. A non-send row never is `approved` (`setApproved` needs type `send`).
- L3. `finishAction` with the default `from`: `ready → expired` (`send_closed`) and a create_draft or send `ready → applied`. No caller does it.
- L4. `markUndone`: an `applied` send `→ undone`. No type guard; no caller passes a send.

### Pair rules (two rows move together; a per-row map cannot show them)

Read with the section 'Stage 1 result': it adds callers and guard facts for these rows.

| #   | When                                                              | Then                                                                                                                                                                     | Where                                                                          |
| --- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| P1  | a send is claimed                                                 | its draft (`depends_on_action_id`) must be `applied`                                                                                                                     | `claimableWhere`, `repo.ts:364`; `send.ts` re-check (E12)                      |
| P2  | a draft (original) is claimed                                     | one of its sends must be `awaiting_approval`; else the draft ends `expired` (`send_closed`) (E8, E14)                                                                    | `repo.ts:370` (`sendWaits`), `drafts.ts:242`, `expiry.ts:97`                   |
| P3  | a draft ends `failed`                                             | its `awaiting_approval` sends expire (`draft_missing`)                                                                                                                   | `drafts.ts:99`; hourly job `listExpiredApprovals` (draft `failed` or `undone`) |
| P4  | a send ends (`applied`, `rejected`, `expired`)                    | its draft: `ready` → `expired` (`send_closed`); `applied` + UIDPLUS → a reverse row; the reverse row applied → the draft `undone` (reason `sent`, `rejected`, `expired`) | `closeDraftOfSend` (`expiry.ts`), `send.ts:202`, `drafts.ts:311`               |
| P5  | "Send again" on a `failed` send (`smtp_error`, `outcome_unknown`) | a new `approved` send row, key `<failed id>:again`; the failed row stays `failed`                                                                                        | `insertSendAgain`, `approvals.ts:240`                                          |
| P6  | a reverse row is `applied`                                        | its original `applied → undone`                                                                                                                                          | `apply.ts:252,342`, `drafts.ts:311`                                            |
| P7  | delegation hooks (`DelegationHooks`, `actions/hooks.ts`)          | send applied → delegation `sent`; send failed or expired → delegation `cancelled`; delegation closed → its reminder sends expire (`delegation_closed`)                   | `send.ts`, `expiry.ts`, `expireReminderActions`                                |

### Stage 1 result — confirmation of the tables above (step 1.1, 2026-11-11)

Method: read `actions/repo.ts` (all writer bodies), `apply.ts`, `drafts.ts`, `send.ts`, `approvals.ts`, `expiry.ts`, `expire.ts`, `undo.ts`, `triage/returned.ts`, `triage/service.ts`, `delegation/chaser.ts`, `config/service.ts`, `scripts/mailbox-settings.ts`, `composition.ts`, `packages/core/src/triage/policy.ts`. Grep of step 1.1 (command in the log) and a second grep for `updateTable("actions")`, `insertInto("actions")`, `UPDATE actions`, `INSERT INTO actions` in `apps/server/src`: every status write is in `actions/repo.ts`; no raw SQL and no other file writes `actions.status`. The other `updateTable("actions")` calls in `repo.ts` change `payload` (`setDelegationId`), `locked_at` (`claimActions`, `releaseActions`), `notified_at`, `result_notified_at`, `provider_result` only.

**Confirmed (no change):** the 10 states and the 6 types; the 13 writer functions and each guard in the "Writers" table (guard text read in `repo.ts`); entry writers; edges E1–E20 (from, to, type and reason columns); the "not status writers" list; pair rules P1–P7 (P1 `claimableWhere` `draftApplied`, P2 `sendWaits`, P3 `drafts.ts:99`, P4 `closeDraftOfSend`, P5 `insertSendAgain`, P6 `markUndone` in `apply.ts`/`drafts.ts`, P7 hooks).

**Corrections and additions (each one changes the build input):**

1. **More callers of `expireSend`** (E18, E19). The table lists only `expiry.ts:52`, which is the `setExpired` call inside `expireSend`. The callers of `expireSend` are: `approvals.ts:66` (a tap on a request older than 48 h: reason `timeout`, E18), `drafts.ts:99` (`draft_missing`, E18; P3), `expire.ts:48` (`policy_changed`, E18; `expireReady` with `filter.sends`, reached from `config/service.ts:169` through `composition.ts:72` `settingsDeps`, and in the CLI `scripts/mailbox-settings.ts` through `setMode`, `setToolSwitch` and `setCategoryAutoWithGate` at lines 69, 78, 87 with `settingsDeps` at line 45; the `expire-ready` command at line 111 calls `expireReady` with no `filter.sends`, so it never reaches `expire.ts:48` and is only an E14 `manual` caller), `expiry.ts:139` (`delegation_closed` for E18 and E19, via `expireReminderActions` ← `delegation/service.ts:161`), `expiry.ts:183` (the hourly job: `timeout`, `draft_missing`, `not_notified`, `held_timeout`). Two files that the step 1.1 file list did not name call into `actions`: `composition.ts` and `delegation/service.ts`.
2. **`closeDraftOfSend` callers** (E14 draft part, P4): `expiry.ts:69` (`expireSend`), `approvals.ts:130` (`rejectRow`, reason `rejected`), `drafts.ts:223` (end of `applyDraft`, after a reject or expiry during the APPEND; reason `rejected` or `expired`). Not only `expiry.ts:97`.
3. **More callers of `releaseAction`** (line-number style: the numbers of `releaseAction` calls in this file are the line of the call or of its `toStatus:` argument, one line apart. Call line: `apply.ts:126,164,395`, `drafts.ts:131`, `send.ts:273,299,309,344,359,455`. `toStatus:` line: the same call plus one. The Edges table and corrections 3, 4 write `apply.ts:395`, `drafts.ts:132`, `send.ts:274,300,310,345,360` and `455`; read each as the call it names, ±1 line. Re-grep `releaseAction` before you build.) (E9, E11, E12). `apply.ts:395` (no provider) and `send.ts:345` (no sender) pass `toStatus: action.status`, so they make a self-loop of the claimed status. `apply.ts:395` runs for any claimed type except `save_summary`: mailbox types `ready → ready` (E9), an `applying` draft or send `applying → applying` (E11), an `approved` send `approved → approved` (E12). Today a test covers it for none of them (see "Coverage"). `send.ts:345` is E12 (`action.status` is `approved` there, because `applying` goes to `recoverSend` first).
4. **`drafts.ts:132` (`failedWith`) is three edges, not one.** `toStatus` is `ready` only when the phase is `before_append` and the claimed `action.status` is `ready`. For a reverse row (`removeDraft`) the DB row is still `ready`: E9. For an original draft the row is `applying` in the DB (`markApplying` ran in the same call, `drafts.ts:150`) although `action.status` is the stale `ready`: E10. In all other cases `toStatus` is `applying`: E11 (also the recovery claim of an original draft with `action.status` `applying`).
5. **E1/E5 types for `create_draft` are reverse rows only.** `removeDraft` finishes a reverse row straight from `ready` (no `markApplying`): E1 (`drafts.ts:302`) and E5 (`failDraft` at `drafts.ts:74` with `bad_payload` or `hard_error`). An original draft is always `applying` before any `finishAction` (`markApplying` at `drafts.ts:150`, or the recovery claim), so `failDraft` and `closeDraft` on an original are E6 and E8, never E5. Original draft `ready → applied`, `ready → failed`, `ready → expired` by `finishAction` are latent (new latent row L8 below). In the edge table, read E1 as "mailbox types and `save_summary`; reverse `create_draft`" (the E5 row says it already).
6. **E7 callers** are `send.ts:142` (`badPayload`, reason `bad_payload`) and `send.ts:262` (`composeFailed`, third compose error, `smtp_error`). Line numbers in the table (`143,263`) are one off. E6 callers for a send: `send.ts:320` (`sendFailed`), `send.ts:423` (`unknownOutcome`), `send.ts:444` (`recoveryFailed`). E13 callers: `send.ts:300` (`auth_error`: `nextAttemptAt` null, no count) and `send.ts:310` (retry).
7. **Entry statuses by type** (for the entry rows of the map): `createPlanned` from triage: for `save_summary`, `move`, `mark_read`, `flag`, `create_draft`: `ready` or `logged`; for `send`: `awaiting_approval` or `logged` (policy gives `await_approval` only to `send`: `policy.ts:7,47`). The chaser: `create_draft` `ready`, `send` `awaiting_approval`. `insertReverse`: mailbox types (`undo.ts:51`) and `create_draft` (`expiry.ts:117`, `send.ts:202`). `insertSendAgain`: `send`, status `approved`, with `approved_at`. A `send` is never `ready` (CHECK). Test A (e) can assert that `actionStatusFor` outputs ⊆ the `createPlanned` entry statuses.
8. **Guard facts that the plan did not state** (needed for test B): `setExpired` with `from: "awaiting_approval"` has no held condition and clears `locked_at` and `next_attempt_at`; only `from: "approved"` needs `locked_at` null or before `staleBefore`. `expireStaleReady` also needs `created_at` older than `CLAIM_MAX_AGE_MS` and `reverses_action_id` null; `expireReadyOriginals` needs `reverses_action_id` null and a non-empty `filter.types` (empty list returns `[]`). `expireReadyDraft` needs type `create_draft`, `reverses_action_id` null and status `ready`. `finishAction`, `markApplying` and `releaseAction` all need `locked_at = lockedAt`; `releaseAction` has no type guard. `releaseActions` (plural) only clears the lock: it never changes status.
9. **More latent edges** (add to the "Latent edges" list; all confirmed in guard text, none has a caller):
   - L5. `finishAction` with `opts.from: ["approved"]`: `approved → applied` and `approved → expired` (`FinishNext` allows any `next`; the only caller passes `failed`).
   - L6. `finishAction` default `from` (`ready`, `applying`) for a send: `applying → expired` (`send_closed`) is possible (no caller; a send in `ready` is blocked by the CHECK).
   - L7. `markUndone` has no type guard: `applied → undone` for a `save_summary` is admitted too (no caller).
   - L8. `finishAction` default `from` for an original `create_draft`: `ready → applied`, `ready → failed`, `ready → expired` (see correction 5; the real flow always has the row `applying` first).
10. **Differences to `docs/architecture.md` §4.6** (the doc fix is stage 5): (a) `approved → rejected` (E17) is missing: §4.6 writes only `awaiting_approval → rejected`; (b) `applying → applying` (E11: draft APPEND error or send recovery error) is missing; (c) `approved → failed` (E7: `bad_payload`, or the third compose error with `smtp_error`) is missing as its own edge in §4.6. The other §4.6 lines are correct for a send: E6 includes `smtp_error` (`sendFailed` runs after `markApplying` committed, so the row is `applying`; `failSend` counts `smtp_error` when the stage is not `content`; `actions-send.test.ts` (6b), line 396, ends `failed`/`smtp_error` from `applying` on the third try), and the line `ready | approved | applying → failed (after 3 hard errors)` is right; (d) no other §4.6 failed line needs a fix: only E7 is added; (e) `applying → ready` is described as "create_draft recovery: Drafts search": it is an error before the APPEND on a row that this call started (E10); (f) `approved → approved` and `ready → ready` appear only as "same status, retry later" (E9, E12 fine); (g) §4.6 never says that `awaiting_approval` is reached only by a `send` and that `logged` is an entry-only state; (h) a send `approved` can be `expired` only for `held_timeout` and `delegation_closed` (it says so) — correct, no change.
11. **Check CHECK name** (3.1): the migration `20261104000001_triage.sql:63` writes an inline `CHECK (status IN (…))` without a name, so Postgres names it `actions_status_check` (`<table>_<column>_check`) and stores it as `status = ANY (ARRAY[…])`. Still [not verified]: no database query ran in this analysis step. Step 3.1 keeps its fallback.

## Decisions

Status of each: **user** = the user must answer before the build; **planner** = the plan session decided it, the user can change it.

- **D1 (user; answered 2026-11-11: recommendation) Scope.** Only `actions.status`, or `actions` + `delegations` (coupled by the hooks, P7)? **Recommendation: `actions` only.** `delegations` gets its own task when its module changes.
- **D2 (planner) Place of the map: `apps/server/src/modules/actions/transitions.ts`.** Why: the map describes rows that the `actions` module owns, and it names server writer functions. `bun run test:unit` already runs `apps/server/src` (`package.json`), so the map is unit-testable there without a DB. `packages/core` has no consumer of the map now. If the web needs the status list later, move only the status list to `@ea/core`.
- **D3 (user; answered 2026-11-11: recommendation) The runtime step** (the writer functions read their guard from the map, or a `canTransition` check before each write). **Recommendation: a separate follow-up task, `[risky]`**, after this task. It changes runtime code in the exactly-once area. This task only records the latent edges; the follow-up may close them.
- **D4 (user; answered 2026-11-11: recommendation, so no §4.6 line and no idea file unless the user asks) `emails.status = 'done'`.** It is in the CHECK and in §4.6 ("done = all its actions have an end status"), but no code writes it. Options: build it, delete it (migration), or leave it and write "not built" in §4.6. **Not part of this task.** Recommendation: leave it; add one line "not built yet" in §4.6 in stage 5 only if the user agrees, and a `tasks/planned/` idea.
- **D5 (user; answered 2026-11-11: no) A DB trigger that rejects illegal edges.** It needs a migration and is `[risky]`. **Recommendation: no.**
- **D6 (user; answered 2026-11-11: no) Web dialogs** (boolean flags → one status union). **Recommendation: no**, a separate small task if wanted.
- **D7 (user; answered 2026-11-11: start now, in parallel with S5d; own worktree and DB) Timing.** Update 2026-11-11: S5c is done and merged; the S5d build runs now (worktree `task/s5d-web-activity`, stages 1–3 committed). S5d decision A9 (`spec/features/done/2026-11/F053-s5d-web-activity/plan.md`) says "S5d first; `state-machine-transitions` later". S5d changes no writer of `actions.status` (its file list has no `actions/` file), so a parallel build has no code conflict; it needs its own DB (`db:worktree`) and its own session. Earlier text: The stages add new files only, so they do not conflict with `s5c-web-settings-rules` (it changes `config/service.ts` and `scripts/mailbox-settings.ts`, which call `expireReady`, but this task does not change them) or `sync-sort-folders` (stage 17, live checks only). Conflicts: `test:int` and the dev DB are shared (use the own worktree DB), and `limen-transition` can change the run procedure (`tasks/README.md`, `run-task`). **Recommendation: run it at the next change in `actions`, or in a quiet slot after the S5c build. If Limen lands first, run it as a Limen job.**
- **D8 (planner) Pair rules:** a data list `PAIR_RULES` in `transitions.ts` (id, when, then, the enforcing function, the integration test that proves it). No runtime check. Stage 1 maps each rule to an existing test; stage 5 adds a test only for a rule with none.
- **D9 (planner) Latent edges:** record them in `LATENT_EDGES`. Do not close them in this task (a guard change is a runtime change, D3). Test A checks that guard edges = design edges + latent edges, so a new latent edge fails a test.
- **D10 (planner) Test B design:** a behavior test. For each writer variant, insert one row per state (10 states, with a type that the CHECKs allow), call the function with the right claim token, and assert: the row changes exactly when its state is in the map's guard set, and the new status is the map's target. The "held" condition (`locked_at` fresh) is one extra case per writer that has it.
- **D11 (user; answered 2026-11-11: normal) Run mode:** normal (one stage at a time, review, commit). **Recommendation: normal**, because there are only 5 small stages and each needs `test:int`. Pipeline mode is possible.
- **D12 (planner) Retry self-loops** (E9, E11, E12) are edges in the map with `retry: true`. Test B must check `releaseAction`, and the follow-up runtime step must allow them.

## Not in this task

- Any change to a runtime file (D3).
- The other 14 machines of the inventory (`emails.status`, the `emails` location flags, `mailboxes.status`, `outbox.status`, `delegations.status`, link tokens, digests, notice episodes, onboarding, mailbox `mode`, `LlmPause`, Telegram polling, scheduler, web dialogs). The done-checklist adds `tasks/planned/` ideas for the top ones (location flags, `mailboxes.status`, `delegations.status`) if the user wants them.
- `emails.status = 'done'` (D4), a DB trigger (D5), the web dialogs (D6).
- A tenant-filter test for the writers (existing tests cover it; no new repository function).

## Plan

Stages: 1 analysis stage, 4 test stages. User checkpoints: after stage 1 (approve the edge table) and after stage 5 (group review, then merge). The planner subagent adds step detail to each approved stage.

### Stage 1 — Confirm the edges (no code)

- [x] **1.1 Confirm the edge table.**
  - Goal: each edge, entry and latent edge in "Facts" is confirmed or corrected from the code.
  - Files: read `apps/server/src/modules/actions/*.ts`, `triage/returned.ts`, `triage/service.ts`, `delegation/chaser.ts`, `config/service.ts`, `scripts/mailbox-settings.ts`; write only this task file (section "Facts").
  - Interfaces: none.
  - Decisions: a caller that the table does not list is a new edge row. A difference to `docs/architecture.md` §4.6 is a line in the log (the doc fix is stage 5).
  - Test: none (analysis).
  - Check: `grep -rn "finishAction\|releaseAction\|markApplying\|markUndone\|setExpired\|setApproved\|setRejected\|expireReadyDraft\|expireReadyOriginals\|expireStaleReady\|createPlanned\|insertReverse\|insertSendAgain" apps/server/src --include=*.ts` gives no caller that the tables miss.
  - Done when: each table row has the mark "confirmed" or a correction, and the log names the grep.
  - Out of scope: code changes.
- [x] **1.2 Coverage matrix.**
  - Goal: for each edge E1–E20 and pair rule P1–P7, the name of an existing integration test that runs it, or "none".
  - Files: read `apps/server/test/integration/actions-*.test.ts`, `triage-*.test.ts` (returned mail), `delegation-*.test.ts`; write this task file (new section "Coverage").
  - Interfaces: none. Decisions: a test counts only when it asserts the new status. Test: none. Check: each row has a test name or "none". Done when: the matrix is in the file. Out of scope: new tests (stage 5).
- [x] **Checkpoint 1:** the user approves the edge table and the latent edges.

### Stage 2 — The map and test A (unit)

- [x] **2.1 `transitions.ts`.**
  - Goal: the map as data, with no import of a DB or a runtime module.
  - Files: new `apps/server/src/modules/actions/transitions.ts` (about 200 lines). Not exported from `actions/index.ts` (no consumer yet).
  - Interfaces (the planner can refine the names):
    ```ts
    import type { ActionType } from "@ea/core";
    export const ACTION_STATUSES = [
      "ready",
      "applying",
      "applied",
      "awaiting_approval",
      "approved",
      "rejected",
      "expired",
      "undone",
      "logged",
      "failed",
    ] as const;
    export type ActionStatus = (typeof ACTION_STATUSES)[number];
    export const TERMINAL_STATUSES: readonly ActionStatus[]; // rejected, expired, undone, logged, failed
    export type ActionWriter =
      | "createPlanned"
      | "insertReverse"
      | "insertSendAgain"
      | "markApplying"
      | "finishAction"
      | "releaseAction"
      | "expireStaleReady"
      | "expireReadyOriginals"
      | "expireReadyDraft"
      | "setExpired"
      | "setApproved"
      | "setRejected"
      | "markUndone";
    export interface ActionEntry {
      status: ActionStatus;
      types: readonly ActionType[];
      writer: ActionWriter;
      callers: readonly string[];
    }
    export interface ActionEdge {
      id: string;
      from: ActionStatus;
      to: ActionStatus;
      types: readonly ActionType[];
      writer: ActionWriter;
      reasons: readonly string[];
      retry?: true;
      callers: readonly string[];
    } // callers = file names, no line numbers
    export interface WriterGuard {
      writer: ActionWriter;
      variant: string;
      from: Readonly<Partial<Record<ActionType, readonly ActionStatus[]>>>;
      to: readonly ActionStatus[];
      held?: "blocks";
    } // `to` = the statuses the variant can write
    export const ACTION_ENTRIES: readonly ActionEntry[];
    export const ACTION_EDGES: readonly ActionEdge[]; // E1–E20, one row per (from, to, writer)
    export const WRITER_GUARDS: readonly WriterGuard[]; // one row per writer variant (finishAction: default / ["applying"] / ["approved"]; releaseAction: per toStatus; setExpired: per from)
    export const LATENT_EDGES: readonly { from: ActionStatus; to: ActionStatus; writer: ActionWriter; why: string }[];
    export const PAIR_RULES: readonly {
      id: string;
      when: string;
      then: string;
      enforcedBy: readonly string[];
      test: string;
    }[];
    export function nextStatuses(from: ActionStatus, type: ActionType): ActionStatus[]; // from ACTION_EDGES; for tests now, for the D3 follow-up later
    ```
  - Decisions: D2, D8, D9, D12. Comments in English STE. The header comment says: "Source of truth for `actions.status` edges. A new status write must update this file; `transitions.test.ts` and `actions-transitions.test.ts` fail otherwise."
  - Test: 2.2. Check: `bun run typecheck && bun run lint`. Done when: the file holds the confirmed tables of stage 1. Out of scope: any import of this file from runtime code.
- [x] **2.2 Test A, `transitions.test.ts` (unit, no DB).**
  - Goal: the map is consistent with itself and with `@ea/core`.
  - Files: new `apps/server/src/modules/actions/transitions.test.ts` (about 100 lines).
  - Interfaces: imports `transitions.ts`; from `@ea/core`: `actionStatusFor` (`(decision: PolicyDecision) => "ready" | "awaiting_approval" | "logged"`, `packages/core/src/triage/policy.ts:55`), `type PolicyDecision` (`"apply" | "await_approval" | "log_only"`, `policy.ts:6`; no exported array of decisions, so the test writes `const DECISIONS = ["apply", "await_approval", "log_only"] as const satisfies readonly PolicyDecision[]`), and `actionTypes` (const array). `actionTypeSchema` is not exported from `@ea/core` (planner check 2026-11-11).
  - Decisions: assertions: (a) every status in an edge, entry or guard is in `ACTION_STATUSES`; (b) no edge leaves a terminal status, and `logged` has no edge; (c) every non-terminal status has an outgoing edge; (d) every status is reachable from an entry; (e) the outputs of `actionStatusFor` for all decisions are entry statuses of `createPlanned`; (f) the edges that `WRITER_GUARDS` admit = `ACTION_EDGES` ∪ `LATENT_EDGES`, both ways (D9); (g) no send edge goes to `ready` (mirror of the CHECK); (h) every type in an edge is in `actionTypes`.
  - Test: this step is the test. Check: `bun run test:unit` passes. Done when: a removed edge or an added guard status in a local try makes the test fail (write the try in the log, then undo it). Out of scope: DB access.

### Stage 3 — Test C (schema) and test B part 1 (committer writers)

- [x] **3.1 Test C, schema.**
  - Goal: the status and type lists of the map equal the CHECK lists in Postgres.
  - Files: new `apps/server/test/integration/actions-transitions.test.ts` (first `describe`, about 50 lines).
  - Interfaces: `` sql`SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'actions'::regclass AND contype = 'c'`.execute(trx) ``; read the quoted values with `/'([a-z_]+)'::text/g`. Correction (planner check 2026-11-11): select the two list CHECKs by name, not by "the definition names `status`": `actions_applied_at_check`, `actions_send_approved_check` and `actions_send_never_ready_check` also name `status` and quote `applied`, `undone`, `approved`, `applying`, `ready`. The type CHECK is `actions_type_check`. The status CHECK has the Postgres default name, expected `actions_status_check` [not verified]; if no row has that name, pick the one CHECK whose def starts with `CHECK ((status = ANY (ARRAY[` and write the real name in the log. Model for a `pg_constraint` query: `web-schema.test.ts:130` (it reads `conname` only; no test reads `pg_get_constraintdef` yet).
  - Decisions: compare as sorted sets. Also assert one insert with an unknown status fails with `23514`. A failed statement aborts the whole `withRollback` transaction: run the failing insert inside a savepoint. Copy the local helper `expectCode(trx, name, run, code)` from `actions-schema.test.ts:68` (`savepoint` → `expect(run()).rejects.toMatchObject({ code })` → `rollback to savepoint`); it is not exported. Imports: `testDb`, `withRollback` from `./helpers`; `createOrgWithMailbox`, `insertTestEmail`, `insertAction` from `./fixtures`; `sql` from `kysely`.
  - Test: this step. Check: `bun test apps/server/test/integration/actions-transitions.test.ts`, then the full `bun run test:int`. Note: `bun run test:int -- actions-transitions` does not narrow the run (Bun ORs the path filters, and `apps/server/test` matches all files). Done when: it passes. Out of scope: other tables.
- [x] **3.2 Test B part 1: `markApplying`, `finishAction`, `releaseAction`.**
  - Goal: the guard rows of these writers in `WRITER_GUARDS` equal the real behavior.
  - Files: `apps/server/test/integration/actions-transitions.test.ts` (about 200 lines).
  - Interfaces: a table-driven helper `checkWriter(guard, call)` with `call: (trx: Transaction<DB>, ctx: TenantContext, row: { id: string; emailId: string; lockedAt: Date }) => Promise<boolean>`: for each status in `ACTION_STATUSES` and each type in the guard (rows that a CHECK forbids are skipped and listed), insert a row with `insertAction(trx, ctx, emailId, { type, status, lockedAt: token, approvedAt })` (email from `insertTestEmail(trx, ctx, mailboxId)`, org from `createOrgWithMailbox(trx)` → `{ orgId, userId, mailboxId }`, `ctx = { orgId }`; `appliedAt` defaults to the creation time for `applied`/`undone`), call the writer, read `status`, and assert `changed === guard.from[type].includes(status)` and the new status. Also one call with a wrong token: no change.
  - Real signatures (`actions/repo.ts`, planner check 2026-11-11; all three are exported from `../../src/modules/actions`): `markApplying(db, ctx, id, lockedAt, opts?: { outgoingMessageId? })`; `finishAction(trx, ctx, id, lockedAt, next: FinishNext, opts?: { from?: readonly ("ready" | "approved" | "applying")[] })` with `FinishNext` = `{ status: "applied"; at }` | `{ status: "failed"; at; reason; lastError?; countAttempt?; providerResult? }` | `{ status: "expired"; at; reason: "send_closed" }`; `releaseAction(db, ctx, id, lockedAt, opts: { toStatus: "ready" | "approved" | "applying"; nextAttemptAt: Date | null; countAttempt: boolean; now: Date; lastError? })`. All return `Promise<boolean>`.
  - CHECK facts for the rows (planner check 2026-11-11): give every `send` row `approvedAt` (`actions_send_approved_check` rejects a send in `approved`, `applying`, `applied` without it; it is legal in every status). Skip `send` × `ready` (`actions_send_never_ready_check`). `releaseAction` with `toStatus: "ready"` on a `send` row that the SQL guard admits (`approved`, `applying`) does not return `false`: the UPDATE fails with `23514` (`actions_send_never_ready_check`). The map's `WRITER_GUARDS` row for that variant has no `from` statuses for `send`; the test expects `23514` for those two rows and `false` for the other send rows. A failed statement aborts the transaction: run each case in a savepoint (the `expectCode` pattern from 3.1) or in its own `withRollback`.
  - Decisions: D10. Variants: `finishAction` default `from` × (`applied`, `failed`, `expired`), `from: ["applying"]`, `from: ["approved"]`; `releaseAction` × each `toStatus`; `markApplying` for send and for create_draft.
  - Test: this step. Check: `bun run test:int`. Done when: it passes, and a local change of one guard row makes it fail (log it, then undo). Out of scope: the provider and SMTP paths (the existing `actions-send` and `actions-drafts` tests cover them).

### Stage 4 — Test B part 2 (close, approval, undo and entry writers)

- [x] **4.1 Send and draft close writers: `setExpired`, `setApproved`, `setRejected`, `expireReadyDraft`.**
  - Goal: as 3.2, for these writers, with the "held" case (`locked_at` fresh vs null or older than `STALE_AFTER_MS`) for `setExpired` (from `approved`) and `setRejected`.
  - Files: `actions-transitions.test.ts` (about 130 lines). Interfaces: `checkWriter` from 3.2. These four functions are not exported from `actions/index.ts`: import them from `../../src/modules/actions/repo` (precedent: `actions-drafts.test.ts`). `STALE_AFTER_MS` (10 min) comes from `../../src/modules/actions` (`constants.ts`). Real signatures (planner check 2026-11-11), all `(trx: Transaction<DB>, ctx, id, …) => Promise<boolean>`: `setExpired(trx, ctx, id, { reason: string; at; from: "awaiting_approval" | "approved"; staleBefore })`; `setApproved(trx, ctx, id, { userId; via; at })` (`approved_by` references `users`: use the `userId` from `createOrgWithMailbox`); `setRejected(trx, ctx, id, { at; staleBefore })`; `expireReadyDraft(trx, ctx, id, at)`. The test passes `staleBefore = now − STALE_AFTER_MS`; "held" = `lockedAt` after `staleBefore`. Decisions: D10; rows of type `send` for the first three, `create_draft` (original) for `expireReadyDraft`. Test/Check: `bun run test:int`. Done when: it passes. Out of scope: the cascade (`expireSend`, P3–P4; stage 5).
- [x] **4.2 Batch and undo writers: `expireStaleReady`, `expireReadyOriginals`, `markUndone`; entry writers.**
  - Goal: as 3.2; and each entry writer writes only the entry statuses of the map.
  - Files: `actions-transitions.test.ts` (about 150 lines).
  - Interfaces: rows old enough for `expireStaleReady` (`createdAt` before `CLAIM_MAX_AGE_MS`), one mailbox, `reverses_action_id` null; `expireReadyOriginals` with `{ mailboxId, types: MAILBOX_ACTION_TYPES }`; `markUndone` for each status. Entry writers: `createPlanned` with each `actionStatusFor` output, `insertReverse`, `insertSendAgain` (with an `applied` draft) → read the new row's status.
  - Real signatures (planner check 2026-11-11): `expireStaleReady(db, ctx, mailboxId, { now; staleBefore })` and `expireReadyOriginals(trx, ctx, filter: ExpireFilter, { now; staleBefore; reason: "policy_changed" | "undo" | "manual" })` (`ExpireFilter` = `{ mailboxId; emailId?; types: readonly MailboxActionType[]; category?; sends? }`) return `{ id, emailId, type }[]`, not a boolean: the `call` of `checkWriter` returns `rows.some((r) => r.id === row.id)`. Both have the not-held guard (`locked_at` null or before `staleBefore`): add the held case (D10). `markUndone(trx, ctx, originalId, { at; reason: "undo" | "user_moved_back" | "sent" | "rejected" | "expired" })` → boolean. `CLAIM_MAX_AGE_MS` (24 h), `MAILBOX_ACTION_TYPES`, `expireStaleReady`, `expireReadyOriginals`, `markUndone`, `createPlanned`, `insertReverse`, `getSend` are exported from `../../src/modules/actions`; `insertSendAgain` only from `../../src/modules/actions/repo`.
  - Entry writer signatures: `createPlanned(db, ctx, emailId, items: PlannedActionInput[])` with `PlannedActionInput` = `{ type; payload; status: "ready" | "awaiting_approval" | "logged"; idempotencyKey; dependsOn?: "create_draft" }`; returns only the inserted rows. Use a mailbox type (for example `move`) for the three `actionStatusFor` outputs; a `send` item needs `dependsOn: "create_draft"` and the key `` `${emailId}:send` `` with its draft (`` `${emailId}:create_draft` ``) in the same call or already in the DB, else it throws `HardError("send needs its draft")`; a `send` with `ready` breaks the CHECK, so do not test it. `insertReverse(trx, ctx, { id, emailId, type, payload })` → the new id or null. `insertSendAgain(trx, ctx, previous: SendRow, { userId; via; at })` → the new id or null: build the failed send with `insertDraftAndSend(trx, ctx, mailboxId, { sendStatus: "failed", approved: { userId, at } })`, then `previous = await getSend(trx, ctx, sendId)`.
  - Decisions: D10. Test/Check: `bun run test:int`. Done when: it passes. Out of scope: the audit rows (existing tests).

### Stage 5 — Pair rule tests, docs, close

- [x] **5.1 Pair rules without a test.**
  - Goal: each P1–P7 names a test in `PAIR_RULES.test`; add a test only where the stage 1 matrix says "none".
  - Files: `actions-transitions.test.ts` (new `describe("pair rules")`, at most 150 lines), `transitions.ts` (`PAIR_RULES.test` values).
  - Interfaces: `insertDraftAndSend`, `expireSend`, `closeDraftOfSend` from the existing modules. Real signatures (planner check 2026-11-11; both exported from `../../src/modules/actions`): `expireSend(trx, ctx, sendId, { reason: SendCloseReason; now; actor: string; hooks: DelegationHooks; uidplus: boolean }) => Promise<boolean>` (`SendCloseReason` = `timeout | draft_missing | not_notified | held_timeout | policy_changed | delegation_closed`; an `approved` send closes only for `held_timeout`, `delegation_closed`); `closeDraftOfSend(trx, ctx, draftId, { reason: "sent" | "rejected" | "expired"; now; uidplus }) => Promise<"reverse" | "expired" | "none">`. Use `noDelegationHooks` for `hooks`. Decisions: D8. Test: this step. Check: `bun run test:int`. Done when: no `PAIR_RULES.test` is empty. Out of scope: the delegation side of P7 beyond the hook call (the `delegation` module tests own it).
- [x] **5.2 Docs.**
  - Goal: the docs name the map and the rule.
  - Files: `docs/architecture.md` §4.6 (one line under `actions.status`: "Code map: `apps/server/src/modules/actions/transitions.ts`; tests compare it with the guards"; and the corrections from the stage 1 log, for example E11 `applying → applying`), `docs/code-patterns.md` § Data access (one rule: "A function that changes `actions.status` gets a row in `actions/transitions.ts` and a case in `actions-transitions.test.ts`."), `docs/modules.md` only if it lists the `actions` files.
  - Interfaces: none. Decisions: D4 line only if the user agreed. Test: none. Check: `bun run lint` (Prettier on Markdown, if configured). Done when: the lines are there. Out of scope: docs of other machines.
- [x] **Group review** of stages 1–5 (reviewer, `git diff master...task/state-machine-transitions`), then **checkpoint 2**: the user approves the merge.

## Coverage (step 1.2, 2026-11-11)

Method: read the test titles of `apps/server/test/integration/actions-*.test.ts`, `triage-returned.test.ts`, `delegation-*.test.ts`, `config-settings.test.ts`, and the status assertions in the tests named below. A test counts only when it asserts the new status in the row (not only the outcome kind). "Direct" = the test calls the writer or the path that the edge uses. Names are `file › test title` (the title is the text of `test("…")`; line numbers are for the title and can move). Short names: `repo` = `actions-repo.test.ts`, `drafts` = `actions-drafts.test.ts`, `send` = `actions-send.test.ts`, `appr` = `actions-approvals.test.ts`, `close` = `actions-close.test.ts`, `expiry` = `actions-expiry.test.ts`, `apply` = `actions-apply.test.ts`, `move` = `actions-move.test.ts`, `committer` = `actions-committer.test.ts`, `undo` = `actions-undo.test.ts`, `config-settings` = `config-settings.test.ts`. The `delegation-chaser` statuses (draft `ready`, send `awaiting_approval`) are verified in `delegation-chaser.test.ts` lines 253 and 268.

### Edges

| #   | Test that asserts the new status | Note |
| --- | --- | --- |
| E1  | `apply › save_summary is applied without a provider call` (148); `apply › flag and mark_read set the IMAP flag and record the UID` (171); `move › (1) a COPY with a new UID…` (159); reverse `create_draft`: `drafts › the reverse row removes the draft and marks the original undone with the reason` (593); reverse flag: `apply › a reverse flag removes the flag and marks the original undone` (432) | covered |
| E2  | `repo › 7: markApplying moves a claimed ready draft…` (1606); `drafts › crash after the APPEND…` (209, asserts `applying` at 229) | covered |
| E3  | `repo › 7: markApplying needs the token and the status approved or ready` (1583); `send › the row is committed as applying with the outgoing id before the SMTP call` (582) | covered |
| E4  | draft: `drafts › a delegation draft becomes one message in Drafts…` (178, asserts `applied` at 195 after E2); send: `send › (1) the happy path…` (232); `repo › 8: finishAction from applying: applied…` (1616); recovery: `send › (16) a copy in Sent proves the send: the recovery ends applied` (697) | covered |
| E5  | mailbox types: `apply › a mail that is not in the folder fails with mail_not_found` (342); `move › (7)` (262), `move › (11)` (315); reverse draft: `drafts › a hard error three times: failed…` (656) | covered. No test for `bad_payload` on a reverse `create_draft` row |
| E6  | draft: `drafts › three hard APPEND errors fail the draft and expire its send` (285), `drafts › a bad payload fails the draft and expires its send` (329); send: `send › (5)` (353), `(6)` (378), `(7)` (455), `(15)` (661), `(17)` (722), `(23)` (792); `repo › 8…` (`two`, 1616) | covered |
| E7  | `send › (6d) a compose error three times fails with stage compose…` (433); `send › (11b) a bad send payload fails as bad_payload from approved…` (541); `repo › 8…` (`three`, `from: ["approved"]`) | covered |
| E8  | `drafts › a dead send: no APPEND, the draft expires with send_closed` (438); `repo › 8…` (`four`) | covered |
| E9  | mailbox: `apply › a soft error releases the action without an attempt` (370, asserts `ready`), `apply › the third hard error fails the action` (393, asserts `ready` with `attempts` 1 and 2 at line 412); reverse draft: `drafts › a hard error three times…` (656, asserts `ready` + `attempts` at 668); `repo › releaseAction counts an attempt on request and keeps the row ready` (451) | covered. `apply.ts:395` (no provider, any type): none |
| E10 | none | no test makes an original draft go `applying → ready` (error before the APPEND, `drafts.ts:132` with `action.status` `ready`) |
| E11 | draft: `drafts › a soft APPEND error keeps the row applying; the next claim appends once` (265); send: `send › (23)` (792), `send › (23b)` (821) | covered. `apply.ts:395` for an `applying` row: none |
| E12 | `send › without a sender an approved row is released unchanged with no count` (566) | covered for `send.ts:345`. `send.ts:274` (compose retry, tries 1 and 2): no assert on the status in `(6d)`. `send.ts:360` (draft not applied): none (`claimableWhere` blocks it; it is a race branch) |
| E13 | `send › (4) a soft connect error retries after 5 min…` (334); `send › (6b)` (396, asserts `approved` + `attempts` 1, 2); `send › (6c)` (418); `send › (8) an auth error gives the row back as approved and unlocked` (478); `repo › 9: releaseAction sets toStatus…` (1676) | covered |
| E14 | stale: `committer › a ready move older than 24 h expires with an audit row…` (439), `repo › expires old ready originals of mailbox types only` (514); `policy_changed`: `config-settings` (`move`, `mark_read`, `flag` → `expired`, lines 257–261, 295, 318, 388); `undo`: `undo › (6c) a ready original in a retry wait is expired by the Undo` (302); `send_closed` draft: `appr › no UIDPLUS: no reverse row; a ready draft is expired` (229), `close › no UIDPLUS…` (164), `expiry › (4b) timeout with a ready draft: the draft expires, no reverse row` (185) | covered for `stale`, `policy_changed`, `undo`, `send_closed`. `manual` with rows: none (`config-settings.test.ts:502` and `repo:1135,1198` use `manual` only for an empty type list or another org; the CLI `mailbox-settings.ts:111` has no test) |
| E15 | `appr › awaiting_approval → approved with the approval fields and an audit row…` (93); `appr › approveSet approves the notified awaiting rows and skips the rest` (271) | covered |
| E16 | `appr › awaiting_approval with an applied draft → rejected, a reverse draft row, the delegation cancelled` (190); `appr › rejectSet rejects the notified awaiting rows…` (316) | covered |
| E17 | `appr › an approved send: rejected when unlocked or stale, already when a run holds it` (248) | partial: the test asserts the result kind `rejected` for the unlocked and the stale row, and the status only for the held row (`approved`). It does not read the status `rejected` of the free row. Stage 4.1 covers it |
| E18 | `expiry › (1) timeout…` (97), `(3)` (131), `(4)` (170); `appr › a notified request older than 48 h is expired on the spot, never approved` (119); `close › an awaiting_approval delegation send with an applied draft, UIDPLUS` (128); `config-settings` helper at line 420 (`policy_changed`); `delegation-service › markAnswered: answered, the reminder send expired…` (`delegation_closed`) | covered for `timeout`, `draft_missing`, `not_notified`, `policy_changed`, `delegation_closed` |
| E19 | `expiry › (6) held_timeout…` (222); `close › an approved send` (217); `close › closes the open reminder sends with their drafts` (321, `delegation_closed` on an `approved` send) | covered |
| E20 | `undo`: `apply › a reverse flag removes the flag and marks the original undone` (432, reason `undo`); `move › (8) the mail goes back to INBOX and the original is undone` (511); `user_moved_back`: `triage-returned › a user move back gives one imap_move feedback row and marks the move undone` (102); draft `sent`: `drafts › the reverse row removes the draft…` (593); draft `rejected`: same file, line 630 | covered for `undo`, `user_moved_back`, `sent`, `rejected`. Draft reason `expired`: none asserts the original `undone` with reason `expired` (the reverse payload reason `expired` is asserted in `close:363`) |

### Entry writers

| Writer | Test | Note |
| --- | --- | --- |
| `createPlanned` (`ready`, `awaiting_approval`, `logged`) | `triage-service.test.ts` (policy cases), `repo › createPlanned with dependsOn…` (1226 and next), `delegation-chaser.test.ts` | statuses asserted per policy decision in triage-service; not re-read in detail |
| `insertReverse` | `undo › (1) every applied mailbox action gets a reverse row…` (153); `expiry › (1)` (109–112, status `ready`); `send › (1)` (272, `ready`) | covered |
| `insertSendAgain` | `appr › a failed send with an applied draft gets one new approved send…` (372, asserts `approved`) | covered |

### Latent edges (a test that proves the guard admits or blocks them)

| Latent edge | Test | Note |
| --- | --- | --- |
| `markApplying`: non-send `approved → applying` | `repo › 7: markApplying needs the token…` checks only a send | none |
| `releaseAction` target variants | `repo › 9` checks `applying → approved`; `repo › releaseAction counts an attempt…` checks `ready → ready` | `ready → approved`, `ready → applying`, `approved → ready`, `approved → applying`: none. Test B (stage 3.2) is the first test |
| `finishAction` default `from`: `ready → applied/expired` | none | |
| `markUndone` of a send or a `save_summary` | `repo` cross-org case only | none |

### Pair rules

| #  | Test | Note |
| -- | --- | --- |
| P1 | `repo › 2: an approved send with an applied draft is claimed with the mail fields` (1341); `repo › 1: a ready draft is claimed while its send waits; the send is not` (1328); `appr › a send whose draft is not applied is refused…` (140, the approval side) | the claim side is covered. The `send.ts` re-check branch (E12, `send.ts:360`): none |
| P2 | `repo › 1` (1328), `repo › 3: a draft waits for its send to wait too…` (1379), `repo › 3b: a ready draft whose send ended is not claimed or counted…` (1395); end: `drafts › a dead send: no APPEND, the draft expires with send_closed` (438); `expiry › (4b)` (185) | covered |
| P3 | `drafts › three hard APPEND errors fail the draft and expire its send` (285), `drafts › a bad payload fails the draft and expires its send` (329); hourly job: `expiry › (3) failed draft: draft_missing…` (131), `(3a)` (145) | covered |
| P4 | send applied → draft reverse row: `send › (1)` (232); rejected: `appr › … → rejected, a reverse draft row…` (190); expired: `expiry › (1)` (97); `close › twice on an applied draft: one reverse row` (267); `drafts › a reject during the APPEND: the final transaction inserts the one reverse row` (489); reverse applied → draft `undone`: `drafts › the reverse row removes the draft…` (593, `sent`; `rejected` at 630) | covered. Reason `expired` ending `undone`: none |
| P5 | `appr › a failed send with an applied draft gets one new approved send; a second tap → already` (372) | covered (the test asserts that the failed row stays `failed`: not read in detail; stage 5.1 re-checks) |
| P6 | `apply › a reverse flag removes the flag and marks the original undone` (432); `move › (8)` (511); `drafts › the reverse row removes the draft…` (593) | covered |
| P7 | send applied → delegation `sent`: `send › (14) triage, draft, approval, send, the delegation is sent…` (870, asserts `delegation.status` `sent` at 976); send failed → cancelled: `send › (5)` (353, asserts `calls.cancelled` `send_failed`); expired → cancelled: `expiry › (1)` (114); reject → cancelled: `appr › … → rejected, …the delegation cancelled` (190); delegation closed → reminder sends expire: `delegation-service › markAnswered…` (`delegation_closed`) and `close › closes the open reminder sends with their drafts` (321) | covered |

### Gaps summary (input for stages 3–5)

- No test at all: E10; `releaseAction` and `markApplying` latent targets; `apply.ts:395` self-loops; E14 reason `manual` with rows; reverse-draft `bad_payload` (E5); `markUndone` of a draft with reason `expired` (E20, P4); `send.ts:360` (E12 / P1 re-check).
- Partial: E17 (status of the free `approved` row not read); E12 compose retry `send.ts:274`.
- Test B (stages 3–4) covers every guard variant of the 13 writers, so the gaps for the writer variants close there. The gaps that test B cannot close (they need the caller path: E10 through `failedWith`, `apply.ts:395`, `send.ts:360`, `manual` through the CLI) stay "none" in `PAIR_RULES`/`ACTION_EDGES` `callers` comments; stage 5.1 adds a test only for a pair rule (P-numbers have no `none` except the P1 `send.ts` re-check branch).

## Questions for the user

None.

## Not verified

- The Postgres default name of the inline status CHECK is `actions_status_check` (step 3.1 has a fallback).

## Done-checklist

- [x] Done-when checks pass (name the command and its output in the log).
- [x] `docs/` describe what was built (architecture §4.6, code-patterns); related ADRs: none.
- [x] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [x] Follow-up ideas are in `planned/`: the runtime step (D3), and, if the user wants them, the next machines (`emails` location flags, `mailboxes.status`, `delegations.status`) and D4.

## Log

- 2026-11-11: plan written from the handoff `notes/2026-11-11-handoff-state-machine-plan.md`. The handoff claims were checked against the code (read only, nothing run). Differences: (1) `repo.ts:~1050` is `expireReadyOriginals` (reasons `policy_changed`, `undo`, `manual`; callers `expire.ts` ← `undo.ts`, `config/service.ts`, `scripts/mailbox-settings.ts`), not `expireReadyDraft` (that is `repo.ts:1292`); the handoff's writer list missed `expireReadyOriginals`. (2) `applying → expired (send_closed)` is written by `finishAction` (`drafts.ts:242`), not by `repo.ts:1300`. (3) The inventory missed the edges `approved → failed` (`send.ts`, `from: ["approved"]`) and `applying → applying` (`drafts.ts:132`, `send.ts:455`), and the retry self-loops. (4) `markUndone` has callers outside `actions`: `triage/returned.ts:43` (`user_moved_back`); also `drafts.ts:311` (`sent`, `rejected`, `expired`). (5) `delegation/chaser.ts:160` writes entry statuses without `actionStatusFor`. (6) `actions-schema.test.ts` does not read the CHECK list; `web-schema.test.ts:130` reads `pg_constraint`. (7) `test:unit` runs `apps/server/src`, so the map can stay in the `actions` module (D2). `git status`: as the handoff says (the inventory, the handoff note and other work untracked).
- 2026-11-11: the user approved the plan ("ok, so i approve it"), read as all recommendations (D1, D3–D6, D11). D7 timing is open: S5d A9 says S5d first. Build handoff written: `~/.pi/agent/notes/2026-11-11-handoff-state-machine-build.md`.
- 2026-11-11: the user answered D7 ("proceed", then "proceed until you finish whole implementation plan / corrections of it"): start now, in parallel with S5d. Task moved to `tasks/active/`.
- 2026-11-11: planner check of the step detail against the code (read only: `fixtures.ts`, `helpers.ts`, `actions/repo.ts`, `actions/expiry.ts`, `actions/index.ts`, `@ea/core`, migrations). Corrections: `actionTypeSchema` is not in `@ea/core` (use `actionTypes`); CHECK names (`actions_send_approved_check`, `actions_type_check`) and 3.1 selects the list CHECKs by name; `releaseAction` to `ready` on an admitted send row fails with `23514` (savepoint per case); `setExpired`, `setApproved`, `setRejected`, `expireReadyDraft`, `insertSendAgain` are only in `actions/repo`; batch writers return rows, not booleans; held case for `expireStaleReady`, `expireReadyOriginals`; `bun run test:int -- <name>` does not narrow the run. Real signatures added to 3.2, 4.1, 4.2, 5.1. Fixture option names were right.
- 2026-11-11: stage 1, steps 1.1 and 1.2 (implementer, analysis only; only this file changed). Command of 1.1: `grep -rn "finishAction\|releaseAction\|markApplying\|markUndone\|setExpired\|setApproved\|setRejected\|expireReadyDraft\|expireReadyOriginals\|expireStaleReady\|createPlanned\|insertReverse\|insertSendAgain" apps/server/src --include=*.ts` (ERE variant `-E`). Result: no status-writer caller outside the files that the tables and the step list name, plus `composition.ts` and `delegation/service.ts` (they call `expireReady` and `expireReminderActions`, not a repo writer). A second grep (`updateTable("actions")`, `insertInto("actions")`, `UPDATE actions`, `INSERT INTO actions`) finds status writes only in `actions/repo.ts`. All 20 edges, 3 entry writers, 13 writers and 7 pair rules are confirmed; the corrections (1–11) are in "Stage 1 result"; the matrix is in "Coverage". No code changed, nothing ran except grep/read commands. Boxes 1.1, 1.2 are left for the main agent to tick.
- 2026-11-11: stage 1 reviewed: FAIL (correction 10 wrong about E6 `smtp_error`; 4 minor) → fixed → PASS (3 minor, fixed by the main session). Grep of step 1.1 found no missing writer caller. Checkpoint 1: the user said "proceed until you finish whole implementation plan / corrections of it", so the main session accepts the confirmed edge table and L1–L8 without a stop.
- 2026-11-11: stage 2 built: `transitions.ts` (`WRITER_GUARDS.from` per type; `LatentEdge.types`; E14 split into E14a/b/c, one per writer; more latent edges than L1–L8, each checked against `repo.ts` by the reviewer: `markApplying` `ready → applying` for mailbox types, `finishAction` `applying → *` for mailbox types and send `applying → expired`, `releaseAction` `applying → ready|applying` for mailbox types and send `approved → applying`, `finishAction` `ready → failed` for `save_summary`). Test A has 13 tests. Mutation tries (undone): M1 remove E15 → test (f) and `nextStatuses` fail; M2 add `approved` to the `setApproved` guard → test (f) fails. Deviation: "retry edge" means "written by `releaseAction`" (E10, E13 change the status). Review: PASS (2 minor comments fixed). Check: `bun run lint && bun run typecheck && bun run test:unit` → 1673 pass, 0 fail.
- 2026-11-11: stage 3 built: `actions-transitions.test.ts` with test C (`actions_status_check` exists by that name; status and type lists equal the map; `bogus` → `23514`) and test B part 1 (`checkWriter` reads the expected result from `WRITER_GUARDS`; `markApplying`, `finishAction` 3 variants × 3 outcomes, `releaseAction` × 3 targets; only skip `send × ready`; `releaseAction` to `ready` on send `approved|applying` → `23514` in a savepoint). Mutation try (undone): remove `approved` from `markApplying` `create_draft` → 1 fail. Review: PASS (1 minor savepoint name and 1 comment fixed). Check: `bun test apps/server/test/integration/actions-transitions.test.ts` → 15 pass; `bun run test:int` → 1226 pass, 0 fail; lint, typecheck pass.
- 2026-11-11: stage 4 built: test B for `setExpired`, `setApproved`, `setRejected`, `expireReadyDraft`, `expireStaleReady`, `expireReadyOriginals` (each reason), `markUndone`, and the entry writers (`createPlanned`, `insertReverse`, `insertSendAgain`, expected statuses from `ACTION_ENTRIES`). `checkWriter` has `lock: "token" | "free" | "fresh"`; with `free` each admitted row is also driven with a fresh lock (blocks only when `held: "blocks"`) and a stale lock. `setRejected` `from "approved"` runs on the `approved` status only (the other variant covers `awaiting_approval`). Mutation try (undone): remove `held: "blocks"` from `setRejected` `from "approved"` → 1 fail. Review: PASS. Minor points not done (optional): `status_reason` not asserted per `expireReadyOriginals` reason; no boundary row `locked_at = staleBefore`; the `reverses_action_id IS NULL` guard of `expireReadyDraft` and `expireStaleReady` has no field in the map and no reverse-row case. Check: `bun test apps/server/test/integration/actions-transitions.test.ts` → 29 pass; `bun run test:int` → 1240 pass, 0 fail; lint, typecheck pass.
- 2026-11-11: stage 5 built: P1 re-check test in `actions-send.test.ts` (draft not `applied` → send released `approved`, no attempt, no SMTP call) and P4 reason `expired` test in `actions-drafts.test.ts` (deviation: they sit next to the local helpers of those files, not in `actions-transitions.test.ts`). Every `PAIR_RULES.test` names real tests; test A checks the format. A first version read test files with `readFileSync` (breaks the "no source text" rule): the main session sent a fix round; the check is now pure data in `transitions.test.ts`. Docs: §4.6 code-map line, E7 `approved → failed`, E17 `approved → rejected`, E11 `applying → applying`, E10 `applying → ready` wording; `code-patterns.md` rule; `modules.md` line. No D4 line. Review: PASS (1 comment fixed). Check: `bun run test:int` → 1242 pass, 0 fail; `bun run test:unit`, lint, typecheck pass.
- 2026-11-11: group review of stages 1–5 (`eac7146..05d06ee`): PASS. Each "Done when" item checked; `git diff eac7146 --stat -- apps/server/src` shows only `transitions.ts` and `transitions.test.ts`. Minor limits recorded in `spec/features/planned/F068-actions-transitions-runtime/plan.md`: a brand-new writer function fails no test (only the code-patterns rule covers it); `PAIR_RULES.test` is checked for format only; the `reverses_action_id IS NULL` guard has no map field. Done-checklist: follow-up idea `spec/features/planned/F068-actions-transitions-runtime/plan.md` (D3); facts appended to `notes/2026-11-11-implicit-state-machines.md`; no new alert; no ADR. Ideas for the other machines: not written (the user did not ask). Checkpoint 2: the user said "proceed until you finish whole implementation plan", so the main session merges without a separate stop.
