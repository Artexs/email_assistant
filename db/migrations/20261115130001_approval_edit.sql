-- migrate:up
-- F102 stage 06: a superseding action (the panel edit of a draft) and the card edit notice (`approval_edit`).
-- Expand only: two nullable columns, no backfill, no change of `actions_type_check` or of a policy (no new table).
-- The kind list below must equal `noticeKinds` in packages/core/src/notices/kinds.ts, plus the kinds that core gets later
-- (`not_triaged`, F109 stage 15); telegram-schema.test.ts compares the two lists.

-- A new version of a send or of its draft points at the row that it replaces; the same organization (composite FK).
-- One row has at most one successor.
ALTER TABLE actions
  ADD COLUMN supersedes_action_id uuid,
  ADD CONSTRAINT actions_supersedes_action_id_org_id_fkey
    FOREIGN KEY (supersedes_action_id, org_id) REFERENCES actions (id, org_id),
  ADD CONSTRAINT actions_supersedes_type_check
    CHECK (supersedes_action_id IS NULL OR type IN ('create_draft', 'send'));
CREATE UNIQUE INDEX actions_supersedes_key ON actions (supersedes_action_id) WHERE supersedes_action_id IS NOT NULL;

-- The edit of one sent card: `edit_of_outbox_id` names that card. `outbox` has no (id, org_id) key, so the FK is on `id`
-- alone; the sender checks that both rows have one org_id. The card goes, the edit goes (cascade).
ALTER TABLE outbox
  ADD COLUMN edit_of_outbox_id uuid REFERENCES outbox (id) ON DELETE CASCADE;
CREATE INDEX outbox_edit_of_idx ON outbox (edit_of_outbox_id) WHERE edit_of_outbox_id IS NOT NULL;

ALTER TABLE outbox DROP CONSTRAINT outbox_kind_check;
ALTER TABLE outbox ADD CONSTRAINT outbox_kind_check CHECK (kind IN (
  'digest', 'urgent', 'auth_error', 'sync_stale', 'sync_ok', 'action_failed',
  'approval', 'approval_set', 'send_result', 'delegation_answered', 'mailbox_removed', 'send_held', 'weekly_report',
  'host_blocked', 'not_triaged', 'approval_edit'));

ALTER TABLE outbox
  ADD CONSTRAINT outbox_approval_edit_check CHECK ((kind = 'approval_edit') = (edit_of_outbox_id IS NOT NULL)),
  ADD CONSTRAINT outbox_approval_edit_email_check CHECK (kind <> 'approval_edit' OR email_id IS NOT NULL);

-- migrate:down
-- Only the rows of the kind that the old list refuses go; every other row stays (`not_triaged`, `weekly_report`, ...).
DELETE FROM outbox WHERE kind = 'approval_edit';

ALTER TABLE outbox
  DROP CONSTRAINT outbox_approval_edit_email_check,
  DROP CONSTRAINT outbox_approval_edit_check;
ALTER TABLE outbox DROP CONSTRAINT outbox_kind_check;
ALTER TABLE outbox ADD CONSTRAINT outbox_kind_check CHECK (kind IN (
  'digest', 'urgent', 'auth_error', 'sync_stale', 'sync_ok', 'action_failed',
  'approval', 'approval_set', 'send_result', 'delegation_answered', 'mailbox_removed', 'send_held', 'weekly_report',
  'host_blocked', 'not_triaged'));
DROP INDEX outbox_edit_of_idx;
ALTER TABLE outbox DROP COLUMN edit_of_outbox_id;

DROP INDEX actions_supersedes_key;
ALTER TABLE actions
  DROP CONSTRAINT actions_supersedes_type_check,
  DROP CONSTRAINT actions_supersedes_action_id_org_id_fkey,
  DROP COLUMN supersedes_action_id;
