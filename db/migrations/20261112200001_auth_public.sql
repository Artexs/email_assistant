-- migrate:up
ALTER TABLE users
  ADD COLUMN locale text CHECK (locale IN ('pl', 'en')),
  ADD COLUMN terms_version text,
  ADD COLUMN terms_accepted_at timestamptz,
  ADD CONSTRAINT users_terms_pair_check CHECK ((terms_version IS NULL) = (terms_accepted_at IS NULL));

CREATE TABLE auth_lockouts (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  window_started_at timestamptz NOT NULL,
  failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  locked_until timestamptz,
  mail_day date,
  mail_count integer NOT NULL DEFAULT 0 CHECK (mail_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- migrate:down
DROP TABLE auth_lockouts;
ALTER TABLE users
  DROP CONSTRAINT users_terms_pair_check,
  DROP COLUMN terms_accepted_at,
  DROP COLUMN terms_version,
  DROP COLUMN locale;
