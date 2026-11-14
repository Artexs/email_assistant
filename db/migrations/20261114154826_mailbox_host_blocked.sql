-- migrate:up
ALTER TABLE mailboxes DROP CONSTRAINT mailboxes_status_check;
ALTER TABLE mailboxes ADD CONSTRAINT mailboxes_status_check CHECK (status IN ('active', 'auth_error', 'paused', 'host_blocked'));
ALTER TABLE outbox DROP CONSTRAINT outbox_kind_check;
ALTER TABLE outbox ADD CONSTRAINT outbox_kind_check CHECK (kind IN (
  'digest', 'urgent', 'auth_error', 'sync_stale', 'sync_ok', 'action_failed',
  'approval', 'approval_set', 'send_result', 'delegation_answered', 'mailbox_removed', 'send_held', 'weekly_report',
  'host_blocked'));
-- A host_blocked row names its mailbox (as auth_error, sync_stale, sync_ok and send_held do).
ALTER TABLE outbox ADD CONSTRAINT outbox_host_blocked_mailbox_check CHECK (kind <> 'host_blocked' OR mailbox_id IS NOT NULL);

-- migrate:down
-- Old code parses neither value: drop the notices, give the mailboxes back to the sync (it meets the guard again).
DELETE FROM outbox WHERE kind = 'host_blocked';
UPDATE mailboxes SET status = 'active', status_changed_at = now() WHERE status = 'host_blocked';
ALTER TABLE outbox DROP CONSTRAINT outbox_host_blocked_mailbox_check;
ALTER TABLE outbox DROP CONSTRAINT outbox_kind_check;
ALTER TABLE outbox ADD CONSTRAINT outbox_kind_check CHECK (kind IN (
  'digest', 'urgent', 'auth_error', 'sync_stale', 'sync_ok', 'action_failed',
  'approval', 'approval_set', 'send_result', 'delegation_answered', 'mailbox_removed', 'send_held', 'weekly_report'));
ALTER TABLE mailboxes DROP CONSTRAINT mailboxes_status_check;
ALTER TABLE mailboxes ADD CONSTRAINT mailboxes_status_check CHECK (status IN ('active', 'auth_error', 'paused'));
