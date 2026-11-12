-- migrate:up
ALTER TABLE organizations
  ADD COLUMN plan text NOT NULL DEFAULT 'active' CHECK (plan IN ('trial', 'active', 'suspended')),
  ADD COLUMN trial_ends_at timestamptz,
  ADD COLUMN max_mailboxes integer NOT NULL DEFAULT 2 CHECK (max_mailboxes >= 0),
  ADD COLUMN resumed_at timestamptz;
ALTER TABLE organizations
  ADD CONSTRAINT organizations_trial_end_check CHECK (plan <> 'trial' OR trial_ends_at IS NOT NULL);

-- migrate:down
ALTER TABLE organizations DROP CONSTRAINT organizations_trial_end_check;
ALTER TABLE organizations
  DROP COLUMN resumed_at,
  DROP COLUMN max_mailboxes,
  DROP COLUMN trial_ends_at,
  DROP COLUMN plan;
