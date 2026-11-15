-- migrate:up
ALTER TABLE outbox DROP CONSTRAINT outbox_kind_check;
ALTER TABLE outbox ADD CONSTRAINT outbox_kind_check CHECK (kind IN (
  'digest', 'urgent', 'auth_error', 'sync_stale', 'sync_ok', 'action_failed',
  'approval', 'approval_set', 'send_result', 'delegation_answered', 'mailbox_removed', 'send_held', 'weekly_report',
  'host_blocked', 'not_triaged', 'approval_edit', 'sent_missing'));
-- A sent_missing row names its mailbox (as host_blocked, auth_error and sync_stale do).
ALTER TABLE outbox ADD CONSTRAINT outbox_sent_missing_mailbox_check CHECK (kind <> 'sent_missing' OR mailbox_id IS NOT NULL);

-- migrate:down
-- The old list refuses the kind: drop its notices, then the check and the value.
DELETE FROM outbox WHERE kind = 'sent_missing';
ALTER TABLE outbox DROP CONSTRAINT outbox_sent_missing_mailbox_check;
ALTER TABLE outbox DROP CONSTRAINT outbox_kind_check;
ALTER TABLE outbox ADD CONSTRAINT outbox_kind_check CHECK (kind IN (
  'digest', 'urgent', 'auth_error', 'sync_stale', 'sync_ok', 'action_failed',
  'approval', 'approval_set', 'send_result', 'delegation_answered', 'mailbox_removed', 'send_held', 'weekly_report',
  'host_blocked', 'not_triaged', 'approval_edit'));
