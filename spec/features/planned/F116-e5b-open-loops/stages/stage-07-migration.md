# F116 stage 07 — Loop tables

Part of [`../plan.md`](../plan.md). `[risky]` (migration, privacy registries). Needs F102 and F104 in `done/`. A migration: no other migration in build next to it. Owner step after the land: `bun run db:migrate` on the dev DB.

## Step 1 — Migration

- **Goal:** one migration file `db/migrations/<stamp>_open_loops.sql` with its down part, as earlier migrations do.
- **Interfaces:** the "Data" section of `interfaces.md`, except the `actions` change (stage 09): tables `open_loops`, `sent_analyses`; column `delegations.source`; column `mailbox_settings.loop_wait_days`; index `emails_thread_received_idx`; the two flags in `packages/core/src/features.ts`.
- **Decisions:**
  - Every FK is composite with `org_id` (the existing pattern). `sent_emails` gets `UNIQUE (id, org_id)` when it has none.
  - `open_loops` CHECKs: `delegate_id` not null exactly when `kind = 'delegated'`; `status = 'closed'` ⇔ `closed_at` and `close_reason` not null; `later_count` 0–3; `follow_ups_sent` 0–2; `cardinality(to_addresses) + cardinality(cc_addresses) <= 10`; `char_length(text) <= 80`; `char_length(subject) <= 300`; `due_at` not null.
  - The thread index uses `CREATE INDEX IF NOT EXISTS` with the name of `interfaces.md`. If F115 stage 03 landed first with another name, use its index and create none (say so in the final message).
  - RLS on both tables (the policy of `20261114100002_rls_tenant_policies.sql`).
  - No outbox kind and no action type changes here.
- **Test (integration):** T1 migrate up, down, up on the job DB; T2 an `open_loops` row of kind `waiting` with a `delegate_id` → CHECK error; T3 a closed row without `close_reason` → error; T4 delete a `sent_emails` row → the loop stays with `sent_email_id` null; T5 delete the mailbox → loops and analyses are gone; T6 a second row with the same `(org_id, sent_email_id, kind)` → unique error; T7 a row of org B read in a transaction of org A → not visible (RLS).

## Step 2 — Schema types and privacy registries

- **Goal:** the Kysely types in `platform/db/schema.ts`, and the F106 registries know the new tables and columns.
- **Decisions:**
  - Export map (account export): `open_loops` exports `kind`, `status`, `close_reason`, `subject`, `counterpart`, `to_addresses`, `cc_addresses`, `text`, `due_at`, `created_at`, `closed_at`; `sent_analyses` exports its codes only.
  - DSR address map: `open_loops.counterpart`, `to_addresses`, `cc_addresses` are third-party addresses; the F106 erase clears them and `text`. The next `loops.match` run closes an open loop with empty `to_addresses` as `dropped` (stage 13). Every other new column is `NOT_PERSONAL` or covered by the export map, so the completeness tests pass.
  - The organization delete test seeds one row of each new table.
  - New audit events of later stages (`loop.*`) are not security events.
- **Test:** T8 the export-map and address-map completeness tests pass; T9 the org delete test removes the new rows; T10 a DSR erase of the counterpart address on a fixture loop → the address is gone from the three columns and `text` is null.

## Check

`bun test apps/server/test/integration/<the touched tests>` on the job DB.

## Done when

T1–T10 pass; the Proof of `plan.md` prints `PROOF_OK` (`/tmp/f116-s07`).

## Out of scope

`actions.loop_id` (09), any reader or writer of loops (08).
