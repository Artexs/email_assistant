-- migrate:up
ALTER TABLE actions ADD COLUMN applied_at timestamptz;
ALTER TABLE actions ADD CONSTRAINT actions_applied_at_check CHECK (status NOT IN ('applied', 'undone') OR applied_at IS NOT NULL);
CREATE UNIQUE INDEX actions_reverse_key ON actions (reverses_action_id) WHERE reverses_action_id IS NOT NULL;
CREATE INDEX actions_email_type_idx ON actions (email_id, type);

ALTER TABLE emails ADD COLUMN inbox_uid bigint;
ALTER TABLE emails ADD COLUMN moved_at timestamptz;
UPDATE emails SET inbox_uid = uid WHERE folder = 'INBOX';
CREATE INDEX emails_claim_idx ON emails (mailbox_id, status, received_at);
CREATE INDEX emails_moved_idx ON emails (mailbox_id, moved_at) WHERE folder <> 'INBOX';
CREATE INDEX emails_returned_idx ON emails (mailbox_id) WHERE returned_at IS NOT NULL;

ALTER TABLE outbox DROP CONSTRAINT outbox_kind_check;
ALTER TABLE outbox ADD CONSTRAINT outbox_kind_check CHECK (kind IN ('digest', 'urgent', 'auth_error', 'sync_stale', 'sync_ok', 'action_failed'));
ALTER TABLE outbox DROP CONSTRAINT outbox_check1;
ALTER TABLE outbox ADD CONSTRAINT outbox_email_kind_check CHECK (kind NOT IN ('urgent', 'action_failed') OR email_id IS NOT NULL);

-- migrate:down
DELETE FROM outbox WHERE kind = 'action_failed';
ALTER TABLE outbox DROP CONSTRAINT outbox_email_kind_check;
ALTER TABLE outbox ADD CONSTRAINT outbox_check1 CHECK (kind <> 'urgent' OR email_id IS NOT NULL);
ALTER TABLE outbox DROP CONSTRAINT outbox_kind_check;
ALTER TABLE outbox ADD CONSTRAINT outbox_kind_check CHECK (kind IN ('digest', 'urgent', 'auth_error', 'sync_stale', 'sync_ok'));
DROP INDEX emails_returned_idx;
DROP INDEX emails_moved_idx;
DROP INDEX emails_claim_idx;
ALTER TABLE emails DROP COLUMN moved_at;
ALTER TABLE emails DROP COLUMN inbox_uid;
DROP INDEX actions_email_type_idx;
DROP INDEX actions_reverse_key;
ALTER TABLE actions DROP CONSTRAINT actions_applied_at_check;
ALTER TABLE actions DROP COLUMN applied_at;
