# F106 stage 01 — Migration: organization delete function and DSR tombstones

Part of [`../plan.md`](../plan.md). `[risky]` (migration, data delete). The only migration of F106.

## Step 1 — the migration and its tests

**Goal.** One privileged function deletes an organization with every row of it and of its single-membership users. Tombstones stop the re-import of erased mail in the database.

**Files.** A new `db/migrations/<version>_account_data.sql`; the regenerated `platform/db/schema.ts`; integration tests.

**Interfaces (later stages use them).**

- `delete_organization(p_org_id uuid) RETURNS void`, `LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp`, owned by `migrator`, `REVOKE ALL … FROM PUBLIC`, `GRANT EXECUTE … TO app`. Shape of `delete_mailbox` (its F092 version). In order:
  1. When `app_current_org()` is set and differs from `p_org_id`: `RAISE EXCEPTION 'organization not found' USING ERRCODE = 'P0002'`.
  2. Lock the organization row `FOR UPDATE`; not found → the same exception.
  3. Find the users whose only membership is this organization (`gone`).
  4. Delete `audit_log` rows of the organization.
  5. Delete `auth_verifications` rows whose `value` is a `gone` user id (reset and invite tokens, trusted devices; `value` is the only key).
  6. Delete the `gone` users (their sessions, accounts, lockouts and second factors go by cascade).
  7. Delete the organization (every `org_id` table goes by cascade, also `dsr_tombstones`).
- `dsr_tombstones`: `org_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE`, `key_hash text NOT NULL CHECK (key_hash ~ '^[0-9a-f]{64}$')`, `created_at timestamptz NOT NULL DEFAULT now()`, `PRIMARY KEY (org_id, key_hash)`. Row-level security on with the `tenant_rows` policy block of `20261114100002_rls_tenant_policies.sql`. `app` gets the default grants.
- Trigger function `emails_skip_tombstoned()` (`SECURITY INVOKER`) and trigger `emails_skip_tombstoned BEFORE INSERT ON emails FOR EACH ROW`: returns NULL when a `dsr_tombstones` row has `org_id = NEW.org_id` and `key_hash` = the SHA-256 hex of the base key (`dedup_key` without a trailing `#<n>`); else NEW (plan F1). The base key also blocks a copy `#2` that a sync chunk planned before the erase (review 1, N6).
- `tombstoneKeyHash(dedupKey: string): string` (the same base-key hash) in `apps/server/src/platform/crypto.ts` (server only). Stage 08 writes tombstones with it. A test pins that it equals the SQL value for `mid:<a@x.test>:h1` and `hash:abc`, and that `mid:<a@x.test>:h1#2` gives the hash of `mid:<a@x.test>:h1`.
- `migrate:down` drops the trigger, the trigger function, the table and the function.

**Decisions.** D2, D3, D16. A user with another membership keeps the user row and its auth rows; only this membership goes (cascade). Rejected: deleting every member's auth rows (it signs a kept user out of the other organization).

**Test** (integration; new file `account-data-delete.test.ts`, and the RLS test):

1. Completeness: the public tables with an `org_id` or `user_id` column (`information_schema.columns`) equal the keys of `DELETE_SEEDS: Record<string, (org, user) => Promise<void>>` (one seed per table). A new table fails with its name.
2. Seed organizations A and B: each an owner, a mailbox, one row per seeded table, one `auth_verifications` row with `value` = the owner id. Call `delete_organization(A)` as `app`, no tenant scope. Per table of test 1: no row with `org_id` = A or `user_id` = A's owner; no `auth_verifications` row of A's owner; A's owner row is gone. B's row count per table is unchanged.
3. User U is a member of A and B. After `delete_organization(A)`: U's `users` row, sessions, its `auth_verifications` row and its B membership stay; its A membership is gone.
4. Unknown id → SQLSTATE `P0002`.
5. With the tenant scope set to B, `delete_organization(A)` → `P0002`, and A is whole.
6. A tombstone for org A with `tombstoneKeyHash("mid:<t1@x.test>:h1")`: `insertEmail` of that key and of `…#2` returns false and stores no row; the key in org B and another key in A are stored.
9. Every public table with a `dedup_key` column and a `message_id%` column has the trigger (`information_schema.triggers`), so a later mail table (F104 Sent rows) fails until it gets one.
7. `rls-policy.test.ts` passes with `dsr_tombstones` added to `TENANT_TABLES` and its seed.
8. In the job DB the migration goes down and up again; tests 2 and 6 still pass (say so in the final message).

**Check.** `bun test apps/server/test/integration/account-data-delete.test.ts apps/server/test/integration/rls-policy.test.ts`.

**Done when.** Tests 1–9 pass, `schema.ts` holds `DsrTombstones`, and the plan Proof (server chain) prints `PROOF_OK`.

**Out of scope.** The service and the CLI (stage 02); writing tombstones (stage 08).
