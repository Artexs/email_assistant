-- migrate:up
-- Mailbox OAuth (F117 D2): the `oauth` secret kind, the send route, the provider, the reason code of an auth error,
-- and the short-lived sign-in state of the code flow.
ALTER TABLE mailbox_credentials DROP CONSTRAINT mailbox_credentials_secret_kind_check;
ALTER TABLE mailbox_credentials ADD CONSTRAINT mailbox_credentials_secret_kind_check
  CHECK (secret_kind IN ('password', 'app_password', 'oauth'));

ALTER TABLE mailboxes
  ADD COLUMN send_via text NOT NULL DEFAULT 'smtp',
  ADD COLUMN oauth_provider text,
  ADD COLUMN auth_reason text;
ALTER TABLE mailboxes ADD CONSTRAINT mailboxes_send_via_check CHECK (send_via IN ('smtp', 'graph'));
ALTER TABLE mailboxes ADD CONSTRAINT mailboxes_oauth_provider_check CHECK (oauth_provider IN ('microsoft', 'google'));
ALTER TABLE mailboxes ADD CONSTRAINT mailboxes_auth_reason_check
  CHECK (auth_reason IN ('oauth_expired', 'oauth_revoked', 'admin_consent_required', 'protocol_disabled'));
-- IS NOT DISTINCT FROM: with a NULL provider, `oauth_provider = 'microsoft'` is NULL and a CHECK accepts NULL.
ALTER TABLE mailboxes ADD CONSTRAINT mailboxes_send_via_provider_check
  CHECK (send_via = 'smtp' OR oauth_provider IS NOT DISTINCT FROM 'microsoft');
-- A status change away from `auth_error` must clear the reason in the same statement.
ALTER TABLE mailboxes ADD CONSTRAINT mailboxes_auth_reason_status_check
  CHECK (auth_reason IS NULL OR (status = 'auth_error' AND oauth_provider IS NOT NULL));

CREATE TABLE mailbox_oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('microsoft', 'google')),
  mailbox_id uuid,
  state_hash text NOT NULL UNIQUE,
  encrypted_verifier text NOT NULL,
  key_version integer NOT NULL CHECK (key_version > 0),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (mailbox_id, org_id) REFERENCES mailboxes (id, org_id) ON DELETE CASCADE
);

CREATE INDEX mailbox_oauth_states_user_idx ON mailbox_oauth_states (user_id, created_at);
CREATE INDEX mailbox_oauth_states_org_idx ON mailbox_oauth_states (org_id);
CREATE INDEX mailbox_oauth_states_mailbox_idx ON mailbox_oauth_states (mailbox_id, org_id) WHERE mailbox_id IS NOT NULL;

ALTER TABLE mailbox_oauth_states ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON mailbox_oauth_states FOR ALL TO app
  USING (app_current_org() IS NULL OR org_id = app_current_org())
  WITH CHECK (app_current_org() IS NULL OR org_id = app_current_org());

-- migrate:down
DROP POLICY tenant_rows ON mailbox_oauth_states;
ALTER TABLE mailbox_oauth_states DISABLE ROW LEVEL SECURITY;
DROP TABLE mailbox_oauth_states;

-- Old code cannot read an `oauth` credential: its mailbox goes (every child row cascades).
DELETE FROM mailboxes WHERE id IN (SELECT mailbox_id FROM mailbox_credentials WHERE secret_kind = 'oauth');

ALTER TABLE mailboxes DROP CONSTRAINT mailboxes_auth_reason_status_check;
ALTER TABLE mailboxes DROP CONSTRAINT mailboxes_send_via_provider_check;
ALTER TABLE mailboxes DROP CONSTRAINT mailboxes_auth_reason_check;
ALTER TABLE mailboxes DROP CONSTRAINT mailboxes_oauth_provider_check;
ALTER TABLE mailboxes DROP CONSTRAINT mailboxes_send_via_check;
ALTER TABLE mailboxes
  DROP COLUMN auth_reason,
  DROP COLUMN oauth_provider,
  DROP COLUMN send_via;

ALTER TABLE mailbox_credentials DROP CONSTRAINT mailbox_credentials_secret_kind_check;
ALTER TABLE mailbox_credentials ADD CONSTRAINT mailbox_credentials_secret_kind_check
  CHECK (secret_kind IN ('password', 'app_password'));
