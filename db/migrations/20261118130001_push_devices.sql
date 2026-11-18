-- migrate:up
-- Push devices and notice routes (phone channel). Expand only: one new table, one new outbox column, one new member
-- column and one CHECK list that only grows. No old column or constraint is removed or narrowed, so the code of the
-- previous release runs on this schema: it never writes the new table, the new column or a `push` row, and it never
-- reads `notice_routes`. (A release that reads a `push` row cannot render it: the plan of the phone channel says: no deploy between the fan-out stage and the sender stage.)
-- The two constraints on the new `outbox.push_subscription_id` are table constraints on an existing table, so `db:check-migrations`
-- reads them as contract statements. They hold no old data and refuse nothing that the previous release writes (it never writes
-- the column): the mark below only silences the check for them. No statement in this file drops or narrows anything that exists.
-- contract: v0.2.1
-- The endpoint and the keys of a device are secrets. They live only inside `secret` (ADR 0009 box, AAD `push:<id>`);
-- `endpoint_hash` (sha256 hex of the endpoint) is the only plain value, and it is no key to the service.

-- One row per browser of a member. `session_id` binds the device to the web session that made it: NULL means the session
-- ended and the device is not live (the sender and the fan-out skip it). The member row owns the device: a removed member
-- takes their devices. A user has one device row per endpoint; a second subscribe of the same browser updates the row.
CREATE TABLE push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  user_id uuid NOT NULL,
  session_id uuid REFERENCES auth_sessions (id) ON DELETE SET NULL,
  secret text NOT NULL CHECK (char_length(secret) BETWEEN 1 AND 8192),
  key_version integer NOT NULL CHECK (key_version > 0),
  endpoint_hash text NOT NULL CHECK (endpoint_hash ~ '^[0-9a-f]{64}$'),
  device_label text NOT NULL CHECK (char_length(device_label) <= 60),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  last_error_code text CHECK (last_error_code ~ '^[a-z0-9_]{1,40}$'),
  FOREIGN KEY (org_id, user_id) REFERENCES memberships (org_id, user_id) ON DELETE CASCADE,
  UNIQUE (user_id, endpoint_hash),
  -- The target of the composite key of `outbox.push_subscription_id`: a notice row cannot point at a device of another org.
  UNIQUE (id, org_id)
);
-- The foreign keys: a delete of a member or of a session finds its devices by index.
CREATE INDEX push_subscriptions_member_idx ON push_subscriptions (org_id, user_id);
CREATE INDEX push_subscriptions_session_idx ON push_subscriptions (session_id) WHERE session_id IS NOT NULL;

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON push_subscriptions FOR ALL TO app
  USING (app_current_org() IS NULL OR org_id = app_current_org())
  WITH CHECK (app_current_org() IS NULL OR org_id = app_current_org());

-- One outbox row per device (`channel = 'push'`). The key clears only its own column when the device goes: the row stays
-- as history (a sent row feeds the delivery metrics and the check that a request was seen). `org_id` is NOT NULL and stays.
ALTER TABLE outbox DROP CONSTRAINT outbox_channel_check;
ALTER TABLE outbox ADD CONSTRAINT outbox_channel_check CHECK (channel IN ('telegram', 'mail', 'push'));
ALTER TABLE outbox ADD COLUMN push_subscription_id uuid;
ALTER TABLE outbox
  ADD CONSTRAINT outbox_push_subscription_fkey
    FOREIGN KEY (push_subscription_id, org_id) REFERENCES push_subscriptions (id, org_id)
    ON DELETE SET NULL (push_subscription_id),
  ADD CONSTRAINT outbox_push_subscription_channel_check CHECK (push_subscription_id IS NULL OR channel = 'push');
CREATE INDEX outbox_push_subscription_idx ON outbox (push_subscription_id) WHERE push_subscription_id IS NOT NULL;

-- The route of each notice group of a member: `{urgent?, approvals?, updates?}`, each `telegram`, `push` or `both`.
-- A missing key means the default of the code. The code validates the keys and the values; the CHECK keeps the shape.
ALTER TABLE memberships
  ADD COLUMN notice_routes jsonb NOT NULL DEFAULT '{}'
    CONSTRAINT memberships_notice_routes_check CHECK (jsonb_typeof(notice_routes) = 'object');

-- migrate:down
-- The old list refuses `push`: drop the push rows first (delivery rows; a device is made again by the next subscribe),
-- then the column, the check and the list. The devices and the routes of the members go with their columns and table.
DELETE FROM outbox WHERE channel = 'push';
ALTER TABLE memberships DROP COLUMN notice_routes;
DROP INDEX outbox_push_subscription_idx;
ALTER TABLE outbox
  DROP CONSTRAINT outbox_push_subscription_channel_check,
  DROP CONSTRAINT outbox_push_subscription_fkey,
  DROP COLUMN push_subscription_id;
ALTER TABLE outbox DROP CONSTRAINT outbox_channel_check;
ALTER TABLE outbox ADD CONSTRAINT outbox_channel_check CHECK (channel IN ('telegram', 'mail'));
DROP TABLE push_subscriptions;
