-- migrate:up
-- F116 stage 07: open loops. Expand only: new tables, new columns with defaults, a new index. No old column or
-- constraint changes, so the code of the old release runs on this schema. The loop texts and addresses are copies from
-- sent mail (F104): the rows are in the privacy registries (`address-map.ts`, `export-map.ts`) and expire by retention.

-- One row per thing the user waits for (`waiting`), promised (`promised`) or handed to a delegate by hand (`delegated`).
-- `sent_email_id` is the Sent mail that opened the loop and `last_sent_email_id` the newest own mail that restarted the
-- wait. Both are cleared (not deleted) when the Sent row goes: the loop keeps its own copy of subject, recipients and ids.
-- The composite foreign keys `SET NULL (col)` clear only the id column: `org_id` is NOT NULL and stays.
CREATE TABLE open_loops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  mailbox_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('waiting', 'promised', 'delegated')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  close_reason text CHECK (close_reason IN (
    'replied', 'replied_subject', 'done', 'dropped', 'untracked', 'stale', 'later_reply', 'expired', 'sent_off')),
  sent_email_id uuid,
  last_sent_email_id uuid,
  thread_key text NOT NULL,
  message_id text,
  references_ids text[] NOT NULL DEFAULT '{}',
  subject text CHECK (char_length(subject) <= 300),
  to_addresses text[] NOT NULL DEFAULT '{}',
  cc_addresses text[] NOT NULL DEFAULT '{}',
  counterpart text,
  delegate_id uuid,
  text text CHECK (char_length(text) <= 80),
  language text NOT NULL CHECK (language IN ('pl', 'en')),
  due_at timestamptz NOT NULL,
  due_source text NOT NULL CHECK (due_source IN ('stated', 'default')),
  wait_from_at timestamptz NOT NULL,
  later_count integer NOT NULL DEFAULT 0 CHECK (later_count BETWEEN 0 AND 3),
  follow_ups_sent integer NOT NULL DEFAULT 0 CHECK (follow_ups_sent BETWEEN 0 AND 2),
  last_follow_up_at timestamptz,
  surfaced_at timestamptz,
  auto_reply_at timestamptz,
  stale_notified_at timestamptz,
  closed_at timestamptz,
  closed_by_email_id uuid,
  closed_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  texts_cleared_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (mailbox_id, org_id) REFERENCES mailboxes (id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (sent_email_id, org_id) REFERENCES sent_emails (id, org_id) ON DELETE SET NULL (sent_email_id),
  FOREIGN KEY (last_sent_email_id, org_id) REFERENCES sent_emails (id, org_id) ON DELETE SET NULL (last_sent_email_id),
  FOREIGN KEY (closed_by_email_id, org_id) REFERENCES emails (id, org_id) ON DELETE SET NULL (closed_by_email_id),
  FOREIGN KEY (delegate_id, org_id) REFERENCES delegates (id, org_id),
  UNIQUE (id, org_id),
  CONSTRAINT open_loops_delegate_check CHECK ((delegate_id IS NOT NULL) = (kind = 'delegated')),
  CONSTRAINT open_loops_closed_check CHECK (
    (status = 'closed' AND closed_at IS NOT NULL AND close_reason IS NOT NULL)
    OR (status = 'open' AND closed_at IS NULL AND close_reason IS NULL)
  ),
  CONSTRAINT open_loops_recipients_check CHECK (cardinality(to_addresses) + cardinality(cc_addresses) <= 10)
);

