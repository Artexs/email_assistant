# F117 stage 03 — Migration: OAuth secret kind, send route, reason, state table

Part of [`../plan.md`](../plan.md). `[risky]` (migration). The only migration of F117.

## Step 03.1 — Schema

**Goal.** The columns and the table that stages 04–15 use (D2).

**Files.** One new file in `db/migrations/` (a free timestamp after the newest); the generated DB types; the RLS policy list, export map and catalog test lists that fail without the new table.

**Shape.**
- `mailbox_credentials.secret_kind` CHECK: `password`, `app_password`, `oauth`.
- `mailboxes.send_via text NOT NULL DEFAULT 'smtp' CHECK (send_via IN ('smtp', 'graph'))`.
- `mailboxes.oauth_provider text NULL CHECK (oauth_provider IN ('microsoft', 'google'))`.
- `mailboxes.auth_reason text NULL CHECK (auth_reason IN ('oauth_expired', 'oauth_revoked', 'admin_consent_required', 'protocol_disabled'))`.
- `CHECK (send_via = 'smtp' OR oauth_provider = 'microsoft')`.
- `CHECK (auth_reason IS NULL OR (status = 'auth_error' AND oauth_provider IS NOT NULL))`.
- New table `mailbox_oauth_states`:
  - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
  - `org_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE`
  - `user_id` NOT NULL, foreign key to the users table, `ON DELETE CASCADE`
  - `provider text NOT NULL CHECK (provider IN ('microsoft', 'google'))`
  - `mailbox_id uuid NULL`, foreign key `(mailbox_id, org_id)` → `mailboxes (id, org_id) ON DELETE CASCADE` (set only for Reconnect)
  - `state_hash text NOT NULL UNIQUE` (hex SHA-256 of `state`)
  - `encrypted_verifier text NOT NULL`, `key_version integer NOT NULL CHECK (key_version > 0)`
  - `expires_at timestamptz NOT NULL`, `created_at timestamptz NOT NULL DEFAULT now()`
  - index on `(user_id, created_at)`.
- RLS: `ENABLE ROW LEVEL SECURITY` and the `tenant_rows` policy of the RLS migration, same text.
- Grants for the `app` role as the other tenant tables have.
- Down: delete `oauth` credential rows and their mailboxes first (old code cannot read them), drop the table, the columns and the CHECKs, restore the old `secret_kind` CHECK.

**Edge cases.**
- Existing rows: `send_via = 'smtp'`, `oauth_provider` and `auth_reason` NULL. An `auth_error` password mailbox stays valid.
- The status check and the reason check must agree: a status change away from `auth_error` must clear `auth_reason` in the same statement (stage 10 writes it; this stage only adds the CHECK).

**Export, delete, retention.**
- Export map: `mailbox_oauth_states` excluded as a secret ("OAuth sign-in state, short-lived"). The new `mailboxes` columns are exported (codes, no secret).
- Organization delete: the cascade covers the table; the delete test that lists tables must list it.
- Retention: `deleteOldOAuthStates` in the retention job deletes rows with `expires_at < now() - interval '1 hour'`; its count joins the `tokens` count of the per-organization log line. Add the row to `docs/capabilities/retention.md`.

**Decisions.** D2, D3, D9.

**Test** (integration):
1. Insert a credential with `secret_kind = 'oauth'` → OK; `'token'` → CHECK error.
2. `send_via = 'graph'` with `oauth_provider = 'google'` → CHECK error; with `'microsoft'` → OK.
3. `auth_reason = 'oauth_expired'` with `status = 'active'` → CHECK error; with `auth_error` and `oauth_provider = 'google'` → OK; with `auth_error` and `oauth_provider` NULL → CHECK error.
4. Two states with the same `state_hash` → unique error.
5. Delete the mailbox → its Reconnect state rows go; delete the user → their rows go.
6. RLS: with `app.org_id` set to org B, a state row of org A is not visible.
7. Retention: rows with `expires_at` 2 h ago go, 30 min ago stay (set times by SQL, not the clock).
8. By hand on the job DB, with one OAuth mailbox inserted: `bun run db:rollback` passes and removes it; `bun run db:migrate` passes. Write both outputs in the final message.

**Check.** Test 8, then the Proof.

**Done when.** The tests pass; the RLS, export and catalog tests pass with the new table listed; the Proof prints `PROOF_OK`.

**Out of scope.** Code that writes the new columns (stages 09–11).
