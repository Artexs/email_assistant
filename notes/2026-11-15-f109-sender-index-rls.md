# F109 stage 02: the sender index and row-level security

Found 2026-11-15 in F109 stage 02 (`db/migrations/20261115120001_suspicious_urgency_sender.sql`).

## Facts

- `emails.from_address` is stored as the mail server sent it (mixed case): `mail/imap/mapper.ts:56`, `mail/sync.ts:173`. So the index is
  `emails_mailbox_sender_idx ON emails (mailbox_id, lower(from_address), received_at)`. Stages 03 and 10 must query with
  `lower(emails.from_address) = $sender` (the sender in lower case).
- Under the role `app` (tenant policy `tenant_rows`, F092), Postgres 17 does **not** use `lower(from_address) = $1` as an index
  condition. `lower()` is not leakproof (`pg_proc.proleakproof = f`), and a leaky qual must not run below the policy qual. The plan
  uses the sender index for `mailbox_id` only; `lower(from_address)` is a Filter. Evidence: `EXPLAIN` as `app` and as the table
  owner `migrator` (owner bypasses row-level security) in `apps/server/test/integration/suspicious-schema.test.ts` tests 7b and 7c.
- The owner role gets `Index Scan Backward using emails_mailbox_sender_idx` with no Sort. So the index columns are right; the limit is RLS.

## Effect

Sender queries stay correct. They read all rows of one mailbox in the time window, then filter by sender. That is fine for
a pilot mailbox (thousands of rows). It is slow for a very large mailbox.

## Options if it matters (not done: they leave "expand only" or touch the privacy maps)

1. A stored generated column `from_address_lower` plus an index on it (`=` on a plain column is leakproof). Cost: table rewrite
   on ADD COLUMN, and `EXPORT_MAP` / `address-map.ts` / DSR erase must treat the new column (a derived copy of an address).
2. Store `from_address` in lower case at sync (new code, old rows stay mixed until a backfill).
3. Accept the limit (chosen for stage 02). Test 7c fails when a later change removes the limit: then update stages 03 and 10.

## Test 7 (review N19)

A 400-row seed and a 20,000-row seed both kept the plan on `emails_mailbox_hash_idx`: with stale statistics every index with the
`mailbox_id` prefix costs the same. Test 7b sets `enable_seqscan = off` and `enable_sort = off` and asks for `ORDER BY received_at
DESC`: only the sender index gives that order without a Sort.