-- A Sent mail opens at most one loop of each kind (a repeat of the analysis cannot double a loop).
CREATE UNIQUE INDEX open_loops_sent_kind_key ON open_loops (org_id, sent_email_id, kind) WHERE sent_email_id IS NOT NULL;
CREATE INDEX open_loops_mailbox_status_due_idx ON open_loops (org_id, mailbox_id, status, due_at);
CREATE INDEX open_loops_thread_idx ON open_loops (mailbox_id, thread_key) WHERE status = 'open';
-- The foreign keys with an action: a delete in the parent table finds its loops by index.
CREATE INDEX open_loops_last_sent_idx ON open_loops (last_sent_email_id) WHERE last_sent_email_id IS NOT NULL;
CREATE INDEX open_loops_sent_idx ON open_loops (sent_email_id) WHERE sent_email_id IS NOT NULL;
CREATE INDEX open_loops_closed_by_email_idx ON open_loops (closed_by_email_id) WHERE closed_by_email_id IS NOT NULL;
CREATE INDEX open_loops_delegate_idx ON open_loops (delegate_id) WHERE delegate_id IS NOT NULL;

-- The state of the analysis of one Sent mail. Codes and counters only: no mail text, no address.
CREATE TABLE sent_analyses (
  sent_email_id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  mailbox_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'done', 'skipped', 'failed')),
  skip_reason text CHECK (skip_reason IN (
    'own_only', 'system_draft', 'list', 'auto', 'calendar', 'too_many', 'no_text', 'too_old', 'thread_restart',
    'delegation_thread', 'llm_cap')),
  expects_reply boolean,
  has_promise boolean,
  prompt_version text,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (sent_email_id, org_id) REFERENCES sent_emails (id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (mailbox_id, org_id) REFERENCES mailboxes (id, org_id) ON DELETE CASCADE
);

CREATE INDEX sent_analyses_org_idx ON sent_analyses (org_id);
CREATE INDEX sent_analyses_mailbox_idx ON sent_analyses (mailbox_id);
CREATE INDEX sent_analyses_pending_idx ON sent_analyses (mailbox_id, next_attempt_at) WHERE status = 'pending';

ALTER TABLE open_loops ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON open_loops FOR ALL TO app
  USING (app_current_org() IS NULL OR org_id = app_current_org())
  WITH CHECK (app_current_org() IS NULL OR org_id = app_current_org());

ALTER TABLE sent_analyses ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON sent_analyses FOR ALL TO app
  USING (app_current_org() IS NULL OR org_id = app_current_org())
  WITH CHECK (app_current_org() IS NULL OR org_id = app_current_org());

-- A hand forward to a delegate (F116) is a loop, not a delegation. A delegation made by the Delegate button (stage 16)
-- has source `button`.
ALTER TABLE delegations
  ADD COLUMN source text NOT NULL DEFAULT 'triage',
  ADD CONSTRAINT delegations_source_check CHECK (source IN ('triage', 'button'));

-- Working days a Waiting loop waits for an answer when the mail states no date.
ALTER TABLE mailbox_settings
  ADD COLUMN loop_wait_days integer NOT NULL DEFAULT 3,
  ADD CONSTRAINT mailbox_settings_loop_wait_days_check CHECK (loop_wait_days BETWEEN 1 AND 10);

-- The loop matcher and the "waiting on you" reader read the mails of one thread by time. F115 plans the same columns.
CREATE INDEX IF NOT EXISTS emails_thread_received_idx ON emails (mailbox_id, thread_key, received_at);

-- migrate:down
-- The index: the name is shared with F115 stage 03. If that migration made it first, this drop removes its index too;
-- the F115 migration then has to be run again (an index holds no data).
DROP INDEX IF EXISTS emails_thread_received_idx;

ALTER TABLE mailbox_settings
  DROP CONSTRAINT mailbox_settings_loop_wait_days_check,
  DROP COLUMN loop_wait_days;

ALTER TABLE delegations
  DROP CONSTRAINT delegations_source_check,
  DROP COLUMN source;

DROP POLICY tenant_rows ON sent_analyses;
ALTER TABLE sent_analyses DISABLE ROW LEVEL SECURITY;
DROP POLICY tenant_rows ON open_loops;
ALTER TABLE open_loops DISABLE ROW LEVEL SECURITY;

DROP TABLE sent_analyses;
DROP TABLE open_loops;
