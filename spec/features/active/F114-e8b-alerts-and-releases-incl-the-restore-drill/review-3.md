# F114 stage 03 review (Opus 5.5, PASS 5d35f560)

Model: Opus 5.5, because the stage sends alerts to people and reads across organizations. No BLOCKING.

Test gap (fixed in a Sonnet continue, no re-review): TG-A, the `main.ts` wiring of the `ops.slo` job had no test (mutation `send: operatorSend` -> `send: null` survived).

Verified: the tick runs in `withoutTenantScope` through `runJobTick` (test 8e, mutation m06); recipient is `OPERATOR_TELEGRAM_CHAT_ID` by direct send per plan D4 (`OPERATOR_USER_IDS` only guards the web operator console); one mark per `nextAlertStep` step, send first, a failed send writes no mark; texts hold only counts, ages, UUIDs and the runbook path (en, pl with decimal commas); `ops:alert-test` exits 1 on a 500 and on a refused connection, no token or chat id printed; 17 worker mutations all killed; review-2 carry-over done.

Notes:
- `OPERATOR_LOCALE` is a plan deviation (D5 says English): logged as owner decision 48.
- The check shape is `SloCheckEntry {kind, run}`: stage 04 must add entries, not functions.
- On shutdown Telegram stops before `sloRun` is awaited: a send in flight fails with no mark and is sent again after restart (safe under D3, same as `operatorRun`).
- Small wording points: English "not told in time" and Polish "w oknie" read a little awkwardly.
