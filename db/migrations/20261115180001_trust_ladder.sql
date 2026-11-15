-- migrate:up
-- F110 stage 03: the trust ladder (history checks, autonomy trips) and the per-user report settings. Expand only: new
-- tables, new nullable or defaulted columns, and two outbox lists that only widen. The code of the previous release
-- never writes a new column, a new kind or `channel = 'mail'`, so every row it writes still passes these constraints.
-- contract: v0.1.0
-- The statements that the contract check flags: the composite foreign key and the quiet pair check of `memberships`
-- (an `ADD CONSTRAINT` on an old table that touches only the new nullable columns) and the two outbox lists (dropped
-- and added again with more values; no old value goes). Release v0.1.0 runs on the VPS: the mark above names it as the
-- release whose code must still work with this schema.

-- One check of a mailbox against its own history: the last 30 days of INBOX mail, classified, compared with what the
-- user did. Codes, counters and money only: no mail text and no address.
CREATE TABLE history_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  mailbox_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'backfilling', 'waiting_flags', 'classifying', 'done', 'no_result')),
  reason text NOT NULL CHECK (reason IN ('connect', 'cli', 'web', 'model_switch', 'flag_on')),
  no_result_reason text
    CHECK (no_result_reason IN ('no_history', 'uidvalidity', 'cost_unknown', 'stopped', 'key_changed', 'auth_refused')),
  key jsonb CHECK (jsonb_typeof(key) = 'object'),
  window_start timestamptz,
  backfill_done_at timestamptz,
  cost_usd numeric NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  capped boolean NOT NULL DEFAULT false,
  result jsonb CHECK (jsonb_typeof(result) = 'object'),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  locked_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  FOREIGN KEY (mailbox_id, org_id) REFERENCES mailboxes (id, org_id) ON DELETE CASCADE,
  UNIQUE (id, org_id),
  -- A reason of `no_result` only on a check that ended without a result, and always there.
  CONSTRAINT history_checks_no_result_pair_check CHECK ((status = 'no_result') = (no_result_reason IS NOT NULL))
);

-- The dedup of the history check: at most one check of a mailbox is open. A second queue call finds it and does nothing; a `done` or
-- `no_result` check leaves the index, so the next check is a new row.
CREATE UNIQUE INDEX history_checks_open_key ON history_checks (mailbox_id) WHERE status NOT IN ('done', 'no_result');
CREATE INDEX history_checks_due_idx ON history_checks (next_attempt_at) WHERE status NOT IN ('done', 'no_result');
CREATE INDEX history_checks_mailbox_idx ON history_checks (org_id, mailbox_id, created_at DESC);

-- The decision of the check for one mail. The row goes with the mail (the foreign key of `email_id` cascades) and with
-- its check. It holds the category, the confidence and the code of the decision: no mail text.
CREATE TABLE history_check_items (
  check_id uuid NOT NULL,
  org_id uuid NOT NULL,
  email_id uuid NOT NULL,
  category text NOT NULL
    CHECK (category IN ('urgent', 'needs_reply', 'delegation', 'info', 'notification', 'spam', 'unsure')),
  confidence real NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  reason_code text NOT NULL,
  would_move boolean NOT NULL,
  acted_on boolean NOT NULL DEFAULT false,
  source text NOT NULL CHECK (source IN ('triage_result', 'classified', 'rule')),
  cost_usd numeric NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  PRIMARY KEY (check_id, email_id),
  FOREIGN KEY (check_id, org_id) REFERENCES history_checks (id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (email_id, org_id) REFERENCES emails (id, org_id) ON DELETE CASCADE
);

-- The foreign key with the mail: a delete of an email finds its items by index (the key starts with `check_id`).
CREATE INDEX history_check_items_email_idx ON history_check_items (email_id);
CREATE INDEX history_check_items_org_idx ON history_check_items (org_id);

-- A pause of `auto` for one category of one mailbox. `granted_at` is the grant that the trip ends: a repeat of the
-- trip for the same grant is a no-op (the unique key). `cleared_at` is set when the user turns `auto` on again.
CREATE TABLE autonomy_trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  mailbox_id uuid NOT NULL,
  category text NOT NULL CHECK (category IN ('urgent', 'needs_reply', 'info', 'notification', 'spam')),
  granted_at timestamptz NOT NULL,
  reason text NOT NULL
    CHECK (reason IN ('corrections', 'important_hidden', 'model_switch', 'evidence_changed', 'history_fail')),
  counts jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(counts) = 'object'),
  tripped_at timestamptz NOT NULL DEFAULT now(),
  cleared_at timestamptz,
  FOREIGN KEY (mailbox_id, org_id) REFERENCES mailboxes (id, org_id) ON DELETE CASCADE,
  UNIQUE (mailbox_id, category, granted_at)
);

