> **Status 2026-11-19 — planned.** Plan base: b1003651. Two `[risky]` stages; no migration; no owner step.

# F068 plan · the `actions.status` writers take their guards from the transitions map

## Input

Task (coordinator, 2026-11-19), word for word: "Decide one shared guard helper that builds WHERE status IN (…) from WRITER_GUARDS, which latent edges L1-L8 close, and a test per closed edge; no behaviour change for E1-E20. [risky]: the send path; Opus review. No migration."

Old task (F067 D3, 2026-11-11): "The writer functions … take their guard (the `from` statuses per type) from `actions/transitions.ts`, or check `canTransition` before each write. Optionally close the latent edges L1–L8 and the extra latent edges of stage 2."

Map: `actions/transitions.ts` (data only). Writers: `actions/repo/lifecycle.ts`, `expiry.ts`, `drafts.ts`, `sends.ts`, `undo.ts`. Tests: `transitions.test.ts` (test A, static), `apps/server/test/integration/actions-transitions.test.ts` (test B: each guard row against the real writer). "E1–E20" means every `ACTION_EDGES` row, E21 and E22 included.

### Decisions

- **D1 Guard source.** Each status writer builds the `(type, status)` part of its `WHERE` from one `WRITER_GUARDS` row, in the same `UPDATE`. Reason: the check stays atomic with the write. Rejected: `canTransition` before the write (an extra read, a race between read and write unless `FOR UPDATE`); a DB trigger (a migration; the task forbids one).
- **D2 One helper, one file.** `apps/server/src/modules/actions/repo/guard.ts` holds `writerGuard` (lookup), `guardGroups` (pure) and `statusGuard` (Kysely expression). Signatures: stage 01. Each writer file resolves its rows once, at module load, into constants: an unknown row throws at import, so every test and the server start fail. Rejected: the helper in `transitions.ts` (that file stays data only; it is already 676 lines, and the planned file-size split may touch it, `spec/features/planned/F143-*`).
- **D3 The helper owns only type and status.** All other conditions stay in the writer code, unchanged: `id`, `org_id`, the claim token `locked_at`, the held rule (`staleBefore`, `ignoreLock`), `approved_at IS NOT NULL` of a send, `reverses_action_id IS NULL`, `created_at`, the mailbox, `filter.types`. Rejected: new map fields for them (the old open point "`reverses_action_id` has no map field" stays open; out of scope).
- **D4 Target-keyed rows.** A guard must depend on the target to close `ready → expired` but keep `ready → applied`. So `finishAction` gets one row per target (`to "applied"`, `to "failed"`, `to "expired"`), as `releaseAction` has per `toStatus`. The `opts.from` of `finishAction` stays as a narrowing: admitted = row ∩ (`opts.from` ?? `["ready", "applying"]`). The default narrowing stays, so a call without `from` never admits `approved`. Rejected: keep the explicit-`from` variants (they cannot express target-dependent closure).
- **D5 Two stages.** Stage 01 moves every writer to the helper, edge set unchanged; stage 02 closes edges by a data change plus tests. Reason: the behaviour change is one reviewed data diff. Rejected: one stage (refactor and closure mixed on the send path).
- **D6 Stage 01 accepts two changes on rows that never occur.** (a) `finishAction` with `from: ["approved"]` on a non-send row: today admitted (no type guard), after stage 01 refused. A non-send row is never `approved` (`setApproved` needs a send). (b) `releaseAction` `toStatus "ready"` on a send: today the guard admits and the CHECK `actions_send_never_ready_check` throws `23514`; after stage 01 it returns `false`. No caller does either (call-site list below).
- **D7 Close every representable latent edge.** Stage 02 closes all 18 `LATENT_EDGES` rows at base (70 keys: writer, type, from, to): L1–L7 and the stage-2 extras. Final rows: stage 02 table. Reason: no caller uses one (call sites below); a closed edge turns a silent wrong write into a refused update. Default; owner to confirm (questions.md 1).
- **D8 L8 stays open.** An original `create_draft` `ready → applied` or `ready → failed` through `finishAction` stays admitted: the map cannot tell an original from a reverse row, and E1/E5 need the reverse rows. The real flow calls `markApplying` first. Rejected: a `reverse` dimension in the map, tests A and B for one unused edge (questions.md 2).
- **D9 `LATENT_EDGES` goes.** Stage 02 removes `LATENT_EDGES` and `LatentEdge`; test A (f) becomes "guard edges equal `ACTION_EDGES`". A future guard wider than its edges then fails test A.
- **D10 E edges are pinned.** Stage 01 adds a unit test with the sorted literal list of every `ACTION_EDGES` key at base. Stages 01–02 change no `ACTION_EDGES` key; only `callers` and comment text may change.
- **D11 Out of scope.** Entry writers (inserts; their TypeScript types limit the status), `releaseActions` (clears locks, no status change), the `PAIR_RULES.test` link check, `status_reason` and boundary tests, other state machines (questions.md 3).
- **D12 No new log line.** Rejected: a `guard_refused` event (a refused update and a lost claim look the same).
- **D13 New writers.** No scan test (the no-source-parsing rule) and no trigger. Stage 02 changes the rule in `docs/code-patterns.md` § Data access: a status writer builds its guard with `statusGuard` from a `WRITER_GUARDS` row and gets a test B case (questions.md 4).

