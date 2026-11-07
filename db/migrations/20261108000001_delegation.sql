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
