-- migrate:up
ALTER TABLE users
  ADD COLUMN email_verified boolean NOT NULL DEFAULT true,
  ADD COLUMN image text,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
UPDATE users SET email = lower(email) WHERE email <> lower(email);
ALTER TABLE users ADD CONSTRAINT users_email_lower_check CHECK (email = lower(email));

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_sessions_user_id_idx ON auth_sessions (user_id);

CREATE TABLE auth_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  account_id text NOT NULL,
  provider_id text NOT NULL,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, account_id)
);
CREATE INDEX auth_accounts_user_id_idx ON auth_accounts (user_id);

CREATE TABLE auth_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_verifications_identifier_idx ON auth_verifications (identifier);
CREATE INDEX auth_verifications_expires_at_idx ON auth_verifications (expires_at);

-- migrate:down
DROP TABLE auth_verifications;
DROP TABLE auth_accounts;
DROP TABLE auth_sessions;
ALTER TABLE users DROP CONSTRAINT users_email_lower_check;
ALTER TABLE users DROP COLUMN updated_at, DROP COLUMN image, DROP COLUMN email_verified;
