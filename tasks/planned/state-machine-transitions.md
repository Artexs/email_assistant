> **Status 2026-11-11 — planned.** The plan is written. The user did not approve the stages yet. The user must also answer the open decisions D1, D3–D7 and D11. No code is changed. Left: the user's approval, then stages 1–5.

# Explicit state machine for `actions.status`

Scope: user request 2026-11-11 ("find all of the implicit state machines in my app", then "prepare … an implementation plan for … this refactor"). Inventory: [`notes/2026-11-11-implicit-state-machines.md`](../../notes/2026-11-11-implicit-state-machines.md). Handoff: [`notes/2026-11-11-handoff-state-machine-plan.md`](../../notes/2026-11-11-handoff-state-machine-plan.md). Needs: nothing. See D7 for the timing.

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
- Types (6): `move, mark_read, flag, save_summary, create_draft, send` (`20261108000001_delegation.sql`; `actionTypeSchema` in `@ea/core`).
- CHECKs on edges: `actions_applied_at_check` (`applied`, `undone` need `applied_at`; `20261107000001_assist_actions.sql:3`), `actions_send_never_ready_check` and "a send in `approved`, `applying`, `applied` has `approved_at`" (`20261108000001_delegation.sql:20-21`).
- Terminal states (no edge leaves them on the same row): `rejected, expired, undone, logged, failed`. `applied` is not terminal (→ `undone`).

### Entry writers (insert a new row)

