-- migrate:up
CREATE TABLE mailbox_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  mailbox_id uuid NOT NULL,
  key text NOT NULL CHECK (key ~ '^[a-z][a-z_]{0,19}$'),
  path text NOT NULL CHECK (length(path) BETWEEN 1 AND 200),
  role text NOT NULL CHECK (role IN ('inbox', 'sort', 'junk')),
  enabled boolean NOT NULL DEFAULT true,
  uidvalidity bigint,
  last_uid bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (mailbox_id, org_id) REFERENCES mailboxes (id, org_id) ON DELETE CASCADE,
  UNIQUE (mailbox_id, key),
  UNIQUE (mailbox_id, path),
  CONSTRAINT mailbox_folders_inbox_key_check CHECK ((key = 'inbox') = (role = 'inbox')),
  CONSTRAINT mailbox_folders_inbox_row_check CHECK (role <> 'inbox' OR (path = 'INBOX' AND enabled))
);
CREATE UNIQUE INDEX mailbox_folders_one_junk_idx ON mailbox_folders (mailbox_id) WHERE role = 'junk';
CREATE INDEX mailbox_folders_org_id_idx ON mailbox_folders (org_id);

INSERT INTO mailbox_folders (org_id, mailbox_id, key, path, role, uidvalidity, last_uid)
SELECT org_id, id, 'inbox', 'INBOX', 'inbox', uidvalidity, last_uid FROM mailboxes;

ALTER TABLE emails ADD COLUMN source_folder text NOT NULL DEFAULT 'INBOX';
DROP INDEX emails_moved_idx;
CREATE INDEX emails_moved_idx ON emails (mailbox_id, moved_at) WHERE folder <> source_folder;

-- migrate:down
DROP INDEX emails_moved_idx;
CREATE INDEX emails_moved_idx ON emails (mailbox_id, moved_at) WHERE folder <> 'INBOX';
ALTER TABLE emails DROP COLUMN source_folder;
DROP TABLE mailbox_folders;