CREATE INDEX autonomy_trips_org_idx ON autonomy_trips (org_id);
CREATE INDEX autonomy_trips_active_idx ON autonomy_trips (org_id, mailbox_id) WHERE cleared_at IS NULL;

ALTER TABLE history_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON history_checks FOR ALL TO app
  USING (app_current_org() IS NULL OR org_id = app_current_org())
  WITH CHECK (app_current_org() IS NULL OR org_id = app_current_org());

ALTER TABLE history_check_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON history_check_items FOR ALL TO app
  USING (app_current_org() IS NULL OR org_id = app_current_org())
  WITH CHECK (app_current_org() IS NULL OR org_id = app_current_org());

ALTER TABLE autonomy_trips ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON autonomy_trips FOR ALL TO app
  USING (app_current_org() IS NULL OR org_id = app_current_org())
  WITH CHECK (app_current_org() IS NULL OR org_id = app_current_org());

-- Per-user quiet hours and report channel. Both quiet columns null = the default 22:00-07:00; equal = none.
-- `report_mailbox_id` names the mailbox that receives the report mail. A delete of that mailbox clears only the id
-- column (`SET NULL (col)`): `org_id` is NOT NULL and stays.
ALTER TABLE memberships
  ADD COLUMN quiet_start text CHECK (quiet_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD COLUMN quiet_end text CHECK (quiet_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD COLUMN report_channel text NOT NULL DEFAULT 'telegram' CHECK (report_channel IN ('telegram', 'mail', 'both')),
  ADD COLUMN report_mailbox_id uuid;
ALTER TABLE memberships
  ADD CONSTRAINT memberships_quiet_pair_check CHECK ((quiet_start IS NULL) = (quiet_end IS NULL)),
  ADD CONSTRAINT memberships_report_mailbox_fkey
    FOREIGN KEY (report_mailbox_id, org_id) REFERENCES mailboxes (id, org_id) ON DELETE SET NULL (report_mailbox_id);
-- The foreign key with the mailbox: a delete of a mailbox finds its memberships by index.
CREATE INDEX memberships_report_mailbox_idx ON memberships (report_mailbox_id) WHERE report_mailbox_id IS NOT NULL;

-- Two new notice kinds and the mail channel. Both lists only widen: the list of `20261115150001_outbox_sent_missing.sql`
-- plus the new values.
ALTER TABLE outbox DROP CONSTRAINT outbox_kind_check;
ALTER TABLE outbox ADD CONSTRAINT outbox_kind_check CHECK (kind IN (
  'digest', 'urgent', 'auth_error', 'sync_stale', 'sync_ok', 'action_failed',
  'approval', 'approval_set', 'send_result', 'delegation_answered', 'mailbox_removed', 'send_held', 'weekly_report',
  'host_blocked', 'not_triaged', 'approval_edit', 'sent_missing', 'trust_report_ready', 'autonomy_paused'));
ALTER TABLE outbox DROP CONSTRAINT outbox_channel_check;
ALTER TABLE outbox ADD CONSTRAINT outbox_channel_check CHECK (channel IN ('telegram', 'mail'));

-- migrate:down
-- The old lists refuse the new values: drop those notices (they are delivery rows, a report is built again), then
-- restore the lists. The data of the new tables and columns goes with them.
DELETE FROM outbox WHERE kind IN ('trust_report_ready', 'autonomy_paused') OR channel <> 'telegram';
ALTER TABLE outbox DROP CONSTRAINT outbox_channel_check;
ALTER TABLE outbox ADD CONSTRAINT outbox_channel_check CHECK (channel IN ('telegram'));
ALTER TABLE outbox DROP CONSTRAINT outbox_kind_check;
ALTER TABLE outbox ADD CONSTRAINT outbox_kind_check CHECK (kind IN (
  'digest', 'urgent', 'auth_error', 'sync_stale', 'sync_ok', 'action_failed',
  'approval', 'approval_set', 'send_result', 'delegation_answered', 'mailbox_removed', 'send_held', 'weekly_report',
  'host_blocked', 'not_triaged', 'approval_edit', 'sent_missing'));

DROP INDEX memberships_report_mailbox_idx;
ALTER TABLE memberships
  DROP CONSTRAINT memberships_report_mailbox_fkey,
  DROP CONSTRAINT memberships_quiet_pair_check,
  DROP COLUMN report_mailbox_id,
  DROP COLUMN report_channel,
  DROP COLUMN quiet_end,
  DROP COLUMN quiet_start;

DROP POLICY tenant_rows ON autonomy_trips;
ALTER TABLE autonomy_trips DISABLE ROW LEVEL SECURITY;
DROP POLICY tenant_rows ON history_check_items;
ALTER TABLE history_check_items DISABLE ROW LEVEL SECURITY;
DROP POLICY tenant_rows ON history_checks;
ALTER TABLE history_checks DISABLE ROW LEVEL SECURITY;

DROP TABLE autonomy_trips;
DROP TABLE history_check_items;
DROP TABLE history_checks;
