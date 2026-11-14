-- migrate:up
-- Captured headers of a stored mail (one row per mail). Text fields follow the mail body retention; counts and codes stay.
CREATE TABLE email_headers (
  email_id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  from_name text CHECK (char_length(from_name) <= 200),
  reply_to text[] NOT NULL DEFAULT '{}' CHECK (cardinality(reply_to) <= 5),
  return_path text CHECK (char_length(return_path) <= 320),
  auth_results text CHECK (char_length(auth_results) <= 1000),
  list_unsubscribe text CHECK (char_length(list_unsubscribe) <= 1000),
  list_id text CHECK (char_length(list_id) <= 300),
  auto_submitted text CHECK (char_length(auto_submitted) <= 100),
  precedence text CHECK (char_length(precedence) <= 50),
  has_calendar boolean NOT NULL DEFAULT false,
  attachments jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(attachments) = 'array'),
  attachment_count integer NOT NULL DEFAULT 0 CHECK (attachment_count >= 0),
  links jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(links) = 'array'),
  link_count integer NOT NULL DEFAULT 0 CHECK (link_count >= 0),
  parts_known boolean NOT NULL,
  captured_at timestamptz NOT NULL,
  texts_cleared_at timestamptz,
  FOREIGN KEY (email_id, org_id) REFERENCES emails (id, org_id) ON DELETE CASCADE
);
CREATE INDEX email_headers_retention_idx ON email_headers (org_id, captured_at) WHERE texts_cleared_at IS NULL;

-- IMAP flags of a stored mail, refreshed by the sync run; the first time each flag was seen; the answered check of /review.
CREATE TABLE email_flags (
  email_id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  seen boolean NOT NULL,
  answered boolean NOT NULL,
  flagged boolean NOT NULL,
  first_seen_at timestamptz,
  first_answered_at timestamptz,
  first_flagged_at timestamptz,
  checked_at timestamptz NOT NULL,
  answered_check text CHECK (answered_check IN ('yes', 'no')),
  answered_check_at timestamptz,
  answered_check_by uuid REFERENCES users (id) ON DELETE SET NULL,
  CHECK ((answered_check IS NULL) = (answered_check_at IS NULL)),
  FOREIGN KEY (email_id, org_id) REFERENCES emails (id, org_id) ON DELETE CASCADE
);
CREATE INDEX email_flags_answered_open_idx ON email_flags (org_id) WHERE answered AND answered_check IS NULL;

-- Reject reasons and "this was a mistake" marks on actions (serious-mistake metric).
CREATE TABLE action_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  action_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('reject_reason', 'mistake')),
  reason text CHECK (reason IN ('wrong_person', 'wrong_content', 'not_needed')),
  user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  via text NOT NULL CHECK (via IN ('telegram', 'web', 'cli')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK ((kind = 'reject_reason') = (reason IS NOT NULL)),
  UNIQUE (org_id, action_id, kind),
  FOREIGN KEY (action_id, org_id) REFERENCES actions (id, org_id) ON DELETE CASCADE
);

-- Row-level security as for every table with org_id (the block of 20261114100002_rls_tenant_policies.sql).
ALTER TABLE email_headers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON email_headers FOR ALL TO app
  USING (app_current_org() IS NULL OR org_id = app_current_org())
  WITH CHECK (app_current_org() IS NULL OR org_id = app_current_org());

ALTER TABLE email_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON email_flags FOR ALL TO app
  USING (app_current_org() IS NULL OR org_id = app_current_org())
  WITH CHECK (app_current_org() IS NULL OR org_id = app_current_org());

ALTER TABLE action_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON action_feedback FOR ALL TO app
  USING (app_current_org() IS NULL OR org_id = app_current_org())
  WITH CHECK (app_current_org() IS NULL OR org_id = app_current_org());

-- Labels from the answered check of /review get their own source.
ALTER TABLE triage_feedback DROP CONSTRAINT triage_feedback_source_check;
ALTER TABLE triage_feedback ADD CONSTRAINT triage_feedback_source_check
  CHECK (source IN ('cli', 'telegram', 'undo', 'imap_move', 'web', 'review', 'answered_check'));

-- migrate:down
DELETE FROM triage_feedback WHERE source = 'answered_check';
ALTER TABLE triage_feedback DROP CONSTRAINT triage_feedback_source_check;
ALTER TABLE triage_feedback ADD CONSTRAINT triage_feedback_source_check
  CHECK (source IN ('cli', 'telegram', 'undo', 'imap_move', 'web', 'review'));
DROP TABLE action_feedback;
DROP TABLE email_flags;
DROP TABLE email_headers;
