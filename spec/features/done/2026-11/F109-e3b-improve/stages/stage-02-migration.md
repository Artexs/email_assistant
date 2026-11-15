# F109 stage 02 — Migration `[risky]`

Part of [`../plan.md`](../plan.md). Decisions D5, D9, D17. The only migration of F109. Never build it next to another ticket's migration stage.

## Step 1 — One expand migration

**Goal.** The three schema changes of F109 land at once, so later stages need no migration.

**Files.** One new file in `db/migrations/` (timestamp after the newest file at HEAD), `platform/db/schema.ts` types, a schema test next to `measure-schema.test.ts`.

**Schema (fixed).**

- `triage_results.suspicious_reasons text[] NOT NULL DEFAULT '{}'`, with `CHECK (suspicious_reasons <@ ARRAY['auth_fail','lookalike_domain','display_name_spoof','reply_to_mismatch','link_mismatch','risky_attachment']::text[])`. Old rows get `{}`. Codes only, so retention does not clear it.
- `mailbox_settings.urgency_profile jsonb NULL`, with `CHECK (urgency_profile IS NULL OR jsonb_typeof(urgency_profile) = 'object')`. Null means "no profile". The shape check is Zod in stage 07, not SQL.
- `outbox` kind list: add `not_triaged`. Copy the current list from the newest migration that sets `outbox_kind_check` at HEAD (it may hold more kinds than `20261114140001_weekly_report_kind.sql`). Down: delete only `not_triaged` rows, then restore the old list.
- Column `emails.from_address_lower text GENERATED ALWAYS AS (lower(from_address)) STORED` and index `emails_mailbox_sender_idx ON emails (mailbox_id, from_address_lower, received_at)` for the sender queries of stages 03 and 10, which query `from_address_lower = lower($sender)`. An expression index on `lower(from_address)` is useless for the app role: `lower()` is not leakproof, so RLS blocks it as an index condition (coordinator change, Opus review N1). The column is a generated copy: code never inserts it (`NewEmail` omits it); it is in `address-map.ts` as not personal and an excluded column of `EXPORT_MAP`.
- Down also drops the two columns, the generated column and the index.

**Decisions.**

- Expand only (PD-053 style): no column drop, no data rewrite.
- `urgency_profile` is user data: add it to the DSR export map (`modules/privacy/export-map.ts`) and its test, as a field of the mailbox settings row. `suspicious_reasons` follows the `triage_results` row wherever that row is exported or erased today; check that the export test still passes.
- The core list `suspiciousReasons` of stage 01 and the SQL list must stay equal: a unit test compares them (read the SQL file text, or keep one exported constant and test the migration against it).

**Test (integration, own DB).**

1. Insert a `triage_results` row without the column → `suspicious_reasons` = `{}`.
2. Insert with `{lookalike_domain}` → ok; with `{phish}` → CHECK error.
3. `UPDATE mailbox_settings SET urgency_profile = '[]'` → CHECK error; `'{"topics":[],"deadlines":[]}'` → ok; `NULL` → ok.
4. Insert an outbox row of kind `not_triaged` → ok; kind `xyz` → error.
5. Migrate down, then up again on the job DB: no error (run once by hand; write the commands in the final message).
6. The equality test of the code list and the SQL list.
7. `pg_indexes` holds `emails_mailbox_sender_idx`; as the app role, the sender query uses it as an Index Cond (`enable_seqscan` and `enable_sort` off). 8. `from_address_lower` follows `from_address`. 9. Down deletes `not_triaged` rows and keeps `weekly_report` rows.

**Check.** `bun run db:migrate` on the job DB, the new tests, the export-map test, then the Proof.

**Done when.** Tests 1–9 pass; `schema.ts` types match; Proof `PROOF_OK`.

**Out of scope.** Code that writes the columns (stages 03, 07, 15).

Owner step O1 after the land: `bun run db:migrate` on the shared dev DB.
