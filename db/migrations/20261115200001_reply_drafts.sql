-- migrate:up
-- F115 stage 03: reply drafts. Expand only: two new tables, a copy of data, and two CHECK lists that only grow. No old
-- column or constraint is removed or narrowed, so the code of the old release runs on this schema: it never writes the
-- new tables or the new notice kinds. `organizations.style_text` stays (E6b drops it). The index of the thread read,
-- `emails_thread_received_idx`, exists since F116 (`20261115160001_open_loops.sql`): this migration creates and drops none.
-- The texts of a request (instruction, sample body) and of a profile are mail-derived or user text: they are in the
-- privacy registries (`address-map.ts`, `export-map.ts`, the legal registries) and a request text expires by retention.

-- The work list of the drafter. After drafting, the pair of actions is the truth; a request only says why and when.
-- `previous_send_id` (the draft that a redraft replaces) and `send_action_id` (the draft that this request made) clear
-- only their own column when a data-request erase deletes the action: `org_id` is NOT NULL and stays.
CREATE TABLE reply_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  mailbox_id uuid NOT NULL,
  email_id uuid NOT NULL,
  thread_key text NOT NULL,
  folder text NOT NULL,
  trigger text NOT NULL CHECK (trigger IN ('auto', 'tap', 'redraft', 'sample')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'drafting', 'done', 'no_draft', 'failed', 'cancelled', 'superseded')),
  reason_code text CHECK (char_length(reason_code) <= 40),
  instruction text CHECK (char_length(instruction) <= 300),
  requested_by uuid REFERENCES users (id) ON DELETE SET NULL,
  previous_send_id uuid,
  send_action_id uuid,
  sample_body text CHECK (char_length(sample_body) <= 2000),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (email_id, org_id) REFERENCES emails (id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (mailbox_id, org_id) REFERENCES mailboxes (id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (previous_send_id, org_id) REFERENCES actions (id, org_id) ON DELETE SET NULL (previous_send_id),
  FOREIGN KEY (send_action_id, org_id) REFERENCES actions (id, org_id) ON DELETE SET NULL (send_action_id)
);

-- A mail gets at most one automatic request: a repeat of the scan cannot double it. Taps, redrafts and samples repeat.
CREATE UNIQUE INDEX reply_requests_auto_key ON reply_requests (org_id, email_id) WHERE trigger = 'auto';
-- The claim of the drafter reads the open requests by due time.
CREATE INDEX reply_requests_queue_idx ON reply_requests (org_id, status, next_attempt_at);
-- The foreign keys: a delete in the parent table finds its requests by index (the list by mail uses the first one too).
CREATE INDEX reply_requests_email_idx ON reply_requests (org_id, email_id);
CREATE INDEX reply_requests_mailbox_idx ON reply_requests (mailbox_id);
CREATE INDEX reply_requests_previous_send_idx ON reply_requests (previous_send_id) WHERE previous_send_id IS NOT NULL;
CREATE INDEX reply_requests_send_action_idx ON reply_requests (send_action_id) WHERE send_action_id IS NOT NULL;

-- The name, the signature and the writing style of one mailbox. All texts are optional.
CREATE TABLE mailbox_profiles (
  mailbox_id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  display_name text CHECK (char_length(display_name) <= 100),
  signature text CHECK (char_length(signature) <= 1000),
  writing_style text CHECK (char_length(writing_style) <= 1000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users (id) ON DELETE SET NULL,
  FOREIGN KEY (mailbox_id, org_id) REFERENCES mailboxes (id, org_id) ON DELETE CASCADE
);

CREATE INDEX mailbox_profiles_org_idx ON mailbox_profiles (org_id);

ALTER TABLE reply_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON reply_requests FOR ALL TO app
  USING (app_current_org() IS NULL OR org_id = app_current_org())
  WITH CHECK (app_current_org() IS NULL OR org_id = app_current_org());

ALTER TABLE mailbox_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON mailbox_profiles FOR ALL TO app
  USING (app_current_org() IS NULL OR org_id = app_current_org())
  WITH CHECK (app_current_org() IS NULL OR org_id = app_current_org());

-- Expand step: each mailbox starts with the signature of its organization. The organization text stays as it is.
-- `left` keeps the copy inside the CHECK for a long old value (the form allows 500 characters).
INSERT INTO mailbox_profiles (mailbox_id, org_id, signature)
SELECT m.id, m.org_id, left(NULLIF(o.style_text, ''), 1000)
FROM mailboxes m
JOIN organizations o ON o.id = m.org_id;

-- Three notice kinds. `reply_prompt` and `reply_result` name a mail; `replies_ready` is a count and names none.
-- The list only grows: the code of the previous release never writes the new kinds. A release that reads such a row
-- cannot parse it (the rollback note in the F115 plan, owner default 28).
ALTER TABLE outbox DROP CONSTRAINT outbox_kind_check;
ALTER TABLE outbox ADD CONSTRAINT outbox_kind_check CHECK (kind IN (
  'digest', 'urgent', 'auth_error', 'sync_stale', 'sync_ok', 'action_failed',
  'approval', 'approval_set', 'send_result', 'delegation_answered', 'mailbox_removed', 'send_held', 'weekly_report',
  'host_blocked', 'not_triaged', 'approval_edit', 'sent_missing', 'trust_report_ready', 'autonomy_paused', 'loop_consent',
  'replies_ready', 'reply_prompt', 'reply_result'));

ALTER TABLE outbox DROP CONSTRAINT outbox_email_kind_check;
ALTER TABLE outbox ADD CONSTRAINT outbox_email_kind_check
  CHECK (kind NOT IN (
    'urgent', 'action_failed', 'approval', 'approval_set', 'send_result', 'delegation_answered',
    'reply_prompt', 'reply_result')
    OR email_id IS NOT NULL OR loop_id IS NOT NULL);

-- migrate:down
-- The old lists refuse the new kinds: drop their notices first, then the checks, then the tables. The profiles hold
-- text that users typed after the migration; a rollback loses it (the organization text is untouched).
DELETE FROM outbox WHERE kind IN ('replies_ready', 'reply_prompt', 'reply_result');

ALTER TABLE outbox DROP CONSTRAINT outbox_email_kind_check;
ALTER TABLE outbox ADD CONSTRAINT outbox_email_kind_check
  CHECK (kind NOT IN ('urgent', 'action_failed', 'approval', 'approval_set', 'send_result', 'delegation_answered')
    OR email_id IS NOT NULL OR loop_id IS NOT NULL);

ALTER TABLE outbox DROP CONSTRAINT outbox_kind_check;
ALTER TABLE outbox ADD CONSTRAINT outbox_kind_check CHECK (kind IN (
  'digest', 'urgent', 'auth_error', 'sync_stale', 'sync_ok', 'action_failed',
  'approval', 'approval_set', 'send_result', 'delegation_answered', 'mailbox_removed', 'send_held', 'weekly_report',
  'host_blocked', 'not_triaged', 'approval_edit', 'sent_missing', 'trust_report_ready', 'autonomy_paused', 'loop_consent'));

DROP TABLE mailbox_profiles;
DROP TABLE reply_requests;
