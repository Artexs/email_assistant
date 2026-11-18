-- migrate:up
-- F110 stage 22: the data of bulk unsubscribe. Expand only: one new nullable column and one new table. The code of the
-- previous release never writes the column or reads the table, so it runs on this schema (the column has no default and
-- no constraint; no old row changes). No URL is stored: a link in a mail is untrusted text and stays in `email_headers`.

-- Does the mail offer RFC 8058 one-click? `true` when the topmost `List-Unsubscribe-Post` value is
-- `List-Unsubscribe=One-Click` (trimmed, case-insensitive); `false` for a mail captured after this migration that has no
-- such header or another value. Old rows stay NULL (no backfill of headers that were not stored).
ALTER TABLE email_headers ADD COLUMN list_unsubscribe_post boolean;

-- One row per (mailbox, sender): the intent to unsubscribe, written before any request goes out. It holds the sender
-- address and its domain, a status and a short code of the result. `code` is never a URL: `http_<status>`, `timeout`,
-- `private_host`, `redirect`, `tls` (the CHECK refuses ':', '/' and '.'). A data-request erase of the sender deletes the
-- row (a cleaned value would hit the unique key on the second erase).
CREATE TABLE unsubscribe_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  mailbox_id uuid NOT NULL,
  sender_lower text NOT NULL
    CHECK (sender_lower = lower(sender_lower) AND char_length(sender_lower) BETWEEN 3 AND 254),
  sender_domain text NOT NULL
    CHECK (sender_domain = lower(sender_domain) AND char_length(sender_domain) BETWEEN 1 AND 253),
  method text NOT NULL CHECK (method IN ('one_click')),
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'done', 'failed', 'refused')),
  code text CHECK (code ~ '^[a-z0-9_]{1,40}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  FOREIGN KEY (mailbox_id, org_id) REFERENCES mailboxes (id, org_id) ON DELETE CASCADE,
  -- The sender address ends with '@' and its domain: the two columns cannot disagree.
  CONSTRAINT unsubscribe_requests_domain_check CHECK (right(sender_lower, char_length(sender_domain) + 1) = '@' || sender_domain),
  -- One request per sender and mailbox; the key also serves the foreign key (it starts with `mailbox_id`).
  UNIQUE (mailbox_id, sender_lower)
);

CREATE INDEX unsubscribe_requests_org_idx ON unsubscribe_requests (org_id);

ALTER TABLE unsubscribe_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON unsubscribe_requests FOR ALL TO app
  USING (app_current_org() IS NULL OR org_id = app_current_org())
  WITH CHECK (app_current_org() IS NULL OR org_id = app_current_org());

-- migrate:down
-- The table and the column hold only data that this migration made: the unsubscribe intents and the one-click flag.
DROP POLICY tenant_rows ON unsubscribe_requests;
ALTER TABLE unsubscribe_requests DISABLE ROW LEVEL SECURITY;
DROP TABLE unsubscribe_requests;
ALTER TABLE email_headers DROP COLUMN list_unsubscribe_post;
