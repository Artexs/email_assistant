# F092 stage 01 — Policies and the catalog test

Part of [`../plan.md`](../plan.md). `[risky]`: migration, tenant isolation. Decisions D8–D13, D18, D19. Read "Rules for every stage" in `plan.md` first.

One migration and one integration test file. No TypeScript in `src/` changes. Nothing sets `app.org_id` yet in app code, so after this stage every query still sees every row (D19): the existing tests must pass unchanged.

This stage may run next to stage 02 (D22). It must not run next to another ticket's migration (ticket § Sequenced).

## Step 1 — the migration `[risky]`

**Goal.** Every table with `org_id` and `organizations` has RLS on with the one `tenant_rows` policy of D8; `delete_mailbox` refuses another organization's mailbox inside a scope (D12).

**Files.** `db/migrations/<YYYYMMDDHHMMSS>_rls_tenant_policies.sql`: a timestamp later than every file in `db/migrations/` at build time (today the newest is `20261113110001_org_features.sql`; others may have landed). Use `<build day>100001` unless a file of that day exists; then the next free number.

**Before you write it.** In your job DB (after `bun run db:migrate`), list the tables with `org_id` as `app`:

```sql
SELECT c.relname FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND a.attname = 'org_id' AND NOT a.attisdropped
ORDER BY 1;
```

The planned answer is the 18 tables of D9. A table that is not in D9 (another ticket landed it) joins the migration with the same block, and the test list of step 2; name it in your final message. A table of D9 that is missing is a stop: ask.

Also confirm that `delete_mailbox` in your job DB has the body of `db/migrations/20261113100001_outbox_view.sql` (up part, lines 11–26): `SELECT prosrc FROM pg_proc WHERE proname = 'delete_mailbox'`. If a later migration replaced it, take that later body as the base for both the up and the down part, and say so.

**Content, in this order.**

1. Header comment (keep it):

   ```sql
   -- migrate:up
   -- Row-level security as a safety net under the tenant filter in code (ADR 0011, docs/architecture.md §5 Tenancy).
   -- The policies apply to `app` only. `migrator` owns the tables and bypasses them (no FORCE), and so do the
   -- SECURITY DEFINER functions it owns. An unset or empty `app.org_id` admits every row: jobs, CLIs, operator routes.
   ```

2. The function (D8), exactly:

   ```sql
   CREATE FUNCTION app_current_org() RETURNS uuid
   LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;
   GRANT EXECUTE ON FUNCTION app_current_org() TO app;
   ```

3. One block per table, in this order: `actions`, `audit_log`, `chat_link_tokens`, `chat_links`, `delegates`, `delegations`, `digests`, `emails`, `mailbox_credentials`, `mailbox_folders`, `mailbox_settings`, `mailboxes`, `memberships`, `org_features`, `outbox`, `sender_rules`, `triage_feedback`, `triage_results` (plus a table found above, in name order). The block, with `<t>` replaced:

   ```sql
   ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
   CREATE POLICY tenant_rows ON <t> FOR ALL TO app
     USING (app_current_org() IS NULL OR org_id = app_current_org())
     WITH CHECK (app_current_org() IS NULL OR org_id = app_current_org());
   ```

4. `organizations`, keyed by `id`:

   ```sql
   ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
   CREATE POLICY tenant_rows ON organizations FOR ALL TO app
     USING (app_current_org() IS NULL OR id = app_current_org())
     WITH CHECK (app_current_org() IS NULL OR id = app_current_org());
   ```

