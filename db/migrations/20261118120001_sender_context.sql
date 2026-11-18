-- migrate:up
-- Sender context (spec/features/active/F120-e11a-sender-context, stage 02). Expand only: two new tables, one new nullable column, one wider CHECK list. The code of
-- the previous release ignores the tables and the column, so it runs on this schema. One exception: that code parses
-- `open_loops.due_source` as the enum ('stated', 'default') and throws on a row with `contact`. No row has `contact`
-- until the contact wait is on (flag `contact_wait`, default off). A rollback of the code first runs
--   UPDATE open_loops SET due_source = 'default', usual_reply_days = NULL WHERE due_source = 'contact';
-- (the `down` part of this file runs the same statement; the stage 12 notes and `docs/capabilities/` repeat it).
--
-- No address is stored here, only a keyed hash (HMAC-SHA256 by `senderKeyHash`) plus dates and counts. The
-- hash is 64 lower-case hex characters (CHECK), so no plain address fits the column. The only text that can name an
-- address is `sender_suggestions.pattern` (the address or `@domain` of an OPEN suggestion; null after the end).

-- Both tables reach the organization through the composite foreign key to `mailboxes (id, org_id)`: a delete of the mailbox
-- or of the organization removes their rows (a separate foreign key on `org_id` would be redundant).

-- One row per contact of a mailbox: counts of the last 90 days, written by a recompute job. A row whose contact
-- left the window keeps its dates and gets zero counts; retention deletes it 365 days after the last activity.
-- `first_seen_at` and `last_seen_at` hold incoming mail only (null for a contact the user only wrote to);
-- `last_user_mail_at` holds the newest own mail to the contact. At least one of the two dates is set, so a retention
-- reader uses `GREATEST(last_seen_at, last_user_mail_at)` (GREATEST skips NULL).
CREATE TABLE sender_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  mailbox_id uuid NOT NULL,
  key_hash text NOT NULL CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  received integer NOT NULL DEFAULT 0 CHECK (received >= 0),
  moved_back integer NOT NULL DEFAULT 0 CHECK (moved_back >= 0),
  answered integer NOT NULL DEFAULT 0 CHECK (answered >= 0),
  flagged integer NOT NULL DEFAULT 0 CHECK (flagged >= 0),
  unseen_7d integer NOT NULL DEFAULT 0 CHECK (unseen_7d >= 0),
  user_mails_to integer NOT NULL DEFAULT 0 CHECK (user_mails_to >= 0),
  delegations_to integer NOT NULL DEFAULT 0 CHECK (delegations_to >= 0),
  -- Category name -> count. `jsonb - text[]` removes the listed keys: what is left is a key that is no category. The path
  -- check refuses every value that is not a number >= 0 (a string, an array, an object or null could hold an address).
  by_category jsonb NOT NULL DEFAULT '{}'
    CHECK (jsonb_typeof(by_category) = 'object'
      AND by_category - ARRAY['urgent', 'needs_reply', 'delegation', 'info', 'notification', 'spam', 'unsure'] = '{}'::jsonb
      AND NOT jsonb_path_exists(by_category, 'strict $.* ? (@.type() != "number" || @ < 0)')),
  corrections jsonb NOT NULL DEFAULT '{}'
    CHECK (jsonb_typeof(corrections) = 'object'
      AND corrections - ARRAY['urgent', 'needs_reply', 'delegation', 'info', 'notification', 'spam', 'unsure'] = '{}'::jsonb
      AND NOT jsonb_path_exists(corrections, 'strict $.* ? (@.type() != "number" || @ < 0)')),
  bulk_signals text[] NOT NULL DEFAULT '{}'
    CHECK (bulk_signals <@ ARRAY['list_id', 'list_unsubscribe', 'noreply', 'auto_submitted']),
  -- Hours; null below 5 samples. A delay of 0 or less is dropped by the pass, so a stored median is never negative.
  median_user_reply_hours real CHECK (median_user_reply_hours BETWEEN 0 AND 100000),
  median_their_reply_hours real CHECK (median_their_reply_hours BETWEEN 0 AND 100000),
  reply_samples_theirs integer NOT NULL DEFAULT 0 CHECK (reply_samples_theirs >= 0),
  relation text NOT NULL CHECK (relation IN ('delegate', 'vip', 'bulk', 'known', 'new')),
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  last_user_mail_at timestamptz,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (mailbox_id, org_id) REFERENCES mailboxes (id, org_id) ON DELETE CASCADE,
  CONSTRAINT sender_profiles_dates_check CHECK (last_seen_at IS NOT NULL OR last_user_mail_at IS NOT NULL),
  -- One row per contact and mailbox; the key also serves the foreign key (it starts with `mailbox_id`).
  UNIQUE (mailbox_id, key_hash)
);

