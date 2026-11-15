-- migrate:up
-- The constraints are on a new column (loop_id) or relax a rule: the code of the previous release never writes loop_id,
-- so every row it writes still passes them. No release has shipped yet, so the first minor release names the contract.
-- contract: v0.1.0
-- F116 stage 9: a second anchor for actions. A follow-up answers the user's own sent mail, so it has no incoming mail.
-- Expand only: `email_id` loses NOT NULL, `loop_id` is new. Every current row keeps its `email_id`; the new CHECKs hold
-- for it. A row of the old release still passes them (`loop_id` is NULL there).
-- The composite foreign key (loop_id, org_id) cascades like the one of `email_id`: a loop row goes only with its mailbox
-- or organization, and then its actions go too.
ALTER TABLE actions
  ALTER COLUMN email_id DROP NOT NULL,
  ADD COLUMN loop_id uuid,
  ADD CONSTRAINT actions_loop_id_org_id_fkey
    FOREIGN KEY (loop_id, org_id) REFERENCES open_loops (id, org_id) ON DELETE CASCADE,
  ADD CONSTRAINT actions_anchor_check CHECK ((email_id IS NULL) <> (loop_id IS NULL)),
  ADD CONSTRAINT actions_loop_type_check CHECK (loop_id IS NULL OR type IN ('create_draft', 'send'));

-- The foreign key with an action: a delete of an open loop finds its actions by index.
CREATE INDEX actions_loop_idx ON actions (org_id, loop_id) WHERE loop_id IS NOT NULL;

-- A card of a follow-up (approval, approval set, edit, result) carries the loop instead of the mail.
ALTER TABLE outbox
  ADD COLUMN loop_id uuid,
  ADD CONSTRAINT outbox_loop_id_org_id_fkey
    FOREIGN KEY (loop_id, org_id) REFERENCES open_loops (id, org_id) ON DELETE CASCADE;
CREATE INDEX outbox_loop_idx ON outbox (loop_id) WHERE loop_id IS NOT NULL;

ALTER TABLE outbox DROP CONSTRAINT outbox_email_kind_check;
ALTER TABLE outbox ADD CONSTRAINT outbox_email_kind_check
  CHECK (kind NOT IN ('urgent', 'action_failed', 'approval', 'approval_set', 'send_result', 'delegation_answered')
    OR email_id IS NOT NULL OR loop_id IS NOT NULL);
ALTER TABLE outbox DROP CONSTRAINT outbox_approval_edit_email_check;
ALTER TABLE outbox ADD CONSTRAINT outbox_approval_edit_email_check
  CHECK (kind <> 'approval_edit' OR email_id IS NOT NULL OR loop_id IS NOT NULL);

-- migrate:down
-- No silent delete: a row that hangs on a loop stops the rollback. The owner closes the loops and removes those rows
-- by hand first (or keeps the schema).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM actions WHERE loop_id IS NOT NULL)
    OR EXISTS (SELECT 1 FROM outbox WHERE loop_id IS NOT NULL) THEN
    RAISE EXCEPTION 'actions or outbox rows with a loop_id exist: remove them before the rollback';
  END IF;
END
$$;

ALTER TABLE outbox DROP CONSTRAINT outbox_approval_edit_email_check;
ALTER TABLE outbox ADD CONSTRAINT outbox_approval_edit_email_check CHECK (kind <> 'approval_edit' OR email_id IS NOT NULL);
ALTER TABLE outbox DROP CONSTRAINT outbox_email_kind_check;
ALTER TABLE outbox ADD CONSTRAINT outbox_email_kind_check
  CHECK (kind NOT IN ('urgent', 'action_failed', 'approval', 'approval_set', 'send_result', 'delegation_answered') OR email_id IS NOT NULL);
DROP INDEX outbox_loop_idx;
ALTER TABLE outbox
  DROP CONSTRAINT outbox_loop_id_org_id_fkey,
  DROP COLUMN loop_id;

DROP INDEX actions_loop_idx;
ALTER TABLE actions
  DROP CONSTRAINT actions_loop_type_check,
  DROP CONSTRAINT actions_anchor_check,
  DROP CONSTRAINT actions_loop_id_org_id_fkey,
  DROP COLUMN loop_id,
  ALTER COLUMN email_id SET NOT NULL;
