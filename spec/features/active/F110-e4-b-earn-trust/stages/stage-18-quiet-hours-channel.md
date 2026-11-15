# F110 stage 18 — Per-user quiet hours and report channel

Part of [`../plan.md`](../plan.md). Web stage. Flags `user_quiet_hours` and `report_mail` (the channel choice shows only with `report_mail`). Polish text: review by `claude-opus-5-5`.

## Step 1 — Quiet hours per user in the sender

- **Goal:** each member's own quiet hours hold their notices (P5).
- **Files:** `packages/core/src/digest/local-time.ts` (`isQuietTime`, `quietEnd` and `lateMin` take an optional `QuietHours` at `HEAD`, default `QUIET_HOURS`); the outbox sender reads the row user's `memberships.quiet_start` / `quiet_end` (one query per claimed batch, not per row).
- **Decisions:**
  - `null` → the default 22:00–07:00. Equal start and end → no quiet hours. A range that crosses midnight works as today's default.
  - The digest kind is never held (as today); `approval_edit` stays exempt (F102 D4).
  - The org time zone stays the clock (no per-user time zone).
  - Flag off → the default for everyone.
  - The F114 alert `slo_urgent_latency` (`operator/slo-checks.ts`, `checkUrgentLatency`) passes to `lateMin` the hours of the user of the sent row that gave `noticeAt` (`MIN(sent_at)`). No sent row: compute `lateMin` per pending urgent row's user and take the smallest (review 2 N4). `UrgentCandidate` carries the quiet hours (null → default; flag off → null). M5 keeps the default (Q18).
- **Test** (`local-time.test.ts`, sender integration test):
  1. Hours 23:00–06:00, `Europe/Warsaw`, now 22:30 local → not quiet; 23:30 → quiet; `quietEnd` → 06:00 next day.
  2. Hours 09:00–17:00 (day quiet) → 12:00 quiet, 18:00 not.
  3. Start = end → never quiet.
  4. DST: 2026-03-29 (spring forward) with 22:00–07:00 → `quietEnd` from 01:30 local is 07:00 local, 4 h 30 min of real time later; 2026-10-25 (fall back) from 01:30 (first pass) → 6 h 30 min later.
  5. Two members, one with 23:00–06:00, at 22:30 → one urgent row goes, the other waits to 07:00.
  6. SLO: flag on, member hours 21:00–08:00, urgent mail at 21:30 local, notice sent 08:00 → `lateMin` 0, the check stays `clear`; flag off → 90 min (firing at the default threshold). Two pending rows, users 21:00–08:00 and default, no sent row, now 07:30 → the smaller value.

## Step 2 — The settings route and card

- **Goal:** a member sets their quiet hours and picks the report channel (P4, Q10).
- **Files:** `GET/PATCH /api/me/notify` with `apiDoc` (body `{ quietStart, quietEnd } | { reportChannel, reportMailboxId? }`, both nullable to reset); schema in `packages/core/src/web/`; a card on the Settings page for every member; page keys.
- **Decisions:**
  - Any member edits only their own row (no user id in the body).
  - `reportChannel` `mail` or `both` needs a mailbox of the org that is `active` (default: the oldest active mailbox; Q10); else 409 `no_mailbox`. `telegram` or `both` without a linked chat is allowed (the card warns).
  - Audit row `member.notify_changed` with the changed keys (no values that are addresses).
- **Test:**
  7. PATCH quiet hours `23:00`/`06:00` → stored; `25:00` → 400; only one of the two → 400.
  8. PATCH `mail` with no active mailbox → 409; with one → stored with that mailbox id.
  9. A member cannot change another member (there is no path to name one: assert the row of the caller only changed).
  10. e2e: the card saves quiet hours and shows them after a reload; `expectNoA11yViolations`.

## Done when

- `/status` shows the member's own quiet hours (the line exists; feed it the per-user value).
- Proof (`s18`, with the web part) prints `PROOF_OK`.

## Out of scope

Sending by mail (stages 19–20). Per-user time zones.