5. `delete_mailbox` (D12): `CREATE OR REPLACE FUNCTION` with the current body and one new first statement. `CREATE OR REPLACE` keeps the owner and the grants (`EXECUTE` only for `app`). Exactly:

   ```sql
   -- The definer bypasses RLS: it checks the scope itself (spec/features/…/F092-rls-safety-net plan D12). Same error as an unknown mailbox.
   CREATE OR REPLACE FUNCTION delete_mailbox(p_org_id uuid, p_mailbox_id uuid) RETURNS void
   LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
   BEGIN
     IF public.app_current_org() IS NOT NULL AND p_org_id <> public.app_current_org() THEN
       RAISE EXCEPTION 'mailbox not found' USING ERRCODE = 'P0002';
     END IF;
     PERFORM 1 FROM public.mailboxes WHERE id = p_mailbox_id AND org_id = p_org_id FOR UPDATE;
     IF NOT FOUND THEN
       RAISE EXCEPTION 'mailbox not found' USING ERRCODE = 'P0002';
     END IF;
     DELETE FROM public.audit_log WHERE org_id = p_org_id AND data->>'mailbox_id' = p_mailbox_id::text;
     -- Digests mix mailboxes: a pending one is dropped (the next slot covers the period), a sent one loses its text and view.
     DELETE FROM public.outbox WHERE org_id = p_org_id AND kind = 'digest' AND status IN ('pending', 'sending');
     UPDATE public.outbox SET text = '[removed]', view = '{}'
       WHERE org_id = p_org_id AND kind = 'digest' AND status IN ('sent', 'failed');
     DELETE FROM public.mailboxes WHERE id = p_mailbox_id AND org_id = p_org_id;
   END;
   $$;
   ```

   Write the ticket path in the comment as the real folder path (`spec/features/active/F092-rls-safety-net/plan.md` D12); the styleguide forbids a bare code in a comment.

6. `-- migrate:down`, in this order: `CREATE OR REPLACE FUNCTION delete_mailbox` with the body of `20261113100001_outbox_view.sql` up part (the same text as item 5 without the first `IF … END IF;`); then for each table of items 3 and 4: `DROP POLICY tenant_rows ON <t>;` and `ALTER TABLE <t> DISABLE ROW LEVEL SECURITY;`; last `DROP FUNCTION app_current_org();` (the function is dropped after the policies and `delete_mailbox` stop using it).

**Interfaces.** SQL: `app_current_org() → uuid` (null when `app.org_id` is unset or `''`). Policy name `tenant_rows` on 19 tables. No new grant except `EXECUTE` on `app_current_org()`. No column change: `bun run db:types` must leave `apps/server/src/platform/db/schema.ts` unchanged.

**Decisions.** D8 (shape, no `FORCE`), D9 (list), D12 (guard), D13 (`audit_log` grants stay).

**Check.**

```
bun run db:migrate && bun run db:rollback && bun run db:migrate && bun run db:types && git diff --exit-code apps/server/src/platform/db/schema.ts
```

(The planning probe ran this migration text on a throw-away cluster after all real migrations: migrate, rollback and migrate passed, 2026-11-14.)

**Done when.** The check passes; the migration holds 19 `CREATE POLICY` lines (`grep -c "CREATE POLICY tenant_rows" <file>` → 19, or more for a found table) and 19 `DROP POLICY` lines.

**Out of scope.** `FORCE ROW LEVEL SECURITY`, a policy on `users` or the `auth_*` tables, a second DB role, any grant change, any change of another function.

## Step 2 — `apps/server/test/integration/rls-policy.test.ts`

**Goal.** CI fails when a table with `org_id` lacks the policy (D10), and the policy limits reads and writes per table (D11, D12, D13).

**Files.** `apps/server/test/integration/rls-policy.test.ts` (new). Test helpers to use (all exist): `testDb`, `withRollback` (`./helpers`), `createOrgWithMailbox`, `linkChat`, `randomChatId` (`./fixtures`), `fillMailbox` (`./mailbox-rows`), `insertDigest` (`../../src/modules/reports/repo`), `insertLinkToken` (`../../src/modules/channels/repo`), `upsertOrgFeature` (`../../src/modules/tenancy/repo`), `insertSenderRule` (`../../src/modules/config`), `recordAudit` (`../../src/modules/audit`). Test files may import repositories directly (the border lint ignores `*.test.ts`).