-- A data-request erase finds the person's rows in every mailbox of the organization by the hash.
CREATE INDEX sender_profiles_org_key_idx ON sender_profiles (org_id, key_hash);

-- One row per suggested rule (VIP, whitelist, blocklist) for an address or a domain. Life: `open` -> `accepted`,
-- `dismissed`, `withdrawn`, `expired`. `reason` holds counts only. An ended row has no `pattern` (the address is
-- cleared at the end) and keeps its `key_hash`, so a dismissed key stays hidden. A domain row hashes '@' || domain.
CREATE TABLE sender_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  mailbox_id uuid NOT NULL,
  key_hash text NOT NULL CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  scope text NOT NULL CHECK (scope IN ('address', 'domain')),
  kind text NOT NULL CHECK (kind IN ('vip', 'whitelist', 'blocklist')),
  pattern text
    CHECK (pattern = lower(pattern) AND char_length(pattern) BETWEEN 2 AND 254 AND pattern !~ '[[:space:][:cntrl:]<>]'),
  reason jsonb NOT NULL DEFAULT '{}'
    CHECK (jsonb_typeof(reason) = 'object'
      AND reason - ARRAY['received', 'answered', 'flagged', 'corrected', 'rescued', 'senders'] = '{}'::jsonb
      AND NOT jsonb_path_exists(reason, 'strict $.* ? (@.type() != "number" || @ < 0)')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'dismissed', 'withdrawn', 'expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  ended_by uuid REFERENCES users (id) ON DELETE SET NULL,
  FOREIGN KEY (mailbox_id, org_id) REFERENCES mailboxes (id, org_id) ON DELETE CASCADE,
  -- An open row has no end; every other status has one, and the pattern is cleared.
  CONSTRAINT sender_suggestions_ended_check CHECK ((status = 'open') = (ended_at IS NULL)),
  CONSTRAINT sender_suggestions_cleared_check CHECK (
    status = 'open' OR pattern IS NULL),
  -- The scope and the pattern agree: a domain pattern starts with '@', an address pattern does not.
  CONSTRAINT sender_suggestions_pattern_scope_check CHECK (
    pattern IS NULL OR ((scope = 'domain') = (left(pattern, 1) = '@')))
);

-- One open suggestion per mailbox, scope, key and kind.
CREATE UNIQUE INDEX sender_suggestions_open_key ON sender_suggestions (mailbox_id, scope, key_hash, kind)
  WHERE status = 'open';
CREATE INDEX sender_suggestions_mailbox_created_idx ON sender_suggestions (mailbox_id, created_at);
CREATE INDEX sender_suggestions_org_idx ON sender_suggestions (org_id);

ALTER TABLE sender_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON sender_profiles FOR ALL TO app
  USING (app_current_org() IS NULL OR org_id = app_current_org())
  WITH CHECK (app_current_org() IS NULL OR org_id = app_current_org());

ALTER TABLE sender_suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON sender_suggestions FOR ALL TO app
  USING (app_current_org() IS NULL OR org_id = app_current_org())
  WITH CHECK (app_current_org() IS NULL OR org_id = app_current_org());

-- A loop that waits as long as its contact usually takes to reply has `due_source = 'contact'` and the usual
-- reply time in days. The replace of the CHECK only widens the list.
ALTER TABLE open_loops DROP CONSTRAINT open_loops_due_source_check;
ALTER TABLE open_loops ADD CONSTRAINT open_loops_due_source_check CHECK (due_source IN ('stated', 'default', 'contact'));
ALTER TABLE open_loops ADD COLUMN usual_reply_days smallint CHECK (usual_reply_days BETWEEN 1 AND 60);

-- migrate:down
-- The old loops code parses `due_source` as ('stated', 'default'): a `contact` row goes back to `default` first (the
-- column that holds its days goes with the next statement). The due date stays as the loop had it.
UPDATE open_loops SET due_source = 'default', usual_reply_days = NULL WHERE due_source = 'contact';
ALTER TABLE open_loops DROP COLUMN usual_reply_days;
ALTER TABLE open_loops DROP CONSTRAINT open_loops_due_source_check;
ALTER TABLE open_loops ADD CONSTRAINT open_loops_due_source_check CHECK (due_source IN ('stated', 'default'));

DROP POLICY tenant_rows ON sender_suggestions;
ALTER TABLE sender_suggestions DISABLE ROW LEVEL SECURITY;
DROP POLICY tenant_rows ON sender_profiles;
ALTER TABLE sender_profiles DISABLE ROW LEVEL SECURITY;

DROP TABLE sender_suggestions;
DROP TABLE sender_profiles;