| Writer            | File                   | Status                                 | Callers                                                                                                                                                                                      |
| ----------------- | ---------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createPlanned`   | `actions/repo.ts:79`   | `ready`, `awaiting_approval`, `logged` | `triage/service.ts:232` (status from `actionStatusFor`, `packages/core/src/triage/policy.ts:55`); `delegation/chaser.ts:160` (reminder: draft `ready`, send `awaiting_approval`, hard-coded) |
| `insertReverse`   | `actions/repo.ts:838`  | `ready` (reverse row)                  | `undo.ts:51`, `expiry.ts:117` (`closeDraftOfSend`), `send.ts:202`                                                                                                                            |
| `insertSendAgain` | `actions/repo.ts:1396` | `approved` (send, key `<id>:again`)    | `approvals.ts:240`                                                                                                                                                                           |

### Writers (change the status of a row) and their guards

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

| #   | From → to                      | Types                                                                         | Writer                                                         | Reasons                                                                           | Callers                                                                                                                               |
| --- | ------------------------------ | ----------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | `ready → applied`              | move, mark_read, flag, save_summary; reverse rows (also reverse create_draft) | `finishAction` (default `from`)                                | —                                                                                 | `apply.ts:95,243,332`, `drafts.ts:302`                                                                                                |
| E2  | `ready → applying`             | create_draft (original)                                                       | `markApplying`                                                 | —                                                                                 | `drafts.ts:150`                                                                                                                       |
| E3  | `approved → applying`          | send                                                                          | `markApplying`                                                 | —                                                                                 | `send.ts:380`                                                                                                                         |
| E4  | `applying → applied`           | create_draft, send                                                            | `finishAction` (send: `from: ["applying"]`)                    | send recovery: `recovered` in `provider_result`                                   | `drafts.ts:204`, `send.ts:162`                                                                                                        |
| E5  | `ready → failed`               | mailbox types, create_draft                                                   | `finishAction`                                                 | `hard_error`, `mail_not_found`, `bad_payload`                                     | `apply.ts:138,183`, `drafts.ts:74`                                                                                                    |
| E6  | `applying → failed`            | create_draft, send                                                            | `finishAction` (send: `from: ["applying"]`)                    | `hard_error`, `bad_payload`, `smtp_rejected`, `smtp_error`, `outcome_unknown`     | `drafts.ts:74`, `send.ts:88` (via `failSend`)                                                                                         |
| E7  | `approved → failed`            | send                                                                          | `finishAction` (`from: ["approved"]`)                          | `bad_payload`, `smtp_error` (third compose error)                                 | `send.ts:88` (via `failSend` from `send.ts:143,263`)                                                                                  |
| E8  | `applying → expired`           | create_draft                                                                  | `finishAction`                                                 | `send_closed`                                                                     | `drafts.ts:242`                                                                                                                       |
| E9  | `ready → ready` (retry)        | mailbox types, create_draft                                                   | `releaseAction`                                                | soft: no count; hard: `attempts + 1`                                              | `apply.ts:126,164,395`, `drafts.ts:132`                                                                                               |
| E10 | `applying → ready` (retry)     | create_draft                                                                  | `releaseAction`                                                | error before the APPEND in a row that started in this call                        | `drafts.ts:132`                                                                                                                       |
| E11 | `applying → applying` (retry)  | create_draft, send                                                            | `releaseAction`                                                | draft: error at the APPEND; send: error in the recovery                           | `drafts.ts:132`, `send.ts:455`                                                                                                        |
| E12 | `approved → approved` (retry)  | send                                                                          | `releaseAction`                                                | no sender, draft not applied, compose error                                       | `send.ts:274,345,360`                                                                                                                 |
| E13 | `applying → approved` (retry)  | send                                                                          | `releaseAction`                                                | login error, known stage before the content                                       | `send.ts:300,310`                                                                                                                     |
| E14 | `ready → expired`              | mailbox types; create_draft                                                   | `expireStaleReady`, `expireReadyOriginals`, `expireReadyDraft` | `stale`; `policy_changed`, `undo`, `manual`; `send_closed`                        | `committer.ts:126`; `expire.ts:30` (from `undo.ts:73`, `config/service.ts:161`, `scripts/mailbox-settings.ts:61,143`); `expiry.ts:97` |
| E15 | `awaiting_approval → approved` | send                                                                          | `setApproved`                                                  | —                                                                                 | `approvals.ts:79`                                                                                                                     |
| E16 | `awaiting_approval → rejected` | send                                                                          | `setRejected`                                                  | `rejected`                                                                        | `approvals.ts:118`                                                                                                                    |
| E17 | `approved → rejected`          | send                                                                          | `setRejected` (not held)                                       | `rejected`                                                                        | `approvals.ts:118`                                                                                                                    |
| E18 | `awaiting_approval → expired`  | send                                                                          | `setExpired` (via `expireSend`)                                | `timeout`, `draft_missing`, `not_notified`, `policy_changed`, `delegation_closed` | `expiry.ts:52`                                                                                                                        |
| E19 | `approved → expired`           | send                                                                          | `setExpired` (via `expireSend`, not held)                      | `held_timeout`, `delegation_closed`                                               | `expiry.ts:52`                                                                                                                        |
| E20 | `applied → undone`             | mailbox types, create_draft                                                   | `markUndone`                                                   | `undo`; `user_moved_back`; `sent`, `rejected`, `expired` (draft)                  | `apply.ts:252,342`; `triage/returned.ts:43`; `drafts.ts:311`                                                                          |

### Latent edges (a guard admits them; no caller uses them; stage 1 confirms)

- `releaseAction`: `ready → approved`, `ready → applying`, `approved → ready`, `approved → applying` (the target is a parameter). A send never goes `→ ready` (CHECK).
- `markApplying`: a non-send row `approved → applying`. A non-send row never is `approved` (`setApproved` needs type `send`).
- `finishAction` with the default `from`: `ready → expired` (`send_closed`) and a create_draft or send `ready → applied`. No caller does it.
- `markUndone`: an `applied` send `→ undone`. No type guard; no caller passes a send.

### Pair rules (two rows move together; a per-row map cannot show them)

| #   | When                                                              | Then                                                                                                                                                                     | Where                                                                          |
| --- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| P1  | a send is claimed                                                 | its draft (`depends_on_action_id`) must be `applied`                                                                                                                     | `claimableWhere`, `repo.ts:364`; `send.ts` re-check (E12)                      |
| P2  | a draft (original) is claimed                                     | one of its sends must be `awaiting_approval`; else the draft ends `expired` (`send_closed`) (E8, E14)                                                                    | `repo.ts:370` (`sendWaits`), `drafts.ts:242`, `expiry.ts:97`                   |
| P3  | a draft ends `failed`                                             | its `awaiting_approval` sends expire (`draft_missing`)                                                                                                                   | `drafts.ts:99`; hourly job `listExpiredApprovals` (draft `failed` or `undone`) |
| P4  | a send ends (`applied`, `rejected`, `expired`)                    | its draft: `ready` → `expired` (`send_closed`); `applied` + UIDPLUS → a reverse row; the reverse row applied → the draft `undone` (reason `sent`, `rejected`, `expired`) | `closeDraftOfSend` (`expiry.ts`), `send.ts:202`, `drafts.ts:311`               |
| P5  | "Send again" on a `failed` send (`smtp_error`, `outcome_unknown`) | a new `approved` send row, key `<failed id>:again`; the failed row stays `failed`                                                                                        | `insertSendAgain`, `approvals.ts:240`                                          |
| P6  | a reverse row is `applied`                                        | its original `applied → undone`                                                                                                                                          | `apply.ts:252,342`, `drafts.ts:311`                                            |
| P7  | delegation hooks (`DelegationHooks`, `actions/hooks.ts`)          | send applied → delegation `sent`; send failed or expired → delegation `cancelled`; delegation closed → its reminder sends expire (`delegation_closed`)                   | `send.ts`, `expiry.ts`, `expireReminderActions`                                |

## Decisions

Status of each: **user** = the user must answer before the build; **planner** = the plan session decided it, the user can change it.

- **D1 (user) Scope.** Only `actions.status`, or `actions` + `delegations` (coupled by the hooks, P7)? **Recommendation: `actions` only.** `delegations` gets its own task when its module changes.
- **D2 (planner) Place of the map: `apps/server/src/modules/actions/transitions.ts`.** Why: the map describes rows that the `actions` module owns, and it names server writer functions. `bun run test:unit` already runs `apps/server/src` (`package.json`), so the map is unit-testable there without a DB. `packages/core` has no consumer of the map now. If the web needs the status list later, move only the status list to `@ea/core`.
- **D3 (user) The runtime step** (the writer functions read their guard from the map, or a `canTransition` check before each write). **Recommendation: a separate follow-up task, `[risky]`**, after this task. It changes runtime code in the exactly-once area. This task only records the latent edges; the follow-up may close them.
- **D4 (user) `emails.status = 'done'`.** It is in the CHECK and in §4.6 ("done = all its actions have an end status"), but no code writes it. Options: build it, delete it (migration), or leave it and write "not built" in §4.6. **Not part of this task.** Recommendation: leave it; add one line "not built yet" in §4.6 in stage 5 only if the user agrees, and a `tasks/planned/` idea.
- **D5 (user) A DB trigger that rejects illegal edges.** It needs a migration and is `[risky]`. **Recommendation: no.**
- **D6 (user) Web dialogs** (boolean flags → one status union). **Recommendation: no**, a separate small task if wanted.
- **D7 (user) Timing.** The stages add new files only, so they do not conflict with `s5c-web-settings-rules` (it changes `config/service.ts` and `scripts/mailbox-settings.ts`, which call `expireReady`, but this task does not change them) or `sync-sort-folders` (stage 17, live checks only). Conflicts: `test:int` and the dev DB are shared (use the own worktree DB), and `limen-transition` can change the run procedure (`tasks/README.md`, `run-task`). **Recommendation: run it at the next change in `actions`, or in a quiet slot after the S5c build. If Limen lands first, run it as a Limen job.**
- **D8 (planner) Pair rules:** a data list `PAIR_RULES` in `transitions.ts` (id, when, then, the enforcing function, the integration test that proves it). No runtime check. Stage 1 maps each rule to an existing test; stage 5 adds a test only for a rule with none.
- **D9 (planner) Latent edges:** record them in `LATENT_EDGES`. Do not close them in this task (a guard change is a runtime change, D3). Test A checks that guard edges = design edges + latent edges, so a new latent edge fails a test.
- **D10 (planner) Test B design:** a behavior test. For each writer variant, insert one row per state (10 states, with a type that the CHECKs allow), call the function with the right claim token, and assert: the row changes exactly when its state is in the map's guard set, and the new status is the map's target. The "held" condition (`locked_at` fresh) is one extra case per writer that has it.
- **D11 (user) Run mode:** normal (one stage at a time, review, commit). **Recommendation: normal**, because there are only 5 small stages and each needs `test:int`. Pipeline mode is possible.
- **D12 (planner) Retry self-loops** (E9, E11, E12) are edges in the map with `retry: true`. Test B must check `releaseAction`, and the follow-up runtime step must allow them.

## Not in this task

- Any change to a runtime file (D3).
- The other 14 machines of the inventory (`emails.status`, the `emails` location flags, `mailboxes.status`, `outbox.status`, `delegations.status`, link tokens, digests, notice episodes, onboarding, mailbox `mode`, `LlmPause`, Telegram polling, scheduler, web dialogs). The done-checklist adds `tasks/planned/` ideas for the top ones (location flags, `mailboxes.status`, `delegations.status`) if the user wants them.
- `emails.status = 'done'` (D4), a DB trigger (D5), the web dialogs (D6).
- A tenant-filter test for the writers (existing tests cover it; no new repository function).

## Plan

Stages: 1 analysis stage, 4 test stages. User checkpoints: after stage 1 (approve the edge table) and after stage 5 (group review, then merge). The planner subagent adds step detail to each approved stage.

### Stage 1 — Confirm the edges (no code)

- [ ] **1.1 Confirm the edge table.**
  - Goal: each edge, entry and latent edge in "Facts" is confirmed or corrected from the code.
  - Files: read `apps/server/src/modules/actions/*.ts`, `triage/returned.ts`, `triage/service.ts`, `delegation/chaser.ts`, `config/service.ts`, `scripts/mailbox-settings.ts`; write only this task file (section "Facts").
  - Interfaces: none.
  - Decisions: a caller that the table does not list is a new edge row. A difference to `docs/architecture.md` §4.6 is a line in the log (the doc fix is stage 5).
  - Test: none (analysis).
  - Check: `grep -rn "finishAction\|releaseAction\|markApplying\|markUndone\|setExpired\|setApproved\|setRejected\|expireReadyDraft\|expireReadyOriginals\|expireStaleReady\|createPlanned\|insertReverse\|insertSendAgain" apps/server/src --include=*.ts` gives no caller that the tables miss.
  - Done when: each table row has the mark "confirmed" or a correction, and the log names the grep.
  - Out of scope: code changes.
- [ ] **1.2 Coverage matrix.**
  - Goal: for each edge E1–E20 and pair rule P1–P7, the name of an existing integration test that runs it, or "none".
  - Files: read `apps/server/test/integration/actions-*.test.ts`, `triage-*.test.ts` (returned mail), `delegation-*.test.ts`; write this task file (new section "Coverage").
  - Interfaces: none. Decisions: a test counts only when it asserts the new status. Test: none. Check: each row has a test name or "none". Done when: the matrix is in the file. Out of scope: new tests (stage 5).
- [ ] **Checkpoint 1:** the user approves the edge table and the latent edges.

### Stage 2 — The map and test A (unit)

- [ ] **2.1 `transitions.ts`.**
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
- [ ] **2.2 Test A, `transitions.test.ts` (unit, no DB).**
  - Goal: the map is consistent with itself and with `@ea/core`.
  - Files: new `apps/server/src/modules/actions/transitions.test.ts` (about 100 lines).
  - Interfaces: imports `transitions.ts`, `actionStatusFor` and `actionTypeSchema` from `@ea/core`.
  - Decisions: assertions: (a) every status in an edge, entry or guard is in `ACTION_STATUSES`; (b) no edge leaves a terminal status, and `logged` has no edge; (c) every non-terminal status has an outgoing edge; (d) every status is reachable from an entry; (e) the outputs of `actionStatusFor` for all decisions are entry statuses of `createPlanned`; (f) the edges that `WRITER_GUARDS` admit = `ACTION_EDGES` ∪ `LATENT_EDGES`, both ways (D9); (g) no send edge goes to `ready` (mirror of the CHECK); (h) every type in an edge is in `actionTypeSchema.options`.
  - Test: this step is the test. Check: `bun run test:unit` passes. Done when: a removed edge or an added guard status in a local try makes the test fail (write the try in the log, then undo it). Out of scope: DB access.

### Stage 3 — Test C (schema) and test B part 1 (committer writers)

- [ ] **3.1 Test C, schema.**
  - Goal: the status and type lists of the map equal the CHECK lists in Postgres.
  - Files: new `apps/server/test/integration/actions-transitions.test.ts` (first `describe`, about 50 lines).
  - Interfaces: `sql\`SELECT pg*get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'actions'::regclass AND contype = 'c'\``; find the definitions that name `status`and`type`, and read the quoted values (`/'([a-z*]+)'::text/g`). Model: `web-schema.test.ts:130`.
  - Decisions: compare as sorted sets. Also assert one insert with an unknown status fails with `23514`.
  - Test: this step. Check: `bun run test:int -- actions-transitions` (or the full `bun run test:int`). Done when: it passes. Out of scope: other tables.
- [ ] **3.2 Test B part 1: `markApplying`, `finishAction`, `releaseAction`.**
  - Goal: the guard rows of these writers in `WRITER_GUARDS` equal the real behavior.
  - Files: `apps/server/test/integration/actions-transitions.test.ts` (about 200 lines).
  - Interfaces: a table-driven helper `checkWriter(guard, call)`: for each status in `ACTION_STATUSES` and each type in the guard (rows that a CHECK forbids are skipped and listed), insert a row with `insertAction` (`lockedAt` = token, `approvedAt` set for a send, `appliedAt` by the fixture), call the writer, read `status`, and assert `changed === guard.from[type].includes(status)` and the new status. Also one call with a wrong token: no change.
  - Decisions: D10. Variants: `finishAction` default `from` × (`applied`, `failed`, `expired`), `from: ["applying"]`, `from: ["approved"]`; `releaseAction` × each `toStatus`; `markApplying` for send and for create_draft.
  - Test: this step. Check: `bun run test:int`. Done when: it passes, and a local change of one guard row makes it fail (log it, then undo). Out of scope: the provider and SMTP paths (the existing `actions-send` and `actions-drafts` tests cover them).

### Stage 4 — Test B part 2 (close, approval, undo and entry writers)

- [ ] **4.1 Send and draft close writers: `setExpired`, `setApproved`, `setRejected`, `expireReadyDraft`.**
  - Goal: as 3.2, for these writers, with the "held" case (`locked_at` fresh vs null or older than `STALE_AFTER_MS`) for `setExpired` (from `approved`) and `setRejected`.
  - Files: `actions-transitions.test.ts` (about 130 lines). Interfaces: `checkWriter` from 3.2. Decisions: D10; rows of type `send` for the first three, `create_draft` (original) for `expireReadyDraft`. Test/Check: `bun run test:int`. Done when: it passes. Out of scope: the cascade (`expireSend`, P3–P4; stage 5).
- [ ] **4.2 Batch and undo writers: `expireStaleReady`, `expireReadyOriginals`, `markUndone`; entry writers.**
  - Goal: as 3.2; and each entry writer writes only the entry statuses of the map.
  - Files: `actions-transitions.test.ts` (about 150 lines).
  - Interfaces: rows old enough for `expireStaleReady` (`createdAt` before `CLAIM_MAX_AGE_MS`), one mailbox, `reverses_action_id` null; `expireReadyOriginals` with `{ mailboxId, types: MAILBOX_ACTION_TYPES }`; `markUndone` for each status. Entry writers: `createPlanned` with each `actionStatusFor` output, `insertReverse`, `insertSendAgain` (with an `applied` draft) → read the new row's status.
  - Decisions: D10. Test/Check: `bun run test:int`. Done when: it passes. Out of scope: the audit rows (existing tests).

### Stage 5 — Pair rule tests, docs, close

- [ ] **5.1 Pair rules without a test.**
  - Goal: each P1–P7 names a test in `PAIR_RULES.test`; add a test only where the stage 1 matrix says "none".
  - Files: `actions-transitions.test.ts` (new `describe("pair rules")`, at most 150 lines), `transitions.ts` (`PAIR_RULES.test` values).
  - Interfaces: `insertDraftAndSend`, `expireSend`, `closeDraftOfSend` from the existing modules. Decisions: D8. Test: this step. Check: `bun run test:int`. Done when: no `PAIR_RULES.test` is empty. Out of scope: the delegation side of P7 beyond the hook call (the `delegation` module tests own it).
- [ ] **5.2 Docs.**
  - Goal: the docs name the map and the rule.
  - Files: `docs/architecture.md` §4.6 (one line under `actions.status`: "Code map: `apps/server/src/modules/actions/transitions.ts`; tests compare it with the guards"; and the corrections from the stage 1 log, for example E11 `applying → applying`), `docs/code-patterns.md` § Data access (one rule: "A function that changes `actions.status` gets a row in `actions/transitions.ts` and a case in `actions-transitions.test.ts`."), `docs/modules.md` only if it lists the `actions` files.
  - Interfaces: none. Decisions: D4 line only if the user agreed. Test: none. Check: `bun run lint` (Prettier on Markdown, if configured). Done when: the lines are there. Out of scope: docs of other machines.
- [ ] **Group review** of stages 1–5 (reviewer, `git diff master...task/state-machine-transitions`), then **checkpoint 2**: the user approves the merge.

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture §4.6, code-patterns); related ADRs: none.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`: the runtime step (D3), and, if the user wants them, the next machines (`emails` location flags, `mailboxes.status`, `delegations.status`) and D4.

## Log

- 2026-11-11: plan written from the handoff `notes/2026-11-11-handoff-state-machine-plan.md`. The handoff claims were checked against the code (read only, nothing run). Differences: (1) `repo.ts:~1050` is `expireReadyOriginals` (reasons `policy_changed`, `undo`, `manual`; callers `expire.ts` ← `undo.ts`, `config/service.ts`, `scripts/mailbox-settings.ts`), not `expireReadyDraft` (that is `repo.ts:1292`); the handoff's writer list missed `expireReadyOriginals`. (2) `applying → expired (send_closed)` is written by `finishAction` (`drafts.ts:242`), not by `repo.ts:1300`. (3) The inventory missed the edges `approved → failed` (`send.ts`, `from: ["approved"]`) and `applying → applying` (`drafts.ts:132`, `send.ts:455`), and the retry self-loops. (4) `markUndone` has callers outside `actions`: `triage/returned.ts:43` (`user_moved_back`); also `drafts.ts:311` (`sent`, `rejected`, `expired`). (5) `delegation/chaser.ts:160` writes entry statuses without `actionStatusFor`. (6) `actions-schema.test.ts` does not read the CHECK list; `web-schema.test.ts:130` reads `pg_constraint`. (7) `test:unit` runs `apps/server/src`, so the map can stay in the `actions` module (D2). `git status`: as the handoff says (the inventory, the handoff note and other work untracked).