**Interfaces inside the file.**

- `const TENANT_TABLES = [...]`: the 18 tables of D9 (plus any found in step 1), and `const ALL_POLICY_TABLES = [...TENANT_TABLES, "organizations"]`.
- `const POLICY_TEXT = "((app_current_org() IS NULL) OR (org_id = app_current_org()))"` and `const ORG_POLICY_TEXT = "((app_current_org() IS NULL) OR (id = app_current_org()))"`: the text Postgres stores (plan P9).
- `async function scopeLocal(trx, orgId: string)`: `await sql\`select set_config('app.org_id', ${orgId}, true)\`.execute(trx)` (D18: local only; `''` for "no scope").
- `async function seedOrg(trx): Promise<{ orgId; userId; mailboxId }>`: `createOrgWithMailbox(trx)`; `fillMailbox(trx, { orgId }, mailboxId, userId)`; `linkChat(trx, { orgId }, userId, randomChatId(), NOW)`; `insertLinkToken(trx, { orgId }, { tokenHash: createHash("sha256").update(randomUUID()).digest("hex"), userId, expiresAt: new Date("2026-11-20T10:15:00Z"), createdAt: NOW })`; `insertDigest(trx, { orgId }, { userId, slotKey: "2026-11-20T08:00", periodStart: new Date("2026-11-19T16:00:00Z"), periodEnd: NOW })`; `upsertOrgFeature(trx, { orgId }, { flag: "stats_page", enabled: true, setBy: "cli", setAt: NOW })`. `NOW = new Date("2026-11-20T10:00:00Z")`. Together these write at least one row in each of the 19 tables (test 6 proves it).
- `async function countWhere(trx, table, column: "org_id" | "id", orgId)`: `select count(*)::int as n from <table> where <column> = <orgId>` with `sql.table` and `sql.ref`.
- `function sqlState(error): string | undefined` (the `code` field of a `pg` error).
- `async function expectSqlState(trx, run: () => Promise<unknown>, code: string)`: `savepoint f092_case`, run, expect a throw with `sqlState = code`, then `rollback to savepoint f092_case` (raw `sql` on `trx`). A Postgres error aborts the transaction; the savepoint lets the test go on after it.

**Tests (numbered; values fixed).**

Catalog walk (no seeding, as `app`, outside a transaction):

1. The catalog list of step 1 (same query) contains every name of `TENANT_TABLES`, and every name it returns is in `TENANT_TABLES`. Failure message: `table <t> has org_id but no entry here: add the tenant_rows policy in its migration and the table to TENANT_TABLES (docs/code-patterns.md § Data access)`.
2. For each table of `ALL_POLICY_TABLES`: `pg_class.relrowsecurity` is `true` and `relforcerowsecurity` is `false`.
3. For each table of `ALL_POLICY_TABLES`: `pg_policies` (`schemaname = 'public'`) has exactly one row; `policyname = 'tenant_rows'`, `permissive = 'PERMISSIVE'`, `array_to_string(roles, ',') = 'app'`, `cmd = 'ALL'`, `qual` and `with_check` equal `POLICY_TEXT` (`ORG_POLICY_TEXT` for `organizations`).
4. The tables of `public` with `relrowsecurity = true` (`relkind IN ('r', 'p')`) are exactly `ALL_POLICY_TABLES` (an RLS table without a policy would deny `app` every row).
5. Every function of `public` with `prosecdef = true` has `app_current_org()` in `prosrc`; the list contains `delete_mailbox`.

Isolation (one `withRollback` per test; `A = await seedOrg(trx)`, `B = await seedOrg(trx)`):

