> **Status 2026-11-19 — planned.** Plan base: 96cf823f. Five stages; stages 01 and 05 are the migrations.

# F062 plan · Neutral names for the moved-mail columns, and no old cursor copy

Replaces the old one-job plan (git history at `96cf823f`).

## Input

Coordinator task (2026-11-20, `notes/2026-11-20-replan-parallel.md` § 7, round 3), word for word: "Decide an expand-and-contract shape over two releases: expand = new columns (source_uid, move_pending_at), dual write, readers on the new names, drop of the mailboxes cursor dual write only when a rollback to the previous release still works; contract = drop the old columns one release later; each migration [risky] and the only migration in build at its time. Write the rollback SQL rule of each migration as a stage decision."

Repo rules this plan follows: `docs/code-patterns.md` § Migrations (expand then contract; a release's migration works with the previous release's code; a contract statement carries `-- contract: v<x.y.z>`), `deploy/README.md` § Release (migration runs before the code switch; rollback goes one release back, never `db:rollback`).

### Decisions

- **D1 Two migrations, two releases.** Stage 01 (expand) rides the next release (expected v0.4.3). Stage 05 (contract) lands on master only after the release that carries stages 01–04 is deployed and is `current` on the VPS (expected v0.4.4). Rejected: one rename migration (`RENAME COLUMN`): the rollback target would name a column that is gone.
- **D2 The dual write of the emails columns is a database trigger, not app code.** Expand adds `emails.source_uid bigint` and `emails.move_pending_at timestamptz` (both nullable, as the old ones), copies the old values, and adds one `BEFORE INSERT OR UPDATE` trigger that keeps each pair equal. So the old release (writes only old names) and the new code (writes only new names) both stay correct, also across a rollback and a roll forward. Rejected: app code that writes both names: a rollback to the old release writes only the old names, and the new code would read stale new columns after the roll forward.
- **D3 Trigger rule.** INSERT: each new column takes `COALESCE(new name, old name)`, then the old column takes that value. UPDATE: when the new column changed (`IS DISTINCT FROM`), copy it to the old one; else when the old column changed, copy it to the new one. When both changed, the new name wins. Null is a value (clearing `move_pending_at` clears `undo_pending_at`).
- **D4 Code moves to the new names in the expand release.** Every query, row type, function name and test uses `source_uid` / `sourceUid` and `move_pending_at` / `movePendingAt` (`setUndoPending` becomes `setMovePending`). After stage 04 no code names the old columns; a unit guard test (stage 04) keeps it so until the contract.
- **D5 The `mailboxes` cursor copy stops in the expand release (stage 02).** A rollback still works: at base `96cf823f` no code outside tests reads `MailboxRow.uidvalidity` or `last_uid`; every cursor reader reads `mailbox_folders` (planner check of `sync.ts`, `sync-backfill.ts`, `sync-chunk.ts`, `sync-below-cursor.ts`, `moves.ts`). The copy only served a rollback to the code before the sort-folder sync, which no release state can reach (rollback goes one release back).
- **D6 Contract drops** `emails.inbox_uid`, `emails.undo_pending_at`, the trigger and its function, `mailboxes.uidvalidity`, `mailboxes.last_uid`, with `-- contract: v<the release that carries stages 01–04>`. Before the drop it inserts a missing INBOX `mailbox_folders` row from the `mailboxes` cursor (`ON CONFLICT DO NOTHING`), so no cursor can be lost.
- **D7 Columns stay nullable.** `source_uid` is null on old rows outside INBOX (as `inbox_uid` is now). `SET NOT NULL` would be a third contract step with no product gain.
- **D8 Data export.** The expand stage exports `source_uid` and `move_pending_at` and lists the old emails columns as excluded ("copy of the new column for the rollback window"); stage 02 excludes the two `mailboxes` cursor columns ("stale copy"). The contract removes the excluded entries. Default, owner to confirm (questions.md Q1).
- **D9 Test tool name stays.** `mailbox:probe-move` keeps its local `inboxUid` (it really is a UID in INBOX); the guard test allows that file and its test.
- **D10 Rollback SQL rule.** Expand: no SQL; `deploy/rollback.sh` alone. Contract: no SQL; a rollback goes only to the expand release; a rollback further needs a restore from the backup that `deploy/release.sh` took. Stage files 01 and 05 hold the full rule.

### Edge cases (answers)

- **Old code during the migration window** (migration runs before the switch): it writes old names; the trigger fills the new ones (test 01-T1, T3).
- **Rollback, then roll forward:** rows written by the old release carry both names (trigger), so the new code reads current values (01-T3, T5).
- **Two writers in one row update** (cannot happen between releases, can in a stray script): new name wins (01-T7, T8).
- **Another ticket's branch still writes `inbox_uid` after stage 04 lands:** the guard test fails at its proof after "merge master"; before the contract it still works at runtime (trigger).
- **A mailbox with no INBOX folder row:** the sync refuses it now; the contract inserts the row first (D6, 05-T3).
- **Contract release deployed while `current` is older than the expand release** (for example after a rollback of the expand release): forbidden; stage 05 and the release check (`docs/release-checklist.md`, contract line rule) stop it.

