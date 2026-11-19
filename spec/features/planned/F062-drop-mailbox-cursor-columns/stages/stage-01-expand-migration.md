Needs: the board's migration slot (no other migration in build). Land after the tag of v0.4.2 exists (board release plan: the expand rides v0.4.3); it may build before that. May run next to stage 02 (both edit `privacy/export-map.ts`, different tables: merge master, re-prove).

# F062 stage 01 — Expand migration: new columns and the copy trigger `[risky]`

Part of [`../plan.md`](../plan.md). Decisions D1, D2, D3, D7, D8, D10.

## Goal

The database has `emails.source_uid` and `emails.move_pending_at`, equal to `inbox_uid` and `undo_pending_at` on every row, and a trigger keeps each pair equal for any writer. No other code changes its reads or writes in this stage.

## Migration (one new dbmate file, `db/migrations/<timestamp>_emails_neutral_names.sql`)

Up, in this order, in the one transaction dbmate gives:

0. `SET LOCAL lock_timeout = '10s';` (S01-2).
1. `ALTER TABLE emails ADD COLUMN source_uid bigint, ADD COLUMN move_pending_at timestamptz;` (nullable, no default: D7).
2. `UPDATE emails SET source_uid = inbox_uid, move_pending_at = undo_pending_at;` (before the trigger exists, so the trigger does not run on it).
3. Function `emails_copy_renamed_columns()` (plpgsql, `RETURNS trigger`, not `SECURITY DEFINER`): the plan's D3 rule for both pairs, then `RETURN NEW`.
4. `CREATE TRIGGER emails_copy_renamed_columns BEFORE INSERT OR UPDATE ON emails FOR EACH ROW EXECUTE FUNCTION emails_copy_renamed_columns();`

Down: drop the trigger, the function, the two columns.

The file must have no `-- contract:` line and no statement that `bun run db:check-migrations` flags. Then `bun run db:types`.

## Decisions for this stage

- **S01-1 Rollback SQL rule (D10).** A rollback of the release that carries this migration is `deploy/rollback.sh` alone. No SQL before or after. The trigger fills the new names from the old release's writes, so a roll forward needs no SQL either. Never `db:rollback` on the VPS (repo rule, `docs/code-patterns.md` § Migrations).
- **S01-2 Lock.** The migration runs while the old release is live. With a 10 s lock timeout it fails fast instead of queueing every `emails` query behind a long transaction. On that failure `release.sh` stops after its `pending` mark: run `deploy/rollback.sh` (it restarts the running release), then the release again. The tombstone-trigger tests stay green.
- **S01-3 Export map (D8).** `emails` exports `source_uid` and `move_pending_at`. `inbox_uid` and `undo_pending_at` move to the excluded list with the reason "copy of source_uid (move_pending_at) for the rollback window; dropped by the contract migration".
- **S01-4 Changelog.** One line under `## [Unreleased]` → `### Changed`, operator words: the data export names the two mail columns `source_uid` and `move_pending_at`.
- **S01-5 Docs.** `docs/architecture.md` § 5 `emails` row: add the new columns; mark the old two "copy for the rollback window" (stage 04 renames the rest). `docs/capabilities/live-lab.md`: one sentence that a demo seed imports only into a database with the columns of its export; after a column change, export it again (D12).

## Test (`apps/server/test/integration/emails-renamed-columns-schema.test.ts`, in a rolled-back transaction, one org, one mailbox)

- T1 Insert with `inbox_uid = 41`, `undo_pending_at = 2026-11-20T10:00:00Z`, no new names → row has `source_uid = 41`, `move_pending_at = 2026-11-20T10:00:00Z`.
- T2 Insert with `source_uid = 42`, `move_pending_at = 2026-11-20T11:00:00Z` only → `inbox_uid = 42`, `undo_pending_at = 2026-11-20T11:00:00Z`.
- T3 Update `inbox_uid` 41 → 77 → `source_uid = 77`.
- T4 Update `source_uid` 42 → 88 → `inbox_uid = 88`.
- T5 Row with both timestamps set; update `undo_pending_at = NULL` → `move_pending_at` is null. Second row: update `move_pending_at = NULL` → `undo_pending_at` is null.
- T6 Update `status` only → all four values unchanged.
- T7 Insert with `source_uid = 5` and `inbox_uid = 6` → both 5.
- T8 Update both in one statement (`source_uid = 9`, `inbox_uid = 10`) → both 9.
- T9 Insert with all four null → all four null.

Backfill check (manual, on the job DB, record it): `bun run db:rollback`; insert a row with `inbox_uid = 41` and `undo_pending_at` set; `bun run db:migrate`; the row has equal new values. Delete it.

## Done when

- T1–T9 pass; the backfill check is recorded.
- The Proof command of `plan.md` (NN = 01) prints `PROOF_OK`.

## Out of scope

- Any read or write of the new names in app code (stages 03, 04).
- The `mailboxes` cursor (stages 02, 05).
- Indexes: no index names these columns now, and none is added.
