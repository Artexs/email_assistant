-- migrate:up
CREATE INDEX outbox_email_idx ON outbox (email_id) WHERE email_id IS NOT NULL;
CREATE INDEX outbox_digest_idx ON outbox (digest_id) WHERE digest_id IS NOT NULL;
CREATE INDEX emails_org_created_idx ON emails (org_id, created_at);

-- migrate:down
DROP INDEX emails_org_created_idx;
DROP INDEX outbox_digest_idx;
DROP INDEX outbox_email_idx;
