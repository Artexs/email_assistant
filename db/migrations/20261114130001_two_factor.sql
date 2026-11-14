-- migrate:up
ALTER TABLE users ADD COLUMN two_factor_enabled boolean NOT NULL DEFAULT false;

-- Better Auth two-factor plugin, model `twoFactor` (plan D1, D2). The secret and the codes are encrypted by Better Auth.
CREATE TABLE auth_two_factors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  secret text NOT NULL,
  backup_codes text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  failed_verification_count integer NOT NULL DEFAULT 0 CHECK (failed_verification_count >= 0),
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One break-glass owner per organization (ADR 0026 point 6).
ALTER TABLE memberships
  ADD COLUMN break_glass boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT memberships_break_glass_owner_check CHECK (NOT break_glass OR role = 'owner');
CREATE UNIQUE INDEX memberships_break_glass_one ON memberships (org_id) WHERE break_glass;

-- migrate:down
DROP INDEX memberships_break_glass_one;
ALTER TABLE memberships DROP CONSTRAINT memberships_break_glass_owner_check, DROP COLUMN break_glass;
DROP TABLE auth_two_factors;
ALTER TABLE users DROP COLUMN two_factor_enabled;
