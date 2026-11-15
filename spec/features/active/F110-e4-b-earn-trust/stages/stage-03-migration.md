# F110 stage 03 — Migration and trust repositories `[risky]`

Part of [`../plan.md`](../plan.md). Risk: migration, tenant isolation, data delete and export. Never build next to another migration stage.

## Step 1 — One migration

- **Goal:** the tables and columns of [interfaces.md](../interfaces.md) § Schema, except the stage 22 part.
- **Files:** one new file in `db/migrations/` (timestamp after the newest at `HEAD`); `platform/db/schema.ts`.
- **Decisions:**
  - Every new table has `org_id` with the composite FK and tenant policy pattern of the newest F106 or F102 migration (read it; copy its RLS and grant lines).
  - Check constraints with the value sets of [interfaces.md](../interfaces.md) § Schema: `history_checks.status`, `reason`, `no_result_reason`; `autonomy_trips.reason`; `memberships.report_channel`. `quiet_start` and `quiet_end` check `^([01][0-9]|2[0-3]):[0-5][0-9]$`; both null or both set.
  - `emails.skip_reason` has no check constraint at base (`20261103100001_mail.sql`); if one exists at `HEAD`, add `history_check` to it.
  - The partial unique index on `history_checks (mailbox_id) WHERE status NOT IN ('done','no_result')` is the dedup of D13: a second queue call is a no-op.
  - `history_check_items.email_id` cascades on email delete; `history_checks.mailbox_id` and `autonomy_trips.mailbox_id` cascade on mailbox delete. `report_mailbox_id` uses the composite FK with `ON DELETE SET NULL (report_mailbox_id)` (PostgreSQL 15+ column list), so `org_id` never becomes null.
  - Outbox (review 1 B2, B3): `outbox_kind_check` gains `trust_report_ready` and `autonomy_paused` (copy the list of the newest migration that changed it, `20261115150001_outbox_sent_missing.sql` at `17b2a369`); `outbox_channel_check` becomes `('telegram', 'mail')`.
  - Down migration: drop in reverse order.
  - Contract check: `bun run db:check-migrations` passes. New-column CHECKs go inline in `ADD COLUMN`. The `memberships` composite FK and quiet pair check are `ADD CONSTRAINT` on an old table: add `-- contract: v<release running on the VPS>` with a reason comment (as `20261115170001_action_loop_anchor.sql`); the review checks the outbox lists only widen (Q17).
- **Test:** the migration test pattern of the repo (up, down, up on an empty DB); an outbox insert of each new kind and of `channel = 'mail'` passes; `kind = 'x'` still fails.

## Step 2 — F106 registration

- **Goal:** delete and export reach the new data (scout 4, seam d).
- **Files:** `privacy/export-map.ts` (`byOrg(...)` for each table; every column exported or in `excluded` with a reason), `privacy/address-map.ts` (`NOT_PERSONAL` for the new columns: none holds an address), the `DELETE_SEEDS` of `account-data-delete.test.ts`.
- **Test:** `privacy-export-map.test.ts`, `privacy-dsr-match.test.ts`, `account-data-delete.test.ts` pass with the new tables (they fail without the registration: check this once by removing one entry).

## Step 3 — Repositories

- **Goal:** the `trust` module and its repo functions; later stages add services.
- **Files:** new `apps/server/src/modules/trust/` (`index.ts`, `repo.ts`), in layer 5 of `layers.json` (next to `operator`; `docs/code-patterns.md` § Layers and borders). It imports lower modules only (`channels`, `reports`, `triage`, `config`, `mail`, `audit`, `tenancy`); no `sameLayerEdges` entry. Nothing below imports `trust`: `reports` gets trust data by injection from the composition root (stage 12). Run `bun run graph:modules` (review 1 B1: `trust` in layer 4 made the cycle `channels → reports → trust → channels`).
- **Interfaces:** `queueHistoryCheck`, `latestHistoryCheck`, `historyResultFor`, `activeTripsOf` ([interfaces.md](../interfaces.md)); plus `insertTrip(trx, ctx, row)` (`ON CONFLICT DO NOTHING`, returns the id or null) and `clearTrips(trx, ctx, mailboxId, category, at)` (sets `cleared_at`; called when `auto` turns on again).
- **Decisions:** D8, D9, D13. `activeTripsOf` = rows with `cleared_at` null. `historyResultFor` reads the newest `done` check; a `fail` stays until a newer `done` check (D8).
- **Test** (`apps/server/test/integration/trust-repo.test.ts`):
  1. `queueHistoryCheck` twice for one mailbox → one row; after it is `done`, a third call makes a second row.
  2. Two orgs: org B never reads org A's checks or trips (tenant scope).
  3. `insertTrip` twice with the same `(mailbox, category, granted_at)` → second returns null.
  4. `clearTrips` then `activeTripsOf` → empty map.
  5. `historyResultFor` with a newer `no_result` check after a `done` check with `fail` → still the `fail` result.
  6. Delete of a mailbox removes its checks, items and trips.
  7. A member has `report_mailbox_id = M`; deleting mailbox M keeps the membership with `report_mailbox_id` null (review 1 T1).

## Done when

- `bun run db:migrate` runs on the job DB; the down step drops everything.
- Proof (`s03`) prints `PROOF_OK`.
- Final message: "U1: owner runs `bun run db:migrate` on the shared dev DB after the land."

## Out of scope

Unsubscribe columns (stage 22). Any job, route or use of the tables.
