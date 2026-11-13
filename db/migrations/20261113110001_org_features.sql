-- migrate:up
-- Per-organization feature flags (ADR 0027). No row = the registry default (packages/core/src/features.ts).
-- The key list is not in SQL: the registry is the source, the repository refuses an unknown key.
CREATE TABLE org_features (
  org_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  flag text NOT NULL CHECK (flag ~ '^[a-z][a-z0-9_]{0,39}$'),
  enabled boolean NOT NULL,
  set_by text NOT NULL CHECK (length(set_by) > 0),
  set_at timestamptz NOT NULL,
  PRIMARY KEY (org_id, flag)
);

-- migrate:down
DROP TABLE org_features;
