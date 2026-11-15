# Operations

> Checked against the code at `255e8ab5`, 2026-11-15.

## What it does now

The server runs one job, `ops.slo`, every 5 minutes. It checks service levels and sends the operator one Telegram text when an alert opens, one repeat every 6 hours while it stays open, and one text when it resolves. Five checks are live: sync lag, urgent mail not told in time and LLM failures (they read the database), free disk space, and the age of the last good backup (they read the host). The state of each incident is in the table `ops_alerts`, so a restart of the server does not lose it. The text goes only to the operator chat `OPERATOR_TELEGRAM_CHAT_ID` (a direct send, no outbox row, no user chat). With no operator chat the job still runs and the `info` line `slo_alert_sent` counts as the send. The text holds the kind, numbers, up to five ids and a runbook path, never a subject, an address, a folder name, an error text or the chat id. It is English by default and Polish when `OPERATOR_LOCALE=pl`.

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
7. **The two host checks** (F114 stage 04) read no database:
   - Disk: `statfs` of `SLO_DISK_PATH` (default `/`; in the container this is the host root volume, to be confirmed on the VPS). It gives `free_pct` and `free_gb` (1024^3 bytes, one decimal). Firing: `free_pct < SLO_DISK_FREE_PCT` (default 15) or `free_gb < SLO_DISK_FREE_GB` (default 2). Clear: both at least 5 points and 0.5 GB above those values. Else `between`. A volume that cannot be read makes the check throw: `slo_check_failed`, kind skipped for this tick.
   - Backup age: reads `BACKUP_STATUS_FILE` (the file of `deploy/backup.sh`, mounted read-only; empty = the check is off and an open alert stays as it is). Firing: the file is missing, unreadable or has a bad shape (`missing` 1), the last run failed (`failed` 1), or the last good backup is older than `SLO_BACKUP_MAX_AGE_H` hours (default 26). Else clear (no `between`). Facts: `age_h` (whole hours since `last_ok_at`, -1 if none), `failed`, `missing`.
8. **The text.** Line 1: `ALERT <kind>`, `STILL OPEN <kind> (since <ISO time>)`, `RESOLVED <kind> (open <N> min)` or `TEST <kind>`. Line 2: the facts in words. Line 3 (not for resolved): up to five ids of mailboxes, mails or organizations, then `+N more`. Last line: `Runbook: docs/known-alerts.md#<kind>`. In Polish the words change (`ALARM`, `Instrukcja:`) and the decimal separator is a comma.
9. **No real send outside the operator chat.** Dev and sim leave `OPERATOR_TELEGRAM_CHAT_ID` empty and send nothing real.

### Releases

1. **Every VPS deploy is a release.** A release is a tag `v<x.y.z>` (SemVer, `0.y.z` for now) on a commit of `origin/master`. The version in the root `package.json` must be the tag without `v`. A patch version is fine. The steps before the deploy are in `docs/release-checklist.md`.
2. **`bun run release:prepare <x.y.z>`** sets `version` in `package.json` and moves the items under `## [Unreleased]` of `CHANGELOG.md` to `## [x.y.z] - <UTC date>`, with an empty `[Unreleased]` left. It runs no git command; it prints the next commands. It refuses with exit 2 and no change for a version that is not `x.y.z`, not greater than the current one, or an `[Unreleased]` with no item.
3. **`deploy/release.sh v<x.y.z>`** (on the VPS) refuses a dirty tree or a tag that is not on `origin/master`. Then it runs the backup, the disk check, writes the state file `state` in the folder `deploy/release-state/` with `pending`, keeps the running image as `ea-server:<current>`, checks out the tag, builds the image once with the build arg `EA_RELEASE`, runs `db:migrate`, starts with `up -d --no-build --wait`, checks `/health` and the `EA_RELEASE` of the running server, and then moves `current` to `previous`. The last line is `release ok <tag> previous <old>`. It never rolls back by itself: a failed migration needs a human choice (a forward fix or a restore).
4. **`deploy/rollback.sh`** goes back with no rebuild and never changes the database. With `pending` set it returns to `current` (the release that broke); else it goes to `previous`. With no target it refuses. A second run with no `pending` swaps `current` and `previous`.
5. **Release identity.** The image holds `EA_RELEASE` (default `dev`); every log line has the field `release`. `/health` stays `{status, db}`. A plain `up -d --build` stamps `dev`.
6. **Images.** `ea-server:latest` is the running release. `ea-server:<tag>` stays for `current` and `previous`; the prune after a release removes every other `ea-server:v*` and `ea-server:pre-*` tag, including a manual `pre-<ticket>` image.
7. **A failed release** leaves `pending` set. `release.sh` refuses to run again until `deploy/rollback.sh` ran. After a release or a rollback the VPS checkout is detached; run `git checkout master` before a `git merge --ff-only`.
8. **Migration rule.** Migrations are forward only and follow expand and contract (`docs/code-patterns.md` § Migrations). CI runs `bun run db:check-migrations`: a migration newer than the cutoff `CONTRACT_CHECK_AFTER` (`apps/server/src/scripts/check-migrations-rules.ts`) that holds a contract statement (drop, rename, type change, `SET NOT NULL`, `TRUNCATE`, `REVOKE`, a new constraint on an old table) fails unless the file has a line `-- contract: v<x.y.z>`. The check does not see a replace that narrows a CHECK list; a reviewer must.

