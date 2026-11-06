-- migrate:up
ALTER TABLE mailboxes ADD COLUMN status_changed_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE memberships ALTER COLUMN digest_times SET DEFAULT '{08:00,16:00}';

CREATE TABLE chat_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  user_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('telegram')),
  external_chat_id bigint NOT NULL CHECK (external_chat_id > 0),
  linked_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, user_id) REFERENCES memberships (org_id, user_id) ON DELETE CASCADE,
  UNIQUE (channel, external_chat_id),
  UNIQUE (org_id, user_id, channel)
);

CREATE TABLE chat_link_tokens (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  org_id uuid NOT NULL,
  user_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, user_id) REFERENCES memberships (org_id, user_id) ON DELETE CASCADE
);

CREATE INDEX chat_link_tokens_member_idx ON chat_link_tokens (org_id, user_id);

CREATE TABLE digests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  user_id uuid NOT NULL,
  slot_key text NOT NULL CHECK (slot_key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$'),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start),
  FOREIGN KEY (org_id, user_id) REFERENCES memberships (org_id, user_id) ON DELETE CASCADE,
  UNIQUE (org_id, user_id, slot_key),
  UNIQUE (id, org_id)
);

CREATE TABLE outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('digest', 'urgent', 'auth_error', 'sync_stale', 'sync_ok')),
  dedup_key text NOT NULL CHECK (length(dedup_key) BETWEEN 1 AND 200),
  email_id uuid,
  mailbox_id uuid,
  digest_id uuid,
  text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 4096),
  buttons jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(buttons) = 'array'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL,
  locked_at timestamptz,
  sent_at timestamptz,
  external_message_id bigint,
  error_code text CHECK (error_code ~ '^[a-z0-9_]{1,40}$'),
  created_at timestamptz NOT NULL,
  CHECK ((kind = 'digest') = (digest_id IS NOT NULL)),
  CHECK (kind <> 'urgent' OR email_id IS NOT NULL),
  CHECK (kind NOT IN ('auth_error', 'sync_stale', 'sync_ok') OR mailbox_id IS NOT NULL),
  CHECK ((status = 'sent') = (sent_at IS NOT NULL)),
  CHECK (status <> 'sending' OR locked_at IS NOT NULL),
  FOREIGN KEY (org_id, user_id) REFERENCES memberships (org_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (email_id, org_id) REFERENCES emails (id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (mailbox_id, org_id) REFERENCES mailboxes (id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (digest_id, org_id) REFERENCES digests (id, org_id) ON DELETE CASCADE,
  UNIQUE (org_id, user_id, dedup_key)
);

CREATE INDEX outbox_due_idx ON outbox (status, next_attempt_at);
CREATE INDEX outbox_mailbox_kind_idx ON outbox (org_id, mailbox_id, kind);

-- migrate:down
DROP TABLE outbox;
DROP TABLE digests;
DROP TABLE chat_link_tokens;
DROP TABLE chat_links;
ALTER TABLE memberships ALTER COLUMN digest_times SET DEFAULT '{}';
ALTER TABLE mailboxes DROP COLUMN status_changed_at;
