-- migrate:up
-- Operator alert state: one row per incident of a service level. Host-wide (disk and backup have no organization), so no
-- org_id, like auth_lockouts. It holds codes and numbers only: no mail text, no address, no error text.
CREATE TABLE ops_alerts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('slo_sync_lag', 'slo_urgent_latency', 'slo_llm_errors', 'slo_disk', 'slo_backup_age')),
  opened_at timestamptz NOT NULL,
  open_sent_at timestamptz,
  last_sent_at timestamptz,
  notice_count integer NOT NULL DEFAULT 0 CHECK (notice_count >= 0),
  resolved_at timestamptz,
  resolved_sent_at timestamptz,
  facts jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(facts) = 'object')
);

-- One active incident per kind: openAlert relies on this index for its conflict rule.
CREATE UNIQUE INDEX ops_alerts_active_kind ON ops_alerts (kind) WHERE resolved_sent_at IS NULL;
CREATE INDEX ops_alerts_opened_idx ON ops_alerts (opened_at DESC);

-- migrate:down
DROP TABLE ops_alerts;
