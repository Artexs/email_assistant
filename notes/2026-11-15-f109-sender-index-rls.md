# F109 stage 02: the sender index and row-level security

Found 2026-11-15 in F109 stage 02; decided by the coordinator after the Opus review (N1).

- `emails.from_address` is stored in mixed case. An index on `lower(from_address)` does not work for the app role: under the tenant
  policy `tenant_rows` Postgres 17 does not use `lower(from_address) = $1` as an index condition, because `lower()` is not leakproof
  (`pg_proc.proleakproof = f`; `texteq` is leakproof). The plan filtered all mail of one mailbox (7 ms against 0.13 ms on 100k rows).
- Decision: stored generated column `emails.from_address_lower text GENERATED ALWAYS AS (lower(from_address)) STORED` and index
  `emails_mailbox_sender_idx ON emails (mailbox_id, from_address_lower, received_at)`. Sender queries (stages 03 and 10) use
  `from_address_lower = lower($sender)`, never `lower(from_address)`.
- Cost: `ADD COLUMN ... STORED` rewrites `emails` once under ACCESS EXCLUSIVE (about 0.8 s per 100k rows).
- Privacy: `address-map.ts` lists the column as not personal (generated copy, goes with the row); `EXPORT_MAP` excludes it (derived).
  DSR erase needs no code: Postgres recomputes the column when `from_address` changes.
- kysely-codegen types the column as `Generated<string | null>`, not `GeneratedAlways`, so `Insertable` accepts it. `NewEmail`
  (`mail/repo/emails.ts`) omits it. Never insert or copy `from_address_lower`.
- Test 7b (`suspicious-schema.test.ts`) runs as the app role with `enable_seqscan = off` and `enable_sort = off`: a small test table
  gives all indexes the same cost, so without these settings the plan can pick another index.