## Entry points

| Kind     | Name                                                                                                                       | Where                                            |
| -------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| job      | `ops.slo` (`30 */5 * * * *`)                                                                                               | `apps/server/src/main.ts`                        |
| function | `runSloTick`                                                                                                               | `apps/server/src/modules/operator/slo-job.ts`    |
| function | `checkSyncLag`, `checkUrgentLatency`, `checkLlmErrors`, `checkDisk`, `checkBackupAge`                                      | `apps/server/src/modules/operator/slo-checks.ts` |
| function | `sloAlertText`                                                                                                             | `apps/server/src/modules/operator/slo-texts.ts`  |
| function | `nextAlertStep`                                                                                                            | `packages/core/src/ops/alert-step.ts`            |
| CLI      | `bun run ops:alerts [--days 7]`: one line per incident of the last days (kind, opened, notices, resolved or `open`, facts) | `apps/server/src/scripts/ops-alerts.ts`          |
| CLI      | `bun run ops:alert-test (--kind <kind> \| --all)`: sends the `TEST` text through the real path, writes no row              | `apps/server/src/scripts/ops-alert-test.ts`      |
| CLI      | `bun run release:prepare <x.y.z>`: version and changelog for a release                                                     | `apps/server/src/scripts/release-prepare.ts`     |
| CLI      | `bun run db:check-migrations`: contract statements in new migrations (CI)                                                  | `apps/server/src/scripts/check-migrations.ts`    |
| script   | `deploy/release.sh <tag>`, `deploy/rollback.sh`                                                                            | `deploy/release.sh`, `deploy/rollback.sh`        |
| config   | `SLO_*`, `BACKUP_STATUS_FILE`, `OPERATOR_TELEGRAM_CHAT_ID`, `OPERATOR_LOCALE`                                              | `apps/server/src/platform/config.ts`             |

## Data

`ops_alerts` (migration `db/migrations/20261115140001_ops_alerts.sql`): one row per incident with the kind, the open, send and resolve times, the notice count and the last facts (numbers only). The table has no `org_id` and no personal data. Rows stay (no retention). Alert texts are never stored.

## Limits

- The disk check reads the volume of the path in the container. That this is the host root volume is not yet shown on the VPS (F114 stage 09).
- A bad status file (not the shape of `deploy/backup.sh`) reads as "No backup status file"; the log has no line that tells the two apart.
- No alert for a server or database that is down: Healthchecks.io stays the dead-man (`platform.heartbeat`).
- The alert text is one language per server (`OPERATOR_LOCALE`), not one per reader.
- The operator console list of alerts is F081.
- The release and rollback scripts are not run on the VPS yet (F114 stage 09), and there is no `v0.1.0` tag yet. `deploy/test/` runs them with stub commands only.
- The restore drill: F114 stages 07 to 09.

## Decisions

- ADR 0024 (structured logs and operator alerts).
- PD-052 (alert thresholds and channel).

## Tests

- `apps/server/test/integration/ops-slo-job.test.ts`
- `apps/server/test/integration/slo-checks.test.ts`
- `apps/server/test/integration/ops-alerts-repo.test.ts`
- `apps/server/src/modules/operator/slo-texts.test.ts`
- `apps/server/src/modules/operator/slo-host-checks.test.ts`
- `deploy/test/backup.test.ts`
- `deploy/test/release.test.ts`
- `deploy/test/rollback.test.ts`
- `deploy/test/release-identity.test.ts`
- `apps/server/src/scripts/check-migrations.test.ts`
- `apps/server/src/scripts/release-prepare.test.ts`
- `packages/core/src/ops/alert-step.test.ts`
