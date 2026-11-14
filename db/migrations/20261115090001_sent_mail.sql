-- migrate:up
-- Sent mail: what the user sent, apart from incoming mail, and one sync state row per mailbox.
CREATE TABLE sent_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  mailbox_id uuid NOT NULL,
  dedup_key text NOT NULL,
  path text NOT NULL CHECK (char_length(path) BETWEEN 1 AND 200),
  uidvalidity bigint NOT NULL,
  uid bigint NOT NULL,
  message_id text,
  parent_message_id text,
  references_ids text[] NOT NULL DEFAULT '{}',
  thread_key text NOT NULL,
  from_address text,
  to_addresses text[] NOT NULL DEFAULT '{}',
  cc_addresses text[] NOT NULL DEFAULT '{}',
  subject text,
  body_text text,
  auto_submitted text,
  precedence text,
  list_id text,
  has_calendar boolean,
  action_id uuid,
  origin text NOT NULL CHECK (origin IN ('user', 'system')),
  content text NOT NULL CHECK (content IN ('pending', 'stored', 'headers_only', 'gone')),
  sent_at timestamptz NOT NULL,
  internal_date timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (mailbox_id, org_id) REFERENCES mailboxes (id, org_id) ON DELETE CASCADE,
  UNIQUE (mailbox_id, dedup_key),
  UNIQUE (id, org_id),
  CONSTRAINT sent_emails_system_check CHECK (origin = 'user' OR (action_id IS NOT NULL AND content = 'headers_only')),
  CONSTRAINT sent_emails_body_check CHECK (body_text IS NULL OR content = 'stored')
);

CREATE INDEX sent_emails_org_idx ON sent_emails (org_id);
CREATE INDEX sent_emails_org_internal_date_idx ON sent_emails (org_id, internal_date);
CREATE INDEX sent_emails_parent_idx ON sent_emails (mailbox_id, parent_message_id)
  WHERE origin = 'user' AND parent_message_id IS NOT NULL;
CREATE INDEX sent_emails_thread_idx ON sent_emails (mailbox_id, thread_key);
CREATE INDEX sent_emails_user_date_idx ON sent_emails (mailbox_id, path, internal_date) WHERE origin = 'user';
CREATE INDEX sent_emails_pending_idx ON sent_emails (mailbox_id, path, internal_date) WHERE content = 'pending';
CREATE INDEX sent_emails_action_idx ON sent_emails (action_id) WHERE action_id IS NOT NULL;

CREATE TABLE mailbox_sent_sync (
  mailbox_id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  enabled_at timestamptz,
  path text CHECK (path IS NULL OR char_length(path) BETWEEN 1 AND 200),
  uidvalidity bigint,
  last_uid bigint,
  first_pass_at timestamptz,
  last_pass_at timestamptz,
  last_error_code text CHECK (last_error_code IN ('no_folder', 'folder_missing', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (mailbox_id, org_id) REFERENCES mailboxes (id, org_id) ON DELETE CASCADE,
  CONSTRAINT mailbox_sent_sync_enabled_check CHECK (enabled = (enabled_at IS NOT NULL)),
  CONSTRAINT mailbox_sent_sync_cursor_check CHECK ((uidvalidity IS NULL) = (last_uid IS NULL)),
  CONSTRAINT mailbox_sent_sync_off_check CHECK (
    enabled
    OR (path IS NULL AND uidvalidity IS NULL AND last_uid IS NULL
      AND first_pass_at IS NULL AND last_pass_at IS NULL AND last_error_code IS NULL)
  )
);

CREATE INDEX mailbox_sent_sync_org_idx ON mailbox_sent_sync (org_id);

ALTER TABLE sent_emails ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON sent_emails FOR ALL TO app
  USING (app_current_org() IS NULL OR org_id = app_current_org())
  WITH CHECK (app_current_org() IS NULL OR org_id = app_current_org());

ALTER TABLE mailbox_sent_sync ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON mailbox_sent_sync FOR ALL TO app
  USING (app_current_org() IS NULL OR org_id = app_current_org())
  WITH CHECK (app_current_org() IS NULL OR org_id = app_current_org());

-- A sent mail whose base key has a tombstone (a data request erased it) inserts nothing.
CREATE TRIGGER emails_skip_tombstoned BEFORE INSERT ON sent_emails
  FOR EACH ROW EXECUTE FUNCTION emails_skip_tombstoned();

-- migrate:down
DROP TRIGGER emails_skip_tombstoned ON sent_emails;

DROP POLICY tenant_rows ON mailbox_sent_sync;
ALTER TABLE mailbox_sent_sync DISABLE ROW LEVEL SECURITY;
DROP POLICY tenant_rows ON sent_emails;
ALTER TABLE sent_emails DISABLE ROW LEVEL SECURITY;

DROP TABLE mailbox_sent_sync;
DROP TABLE sent_emails;
