-- migrate:up
ALTER TABLE emails ADD CONSTRAINT emails_id_org_key UNIQUE (id, org_id);
ALTER TABLE emails ADD COLUMN backfilled_at timestamptz;

CREATE TABLE sender_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  mailbox_id uuid,
  pattern text NOT NULL CHECK (length(pattern) > 0 AND pattern = lower(pattern)),
  kind text NOT NULL CHECK (kind IN ('whitelist', 'blocklist', 'vip')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (mailbox_id, org_id) REFERENCES mailboxes (id, org_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX sender_rules_key ON sender_rules (org_id, mailbox_id, pattern, kind) NULLS NOT DISTINCT;

CREATE TABLE triage_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  email_id uuid NOT NULL,
  category text NOT NULL CHECK (
    category IN ('urgent', 'needs_reply', 'delegation', 'info', 'notification', 'spam', 'unsure')
  ),
  vip boolean NOT NULL DEFAULT false,
  confidence real NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  reason_code text NOT NULL,
  reason text,
  fields jsonb NOT NULL DEFAULT '{}',
  model text,
  prompt_version text,
  tokens_in integer,
  tokens_out integer,
  latency_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (email_id, org_id) REFERENCES emails (id, org_id) ON DELETE CASCADE
);

CREATE INDEX triage_results_email_created_idx ON triage_results (email_id, created_at DESC);
CREATE INDEX triage_results_org_created_idx ON triage_results (org_id, created_at);

CREATE TABLE triage_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  email_id uuid NOT NULL,
  verdict text NOT NULL CHECK (verdict IN ('right', 'wrong')),
  true_category text CHECK (
    true_category IN ('urgent', 'needs_reply', 'delegation', 'info', 'notification', 'spam', 'unsure')
  ),
  source text NOT NULL CHECK (source IN ('cli', 'telegram', 'undo', 'imap_move', 'web')),
  user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (email_id, org_id) REFERENCES emails (id, org_id) ON DELETE CASCADE
);

CREATE INDEX triage_feedback_email_created_idx ON triage_feedback (email_id, created_at DESC);

CREATE TABLE actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  email_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('move', 'mark_read', 'flag', 'save_summary')),
  payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL CHECK (
    status IN (
      'ready',
      'applying',
      'applied',
      'awaiting_approval',
      'approved',
      'rejected',
      'expired',
      'undone',
      'logged',
      'failed'
    )
  ),
  status_reason text,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  locked_at timestamptz,
  last_error text,
  provider_result jsonb,
  idempotency_key text NOT NULL,
  outgoing_message_id text,
  depends_on_action_id uuid,
  reverses_action_id uuid,
  notified_at timestamptz,
  approved_by uuid REFERENCES users (id) ON DELETE SET NULL,
  approved_at timestamptz,
  approved_via text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (email_id, org_id) REFERENCES emails (id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (depends_on_action_id, org_id) REFERENCES actions (id, org_id),
  FOREIGN KEY (reverses_action_id, org_id) REFERENCES actions (id, org_id),
  UNIQUE (org_id, idempotency_key),
  UNIQUE (id, org_id)
);

CREATE INDEX actions_status_next_attempt_idx ON actions (status, next_attempt_at);
CREATE INDEX actions_email_id_idx ON actions (email_id);

CREATE TABLE audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  email_id uuid,
  action_id uuid,
  actor text NOT NULL,
  event text NOT NULL,
  reason_code text,
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (email_id, org_id) REFERENCES emails (id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (action_id, org_id) REFERENCES actions (id, org_id) ON DELETE CASCADE
);

CREATE INDEX audit_log_org_created_idx ON audit_log (org_id, created_at);
CREATE INDEX audit_log_org_event_created_idx ON audit_log (org_id, event, created_at);

REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM app;

-- migrate:down
DROP TABLE audit_log;
DROP TABLE actions;
DROP TABLE triage_feedback;
DROP TABLE triage_results;
DROP TABLE sender_rules;
ALTER TABLE emails DROP COLUMN backfilled_at;
ALTER TABLE emails DROP CONSTRAINT emails_id_org_key;
