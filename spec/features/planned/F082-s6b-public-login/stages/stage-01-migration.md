# F082 stage 01 — Migration `auth_public`, `db:types`, tenancy user columns [risky]

Part of [`../plan.md`](../plan.md). Read its L1, L2, L11 and "Rules for every stage" first.

Parallel: lane A, first. Stage 8 may run at the same time. No other job that adds a migration or changes `bun.lock` may run at the same time.

One step. The only migration of S6b: no other job that adds a migration or changes `bun.lock` runs at the same time.

- [ ] **1.1 New user columns and the lockout table**
  - Goal: the database holds the user's language, the accepted terms version and time, and the lockout state; tenancy reads and writes the user columns.
  - Files:
    - add `db/migrations/<YYYYMMDD>100001_auth_public.sql` (`<YYYYMMDD>` = the build day; the name must sort after the newest file in `db/migrations/`; check with `ls db/migrations | tail -1`);
    - regenerate `apps/server/src/platform/db/schema.ts` (`bun run db:migrate`, then `bun run db:types`; never edit it by hand);
    - change `packages/core/src/tenancy.ts` (`userLocales`, `UserLocale`) and its test;
    - change `apps/server/src/modules/tenancy/repo.ts` (`insertUser`, `getUserAuthProfile`, `setUserTerms`), `service.ts` (`createOrganizationWithOwner` input), `index.ts` (exports);
    - change `docs/code-patterns.md` § Data access (the list of functions without a `TenantContext`);
    - add `apps/server/test/integration/auth-public-schema.test.ts`; add cases to `apps/server/test/integration/tenancy.test.ts` (or a new `tenancy-user-profile.test.ts` if that file spawns CLIs only).
  - SQL (exact):

    ```sql
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
    ```

    The `app` role gets the table rights through the default privileges of `20261103000001_app_grants.sql`; add no `GRANT`.

  - Interfaces:

    ```ts
    // packages/core/src/tenancy.ts
    export const userLocales = ["pl", "en"] as const;
    export type UserLocale = (typeof userLocales)[number];
    export const userLocaleSchema = z.enum(userLocales);

    // modules/tenancy/repo.ts — users are global: no TenantContext (list them in docs/code-patterns.md)
    export function insertUser(
      db: Db | Transaction<DB>,
      input: { email: string; displayName: string; locale?: UserLocale }
    ): Promise<{ id: string }>;
    export interface UserAuthProfile {
      locale: UserLocale | null;
      termsVersion: string | null;
      termsAcceptedAt: Date | null;
    }
    export function getUserAuthProfile(db: Db | Transaction<DB>, userId: string): Promise<UserAuthProfile | undefined>;
    // UPDATE users SET terms_version = $version, terms_accepted_at = $at WHERE id = $userId; true when one row changed
    export function setUserTerms(db: Db | Transaction<DB>, userId: string, version: string, at: Date): Promise<boolean>;

    // modules/tenancy/service.ts
    // CreateOrganizationInput gets `locale?: UserLocale`; it goes to insertUser. Absent = NULL.
    ```

    `getUserAuthProfile` parses `locale` with `userLocaleSchema.nullable()`. `index.ts` exports `getUserAuthProfile`, `setUserTerms`, `type UserAuthProfile`.

  - Decisions: L1, L2, L11. `docs/code-patterns.md`: add one line under "Only these take no `TenantContext`": "`getUserAuthProfile`, `setUserTerms` (`tenancy/repo.ts`, S6b): the user gives the row; the web resolves the user from the session." Do not add the lockout functions here (stage 5 adds them).
  - Test:
    1. `auth-public-schema`: `UPDATE users SET locale = 'de'` on a test user → error code `23514`.
    2. `auth-public-schema`: `UPDATE users SET terms_version = '2026-11-12'` (no `terms_accepted_at`) → `23514`; both set → ok.
    3. `auth-public-schema`: insert an `auth_lockouts` row for a test user (`window_started_at = '2026-11-20T10:00:00Z'`), delete the user → `SELECT count(*) FROM auth_lockouts WHERE user_id = <id>` is 0.
    4. `auth-public-schema`: `failed_count = -1` → `23514`; `mail_count = -1` → `23514`.
    5. `auth-public-schema`: the `app` role (the `testDb()` connection) can `INSERT`, `SELECT`, `UPDATE` and `DELETE` an `auth_lockouts` row.
    6. tenancy: a new user → `getUserAuthProfile` = `{ locale: null, termsVersion: null, termsAcceptedAt: null }`; a random uuid → `undefined`.
    7. tenancy: `setUserTerms(db, id, "2026-11-12", new Date("2026-11-20T10:00:00Z"))` → `true`; the profile shows both values; a random uuid → `false`.
    8. tenancy: `createOrganizationWithOwner(db, { …, locale: "en" })` → profile `locale = "en"`; without `locale` → `null`.
    9. core: `userLocaleSchema.safeParse("de").success === false`, `"pl"` and `"en"` pass.
       Tests run in `withRollback` where they can; tests 3 and 5 may commit and delete their user in `finally`.
  - Check: `bun run db:migrate && bun run db:types` in the job worktree (its own DB), then the Proof of `plan.md` (server form, `/tmp/f082-s01`). Also `bun run db:rollback && bun run db:migrate` once (the down part works); paste the last line of each.
  - Done when: the checks pass; `git diff --stat` shows `schema.ts` changed only by `db:types`; the Proof printed `PROOF_OK`.
  - Out of scope: the lockout logic (stage 5), the terms logic (stage 7), the language choice in the panel (S6c).
