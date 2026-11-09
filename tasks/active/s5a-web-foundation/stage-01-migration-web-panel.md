# s5a-web-foundation — Stage 1

Part of [`../s5a-web-foundation.md`](../s5a-web-foundation.md). Read that file's "Done when", "Owns", S1–S13, "Facts checked", W1–W20, "User steps" and the master plan's "Rules for every step" (`tasks/active/s5-web-panel.md`) first. Decisions named D<n> are in the master plan, W<n> and S<n> in the segment file, "fact <n>" in the segment file's "Facts checked".

## Stage 1 — Migration `web_panel`: `users` columns and CHECK, the three Better Auth tables, `db:types`, schema tests [risky]

Database of the build: the worktree's own database `email_assistant_s5a` (user step 0 in the segment file), **not** the shared dev database. Reason: the CHECK of this migration makes `tenancy.test.ts` on `master` fail (it inserts `A@x.test` and expects the unique index's `23505`; after the CHECK it gets `23514`), and `test-mail-traffic` and `llm-provider-switch` still run `test:int` on `master` code against the dev database. The dev database gets this migration with the merge.

- [ ] **1.1 Migration `20261109000001_web_panel.sql`, generated types, schema test, the `tenancy.test.ts` duplicate test**
  - Goal: the database holds what Better Auth 1.7.18 needs on top of our `users` table (D1, D11): the three auth tables and the three `users` columns, with every e-mail lower-cased and kept lower-cased (D2), readable and writable by the `app` role (fact 2), and the existing data untouched otherwise.
  - Files: create `db/migrations/20261109000001_web_panel.sql` (the version must be the next free one after the highest file in `db/migrations/`; today the highest is `20261108000001_delegation.sql`; never reuse a version); regenerate `apps/server/src/platform/db/schema.ts` with `bun run db:types` (never by hand); create `apps/server/test/integration/web-schema.test.ts`; change `apps/server/test/integration/tenancy.test.ts` (the duplicate e-mail test, below).
  - Interfaces: after `db:types`, `schema.ts` has `Users` with the new fields `email_verified: Generated<boolean>`, `image: string | null`, `updated_at: Generated<Timestamp>`, and the new interfaces `AuthSessions`, `AuthAccounts`, `AuthVerifications` under the `DB` keys `auth_sessions`, `auth_accounts`, `auth_verifications`. Nothing else in `schema.ts` changes.
  - Decisions:
    - Exact SQL (verified against Postgres 17 on 2026-11-08 as `notes/2026-11-08-s5a-probes/web_panel.sql.txt`; keep the order; `-- migrate:down` undoes it in reverse):

      ```sql
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
      ```

    - Why these shapes: the column lists are Better Auth's own generated DDL for the models `session`, `account` and `verification` (`notes/2026-11-08-s5-probes/schema.sql.txt`) in our snake_case names (D1 maps the fields); `token UNIQUE` because Better Auth finds a session by its token; `UNIQUE (provider_id, account_id)` because the `credential` account has `account_id = user id` and one user gets at most one; `email_verified DEFAULT true` because the CLI creates verified owners (D11) and Better Auth does not need verification to sign in; `updated_at` and `created_at` get defaults so that `insertUser` (S0) keeps working unchanged; the `UPDATE … WHERE email <> lower(email)` runs before the CHECK because the pilot owner's row may hold upper-case letters (cold review finding 2), and the unique index `users_email_lower_key ON (lower(email))` (`20261103000002_tenancy.sql:18`) already guarantees that lower-casing cannot clash; `auth_verifications_expires_at_idx` serves a later cleanup job (none in S5). No grant lines: the S0 default privileges give `app` SELECT, INSERT, UPDATE, DELETE on new tables (`20261103000001_app_grants.sql`; fact 2). `audit_log` is not touched.
    - `tenancy.test.ts` (today `:100`): the "duplicate e-mail" test inserts `A@x.test` next to `a@x.test` and expects `23505`. After the CHECK, a mixed-case insert fails earlier with `23514`. Change that test to a **lower-case** duplicate (`a@x.test` twice → `23505`) and add the mixed-case case to `web-schema.test.ts` (test 1). Nothing else in the suite inserts mixed-case e-mails (`grep -rn "@X.test\|[A-Z][a-z]*@x.test" apps/server/test apps/server/src` before the change confirms; list what it finds in the log line).
    - Existing rows: `SELECT count(*) FROM users WHERE email <> lower(email)` on the worktree database before the migration (information for the log; the S5e deploy runs the same on the VPS). No `actions`, `outbox` or other table changes.
    - A statement that must fail runs inside a savepoint, the pattern of `apps/server/test/integration/delegation-schema.test.ts` (S4 stage 2); assert the Postgres error `code` and, for a check violation, the `constraint` name (two checks can give `23514`).

  - Test (`web-schema.test.ts`, `withRollback` from `helpers.ts`; the test connection is the `app` role, so every statement that succeeds also proves the grant):
    1. `INSERT INTO users (email, display_name) VALUES ('Mixed.Case@X.test', 'T')` → `23514` with `constraint` `users_email_lower_check`; the same with `mixed.case@x.test` → OK, and the row reads `email_verified = true`, `image IS NULL`, `updated_at` within 5 s of `now()`.
    2. `auth_sessions`: a row for that user (`token 't1'`, `expires_at now() + 1 day`) → OK; a second row with `token 't1'` → `23505`; `DELETE FROM users WHERE id = …` → the session row is gone (cascade).
    3. `auth_accounts`: a row `provider_id 'credential'`, `account_id = <user id>`, `password 'x'` → OK; the same `(provider_id, account_id)` again → `23505`; a row with `provider_id 'google'`, `account_id '123'` for the same user → OK (two accounts, different providers); cascade on user delete.
    4. `auth_verifications`: a row `identifier 'reset-password:abc'`, `value <user id>`, `expires_at now() + 1 h` → OK; `SELECT … WHERE identifier = 'reset-password:abc'` finds it; `UPDATE` and `DELETE` on it work (the grant).
    5. `pg_indexes` lists `auth_sessions_user_id_idx`, `auth_accounts_user_id_idx`, `auth_verifications_identifier_idx`, `auth_verifications_expires_at_idx`; `pg_constraint` lists `users_email_lower_check` on `users`.
    6. `tenancy.test.ts`: the lower-case duplicate → `23505` (the changed test); the rest of the file unchanged and green.
  - Check: the database guard (segment file, user step 0; it must print `/email_assistant_s5a /email_assistant_s5a`, else stop), then in the worktree with its own database: `bun run db:migrate && bun run db:types && bun run lint && bun run typecheck && bun run test:int` (the containers run; if not: `newgrp docker <<'EOF'` / `bun run dev:up` / `EOF`, fact 20). Round trip: `bun run db:rollback && bun run db:migrate` both succeed; before the second `migrate`, insert `('Owner.Upper@X.test', 'T')` into `users` as `migrator` (`bun -e` with `pg` and `MIGRATOR_DATABASE_URL`, no printing of the URL), run `db:migrate`, read the row back as `owner.upper@x.test`, delete it. `git diff --stat apps/server/src/platform/db/schema.ts` shows only the three new interfaces and the three `Users` fields.
  - Done when: the tests pass, the whole integration suite stays green on the worktree database, the round trip works, the `schema.ts` diff is as described.
  - Out of scope: `platform/auth.ts`, config keys, any Better Auth code (stages 2–3); the `delete_mailbox` function (S5b).
