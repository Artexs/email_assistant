# F110 stage 03 — Migration and trust repositories `[risky]`

Part of [`../plan.md`](../plan.md). Risk: migration, tenant isolation, data delete and export. Never build next to another migration stage.

## Step 1 — One migration

- **Goal:** the tables and columns of [interfaces.md](../interfaces.md) § Schema, except the stage 21 part.
- **Files:** one new file in `db/migrations/` (timestamp after the newest at `HEAD`); `platform/db/schema.ts`.
- **Decisions:**
  - Every new table has `org_id` with the composite FK and tenant policy pattern of the newest F106 or F102 migration (read it; copy its RLS and grant lines).
  - `history_checks.status` and `no_result_reason`, `autonomy_trips.reason` (`corrections`, `important_hidden`, `model_switch`) and `memberships.report_channel` get check constraints. `quiet_start` and `quiet_end` check `^([01][0-9]|2[0-3]):[0-5][0-9]$`; both null or both set.
  - `emails.skip_reason` has no check constraint at base (`20261103100001_mail.sql`); if one exists at `HEAD`, add `history_check` to it.
  - The partial unique index on `history_checks (mailbox_id) WHERE status NOT IN ('done','no_result')` is the dedup of D13: a second queue call is a no-op.
  - `history_check_items.email_id` cascades on email delete; `history_checks.mailbox_id` and `autonomy_trips.mailbox_id` cascade on mailbox delete; `report_mailbox_id` sets null.
  - Down migration: drop in reverse order.
- **Test:** the migration test pattern of the repo (up, down, up on an empty DB).

## Step 2 — F106 registration

- **Goal:** delete and export reach the new data (scout 4, seam d).
- **Files:** `privacy/export-map.ts` (`byOrg(...)` for each table; every column exported or in `excluded` with a reason), `privacy/address-map.ts` (`NOT_PERSONAL` for the new columns: none holds an address), the `DELETE_SEEDS` of `account-data-delete.test.ts`.
- **Test:** `privacy-export-map.test.ts`, `privacy-dsr-match.test.ts`, `account-data-delete.test.ts` pass with the new tables (they fail without the registration: check this once by removing one entry).

## Step 3 — Repositories

- **Goal:** the `trust` module and its repo functions; later stages add services.
- **Files:** new `apps/server/src/modules/trust/` (`index.ts`, `repo.ts`), in layer 4 of `layers.json` (`docs/code-patterns.md` § Layers and borders). It imports `mail`, `config`, `triage`, `audit`, `tenancy`, and `channels` through a `sameLayerEdges` entry (reason: trust notices). Add the edge `reports → trust` now too (reason: M8, stage 12). Run `bun run graph:modules`.
- **Interfaces:** `queueHistoryCheck`, `latestHistoryCheck`, `historyResultFor`, `activeTripsOf` ([interfaces.md](../interfaces.md)); plus `insertTrip(trx, ctx, row)` (`ON CONFLICT DO NOTHING`, returns the id or null) and `clearTrips(trx, ctx, mailboxId, category, at)` (sets `cleared_at`; called when `auto` turns on again).
- **Decisions:** D8, D9, D13. `activeTripsOf` = rows with `cleared_at` null. `historyResultFor` reads the newest `done` check; a `fail` stays until a newer `done` check (D8).
- **Test** (`apps/server/test/integration/trust-repo.test.ts`):
  1. `queueHistoryCheck` twice for one mailbox → one row; after it is `done`, a third call makes a second row.
  2. Two orgs: org B never reads org A's checks or trips (tenant scope).
  3. `insertTrip` twice with the same `(mailbox, category, granted_at)` → second returns null.
  4. `clearTrips` then `activeTripsOf` → empty map.
  5. `historyResultFor` with a newer `no_result` check after a `done` check with `fail` → still the `fail` result.
  6. Delete of a mailbox removes its checks, items and trips.

## Done when

- `bun run db:migrate` runs on the job DB; the down step drops everything.
- Proof (`s03`) prints `PROOF_OK`.
- Final message: "U1: owner runs `bun run db:migrate` on the shared dev DB after the land."

## Out of scope

Unsubscribe columns (stage 21). Any job, route or use of the tables.
