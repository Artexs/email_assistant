# s3-assist-actions — Stage 2

Part of [`../s3-assist-actions.md`](../s3-assist-actions.md). Read that file's "Input" and "Rules for every step" first.

## Stage 2 — S3 migration: `applied_at`, `inbox_uid`, `moved_at`, indexes, outbox kind [risky]

- [ ] **2.1 Migration `<build date>000001_assist_actions.sql`**
  - Goal: the schema for the committer, Undo, the returned check and the failed-action notice, with the guards in the database (D2, D19).
  - Files: create `db/migrations/<YYYYMMDD>000001_assist_actions.sql` (the build date; later than `20261106000001_telegram.sql`); regenerate `apps/server/src/platform/db/schema.ts` (`bun run db:types`, never by hand); create `apps/server/test/integration/actions-schema.test.ts`.
  - Interfaces: the SQL below. After `db:types`: `Actions.applied_at: Timestamp | null`, `Emails.inbox_uid: Int8 | null`, `Emails.moved_at: Timestamp | null`.
  - Decisions:
    - Read the real name of the `outbox.kind` check first: `SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'outbox'::regclass AND contype = 'c';` on the dev DB. The default name is `outbox_kind_check`; if it differs, use the real one in both directions of the migration.
    - Exact SQL (keep the order; `-- migrate:down` undoes it in reverse order):

      ```sql
      -- migrate:up
      ALTER TABLE actions ADD COLUMN applied_at timestamptz;
      ALTER TABLE actions ADD CONSTRAINT actions_applied_at_check CHECK (status NOT IN ('applied', 'undone') OR applied_at IS NOT NULL);
      CREATE UNIQUE INDEX actions_reverse_key ON actions (reverses_action_id) WHERE reverses_action_id IS NOT NULL;
      CREATE INDEX actions_email_type_idx ON actions (email_id, type);

      ALTER TABLE emails ADD COLUMN inbox_uid bigint;
      ALTER TABLE emails ADD COLUMN moved_at timestamptz;
      UPDATE emails SET inbox_uid = uid WHERE folder = 'INBOX';
      CREATE INDEX emails_claim_idx ON emails (mailbox_id, status, received_at);
      CREATE INDEX emails_moved_idx ON emails (mailbox_id, moved_at) WHERE folder <> 'INBOX';
      CREATE INDEX emails_returned_idx ON emails (mailbox_id) WHERE returned_at IS NOT NULL;

      ALTER TABLE outbox DROP CONSTRAINT outbox_kind_check;
      ALTER TABLE outbox ADD CONSTRAINT outbox_kind_check CHECK (kind IN ('digest', 'urgent', 'auth_error', 'sync_stale', 'sync_ok', 'action_failed'));
      ALTER TABLE outbox DROP CONSTRAINT outbox_check1;
      ALTER TABLE outbox ADD CONSTRAINT outbox_email_kind_check CHECK (kind NOT IN ('urgent', 'action_failed') OR email_id IS NOT NULL);

      -- migrate:down
      ALTER TABLE outbox DROP CONSTRAINT outbox_email_kind_check;
      ALTER TABLE outbox ADD CONSTRAINT outbox_check1 CHECK (kind <> 'urgent' OR email_id IS NOT NULL);
      ALTER TABLE outbox DROP CONSTRAINT outbox_kind_check;
      ALTER TABLE outbox ADD CONSTRAINT outbox_kind_check CHECK (kind IN ('digest', 'urgent', 'auth_error', 'sync_stale', 'sync_ok'));
      DROP INDEX emails_returned_idx;
      DROP INDEX emails_moved_idx;
      DROP INDEX emails_claim_idx;
      ALTER TABLE emails DROP COLUMN moved_at;
      ALTER TABLE emails DROP COLUMN inbox_uid;
      DROP INDEX actions_email_type_idx;
      DROP INDEX actions_reverse_key;
      ALTER TABLE actions DROP CONSTRAINT actions_applied_at_check;
      ALTER TABLE actions DROP COLUMN applied_at;
      ```

      The unnamed check `CHECK (kind <> 'urgent' OR email_id IS NOT NULL)` has a generated name (`outbox_check1` by the default rule, but the number depends on the order of the unnamed checks in the S2 migration): read it with the query above and put the real name into both directions. Keep the other unnamed outbox checks as they are.

    - Why these shapes: `applied_at` is the Undo window and the metric time (D10, P4); the check makes an `applied` or `undone` row without a time impossible. `actions_reverse_key` makes two reverse rows for one original impossible (D10). `inbox_uid` is the hint of the below-cursor check (D4); the backfill `UPDATE` sets it for every existing INBOX row (rows in other folders are only the S1a test row with `EA-test`, if any: they stay NULL and are never checked). `emails_claim_idx` closes `tasks/planned/s1b-claim-index.md`. The two partial indexes serve the returned check and the returned job. `outbox.kind` gets `action_failed` (D11).
    - Existing rows: no `actions` row is `applied` or `undone` yet (S1b and S2 wrote `logged` and `ready` only), so the new check holds. Verify with `SELECT status, count(*) FROM actions GROUP BY 1` on the dev DB before the migration; the stage 19 deploy runs the same query on the VPS.
    - No grant change: the S0 default privileges cover the columns and indexes.

  - Test (`actions-schema.test.ts`, `withRollback`; statements that must fail in `trx.savepoint`, checked by the Postgres error `code`: `23514` check, `23505` unique):
    1. Insert an action with status `applied` and `applied_at` NULL → `23514`; with `applied_at` set → OK; status `undone` without `applied_at` → `23514`.
    2. Two actions with the same `reverses_action_id` → `23505`; two with NULL → OK.
    3. A new email row (fixture `insertTestEmail`) has `inbox_uid` NULL and `moved_at` NULL (the repository sets them: stages 5 and 7).
    4. An outbox row with kind `action_failed` and `email_id` → OK; without `email_id` → `23514`; kind `digest` still needs `digest_id` (`23514` without it).
    5. `pg_indexes` lists `emails_claim_idx`, `emails_moved_idx`, `emails_returned_idx`, `actions_email_type_idx`, `actions_reverse_key`.
  - Check: `bun run dev:up && bun run db:migrate && bun run db:types && bun run lint && bun run typecheck && bun run test:int`. Round trip: `bun run db:rollback && bun run db:migrate` both succeed. `git diff --stat apps/server/src/platform/db/schema.ts` shows only the three new fields.
  - Done when: the tests pass and the round trip works. The main session moves `tasks/planned/s1b-claim-index.md` to `tasks/done/` in the stage commit (log line: "done by S3 stage 2").
  - Out of scope: repository functions (stages 5, 7), the `actions.applying` status (S4 uses it).
