Needs the release that carries stages 01–04 (expected v0.4.3) deployed and `current` on the VPS; the coordinator reads `deploy/release-state/state` and gives the version in the task. Needs stage 04: `RETIRED_COLUMN_ALLOW` in `apps/server/src/platform/db/retired-columns.test.ts`. Needs stage 02: no code reads `mailboxes.uidvalidity` / `last_uid`. Needs the board's migration slot.

# F062 stage 05 — Contract migration: drop the old columns `[risky]`

Part of [`../plan.md`](../plan.md). Decisions D1, D6, D10.

## Goal

The database has no `emails.inbox_uid`, `emails.undo_pending_at`, `mailboxes.uidvalidity`, `mailboxes.last_uid`, and no copy trigger. No behaviour changes.

## Migration (one new dbmate file, `db/migrations/<timestamp>_drop_old_cursor_columns.sql`)

The file has the line `-- contract: v<x.y.z>`, where `v<x.y.z>` is the release from the task (the release that carries stages 01–04).

Up, in this order:

1. Insert a missing INBOX folder row (key `inbox`, path `INBOX`, role `inbox`, enabled) with the `mailboxes` cursor, `ON CONFLICT (mailbox_id, key) DO NOTHING` (D6; the same insert as the roll-forward step of the sort-folder rollout in `deploy/README.md`).
2. `DROP TRIGGER emails_copy_renamed_columns ON emails;` then `DROP FUNCTION emails_copy_renamed_columns();`.
3. `ALTER TABLE emails DROP COLUMN inbox_uid, DROP COLUMN undo_pending_at;`
4. `ALTER TABLE mailboxes DROP COLUMN uidvalidity, DROP COLUMN last_uid;`

Down (dev DB only): add the four columns back (nullable), copy `source_uid` / `move_pending_at` into the emails pair and the INBOX folder cursor into `mailboxes`, create the function and trigger of stage 01 again (same body). So `db:rollback` returns the dev DB to the stage-01 state.

Then `bun run db:types`.

## Code and docs

- `privacy/export-map.ts`: remove the four excluded entries.
- `retired-columns.test.ts`: remove `export-map.ts` from `RETIRED_COLUMN_ALLOW`. Keep the test: raw `sql` strings and other tickets' branches still need it.
- Docs: `docs/architecture.md` § 5 drops the "copy for the rollback window" note; ADR 0014 gets one dated line: this ticket closed the rollback window of the sort-folder sync, the old columns are gone; `deploy/README.md` § Synced folders: no rollback step names the old columns.
- `CHANGELOG.md` `## [Unreleased]` → `### Removed`: the old mail cursor columns, operator words.

## Decisions for this stage

- **S05-1 Rollback SQL rule (D10).** A rollback of the release that carries this migration is `deploy/rollback.sh` alone, to the release named in the `-- contract:` line; no SQL. That release reads and writes only the new names and no `mailboxes` cursor (stages 02–04), and nothing in it calls the dropped trigger. A rollback to any older release is not possible after this migration: it needs a restore from the backup that `deploy/release.sh` took before the migration (`deploy/README.md` § Backups). Write this rule in `deploy/README.md` § Synced folders.
- **S05-2 Release check.** At the deploy of the release that carries this stage, `current` on the VPS must be the release in the `-- contract:` line or a later one. If the expand release was rolled back, this stage's release waits until it is deployed again. This is the existing rule of `docs/release-checklist.md` (contract line); add no new rule.
- **S05-4 If the task gives no version,** or the version is not in `CHANGELOG.md` with stages 01–04 in its section, stop and ask.

## Test

- T1 `bun run db:check-migrations` passes (the contract line covers the drops).
- T2 The `privacy-export-map` test passes without the excluded entries.
- T3 Missing-row step (manual, on the job DB): `bun run db:rollback`; insert a mailbox with `uidvalidity = 7`, `last_uid = 120` and no INBOX folder row; `bun run db:migrate`; the mailbox now has an INBOX row with `uidvalidity = 7`, `last_uid = 120`. Delete the test rows. Record the output in the final message.
- T4 The stage-01 trigger test file is deleted or reduced to: `source_uid` and `move_pending_at` exist, the old names do not (`information_schema.columns`), and no trigger named `emails_copy_renamed_columns` exists (`pg_trigger`).
- T5 The guard test passes with the shorter allow list.
- T6 Dev round trip on the job DB: `bun run db:rollback` then `bun run db:migrate` both succeed. Record it.

## Done when

- `schema.ts` has no `inbox_uid`, `undo_pending_at`, and `Mailboxes` has no `uidvalidity` or `last_uid`.
- T1–T6 pass or are recorded.
- The Proof command of `plan.md` (NN = 05) prints `PROOF_OK`.

## Out of scope

- `SET NOT NULL` on the new columns (D7).
- The `mailbox_folders` and `mailbox_sent_sync` cursors.
- The deploy itself (coordinator release record).
