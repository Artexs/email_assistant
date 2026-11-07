# s4-drafts-approvals-delegation — Stage 2

Part of [`../s4-drafts-approvals-delegation.md`](../s4-drafts-approvals-delegation.md). Read that file's "Input" and "Rules for every step" first.

## Stage 2 — S4 migration: `delegates`, `delegations`, action types and checks, outbox kinds [risky]

- [ ] **2.1 Migration `<next free version>_delegation.sql`**
  - Goal: the schema of D1 with the guards in the database: a send on its way out always has an approval record; a send is never `ready`; a delegation in `sent` always has its message id.
  - Files: create `db/migrations/<version>_delegation.sql` (`<version>` = the next free version after the highest file in `db/migrations/`, after the S3 migration; never a version that exists); regenerate `apps/server/src/platform/db/schema.ts` (`bun run db:types`, never by hand); create `apps/server/test/integration/delegation-schema.test.ts`.
  - Interfaces: the SQL below. After `db:types`: `Delegates`, `Delegations` interfaces; `Actions.result_notified_at: Timestamp | null`.
  - Decisions:
    - Read the real constraint names first on the dev DB: `SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'actions'::regclass AND contype = 'c';` (the column check of `type` is `actions_type_check` by the default rule) and the same for `outbox` (the S3 migration named `outbox_kind_check` and `outbox_email_kind_check`). Use the real names in both directions.
    - Exact SQL (keep the order; `-- migrate:down` undoes it in reverse):

      ```sql
      -- migrate:up
      CREATE TABLE delegates (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
        name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
        email text NOT NULL CHECK (email = lower(email) AND email ~ '^[^\s@]+@[^\s@]+$'),
        competence_tags text[] NOT NULL DEFAULT '{}',
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (id, org_id)
      );
      CREATE UNIQUE INDEX delegates_org_email_key ON delegates (org_id, email);

      ALTER TABLE actions DROP CONSTRAINT actions_type_check;
      ALTER TABLE actions ADD CONSTRAINT actions_type_check
        CHECK (type IN ('move', 'mark_read', 'flag', 'save_summary', 'create_draft', 'send'));
      ALTER TABLE actions ADD COLUMN result_notified_at timestamptz;
      ALTER TABLE actions ADD CONSTRAINT actions_send_approved_check
        CHECK (type <> 'send' OR status NOT IN ('approved', 'applying', 'applied') OR approved_at IS NOT NULL);
      ALTER TABLE actions ADD CONSTRAINT actions_send_never_ready_check CHECK (type <> 'send' OR status <> 'ready');
      CREATE INDEX actions_depends_on_idx ON actions (depends_on_action_id) WHERE depends_on_action_id IS NOT NULL;
      CREATE INDEX actions_org_type_status_idx ON actions (org_id, type, status);

      CREATE TABLE delegations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL,
        mailbox_id uuid NOT NULL,
        email_id uuid NOT NULL,
        delegate_id uuid NOT NULL,
        draft_action_id uuid NOT NULL,
        send_action_id uuid NOT NULL,
        task_summary text NOT NULL,
        due_at timestamptz,
        status text NOT NULL DEFAULT 'drafted'
          CHECK (status IN ('drafted', 'sent', 'answered', 'overdue', 'done', 'cancelled')),
        status_reason text,
        sent_message_id text,
        sent_at timestamptz,
        last_reminder_at timestamptz,
        reminders_sent integer NOT NULL DEFAULT 0 CHECK (reminders_sent >= 0),
        answered_email_id uuid REFERENCES emails (id) ON DELETE SET NULL,
        answered_at timestamptz,
        answered_notified_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CHECK (status NOT IN ('sent', 'answered', 'overdue') OR (sent_message_id IS NOT NULL AND sent_at IS NOT NULL)),
        FOREIGN KEY (email_id, org_id) REFERENCES emails (id, org_id) ON DELETE CASCADE,
        FOREIGN KEY (mailbox_id, org_id) REFERENCES mailboxes (id, org_id) ON DELETE CASCADE,
        FOREIGN KEY (delegate_id, org_id) REFERENCES delegates (id, org_id),
        FOREIGN KEY (draft_action_id, org_id) REFERENCES actions (id, org_id) ON DELETE CASCADE,
        FOREIGN KEY (send_action_id, org_id) REFERENCES actions (id, org_id) ON DELETE CASCADE,
        UNIQUE (send_action_id),
        UNIQUE (id, org_id)
      );
      CREATE INDEX delegations_mailbox_status_idx ON delegations (org_id, mailbox_id, status);
      CREATE INDEX delegations_status_due_idx ON delegations (org_id, status, due_at);

      ALTER TABLE outbox DROP CONSTRAINT outbox_kind_check;
      ALTER TABLE outbox ADD CONSTRAINT outbox_kind_check CHECK (kind IN (
        'digest', 'urgent', 'auth_error', 'sync_stale', 'sync_ok', 'action_failed',
        'approval', 'approval_set', 'send_result', 'delegation_answered'));
      ALTER TABLE outbox DROP CONSTRAINT outbox_email_kind_check;
      ALTER TABLE outbox ADD CONSTRAINT outbox_email_kind_check
        CHECK (kind NOT IN ('urgent', 'action_failed', 'approval', 'approval_set', 'send_result', 'delegation_answered') OR email_id IS NOT NULL);

      -- migrate:down
      DELETE FROM outbox WHERE kind IN ('approval', 'approval_set', 'send_result', 'delegation_answered');
      ALTER TABLE outbox DROP CONSTRAINT outbox_email_kind_check;
      ALTER TABLE outbox ADD CONSTRAINT outbox_email_kind_check
        CHECK (kind NOT IN ('urgent', 'action_failed') OR email_id IS NOT NULL);
      ALTER TABLE outbox DROP CONSTRAINT outbox_kind_check;
      ALTER TABLE outbox ADD CONSTRAINT outbox_kind_check
        CHECK (kind IN ('digest', 'urgent', 'auth_error', 'sync_stale', 'sync_ok', 'action_failed'));
      DROP TABLE delegations;
      DROP INDEX actions_org_type_status_idx;
      DROP INDEX actions_depends_on_idx;
      ALTER TABLE actions DROP CONSTRAINT actions_send_never_ready_check;
      ALTER TABLE actions DROP CONSTRAINT actions_send_approved_check;
      ALTER TABLE actions DROP COLUMN result_notified_at;
      DELETE FROM actions WHERE type IN ('create_draft', 'send');
      ALTER TABLE actions DROP CONSTRAINT actions_type_check;
      ALTER TABLE actions ADD CONSTRAINT actions_type_check CHECK (type IN ('move', 'mark_read', 'flag', 'save_summary'));
      DROP TABLE delegates;
      ```

    - Why these shapes (D1): `actions_send_approved_check` is the database side of ADR 0003 ("every send needs an approval record"); `actions_send_never_ready_check` closes the one status that the committer claims without an approval; `UNIQUE (send_action_id)` ties one delegation to one send; the `delegations` status check makes a `sent` row without its message id impossible; the `delegate_id` FK has no cascade (delegates are deactivated: D6); `answered_email_id` is a single-column FK with `SET NULL` because a composite FK cannot null one column. The down section deletes the S4 rows first, because the old checks refuse them; their `audit_log` rows go with them (`audit_log (action_id, org_id) → actions (id, org_id) ON DELETE CASCADE`, `20261104000001_triage.sql:114`: accepted for a rollback).
    - Existing rows: no `actions` row is a `send` or `create_draft` yet, so the new checks hold (`SELECT type, count(*) FROM actions GROUP BY 1` on the dev DB before the migration; the stage 22 deploy runs it on the VPS).
    - No grant change: the S0 default privileges cover new tables and columns.

  - Test (`delegation-schema.test.ts`, `withRollback`; statements that must fail in `trx.savepoint`, checked by the Postgres error `code`: `23514` check, `23505` unique, `23503` foreign key):
    1. A `send` action with status `approved` and `approved_at` NULL → `23514` with `constraint` `actions_send_approved_check`; with `approved_at` set → OK; `applied` with `applied_at` set (so S3's `actions_applied_at_check` holds) and without `approved_at` → `23514` with `constraint` `actions_send_approved_check` (assert the constraint name: two checks can give `23514`); a `send` with status `ready` → `23514`; a `send` with `awaiting_approval` and no `approved_at` → OK.
    2. `type` `create_draft` with status `ready` → OK; `type` `nope` → `23514`.
    3. `delegates`: `email` with upper case → `23514`; a name of 101 characters → `23514`; two delegates with the same email in one org → `23505`; the same email in two orgs → OK.
    4. `delegations`: status `sent` without `sent_message_id` → `23514`; with both → OK; a `delegate_id` of another org → `23503`; two delegations with the same `send_action_id` → `23505`; `answered_email_id` of a deleted mail becomes NULL (insert, delete the answer mail, select).
    5. `outbox` rows of kind `approval`, `approval_set`, `send_result`, `delegation_answered` with `email_id` → OK; `approval` without `email_id` → `23514`; `digest` still needs `digest_id`.
    6. `pg_indexes` lists `delegates_org_email_key`, `actions_depends_on_idx`, `actions_org_type_status_idx`, `delegations_mailbox_status_idx`, `delegations_status_due_idx`.
  - Check: `bun run dev:up && bun run db:migrate && bun run db:types && bun run lint && bun run typecheck && bun run test:int`. Round trip: `bun run db:rollback && bun run db:migrate` both succeed, also with one `approval` outbox row and one `create_draft` action inserted by hand before the rollback. `git diff --stat apps/server/src/platform/db/schema.ts` shows only the two new tables and the new column.
  - Done when: the tests pass and the round trip works.
  - Out of scope: repository functions (stages 7, 10); the `delegation` module files.
