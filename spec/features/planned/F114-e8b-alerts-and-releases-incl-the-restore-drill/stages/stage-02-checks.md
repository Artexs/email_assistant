# F114 stage 02 — The three database SLO checks and the config

Part of [`../plan.md`](../plan.md). Decisions P3, D2, D6, D8. Needs stage 01 (`SloCheck`, `SLO_KINDS`).

## Step 1 — Config keys

- **Files:** `platform/config.ts` (existing number pattern), `.env.example`. **Keys** (default, range): `SLO_SYNC_LAG_MIN` 15 (5–1440); `SLO_URGENT_LATENCY_MIN` 10 (1–240); `SLO_LLM_WINDOW_MIN` 30 (5–240); `SLO_LLM_MIN_CALLS` 5 (1–1000); `SLO_LLM_FAIL_PCT` 20 (1–100); `SLO_LLM_CLEAR_PCT` 10 (0–99); `SLO_REPEAT_H` 6 (1–168). Disk and backup keys: stage 04.
- **Decisions:** `SLO_LLM_CLEAR_PCT ≥ SLO_LLM_FAIL_PCT` is a start error that names both keys.
- **Test:** 1. no keys → the defaults. 2. `SLO_LLM_FAIL_PCT=10`, `SLO_LLM_CLEAR_PCT=10` → error with both key names. 3. `SLO_REPEAT_H=0` → error.

## Step 2 — Readers in their owning modules

All read across organizations, skip `suspended` ones, return ids and times only, and go into the `docs/code-patterns.md` exceptions.

- `mail`: `listLaggingMailboxes(db, { before: Date })` → `{ mailboxId, orgId, since }[]`: `status = 'active'` and `greatest(last_synced_at, status_changed_at, created_at) < before` (= `since`). `status_changed_at` stops a false alert right after `/resume`.
- `channels`: `listUrgentCandidates(db, { since: Date })` → `{ emailId, orgId, receivedAt, noticeAt, timeZone }[]`: the M5 arrival rule of `listUrgentNoticeTimes` (reuse its SQL: one arrival definition), `received_at ≥ since`, mailbox `active`, organization with a linked chat; `noticeAt` = first sent `urgent` row.
- `audit`: `countLlmCallsSince(db, since)` → `{ total, failed }` over `llm.call` rows (`failed` = `reason_code <> 'ok'`).
- LLM quota pause: `latestLlmPause` per non-suspended organization (with `softCodes`, `configCodes`); a result with code `http_429_quota` counts that organization.

## Step 3 — The checks

- **Files:** `modules/operator/slo-checks.ts`. Each returns `SloReading = { check: SloCheck; ids: string[] }` (at most 5 sorted ids for the stage 03 text; never stored).
- **Interfaces:** `checkSyncLag(db, now, cfg)`, `checkUrgentLatency(db, now, cfg)`, `checkLlmErrors(db, now, cfg)` → `SloReading`. Stage 04 adds `checkDisk` and `checkBackupAge` in the same file.
- **Rules** (state: `firing` / `between` / `clear`; facts are numbers):
  - Sync lag: any row → firing, else clear. Facts `mailboxes`, `max_lag_min`. Ids: mailbox ids.
  - Urgent: candidates of the last 24 h. Due = `receivedAt`; when `isQuietTime(receivedAt, timeZone)`, due = `quietEnd(receivedAt, timeZone)`. Late = (`noticeAt` null and `now − due > N min`) or (`noticeAt − due > N min` and `noticeAt ≥ now − 1 h`). Any late → firing, else clear (so it clears 1 h after the last late notice). Facts `mails`, `max_wait_min`. Ids: email ids.
  - LLM: `pct = failed / total × 100`. Firing: (`total ≥ MIN_CALLS` and `pct ≥ FAIL_PCT`) or quota orgs > 0. Clear: (`total < MIN_CALLS` or `pct < CLEAR_PCT`) and quota orgs = 0. Else between. Facts `calls`, `failed`, `pct`, `quota_orgs`. Ids: quota org ids.

## Test (fixed `now = 2026-11-20T10:00:00Z`, defaults)

Integration (two organizations, one `suspended`):

1. Active mailbox, `last_synced_at` 09:44, `status_changed_at` 08:00 → firing, `mailboxes = 1`, `max_lag_min = 16`.
2. Same, `status_changed_at` 09:50 (just resumed) → clear.
3. A lagging mailbox of the suspended organization only → clear.
4. Never synced, `created_at` 09:50 → clear; `created_at` 09:40 → firing.
5. Urgent mail `received_at` 09:45, no notice → firing, `max_wait_min = 15`.
6. Quiet hours: mail received 2026-11-19T22:30Z (23:30 Warsaw), no notice; due 2026-11-20T06:00Z (07:00 Warsaw). `now` 06:05Z → clear; `now` 06:15Z → firing.
7. Notice sent 09:20 for mail received 09:00 → firing (late within 1 h); sent 08:50 for mail received 08:30 → clear.
8. Urgent mail of an organization with no linked chat → clear.
9. 10 `llm.call` rows, 2 failed → firing (20 %); 3 failed of 4 → clear (below min calls).
10. 3 failed of 20 (15 %) → between.
11. Newest `llm.call` row of one organization `http_429_quota` → firing, `quota_orgs = 1`, ids = that org id.

## Check

The new tests, then the Proof.

## Done when

Tests 1–11 pass; readers in the exceptions list; the Proof prints `PROOF_OK`. Out of scope: job, send, texts (03); disk and backup (04).

