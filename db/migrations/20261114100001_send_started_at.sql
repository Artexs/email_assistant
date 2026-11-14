-- migrate:up
-- When a send entered `applying` (its SMTP try started). The send limits count sends by it (PD-044).
ALTER TABLE actions ADD COLUMN send_started_at timestamptz;

-- Sends that may have reached people (applying, applied, failed with an unknown outcome) get their best known time.
UPDATE actions
SET send_started_at = coalesce(applied_at, updated_at)
WHERE type = 'send'
  AND (status IN ('applying', 'applied') OR (status = 'failed' AND status_reason = 'outcome_unknown'));

CREATE INDEX actions_send_started_idx ON actions (org_id, send_started_at)
  WHERE type = 'send' AND send_started_at IS NOT NULL;

-- migrate:down
DROP INDEX actions_send_started_idx;
ALTER TABLE actions DROP COLUMN send_started_at;