6. `scopeLocal(trx, "")`: for each table of `ALL_POLICY_TABLES`, `countWhere(…, A.orgId) >= 1` and `countWhere(…, B.orgId) >= 1` (column `id` for `organizations`, `org_id` else). This proves the seed covers every table and that "no scope" admits both. If it fails for a table, add a row for that table to `seedOrg` (an existing helper, or a plain `insertInto` with fixed values); never drop the table from the loop.
7. `scopeLocal(trx, A.orgId)`: for each table, `countWhere(…, B.orgId) = 0` and `countWhere(…, A.orgId) >= 1`. Also, for each table, `select count(*) from <t> where <column> <> A.orgId` = 0 (no foreign row by any filter).
8. `scopeLocal(trx, A.orgId)`, then `scopeLocal(trx, "")` in the same transaction: B rows are visible again (`countWhere(mailboxes, B) = 1`).
9. `app_current_org()`: `scopeLocal(trx, A.orgId)` → `select app_current_org() as v` = `A.orgId`; `scopeLocal(trx, "")` → `null`.
10. `scopeLocal(trx, "not-a-uuid")`, then `expectSqlState(trx, () => select count(*) from mailboxes, "22P02")` (fail closed, P7). Own `withRollback`, no seeding needed.

Writes (each its own `withRollback` with A and B seeded, then `scopeLocal(trx, A.orgId)`; every expected error goes through `expectSqlState`, so the test can read after it):

11. `insertSenderRule(trx, { orgId: B.orgId }, { mailboxId: null, pattern: "w11@x.test", kind: "vip" })` → throws, `sqlState = "42501"`.
12. Insert as `scopeLocal(trx, "")` a rule for A with `mailboxId: null`, `pattern: "w12@x.test"`; then `scopeLocal(trx, A.orgId)`; `update sender_rules set org_id = <B> where pattern = 'w12@x.test'` → throws `42501`.
13. With `scopeLocal(trx, "")` insert a rule for B (`pattern: "w13@x.test"`, `mailboxId: null`); `scopeLocal(trx, A.orgId)`; `update sender_rules set kind = 'blocklist' where pattern = 'w13@x.test'` → `numUpdatedRows = 0`; `delete from sender_rules where pattern = 'w13@x.test'` → `numDeletedRows = 0`; `scopeLocal(trx, "")` → the rule still exists with `kind = 'vip'`.
14. `recordAudit(trx, { orgId: A.orgId }, { actor: "system", event: "email.triaged" })` → succeeds (insert under the policy; `app` has only `INSERT`, `SELECT`, D13).
15. `recordAudit(trx, { orgId: B.orgId }, { actor: "system", event: "email.triaged" })` → throws `42501`.
16. `expectSqlState(trx, () => select delete_mailbox(<B.orgId>, <B.mailboxId>), "P0002")`; then `scopeLocal(trx, "")`: `select count(*) from mailboxes where id = <B.mailboxId>` → 1.
17. `select delete_mailbox(<A.orgId>, <A.mailboxId>)` under A → succeeds; then `scopeLocal(trx, "")` and `select count(*) from mailboxes where id = <A.mailboxId>` → 0.
18. `scopeLocal(trx, "")`; `select delete_mailbox(<B.orgId>, <B.mailboxId>)` → succeeds (the jobs and CLI path is unchanged).

**Decisions.** D8, D10, D11, D12, D13, D18.

**Check.** `bun test apps/server/test/integration/rls-policy.test.ts` passes; then `bun test apps/server/test/integration/delete-mailbox.test.ts apps/server/test/integration/mail-remove.test.ts apps/server/test/integration/web-mailboxes.test.ts` passes unchanged (the guard does not change the unscoped path).

**Done when.** Tests 1–18 exist and pass; the existing integration suite passes with no test changed.

**Out of scope.** Any change in `apps/server/src/`; the scope and the driver (stage 02); web tests (stage 03); docs (stage 04).

## Stage done when

Steps 1 and 2 are done, and the Proof of `plan.md` for stages 01 and 02 passes with `NN = 01` (`/tmp/f092-s01`). In the final message: the migration file name, the table list (and any table added beyond D9), and the `delete_mailbox` base body you used.
