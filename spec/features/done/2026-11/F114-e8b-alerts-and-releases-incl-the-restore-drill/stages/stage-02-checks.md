# F114 stage 02 — The three database SLO checks and the config

Part of [`../plan.md`](../plan.md). Decisions P3, D2, D6, D8. Needs stage 01 (`SloCheck`, `SLO_KINDS`).

## Step 1 — Config keys

- `platform/config.ts`, `.env.example`. **Keys** (default, range): `SLO_SYNC_LAG_MIN` 15 (5–1440); `SLO_URGENT_LATENCY_MIN` 10 (1–240); `SLO_LLM_WINDOW_MIN` 30 (5–240); `SLO_LLM_MIN_CALLS` 5 (1–1000); `SLO_LLM_FAIL_PCT` 20 (1–100); `SLO_LLM_CLEAR_PCT` 10 (0–99); `SLO_REPEAT_H` 6 (1–168). Disk and backup keys: stage 04.
- `SLO_LLM_CLEAR_PCT ≥ SLO_LLM_FAIL_PCT` is a start error that names both keys.
- **Test:** 1. no keys → the defaults. 2. `SLO_LLM_FAIL_PCT=10`, `SLO_LLM_CLEAR_PCT=10` → error with both names. 3. `SLO_REPEAT_H=0` → error.

## Step 2 — Readers in their owning modules

All read across organizations, skip `plan = 'suspended'`, return ids and times only. Add each to the `docs/code-patterns.md` exceptions; fix its `operator` line ("no exception to § Data access"): the SLO job is now one.

- `mail`: `listLaggingMailboxes(db, { before })` → `{ mailboxId, orgId, since }[]`: `status = 'active'` and `since = greatest(last_synced_at, status_changed_at, created_at, organizations.resumed_at) < before`. As the `sync_stale` grace: no false alert after a resume or connect.
- `channels`: `listUrgentCandidates(db, { since })` → `{ emailId, orgId, receivedAt, startAt, noticeAt, timeZone }[]`. Eligible = the mail the urgent detector (`notices/urgent.ts`) would notify: latest triage `urgent`, not in the junk folder of its mailbox, `triaged_at ≥` the earliest `linked_at` of the org's chats and `≥ resumed_at`, mailbox `active`, at least one linked chat; plus the M5 filters (real, not backfilled). `received_at ≥ since`. `startAt = max(received_at, mailbox status_changed_at, org resumed_at)`. `noticeAt` = first sent `urgent` outbox row.
- `audit`: `countLlmCallsSince(db, since)` → `{ total, failed }` over `llm.call` rows (`failed` = `reason_code <> 'ok'`).
- Quota pause: `latestLlmPause` per non-suspended organization; code `http_429_quota` counts it.

## Step 3 — The checks

- **Files:** `modules/operator/slo-checks.ts`. Each returns `SloReading = { check: SloCheck; ids: string[] }` (≤ 5 sorted ids, never stored).
- **Interfaces:** `checkSyncLag(db, now, cfg, startedAt)`, `checkUrgentLatency(db, now, cfg, startedAt)`, `checkLlmErrors(db, now, cfg)` → `SloReading`. Stage 04 adds `checkDisk`, `checkBackupAge`.
- **Start grace:** for 10 min after `startedAt` (the `sync_stale` value), sync lag and urgent return `between`: an open alert stays open, none opens.
- **Rules** (`firing` / `between` / `clear`; facts are numbers):
  - Sync lag: any row → firing, else clear. Facts `mailboxes`, `max_lag_min`. Ids: mailbox ids.
  - Urgent: `lateMin(from, to, tz)` (pure, core) = minutes between `from` and `to` outside the org's quiet hours (`isQuietTime`); the sender holds urgent notices then. Late = `lateMin(startAt, noticeAt ?? now) > N` and (`noticeAt` null or `noticeAt ≥ now − 1 h`). Any late → firing, else clear (1 h after the last late notice). Facts `mails`, `max_wait_min`. Ids: email ids.
  - LLM: `pct = failed / total × 100`. Firing: (`total ≥ MIN_CALLS` and `pct ≥ FAIL_PCT`) or quota orgs > 0. Clear: (`total < MIN_CALLS` or `pct < CLEAR_PCT`) and no quota org. Else between. Facts `calls`, `failed`, `pct`, `quota_orgs`. Ids: quota org ids.

## Test (`now = 2026-11-20T10:00:00Z`, `startedAt` 08:00Z, defaults)

Integration (two organizations, one suspended):

1. Mailbox `last_synced_at` 09:44, `status_changed_at` 08:00 → firing, `max_lag_min = 16`.
2. Same, `status_changed_at` 09:50 → clear; org `resumed_at` 09:50 → clear.
3. Lagging mailbox of the suspended organization only → clear.
4. Never synced, `created_at` 09:50 → clear; 09:40 → firing.
5. `startedAt` 09:55, case 1 data → between.
6. Urgent mail received 09:45, no notice → firing, `max_wait_min = 15`.
7. `startedAt` 2026-11-19T00:00Z. Received 2026-11-19T20:58Z (21:58 Warsaw), no notice: `now` 21:30Z → clear (2 min outside quiet); `now` 2026-11-20T06:09Z → firing (2 + 9 = 11 min).
8. Notice 09:20 for mail received 09:00 → firing; notice 08:50 for mail received 08:30 → clear.
9. No linked chat → clear. Mail in the junk folder → clear. Triaged before the chat's `linked_at` → clear. Mailbox `status_changed_at` 09:55 (resumed), mail received 09:00 → clear.
10. 10 `llm.call` rows, 2 failed → firing; 3 of 4 → clear; 3 of 20 → between.
11. Newest `llm.call` of one org `http_429_quota` → firing, `quota_orgs = 1`, ids = that org.

Unit: 12. `lateMin(20:58Z, 2026-11-20T06:09Z, "Europe/Warsaw")` = 11.

## Done when

Tests 1–12 pass; `code-patterns.md` updated; the Proof prints `PROOF_OK`. Out of scope: job, send, texts (03); disk and backup (04).
