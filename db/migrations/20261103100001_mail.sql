-- migrate:up
CREATE TABLE mailboxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  protocol text NOT NULL DEFAULT 'imap' CHECK (protocol IN ('imap')),
  address text NOT NULL CHECK (length(address) > 0),
  imap_host text NOT NULL,
  imap_port integer NOT NULL CHECK (imap_port BETWEEN 1 AND 65535),
  smtp_host text NOT NULL,
  smtp_port integer NOT NULL CHECK (smtp_port BETWEEN 1 AND 65535),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'auth_error', 'paused')),
  uidvalidity bigint,
  last_uid bigint,
  last_synced_at timestamptz,
  capabilities jsonb NOT NULL DEFAULT '{}',
  folder_map jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id)
);

CREATE UNIQUE INDEX mailboxes_org_address_key ON mailboxes (org_id, lower(address));

CREATE TABLE mailbox_credentials (
  mailbox_id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  encrypted_secret text NOT NULL,
  secret_kind text NOT NULL CHECK (secret_kind IN ('password', 'app_password')),
  key_version integer NOT NULL CHECK (key_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (mailbox_id, org_id) REFERENCES mailboxes (id, org_id) ON DELETE CASCADE
);

CREATE TABLE mailbox_settings (
  mailbox_id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  mode text NOT NULL DEFAULT 'shadow' CHECK (mode IN ('shadow', 'assist')),
  tool_switches jsonb NOT NULL DEFAULT '{}',
  category_policy jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (mailbox_id, org_id) REFERENCES mailboxes (id, org_id) ON DELETE CASCADE
);

CREATE TABLE emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  mailbox_id uuid NOT NULL,
  dedup_key text NOT NULL,
  message_id_header text,
  content_hash text NOT NULL,
  uid bigint NOT NULL,
  folder text NOT NULL DEFAULT 'INBOX',
  returned_at timestamptz,
  thread_key text NOT NULL,
  in_reply_to text,
  references_header text,
  from_address text,
  to_addresses text[] NOT NULL DEFAULT '{}',
  cc_addresses text[] NOT NULL DEFAULT '{}',
  subject text,
  received_at timestamptz NOT NULL,
  body_text text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'triaged', 'done', 'skipped')),
  skip_reason text,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (mailbox_id, org_id) REFERENCES mailboxes (id, org_id) ON DELETE CASCADE,
  UNIQUE (mailbox_id, dedup_key)
);

CREATE INDEX emails_mailbox_message_id_idx ON emails (mailbox_id, message_id_header);
CREATE INDEX emails_mailbox_hash_idx ON emails (mailbox_id, content_hash);
CREATE INDEX emails_org_id_idx ON emails (org_id);

-- migrate:down
DROP TABLE emails;
DROP TABLE mailbox_settings;
DROP TABLE mailbox_credentials;
DROP TABLE mailboxes;
