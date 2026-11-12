-- migrate:up
ALTER TABLE mailboxes
  ADD COLUMN smtp_security text NOT NULL DEFAULT 'tls' CHECK (smtp_security IN ('tls', 'starttls'));

-- migrate:down
ALTER TABLE mailboxes DROP COLUMN smtp_security;
