-- migrate:up
ALTER TABLE outbox DROP CONSTRAINT outbox_kind_check;
ALTER TABLE outbox ADD CONSTRAINT outbox_kind_check CHECK (kind IN (
  'digest', 'urgent', 'auth_error', 'sync_stale', 'sync_ok', 'action_failed',
  'approval', 'approval_set', 'send_result', 'delegation_answered', 'mailbox_removed', 'send_held'));
-- A send_held row names its mailbox (as auth_error, sync_stale and sync_ok do).
ALTER TABLE outbox ADD CONSTRAINT outbox_send_held_mailbox_check CHECK (kind <> 'send_held' OR mailbox_id IS NOT NULL);

-- migrate:down
DELETE FROM outbox WHERE kind = 'send_held';
ALTER TABLE outbox DROP CONSTRAINT outbox_send_held_mailbox_check;
ALTER TABLE outbox DROP CONSTRAINT outbox_kind_check;
ALTER TABLE outbox ADD CONSTRAINT outbox_kind_check CHECK (kind IN (
  'digest', 'urgent', 'auth_error', 'sync_stale', 'sync_ok', 'action_failed',
  'approval', 'approval_set', 'send_result', 'delegation_answered', 'mailbox_removed'));
