# F119 stage 02 — Migration: providers, SSO required, session method

Part of [`../plan.md`](../plan.md). `[risky]` (migration). The only migration of F119; no other migration of any ticket runs next to it. Read `spike.md` first: a FAIL of S2, S4 or S5 changes this stage (stop and ask).

## Step 02.1 — One dbmate migration

**Goal.** The tables and columns that stages 03–12 use.

**Files.** One new `db/migrations/<timestamp>_sso.sql` (up and down), then `bun run db:types`.

**Interfaces (shape; exact SQL is the worker's).**

- `sso_providers`:
  - `id uuid PK DEFAULT gen_random_uuid()`
  - `provider_id text NOT NULL UNIQUE` — equals the org id as text (D10; stage 07 writes it)
  - `org_id uuid NOT NULL UNIQUE REFERENCES organizations ON DELETE CASCADE` — one provider per organization (PD-040)
  - `issuer text NOT NULL CHECK (issuer LIKE 'https://%')`
  - `domain text NOT NULL UNIQUE CHECK (domain = lower(domain) AND domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$')` — one organization per domain
  - `domain_verified boolean NOT NULL DEFAULT false`, `domain_proof text CHECK (domain_proof IN ('dns','attested'))`, `CHECK (domain_verified = (domain_proof IS NOT NULL))`
  - `oidc_config text NOT NULL` (the plugin's JSON, holds the client secret, D15), `saml_config text CHECK (saml_config IS NULL)`
  - `user_id uuid REFERENCES users ON DELETE SET NULL` (the plugin's creator field; we write NULL)
  - `created_at`, `updated_at timestamptz NOT NULL DEFAULT now()`
  - RLS: `ENABLE ROW LEVEL SECURITY` and the `tenant_rows` policy for `app`, as every `org_id` table (`20261114100002_rls_tenant_policies.sql`). Grants for `app` as the other tables.
- `organizations.sso_required boolean NOT NULL DEFAULT false`.
- `auth_sessions.sign_in_method text NOT NULL DEFAULT 'password' CHECK (sign_in_method IN ('password','sso'))` and `auth_sessions.sso_started_at timestamptz`, with `CHECK ((sign_in_method = 'sso') = (sso_started_at IS NOT NULL))`. `sso_started_at` is the time of the IdP sign-in; a session made later from an SSO session keeps it (D6, F9).
- Function and trigger `auth_sessions_sso_cap` `BEFORE INSERT OR UPDATE ON auth_sessions FOR EACH ROW`: on UPDATE, `NEW.sign_in_method := OLD.sign_in_method` and `NEW.sso_started_at := OLD.sso_started_at` unless the update sets `sso_started_at` itself (tests move it, D16); then, when `NEW.sign_in_method = 'sso'`, `NEW.expires_at := LEAST(NEW.expires_at, NEW.sso_started_at + interval '12 hours')`.
- Down: drop in reverse order.

**Registries (F106 rule 18, `docs/capabilities/account-data.md`).**

- `EXPORT_MAP`: `sso_providers` exported by `org_id` with `oidc_config` excluded (reason: "secret: the IdP client secret"); the new `organizations` column exported. `auth_sessions` stays a secret table.
- `DSR_ADDRESS_MAP` / `NOT_PERSONAL`: classify any column the completeness test names (expected: none; `domain` is the organization's own).
- The delete test (`account-data-delete.test.ts`) seeds one `sso_providers` row; `delete_organization` removes it by cascade.

**Decisions.** D4, D6, D15, D16.

**Test** (`apps/server/test/integration/sso-schema.test.ts`, new):

1. Insert a provider for org A with `domain = 'x.test'`, `domain_verified = false`, `domain_proof = NULL`: ok. A second provider for org A: unique violation. A provider for org B with `domain = 'x.test'`: unique violation.
2. `domain = 'X.test'`, `'x'`, `'-x.test'`: check violation each. `issuer = 'http://idp.x.test'`: check violation.
3. `domain_verified = true` with `domain_proof = NULL`: check violation; `domain_proof = 'dns'` with `domain_verified = false`: check violation.
4. `saml_config = '{}'`: check violation.
5. Insert a session with `sign_in_method = 'sso'`, `sso_started_at = now() - 2 h`, `expires_at = now() + 30 days`: stored `expires_at = sso_started_at + 12 h`.
6. Update that row: `expires_at = now() + 30 days` → still `sso_started_at + 12 h`; `sign_in_method = 'password'` → still `'sso'`; `sso_started_at = now() - 13 h` → `expires_at` in the past.
7. A `'password'` session with `expires_at = now() + 30 days` keeps it on insert and update.
8. `sign_in_method = 'other'`: check violation; `'sso'` without `sso_started_at`, and `'password'` with it: check violation.
9. RLS: with `app.org_id` = org B, the `app` role sees no row of org A's provider and cannot insert one for org A (as `rls-policy.test.ts`).
10. Deleting org A removes its provider (cascade); deleting the user in `user_id` sets it NULL.

The export-map, address-map and delete tests of F106 pass with the new table.

**Check.** `bun run db:migrate` on the job DB, `bun run db:types`, then the Proof of `plan.md` (`/tmp/f119-s02`).

**Done when.** The ten tests pass; `platform/db/schema.ts` is regenerated, not hand-edited; Proof prints `PROOF_OK`.

**Out of scope.** Any Better Auth option (stage 03), CLI, route.
