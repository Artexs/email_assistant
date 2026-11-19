# F120 stage 02 — Migration and data maps [risky]

Part of [`../plan.md`](../plan.md). Names: [`../interfaces.md`](../interfaces.md) § Tables. The only migration of F120.

Carry-over reads: `db/migrations/20261117140001_unsubscribe_data.sql` (newest pattern: RLS, down part), `db/migrations/20261115160001_open_loops.sql`, `apps/server/src/modules/privacy/address-map.ts`, `export-map.ts`, `apps/server/test/integration/account-data-delete.test.ts` (`DELETE_SEEDS`), `packages/core/src/legal/data-categories.ts`, `packages/core/src/features.ts`, `docs/code-patterns.md` § Data access.

## Step 1 — the migration

- Goal: one dbmate file `db/migrations/2026MMDDHHMMSS_sender_context.sql`, expand only (the old release runs on it), with a down part.
- Up: tables `sender_profiles` and `sender_suggestions` as in interfaces.md, with `org_id` FK to `organizations` ON DELETE CASCADE, `mailbox_id` FK ON DELETE CASCADE, CHECKs on every enum column and on counts (`>= 0`), `tenant_rows` RLS policy and grants as the newest migration does; index `sender_suggestions (mailbox_id, created_at)`. `open_loops`: replace the `due_source` CHECK with `('stated','default','contact')`; add `usual_reply_days smallint NULL CHECK (usual_reply_days BETWEEN 1 AND 60)`.
- Down: rewrite `due_source = 'contact'` rows to `'default'`, drop the column, restore the CHECK, drop both tables.
- Then `bun run db:types`.
- Decisions: D2, D6, D11, D12. `key_hash` has CHECK `key_hash ~ '^[0-9a-f]{64}$'` so no plain address fits.

## Step 2 — the maps and flags

- Goal: every completeness test passes with the new tables.
  - DSR map: `sender_profiles` and `sender_suggestions` go to the DSR handling of D14. `sender_suggestions.pattern` is in `DSR_ADDRESS_MAP` with rule `delete` (the row goes whole, as `unsubscribe_requests`). `sender_profiles` has no address column: classify each of its candidate columns in `NOT_PERSONAL` with a reason (`key_hash`: "keyed hash of the address; the erase deletes the row by hash, stage 04"; the jsonb and array columns: "category names and signal codes, no address"). If the test's shape does not allow a reason of that kind, the worker asks.
  - Export map: both tables by org (stage 04 adds the address join).
  - Org delete: `DELETE_SEEDS` gets a row of each table; `delete_organization` covers them through the cascade or an explicit delete (whichever the function does for `unsubscribe_requests`).
  - Legal catalog: a data category `sender-context` with subject `others` (D15), tables `sender_profiles`, `sender_suggestions`. No `TERMS_VERSION` bump (Q2).
  - Flags: `sender_context`, `sender_suggestions`, `contact_wait` (P1): default false, epic `E11a`, removeBy `2027-06-01`.
- Test (integration, new file `contacts-schema.test.ts`):
  1. Insert a profile with `key_hash = 'a@x.pl'` → CHECK error.
  2. Two open suggestions with the same mailbox, scope, key, kind → unique error; one `open` and one `dismissed` → both stored.
  3. Tenant filter: org A row invisible under org B context (as other schema tests).
  4. Delete the mailbox → its profile and suggestion rows are gone; the other mailbox's rows stay.
  5. `open_loops` accepts `due_source = 'contact'` with `usual_reply_days = 2`; `usual_reply_days = 0` → CHECK error.
  6. Migration down then up on the job DB passes (`bun run db:rollback && bun run db:migrate` inside the job only).
- Existing tests that must pass unchanged: `privacy-dsr-match` test 1, `privacy-export-map`, `account-data-delete`, `data-categories`, the features registry test.
- Check: `bun run db:migrate && bun run db:types && bun test apps/server/test/integration/contacts-schema.test.ts`.
- Out of scope: any writer or reader; the DSR erase code (stage 04).

## Done when

Tests 1–6 pass; removing the RLS policy makes test 3 fail. Then the Proof command. Owner step after the land: `bun run db:migrate` on the shared dev DB (coordinator tells the owner; it runs no agent command on the dev DB).