## Facts checked (2026-11-19, base 96cf823f)

- `inbox_uid` and `undo_pending_at` are nullable; no index, CHECK, view, policy or trigger names them or the `mailboxes` cursor (scout 3; `schema.ts`).
- Real uses: 230 lines in 31 files (planner grep); the task's 341 also count the `mailbox_folders` and `mailbox_sent_sync` cursors, which keep their names.
- The `org:export` map is checked against `information_schema` by test `privacy-export-map` (`privacy/export-map.ts` header).
- `bun run db:check-migrations` (CI) fails a `DROP COLUMN|TRIGGER|FUNCTION` without a `-- contract:` line (`check-migrations-rules.ts`); `ADD COLUMN`, `UPDATE`, `CREATE FUNCTION`, `CREATE TRIGGER` pass.
- `deploy/release.sh` runs `db:migrate` before `up -d`; `deploy/rollback.sh` never migrates; state holds `current` and `previous` only (scout 4).

## Not verified

- Every live mailbox has an INBOX `mailbox_folders` row (scout 1); D6 makes the answer harmless.
- Row count of `emails` on the VPS (the expand `UPDATE` runs under a table lock); expected tens of thousands, seconds.

## Done when

Ticket `## Acceptance`, five items.

## Rules for every stage

- Format only the files the stage changes. Merge master before the proof; a conflict is "merge master, re-prove".
- No code outside migrations, `schema.ts` and the stage-04 guard names `inbox_uid`, `undo_pending_at`, `inboxUid` (except D9) or `UndoPending` once stage 04 lands.
- A schema change is only a new dbmate file; then `bun run db:types`. Never edit `schema.ts` by hand.
- A gap or a deviation in a decision is a question in the final message, not a choice.
- Docs: the stage that changes a behaviour updates its page in `docs/capabilities/`.

## Proof

`mkdir -p /tmp/f062-sNN && bun run lint > /tmp/f062-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f062-sNN/typecheck.log 2>&1 && bun run db:check-migrations > /tmp/f062-sNN/migrations.log 2>&1 && bun run test:unit:ci > /tmp/f062-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f062-sNN/int.log 2>&1 && echo PROOF_OK`

## Coordinator checkpoints and steps

- **Migration slot:** stage 01 and stage 05 each need the board's single migration slot.
- **After stage 01 lands, and after stage 05 lands:** `bun run db:migrate` on the shared dev DB (coordinator or owner).
- **Release record (not a stage):** the release that carries stages 01–04; if one of them misses it, the contract waits for the release that carries the last one.
- **Before stage 05 starts:** `deploy/release-state/state` on the VPS shows that `current` carries stages 01–04. Give that version to the worker for the `-- contract:` line.
- **Release record:** the release that carries stage 05; at its deploy, `current` is still that expand release (S05-2).

## Review

Stages 01 and 05: Opus review before land (migrations, `[risky]`). Stage 02: Sonnet review (sync cursor). Stages 03 and 04 land on the worker's proof.

## Stages

- [x] [stage 01](stages/stage-01-expand-migration.md) `[risky]` — expand migration: new columns, copy trigger, export map
- [x] [stage 02](stages/stage-02-stop-mailbox-cursor-copy.md) — stop the `mailboxes` cursor copy
- [x] [stage 03](stages/stage-03-mail-module-new-names.md) — mail module on the new names
- [x] [stage 04](stages/stage-04-actions-guard-docs.md) — actions module, tests, guard test, docs
- [x] [stage 05](stages/stage-05-contract-migration.md) `[risky]` — contract migration

## How to run (coordinator)

Order: 01 ∥ 02 → 03 → 04 → release → 05. Stage 02 may run next to 01 and 03. Spawn per stage with the board's worker flags and `--prepare 'bash scripts/limen-prepare.sh'`; the task: "Implement F062 stage NN. Read ticket.md, plan.md and stages/stage-NN-*.md. Final proof: the Proof command of plan.md with NN filled in."

## Planning progress

- Scouts: 4 (scouts.md). Stage files: all written.
- Word counts (`wc -w`, before the review): plan 1447; stages 01 684, 02 572, 03 632, 04 596, 05 ≤700.

## Cold review

Model: `claude-opus-5-5` (the plan has two `[risky]` migration stages; migrations are a risk area). Result: see § Log.

## Log

- 2026-11-19: Plan written at base 96cf823f.
