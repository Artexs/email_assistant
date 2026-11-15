# Operations

> Checked against the code at `4a53454e`, 2026-11-15.

## What it does now

The server runs one job, `ops.slo`, every 5 minutes. It checks service levels and sends the operator one Telegram text when an alert opens, one repeat every 6 hours while it stays open, and one text when it resolves. The three checks that read the database are live: sync lag, urgent mail not told in time, and LLM failures. The state of each incident is in the table `ops_alerts`, so a restart of the server does not lose it. The text goes only to the operator chat `OPERATOR_TELEGRAM_CHAT_ID` (a direct send, no outbox row, no user chat). With no operator chat the job still runs and the `info` line `slo_alert_sent` counts as the send. The text holds the kind, numbers, up to five ids and a runbook path, never a subject, an address, a folder name, an error text or the chat id. It is English by default and Polish when `OPERATOR_LOCALE=pl`.

## Rules

### Alerts

1. **One incident per kind.** The kinds are `slo_sync_lag`, `slo_urgent_latency`, `slo_llm_errors`, `slo_disk` and `slo_backup_age`. A partial unique index allows one open row per kind. One IMAP outage makes one alert, not one per mailbox.
2. **The step rule.** For each kind, in this order, the job reads the check and calls `nextAlertStep` (`packages/core/src/ops/alert-step.ts`). It returns `none`, `open`, `repeat`, `resolve` or `silent_close`:
   - `open`: no open row, check firing. The job inserts the row, sends, then marks the send.
   - `repeat`: the open notice went out and `SLO_REPEAT_H` hours (default 6) passed since the last notice, check firing or between.
   - `resolve`: the check is clear, or a resolved notice is still owed. The job sets `resolved_at`, sends, then marks the send.
   - `silent_close`: the open notice never went out and the check is clear. The job closes the row with no text.
3. **Send first, then mark.** A failed send writes no mark and logs `slo_alert_send_failed`; the next tick sends the same notice again. A crash between the send and the mark repeats one notice (at least once). The job calls each mark once per step.
4. **Hysteresis.** A check has three states: `firing`, `between` and `clear`. An open alert stays open while the check is `between`. It resolves only on `clear`.
5. **A check that fails** logs `slo_check_failed` with its kind and is skipped for this tick; the other kinds run. A check that is off (it returns null) leaves an open row as it is.
6. **The three database checks** read every organization that is not suspended, with no tenant scope (the scheduler runs each tick that way):
   - Sync lag: an active mailbox with no sign of life (last sync, status change, creation or organization resume) for more than `SLO_SYNC_LAG_MIN` minutes (default 15).
   - Urgent latency: an urgent mail that the urgent notice covers waited more than `SLO_URGENT_LATENCY_MIN` minutes (default 10) outside quiet hours for its notice. The wait starts at the receive time, or at the later mailbox status change or organization resume. A notice that fails for good keeps the mail late for 24 h. The check reads at most 200 urgent mails per organization. A bad organization time zone skips that organization and logs `slo_urgent_zone_bad`.
   - LLM errors: at least `SLO_LLM_MIN_CALLS` calls in `SLO_LLM_WINDOW_MIN` minutes with `SLO_LLM_FAIL_PCT` percent failed, or an organization paused by a spent quota.
   - For 10 minutes after a start, sync lag and urgent give no verdict.
7. **The text.** Line 1: `ALERT <kind>`, `STILL OPEN <kind> (since <ISO time>)`, `RESOLVED <kind> (open <N> min)` or `TEST <kind>`. Line 2: the facts in words. Line 3 (not for resolved): up to five ids of mailboxes, mails or organizations, then `+N more`. Last line: `Runbook: docs/known-alerts.md#<kind>`. In Polish the words change (`ALARM`, `Instrukcja:`) and the decimal separator is a comma.
8. **No real send outside the operator chat.** Dev and sim leave `OPERATOR_TELEGRAM_CHAT_ID` empty and send nothing real.

## Entry points

| Kind     | Name                                                                                                                       | Where                                            |
| -------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| job      | `ops.slo` (`30 */5 * * * *`)                                                                                               | `apps/server/src/main.ts`                        |
| function | `runSloTick`                                                                                                               | `apps/server/src/modules/operator/slo-job.ts`    |
| function | `checkSyncLag`, `checkUrgentLatency`, `checkLlmErrors`                                                                     | `apps/server/src/modules/operator/slo-checks.ts` |
| function | `sloAlertText`                                                                                                             | `apps/server/src/modules/operator/slo-texts.ts`  |
| function | `nextAlertStep`                                                                                                            | `packages/core/src/ops/alert-step.ts`            |
| CLI      | `bun run ops:alerts [--days 7]`: one line per incident of the last days (kind, opened, notices, resolved or `open`, facts) | `apps/server/src/scripts/ops-alerts.ts`          |
| CLI      | `bun run ops:alert-test (--kind <kind> \| --all)`: sends the `TEST` text through the real path, writes no row              | `apps/server/src/scripts/ops-alert-test.ts`      |
| config   | `SLO_*`, `OPERATOR_TELEGRAM_CHAT_ID`, `OPERATOR_LOCALE`                                                                    | `apps/server/src/platform/config.ts`             |

## Data

`ops_alerts` (migration `db/migrations/20261115140001_ops_alerts.sql`): one row per incident with the kind, the open, send and resolve times, the notice count and the last facts (numbers only). The table has no `org_id` and no personal data. Rows stay (no retention). Alert texts are never stored.

## Limits

- The disk and backup-age checks, the backup status file and the Healthchecks.io backup ping come in F114 stage 04. Until then the text of those two kinds exists (`ops:alert-test` sends it) but no check opens them.
- No alert for a server or database that is down: Healthchecks.io stays the dead-man (`platform.heartbeat`).
- The alert text is one language per server (`OPERATOR_LOCALE`), not one per reader.
- The operator console list of alerts is F081.
- Releases, rollback and the restore drill: F114 stages 05 to 09.

## Decisions

- ADR 0024 (structured logs and operator alerts).
- PD-052 (alert thresholds and channel).

## Tests

- `apps/server/test/integration/ops-slo-job.test.ts`
- `apps/server/test/integration/slo-checks.test.ts`
- `apps/server/test/integration/ops-alerts-repo.test.ts`
- `apps/server/src/modules/operator/slo-texts.test.ts`
- `packages/core/src/ops/alert-step.test.ts`
