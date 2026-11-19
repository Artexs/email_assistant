> **Status 2026-11-19 — planned.** Plan base: 96cf823f. Five stages; stages 01 and 05 are the migrations.

# F062 plan · Neutral names for the moved-mail columns, and no old cursor copy

Replaces the old one-job plan (git history at `96cf823f`).

## Input

Coordinator task (2026-11-20, `notes/2026-11-20-replan-parallel.md` § 7, round 3), word for word: "Decide an expand-and-contract shape over two releases: expand = new columns (source_uid, move_pending_at), dual write, readers on the new names, drop of the mailboxes cursor dual write only when a rollback to the previous release still works; contract = drop the old columns one release later; each migration [risky] and the only migration in build at its time. Write the rollback SQL rule of each migration as a stage decision."

Repo rules this plan follows: `docs/code-patterns.md` § Migrations (expand then contract; a release's migration works with the previous release's code; a contract statement carries `-- contract: v<x.y.z>`), `deploy/README.md` § Release (migration runs before the code switch; rollback goes one release back, never `db:rollback`).

### Decisions

- **D1 Two migrations, two releases.** Stage 01 (expand) rides the next release (expected v0.4.3). Stage 05 (contract) lands on master only after the release that carries stages 01–04 is deployed and is `current` on the VPS (expected v0.4.4). Rejected: one rename migration (`RENAME COLUMN`): the rollback target would name a column that is gone.
- **D2 The dual write of the emails columns is a database trigger, not app code.** Expand adds `emails.source_uid bigint` and `emails.move_pending_at timestamptz` (both nullable, as the old ones), copies the old values, and adds one `BEFORE INSERT OR UPDATE` trigger that keeps each pair equal. The old release (old names only) and the new code (new names only) both stay correct across a rollback and a roll forward. Rejected: app code that writes both names: after a rollback the old release writes only the old names, so the new columns go stale.
- **D3 Trigger rule.** INSERT: each new column takes `COALESCE(new name, old name)`, then the old column takes that value. UPDATE: when the new column changed (`IS DISTINCT FROM`), copy it to the old one; else when the old column changed, copy it to the new one. When both changed, the new name wins. Null is a value (clearing `move_pending_at` clears `undo_pending_at`).
- **D4 Code moves to the new names in the expand release.** Every query, row type, function name and test uses `source_uid` / `sourceUid` and `move_pending_at` / `movePendingAt` (`setUndoPending` becomes `setMovePending`). A guard test (stage 04) keeps the old names out.
- **D5 The `mailboxes` cursor copy stops in the expand release (stage 02).** A rollback still works: at base `96cf823f` no code outside tests reads `MailboxRow.uidvalidity` or `last_uid`; every cursor reader reads `mailbox_folders` (planner check of `sync.ts`, `sync-backfill.ts`, `sync-chunk.ts`, `sync-below-cursor.ts`, `moves.ts`). The copy only served a rollback to the code before the sort-folder sync, which no release state can reach (rollback goes one release back).
- **D6 Contract drops** `emails.inbox_uid`, `emails.undo_pending_at`, the trigger and its function, `mailboxes.uidvalidity`, `mailboxes.last_uid`, with `-- contract: v<the release that carries stages 01–04>`. First it inserts any missing INBOX `mailbox_folders` row from the `mailboxes` cursor, so no cursor is lost.
- **D7 Columns stay nullable.** `source_uid` is null on old rows outside INBOX (as `inbox_uid` is now). `SET NOT NULL` would be a third contract step with no product gain.
- **D8 Data export.** The expand stage exports `source_uid` and `move_pending_at` and lists the old emails columns as excluded ("copy of the new column for the rollback window"); stage 02 excludes the two `mailboxes` cursor columns ("stale copy"). The contract removes the excluded entries. Default, owner to confirm (questions.md Q1).
- **D9 Test tool name stays.** `mailbox:probe-move` keeps its local `inboxUid` (it really is a UID in INBOX); the guard test allows that file and its test.
- **D10 Rollback SQL rule.** Expand: no SQL; `deploy/rollback.sh` alone. Contract: no SQL; a rollback goes only to the expand release; a rollback (or `release.sh` of a tag) further back needs a restore from the backup that `deploy/release.sh` took. Stage files 01 and 05 hold the full rule.
- **D11 Stage 05 lands just before its release.** The coordinator lands it when it prepares the next release after the expand release. If the expand release is rolled back while stage 05 is on master and not released, the coordinator reverts stage 05 on master before any fix release, and lands it again later. Rejected: land at once: every fix release would then carry the drop.
- **D12 Demo seed.** The demo seed takes its columns from the export map, so a seed exported before stage 01 or 02 does not import after them (`bad_seed`). Accept: export the seed again; no format bump. Default, owner to confirm (questions.md Q5).

### Edge cases (answers)

