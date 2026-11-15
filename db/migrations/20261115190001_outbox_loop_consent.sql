-- migrate:up
-- F116 stage 11: a new notice kind `loop_consent`. An owner whose Telegram consent does not cover open-loop data gets one
-- fixed line instead of a follow-up card (no recipient, no text). The list only grows: the code of the previous release
-- never writes the new kind, so every row it writes passes the check.
ALTER TABLE outbox DROP CONSTRAINT outbox_kind_check;
ALTER TABLE outbox ADD CONSTRAINT outbox_kind_check CHECK (kind IN (
  'digest', 'urgent', 'auth_error', 'sync_stale', 'sync_ok', 'action_failed',
  'approval', 'approval_set', 'send_result', 'delegation_answered', 'mailbox_removed', 'send_held', 'weekly_report',
  'host_blocked', 'not_triaged', 'approval_edit', 'sent_missing', 'trust_report_ready', 'autonomy_paused', 'loop_consent'));

-- migrate:down
-- The old list refuses the kind: drop its notices, then the check and the value.
DELETE FROM outbox WHERE kind = 'loop_consent';
ALTER TABLE outbox DROP CONSTRAINT outbox_kind_check;
ALTER TABLE outbox ADD CONSTRAINT outbox_kind_check CHECK (kind IN (
  'digest', 'urgent', 'auth_error', 'sync_stale', 'sync_ok', 'action_failed',
  'approval', 'approval_set', 'send_result', 'delegation_answered', 'mailbox_removed', 'send_held', 'weekly_report',
  'host_blocked', 'not_triaged', 'approval_edit', 'sent_missing', 'trust_report_ready', 'autonomy_paused'));
