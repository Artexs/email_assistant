# F118 stage 10 — Migration B: detail at send time `[risky]`

Part of [`../plan.md`](../plan.md). Needs 09. **Migration**: no other migration in the repo at the same time. Owner step after the land: `bun run db:migrate` on the shared dev DB. Checkpoint C1 (review of 06–10) after the land.

Carry-over reads: `plan.md` D11, D12, D14; `interfaces.md` (`effectiveDetail`, columns, flag `telegram_minimal`); `channels/sender.ts` (render at send time, `listQuietHoursOf` as the model of a batch read), `channels/notice-queue.ts`, `channels/approval-taps.ts` (renders too); the stage 09 `telegramDetailOf`.

## Step 1 — Migration

- **Shape:** `db/migrations/<ts>_telegram_detail.sql`:
  - `memberships.telegram_detail text NOT NULL DEFAULT 'minimal' CHECK (telegram_detail IN ('full','minimal'))`; then `UPDATE memberships SET telegram_detail = 'full'` where a `chat_links` row of the same org and user exists (the pilot keeps `full`, P1).
  - `organizations.telegram_minimal_locked boolean NOT NULL DEFAULT false`.
  - Widen `outbox_detail_check` to `('full','minimal')`.
  - `down`: set `outbox.detail = 'full'` where `minimal`, restore the CHECK, drop the two columns.
- **Test (integration, schema):**
  1. A linked member before the migration → `full`; an unlinked member → `minimal`; a new membership → `minimal`.
  2. `telegram_detail = 'short'` → CHECK error.
  3. Down then up → no error with one `minimal` outbox row.

## Step 2 — Effective detail at send time

- **Goal:** ADR 0032 point 5: the Telegram sender renders each row without stored text with the member's current effective detail and writes that value to `outbox.detail` with the sent text.
- **Interfaces:** `effectiveDetail({ flagOn, locked, memberDetail })` in core (D11). A batch reader `detailsOf(trx, ctx, userIds)` (one query per claimed batch, like `listQuietHoursOf`). `telegramDetailOf` (stage 09) uses the same reader for direct answers. `queueNotice` stores the current effective detail on a Telegram row and check-renders with it. The flag `telegram_minimal` in `featureFlags` (epic E9, remove-by 2027-06-01, default off).
- **Decisions:** a row with stored `text` (queued before F088) goes as it is. Card edits keep the stored card text (rule 13). The mail channel ignores the detail (always `full`; it goes into the user's own INBOX). The tap answer path that renders (`approval-taps.ts`) uses the effective detail too.
- **Test (unit, `effectiveDetail`):**
  1. flag off, locked true, member `minimal` → `full`.
  2. flag on, locked true, member `full` → `minimal`.
  3. flag on, locked false, member `full` → `full`; member `minimal` → `minimal`.
- **Test (integration):**
  1. Flag on, member `full`: queue an urgent row; set the member to `minimal`; send → the sent text has no subject (canary), `outbox.detail` = `minimal`, no keyboard.
  2. The reverse (queued `minimal`, member `full` at send) → `full` text, `detail` = `full`.
  3. Flag off, member `minimal` → `full` text (today's behaviour).
  4. Org locked, member `full` → `minimal`.
  5. An `approval` card sent `minimal`, then approved in the panel → the `approval_edit` row edits the minimal text plus the status line.
  6. `/digest` with flag on and member `minimal` → minimal digest (stage 09 branch now reached).
  7. A mail-channel digest row of a `minimal` member → full mail text (unchanged).
- **Mutation guard:** make the sender read `row.detail` instead of the current value; test 1 fails; restore.
- **Check:** the touched tests, then the Proof.
- **Done when:** the Proof prints `PROOF_OK`.
- **Out of scope:** the routes and the link step (11), the panel (12).