- **Old code during the migration window, a rollback, a roll forward:** the trigger keeps both names equal (D2; 01-T1–T5). Two writers in one statement: new name wins (01-T7, T8).
- **Another ticket's branch still writes `inbox_uid` after stage 04 lands:** the guard test fails at its proof after "merge master"; before the contract it still works at runtime (trigger).
- **A mailbox with no INBOX folder row:** the sync refuses it now; the contract inserts the row first (D6, 05-T3).
- **Expand release rolled back around the contract:** D11 and S05-2.

## Facts checked (2026-11-19, base 96cf823f)

- The four old columns are nullable; no index, CHECK, view, policy or trigger names them (scout 3; `schema.ts`).
- Real uses: 230 lines in 31 files (planner grep); the task's 341 also count the `mailbox_folders` and `mailbox_sent_sync` cursors, which keep their names.
- Test `privacy-export-map` checks the export map against `information_schema`.
- `bun run db:check-migrations` (CI) fails a `DROP COLUMN|TRIGGER|FUNCTION` without a `-- contract:` line (`check-migrations-rules.ts`); `ADD COLUMN`, `UPDATE`, `CREATE FUNCTION`, `CREATE TRIGGER` pass.
- `deploy/release.sh` runs `db:migrate` before `up -d`; `deploy/rollback.sh` never migrates; state holds `current` and `previous` only (scout 4).

## Not verified

- Every live mailbox has an INBOX `mailbox_folders` row (scout 1); D6 makes the answer harmless.
- Row count of `emails` on the VPS (the expand `UPDATE` runs under a table lock); expected tens of thousands, seconds.

## Done when

Ticket `## Acceptance`, five items.

## Rules for every stage

- Format only the files the stage changes. Merge master before the proof; a conflict is "merge master, re-prove".
- Once stage 04 lands, no code outside the guard's allow list (stage 04 step 3) names `inbox_uid`, `undo_pending_at`, `inboxUid` or `UndoPending`.
- After a merge of master that brings a migration, run `bun run db:migrate` on the job DB before any test.
- A schema change is only a new dbmate file; then `bun run db:types`. Never edit `schema.ts` by hand.
- A gap or a deviation in a decision is a question in the final message, not a choice.

## Proof

`mkdir -p /tmp/f062-sNN && bun run lint > /tmp/f062-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f062-sNN/typecheck.log 2>&1 && bun run db:check-migrations > /tmp/f062-sNN/migrations.log 2>&1 && bun run test:unit:ci > /tmp/f062-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f062-sNN/int.log 2>&1 && echo PROOF_OK`

## Coordinator checkpoints and steps

- **Migration slot:** stage 01 and stage 05 each need the board's single migration slot.
- **After stage 01 lands, and after stage 05 lands:** `bun run db:migrate` on the shared dev DB (coordinator or owner).
- **Releases (records, not stages):** the expand release carries stages 01–04 (else the contract waits for the release that carries the last one). Before stage 05: `deploy/release-state/state` shows `current` carries them; give that version to the worker. At the contract release's deploy: S05-2.

## Review

Stages 01 and 05: Opus review before land (migrations, `[risky]`). Stage 02: Sonnet review (sync cursor). Stages 03 and 04 land on the worker's proof.

## Stages

- [x] [stage 01](stages/stage-01-expand-migration.md) `[risky]` — expand migration: new columns, copy trigger, export map
- [x] [stage 02](stages/stage-02-stop-mailbox-cursor-copy.md) — stop the `mailboxes` cursor copy
- [x] [stage 03](stages/stage-03-mail-module-new-names.md) — mail module on the new names
- [x] [stage 04](stages/stage-04-actions-guard-docs.md) — actions module, tests, guard test, docs
- [x] [stage 05](stages/stage-05-contract-migration.md) `[risky]` — contract migration

## How to run (coordinator)

Order: 01 ∥ 02 → 03 → 04 → release → 05 (D11). Board worker flags, `--prepare 'bash scripts/limen-prepare.sh'`; task: "Implement F062 stage NN. Read ticket.md, plan.md and stages/stage-NN-*.md. Final proof: the Proof command of plan.md with NN filled in."

## Planning progress

- Scouts: 4 (scouts.md). Stage files: all written.
- Word counts (`wc -w`, after the review fixes): plan 1488; stages 01 695, 02 572, 03 632, 04 616, 05 697.

## Cold review

Model: `claude-opus-5-5` (two `[risky]` migration stages). Review 1 ([`plan-review-1.md`](plan-review-1.md)): FAIL, 1 blocking, 7 notes. Fixed: 1 (allow list), 2 (D11), 3 and 4 (S05-2, S05-4), 5 (D12), 6 (rule), 7 (insert), 8 (stage 01 gate, lock timeout, `release.sh` of an old tag). Rejected: 8 "§ Backups dangling": `deploy/README.md` has `## Backups`.

## Log

- 2026-11-19: Plan written at base 96cf823f. Cold review 1 (Opus): FAIL; fixes in § Cold review.
