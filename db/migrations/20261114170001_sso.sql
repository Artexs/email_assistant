-- migrate:up
-- spec/features/active/F119-e7-t7-identity-b-oidc (stage 02): OIDC providers, the "SSO required" switch and the
-- sign-in method of a session.
-- `app` gets SELECT, INSERT, UPDATE, DELETE by the default privileges of 20261103000001_app_grants.sql. UPDATE is needed:
-- the Better Auth SSO plugin locks the provider row with an UPDATE as `app` (spike.md, finding on the plugin lock).

-- One provider per organization (PD-040), and one organization per domain. `provider_id` is the org id as text.
-- `oidc_config` is the plugin's JSON and holds the client secret in clear (plan.md, secrets decision); the export never reads it.
-- The issuer is `https://…`, or exactly `http://127.0.0.1:<port>` for the fake IdP of the tests (plan.md, issuer CHECK decision).
CREATE TABLE sso_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id text NOT NULL UNIQUE,
  org_id uuid NOT NULL UNIQUE REFERENCES organizations (id) ON DELETE CASCADE,
  issuer text NOT NULL CHECK (issuer ~ '^https://' OR issuer ~ '^http://127\.0\.0\.1:[0-9]{1,5}$'),
  domain text NOT NULL UNIQUE CHECK (
    domain = lower(domain) AND domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
  ),
  domain_verified boolean NOT NULL DEFAULT false,
  domain_proof text CHECK (domain_proof IN ('dns', 'attested')),
  oidc_config text NOT NULL,
  saml_config text CHECK (saml_config IS NULL),
  user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (domain_verified = (domain_proof IS NOT NULL))
);
CREATE INDEX sso_providers_user_id_idx ON sso_providers (user_id);
ALTER TABLE sso_providers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON sso_providers FOR ALL TO app
  USING (app_current_org() IS NULL OR org_id = app_current_org())
  WITH CHECK (app_current_org() IS NULL OR org_id = app_current_org());

ALTER TABLE organizations ADD COLUMN sso_required boolean NOT NULL DEFAULT false;

-- `sso_started_at` is the IdP sign-in time. A session made from an SSO session keeps it (facts.md, session copy).
ALTER TABLE auth_sessions
  ADD COLUMN sign_in_method text NOT NULL DEFAULT 'password' CHECK (sign_in_method IN ('password', 'sso')),
  ADD COLUMN sso_started_at timestamptz,
  ADD CONSTRAINT auth_sessions_sso_started_check CHECK ((sign_in_method = 'sso') = (sso_started_at IS NOT NULL));

-- An SSO session ends 12 h after the IdP sign-in, whatever Better Auth writes at a refresh (facts.md, session refresh). On UPDATE the
-- method and the start stay as they were, unless the update sets `sso_started_at` itself (tests move it).
CREATE FUNCTION auth_sessions_sso_cap() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.sso_started_at IS NOT DISTINCT FROM OLD.sso_started_at THEN
      NEW.sign_in_method := OLD.sign_in_method;
    END IF;
  END IF;
  IF NEW.sign_in_method = 'sso' THEN
    NEW.expires_at := LEAST(NEW.expires_at, NEW.sso_started_at + interval '12 hours');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER auth_sessions_sso_cap BEFORE INSERT OR UPDATE ON auth_sessions
  FOR EACH ROW EXECUTE FUNCTION auth_sessions_sso_cap();

-- migrate:down
-- Deletes every provider row (and its client secret) and the SSO flag of every organization; it turns every SSO session
-- into a plain session without a cap. The sessions stay. The old schema is back.
DROP TRIGGER auth_sessions_sso_cap ON auth_sessions;
DROP FUNCTION auth_sessions_sso_cap();
ALTER TABLE auth_sessions
  DROP CONSTRAINT auth_sessions_sso_started_check,
  DROP COLUMN sso_started_at,
  DROP COLUMN sign_in_method;
ALTER TABLE organizations DROP COLUMN sso_required;
DROP TABLE sso_providers;
