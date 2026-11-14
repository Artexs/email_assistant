# F104 stage 01 — Migration and account-data registries

Part of [`../plan.md`](../plan.md). **[risky]**: a migration and privacy registries (review before the land; no other migration in build). Read D1, D2, D6, D7, D18.

After this stage both tables exist with RLS and the tombstone trigger, and the F106 registries classify every new column. No code writes the tables yet.

## Step 1 — The migration

**Goal.** One dbmate file `db/migrations/<timestamp>_sent_mail.sql`, later than every file at your base; then `bun run db:types`.

**Schema (up).** Every name is an interface for later stages.

`sent_emails`:
- `id uuid` PK; `org_id`, `mailbox_id` NOT NULL; FK `(mailbox_id, org_id)` → `mailboxes (id, org_id)` ON DELETE CASCADE; `UNIQUE (mailbox_id, dedup_key)`; `UNIQUE (id, org_id)` (FK target for E5b).
- `dedup_key text NOT NULL`; location `path text NOT NULL` (1–200 chars), `uidvalidity`, `uid bigint NOT NULL`.
- Nullable text: `message_id`, `parent_message_id`, `from_address`, `subject`, `body_text`, `auto_submitted`, `precedence`, `list_id`; `has_calendar boolean`; `action_id uuid` (no FK).
- `references_ids`, `to_addresses`, `cc_addresses text[] NOT NULL DEFAULT '{}'`; `thread_key text NOT NULL`; `sent_at`, `internal_date timestamptz NOT NULL`; `created_at`, `updated_at`.
- `origin` CHECK in (`user`, `system`); `content` CHECK in (`pending`, `stored`, `headers_only`, `gone`).
- `sent_emails_system_check`: `origin = 'user' OR (action_id IS NOT NULL AND content = 'headers_only')`. `sent_emails_body_check`: `body_text IS NULL OR content = 'stored'`.
- Indexes: `(org_id)`; `(org_id, internal_date)`; `(mailbox_id, parent_message_id)` for user rows with a parent; `(mailbox_id, thread_key)`; `(mailbox_id, path, internal_date)` for user rows and again for `pending` rows; `(action_id)` where set.

`mailbox_sent_sync`:
- `mailbox_id` PK; `org_id`; the same FK. `enabled boolean NOT NULL DEFAULT false`, `enabled_at`, `path` (1–200), `uidvalidity`, `last_uid bigint`, `first_pass_at`, `last_pass_at`, `last_error_code` CHECK in (`no_folder`, `folder_missing`, `failed`); `created_at`, `updated_at`; index `(org_id)`.
- Checks: `enabled = (enabled_at IS NOT NULL)`; `(uidvalidity IS NULL) = (last_uid IS NULL)`; `mailbox_sent_sync_off_check`: off → `path`, cursor, `first_pass_at`, `last_pass_at`, `last_error_code` null.

Both: RLS and the `tenant_rows` policy as the `emails` block of `20261114100002_rls_tenant_policies.sql`; no `GRANT`. `sent_emails` gets trigger `emails_skip_tombstoned` (`BEFORE INSERT`, the F106 function of the same name; test 9 of `account-data-delete.test.ts` looks for that name). Down: trigger, policies, tables.

**Check.** `bun run db:migrate && bun run db:rollback && bun run db:migrate && bun run db:types`.

## Step 2 — Schema tests and fixtures

- `fillMailbox` (`mailbox-rows.ts`) inserts one sent row and one enabled state row; `countMailboxRows` gains both keys.
- `TENANT_TABLES` (`rls-policy.test.ts`) and `DELETE_SEEDS` (`account-data-delete.test.ts`, seeded by `fillMailbox`) gain both tables.

**Test** (`mail-schema.test.ts`; minimal row: `dedup_key "mid:<a@x.test>:h1"`, `path "Sent"`, `uidvalidity 7`, `uid 1`, `thread_key "<a@x.test>"`, `origin "user"`, `content "pending"`):

1. The minimal row inserts; arrays default to `{}`.
2. Org A's mailbox with org B's `org_id` → `23503`.
3. Same `(mailbox_id, dedup_key)` twice → `23505`; another mailbox inserts.
4. `content 'new'`, `origin 'other'`, `path ''` → `23514`.
5. `system` with `pending` or without `action_id` → `23514`; `system` + `action_id` + `headers_only` inserts; `user` + `action_id` + `pending` inserts.
6. `body_text` with `pending` → `23514`; with `stored` inserts.
7. State: on without `enabled_at`; off with a cursor; half a cursor; `last_error_code 'other'` → each `23514`.
8. A mailbox delete removes both tables' rows.
9. A sent row whose base dedup key has a tombstone (`tombstoneKeyHash`) inserts nothing, no error.
10. The RLS, delete-mailbox, mail-remove and account-data-delete suites pass.

## Step 3 — Account-data registries (D18)

- `privacy/export-map.ts`: both tables, every column, by `org_id`.
- `privacy/address-map.ts` `sent_emails`: `to_addresses`, `cc_addresses` → `recipients`; `from_address` → `equal`; `subject`, `body_text` → `text`. `NOT_PERSONAL`: `dedup_key`, `message_id`, `parent_message_id`, `references_ids`, `thread_key` (Message-IDs), `path` (folder name), `origin`, `content`, `auto_submitted`, `precedence` (codes), `list_id` (list name). `NO_PERSONAL_TABLES`: `mailbox_sent_sync` (path, cursor, codes).
- `privacy/dsr-match.ts` `ROW_SHAPE`: `sent_emails` rows belong to no incoming mail, so their mentions are always scrubbed; let the shape type say "no mail column".

**Test.**

11. The export-map, DSR-match, find and erase suites pass.
12. Find: a sent row with the person in `cc_addresses` and `subject` → mentions `sent_emails.cc_addresses` and `sent_emails.subject`.
13. Erase: that row loses the address in both; the after-match is empty; org B's row stays.

**Out of scope.** Sent mail that "goes" (stage 12); repository code (stage 02).

## Done when

Steps 1–3 done; the Proof passes (`/tmp/f104-s01`).