### Edge cases

- **Crash and repeat:** the guard is part of the single `UPDATE`; no new statement, no new commit point. At-most-once of a send is unchanged: `markApplying` still commits `applying` before SMTP.
- **Two runs at once, tenants:** same row locks, claim token and `org_id` filter as today.
- **Refused write:** callers treat `false` as lost (`markApplying`, `finishAction`) or ignore it (`releaseAction`: the row is claimed again after the stale window). Only latent edges change to `false`.
- **Secrets:** nothing new in logs or errors.

## Facts checked (planner, 2026-11-19, code at b1003651)

Each writer call maps to an edge (read in the code):

- `apply.ts`: summary `finishAction applied` from `ready` (E1); mailbox `releaseAction ready` (E9) and `failed` (E5); reverse and original `applied` (E1); the no-provider release `toStatus: action.status` runs only for handlers that need IMAP (mailbox `ready`, draft `ready`/`applying`, send `approved`/`applying`): E9, E11, E12.
- `drafts.ts`: `markApplying` only when the claimed status is `ready` (E2); `failedWith` releases to `ready` only for `before_append` with claimed `ready` (E10 for an original now `applying`, E9 for a reverse row), else to `applying` (E11); a reverse row always uses `before_append`; `closeDraft` `expired` from `applying` (E8) or, in the loop-closed path, `ready` (E22).
- `send.ts`: `toStatus: action.status` with an `approved` claim (E12), the draft re-check to `approved` (E12). `send-limit.ts`: `markApplying` (E3), held release to `approved` (E12). `send-failure.ts`: `failed` with `from: [approved|applying]` (E7, E6), releases to `approved` (E12, E13) and `applying` (E11). `send-finish.ts`: `applied` from `applying` (E4). `send-close.ts`: `expired` from `approved` (E21).
- `markUndone` callers: `apply.ts`, `drafts.ts`, `triage/returned.ts` (mailbox types and drafts, E20).
- Kysely 0.29.8 (the pinned range `^0.29.8`) exports `DummyDriver`, `PostgresAdapter` and `PostgresQueryCompiler` from its root (`dist/index.d.ts`), for the compile-only unit test of stage 01.
- `ExpireFilter.types` is `MailboxActionType[]` (`packages/core/src/triage/expire-filter.ts`).
- `createPlanned` has more callers than its `ACTION_ENTRIES` rows name: `loops/delegate.ts`, `loops/follow-up-draft.ts`, `delegation/remind.ts`, `replies/write.ts` (scout 1, grep).

## Not verified

- No test ran in this job (no `node_modules`). The stage Proofs run them.

## Done when

- Every status writer of `actions/repo/` reads its `(type, status)` guard through `statusGuard`; none writes a literal status list in its `WHERE`.
- Test A: guard edges equal `ACTION_EDGES`; the pinned E-edge list passes unchanged.
- Test B passes for every row; the closed-edge test drives all 70 keys and each returns `false` with the row unchanged.
- `docs/capabilities/actions-and-undo.md` and `docs/code-patterns.md` describe the runtime guard.
- The Proof exits 0 on each stage.

## Rules for every stage

- No migration, no `bun.lock` change, no edit of `platform/db/schema.ts`.
- Change no `ACTION_EDGES` key. Change no caller in `apply.ts`, `drafts.ts`, `send*.ts`, `expiry.ts`, `approvals.ts`: the stages change repository writers, the map and tests only. If a caller must change, stop and ask.
- The send and approval suites pass with no edit: `actions-send*.test.ts`, `actions-copy-check.test.ts`, `actions-follow-up-concurrency.test.ts`, `actions-approvals.test.ts`, `web-approvals-races.test.ts`.
- A gap or a deviation is a question in the final message, not a choice.
- Format only the files of the stage. Comments name rules, not bare codes.

## Proof

`mkdir -p /tmp/f068-sNN && bun run lint > /tmp/f068-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f068-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f068-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f068-sNN/int.log 2>&1 && echo PROOF_OK`

Run it after the last commit, with nothing after it.

## Review

Both stages are `[risky]` (send path): an Opus review (`claude-opus-5-5`, `--thinking high`) before each land re-checks the call-site list against the diff.

## Stages

- [ ] [stage 01](stages/stage-01-guard-helper.md) `[risky]` — the shared guard helper; every writer reads its row; edge set unchanged.
- [ ] [stage 02](stages/stage-02-close-latent-edges.md) `[risky]` — close the latent edges, test each, update the docs.

## How to run (coordinator)

Move the ticket to `active/`, commit, spawn stage 01 with the board worker route and `--prepare 'bash scripts/limen-prepare.sh'`. Review, land with `--keep-open`, then stage 02; its land closes the ticket. No owner checkpoint.

## Planning progress

- Scouts: 3 (`scouts.md`).
- [written] plan.md · [written] stage 01 · [written] stage 02 · [written] questions.md
- `wc -w` before commit: see § Log.

## Cold review

Model: `claude-opus-5-5`, because both stages are `[risky]` (send path). Result: `plan-review-1.md`.

## Log

- 2026-11-19: plan written at b1003651. Words: plan 1,495+, stage 01 700, stage 02 682.
