-- migrate:up
-- F109 stage 02: stored suspicious reason codes, the urgency profile, the not_triaged notice kind and a sender index.
-- Expand only: no column drop, no data rewrite. The code list below must equal `suspiciousReasons` in
-- packages/core/src/triage/suspicious.ts (a test compares them).
ALTER TABLE triage_results
  ADD COLUMN suspicious_reasons text[] NOT NULL DEFAULT '{}',
  ADD CONSTRAINT triage_results_suspicious_reasons_check CHECK (suspicious_reasons <@ ARRAY[
    'auth_fail', 'lookalike_domain', 'display_name_spoof', 'reply_to_mismatch', 'link_mismatch', 'risky_attachment'
  ]::text[]);

-- NULL means "no profile". The shape of the object is checked in code (Zod), not here.
ALTER TABLE mailbox_settings
  ADD COLUMN urgency_profile jsonb,
  ADD CONSTRAINT mailbox_settings_urgency_profile_check CHECK (
    urgency_profile IS NULL OR jsonb_typeof(urgency_profile) = 'object');

ALTER TABLE outbox DROP CONSTRAINT outbox_kind_check;
ALTER TABLE outbox ADD CONSTRAINT outbox_kind_check CHECK (kind IN (
  'digest', 'urgent', 'auth_error', 'sync_stale', 'sync_ok', 'action_failed',
  'approval', 'approval_set', 'send_result', 'delegation_answered', 'mailbox_removed', 'send_held', 'weekly_report',
  'host_blocked', 'not_triaged'));

-- emails.from_address is stored as the server sent it (mixed case), so the index holds lower(from_address): sender
-- queries must filter with lower(emails.from_address) = $sender to use it.
CREATE INDEX emails_mailbox_sender_idx ON emails (mailbox_id, lower(from_address), received_at);

-- migrate:down
DROP INDEX emails_mailbox_sender_idx;

-- Only the rows of the kind that the old list refuses go; every other row stays.
DELETE FROM outbox WHERE kind = 'not_triaged';
ALTER TABLE outbox DROP CONSTRAINT outbox_kind_check;
ALTER TABLE outbox ADD CONSTRAINT outbox_kind_check CHECK (kind IN (
  'digest', 'urgent', 'auth_error', 'sync_stale', 'sync_ok', 'action_failed',
  'approval', 'approval_set', 'send_result', 'delegation_answered', 'mailbox_removed', 'send_held', 'weekly_report',
  'host_blocked'));

ALTER TABLE mailbox_settings
  DROP CONSTRAINT mailbox_settings_urgency_profile_check,
  DROP COLUMN urgency_profile;

ALTER TABLE triage_results
  DROP CONSTRAINT triage_results_suspicious_reasons_check,
  DROP COLUMN suspicious_reasons;
