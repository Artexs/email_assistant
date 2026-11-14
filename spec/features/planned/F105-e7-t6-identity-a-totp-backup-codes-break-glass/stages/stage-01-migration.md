# F105 stage 01 — Migration: 2FA table, user flag, break-glass column [risky]

Part of [`../plan.md`](../plan.md). Read its D2, D23, "Facts checked" F1 and "Rules for every stage" first. Lane A, first stage. The only migration of this ticket: no other migration of any ticket may be in build next to it.

`[risky]`: migration. A review job checks it before the land.

One step. About 150 changed lines (most of it the generated `schema.ts`).

- [ ] **01.1 Migration `two_factor`, generated types, schema test**
  - Goal: the database holds the second factor of a user and the break-glass mark of a membership, with the constraints of D2.
  - Files:
    - add `db/migrations/<YYYYMMDD>120001_two_factor.sql` (`<YYYYMMDD>` = the build day; the name must sort after the newest file in `db/migrations/`; at the plan base the newest is `20261114100002_rls_tenant_policies.sql`; if a newer file exists, pick a time after it);
    - regenerate `apps/server/src/platform/db/schema.ts` with `bun run db:types` (never edit it by hand);
    - add `apps/server/test/integration/auth-two-factor-schema.test.ts`.
  - Interfaces (exact SQL):

    ```sql
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
    ```

    The `UNIQUE (user_id)` makes its own index; no second index on `user_id`. The default grants of `20261103000001_app_grants.sql` give the `app` role access to the new table; no `GRANT` line. No RLS policy: the table has no `org_id` (the RLS test checks only `org_id` tables).
  - Decisions: D2, D23.
  - Test (`auth-two-factor-schema.test.ts`; pattern of `auth-public-schema.test.ts`: `testDb()`, `withRollback`, a savepoint helper for expected violations; users from `insertUser` with `@x.test` addresses; a membership from `insertMembership` after `insertOrganization`):
    1. A new user has `two_factor_enabled = false`.
    2. An `auth_two_factors` row with only `user_id`, `secret`, `backup_codes` gets `verified = false`, `failed_verification_count = 0`, `locked_until = null`, `created_at` set.
    3. A second row for the same user fails with a unique violation (`23505`).
    4. `failed_verification_count = -1` fails with a check violation (`23514`).
    5. Deleting the user deletes its `auth_two_factors` row (cascade).
    6. The `app` role can insert, select, update and delete an `auth_two_factors` row (the test connection is `app`; as test 4 of `auth-public-schema.test.ts`).
    7. A membership with `role = 'assistant'` and `break_glass = true` fails with `23514`.
    8. Two owner memberships of one organization: the first gets `break_glass = true`; the second `break_glass = true` fails with `23505`; the same user marked in a second organization works.
    9. A new membership has `break_glass = false`.
  - Check: `bun run db:migrate` (the job's own DB from `scripts/limen-prepare.sh`), `bun run db:types`, then `bun test apps/server/test/integration/auth-two-factor-schema.test.ts apps/server/test/integration/auth-public-schema.test.ts apps/server/test/integration/rls-policy.test.ts`; `bun run typecheck`. Then the down step once: `bun run db:rollback` and `bun run db:migrate` again; both succeed.
  - Done when: tests 1–9 pass; `schema.ts` has `AuthTwoFactors`, `Users.two_factor_enabled` and `Memberships.break_glass`; the rollback and the second migrate succeed.
  - Out of scope: the plugin (stage 02); any repository function (stages 05–08).

## Done when

- Step 01.1 is done and committed by explicit paths (the migration, `schema.ts`, the test).
- The Proof command of `plan.md` for stage 01 (`/tmp/f105-s01`) prints `PROOF_OK`.
