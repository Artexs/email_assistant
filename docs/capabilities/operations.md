# Operations

> Checked against the code at `255e8ab5`, 2026-11-15.
>
> Limits rechecked after the first drill on the VPS, 2026-11-19.

## What it does now

The server runs one job, `ops.slo`, every 5 minutes. It checks service levels and sends the operator one Telegram text when an alert opens, one repeat every 6 hours while it stays open, and one text when it resolves. Five checks are live: sync lag, urgent mail not told in time and LLM failures (they read the database), free disk space, and the age of the last good backup (they read the host). The state of each incident is in the table `ops_alerts`, so a restart of the server does not lose it. The text goes only to the operator chat `OPERATOR_TELEGRAM_CHAT_ID` (a direct send, no outbox row, no user chat). With no operator chat the job still runs and the `warn` line `operator_alert_unsent` counts as the send. The text holds the kind, numbers, up to five ids and a runbook path, never a subject, an address, a folder name, an error text or the chat id. It is English by default and Polish when `OPERATOR_LOCALE=pl`.

## Rules

### Alerts

1. **One incident per kind.** The kinds are `slo_sync_lag`, `slo_urgent_latency`, `slo_llm_errors`, `slo_disk` and `slo_backup_age`. A partial unique index allows one open row per kind. One IMAP outage makes one alert, not one per mailbox.
2. **The step rule.** For each kind, in this order, the job reads the check and calls `nextAlertStep` (`packages/core/src/ops/alert-step.ts`). It returns `none`, `open`, `repeat`, `resolve` or `silent_close`:
   - `open`: no open row, check firing. The job inserts the row, sends, then marks the send.
   - `repeat`: the open notice went out and `SLO_REPEAT_H` hours (default 6) passed since the last notice, check firing or between.
   - `resolve`: the check is clear, or a resolved notice is still owed. The job sets `resolved_at`, sends, then marks the send.
   - `silent_close`: the open notice never went out and the check is clear. The job closes the row with no text.
3. **Send first, then mark.** A failed send writes no mark and logs `operator_alert_send_failed` (level `error`, once per alert key and process); the next tick sends the same notice again. A crash between the send and the mark repeats one notice (at least once). The job calls each mark once per step.
4. **Hysteresis.** A check has three states: `firing`, `between` and `clear`. An open alert stays open while the check is `between`. It resolves only on `clear`.
5. **A check that fails** logs `operator_check_failed` with its kind (a state read or write that fails logs `operator_alert_failed`) and is skipped for this tick; the other kinds run. A check that is off (it returns null) leaves an open row as it is.
6. **The three database checks** read every organization that is not suspended, with no tenant scope (the scheduler runs each tick that way):
   - Sync lag: an active mailbox with no sign of life (last sync, status change, creation or organization resume) for more than `SLO_SYNC_LAG_MIN` minutes (default 15).
   - Urgent latency: an urgent mail that the urgent notice covers waited more than `SLO_URGENT_LATENCY_MIN` minutes (default 10) outside quiet hours for its notice (the default hours, or with the flag `user_quiet_hours` the own hours of the user of the notice: [digest-and-notices.md](digest-and-notices.md) rule 3a). The wait starts at the receive time, or at the later mailbox status change or organization resume. A notice that fails for good keeps the mail late for 24 h. The check reads at most 200 urgent mails per organization. A bad organization time zone skips that organization and logs `slo_urgent_zone_bad`.
   - LLM errors: at least `SLO_LLM_MIN_CALLS` calls in `SLO_LLM_WINDOW_MIN` minutes with `SLO_LLM_FAIL_PCT` percent failed, or an organization paused by a spent quota.
   - For 10 minutes after a start, sync lag and urgent give no verdict.
7. **The two host checks** (F114 stage 04) read no database:
   - Disk: `statfs` of `SLO_DISK_PATH` (default `/`; in the container this is the host root volume, to be confirmed on the VPS). It gives `free_pct` and `free_gb` (1024^3 bytes, one decimal). Firing: `free_pct < SLO_DISK_FREE_PCT` (default 15) or `free_gb < SLO_DISK_FREE_GB` (default 2). Clear: both at least 5 points and 0.5 GB above those values. Else `between`. A volume that cannot be read makes the check throw: `operator_check_failed`, kind skipped for this tick.
   - Backup age: reads `BACKUP_STATUS_FILE` (the file of `deploy/backup.sh`, mounted read-only; empty = the check is off and an open alert stays as it is). Firing: the file is missing, unreadable or has a bad shape (`missing` 1), the last run failed (`failed` 1), or the last good backup is older than `SLO_BACKUP_MAX_AGE_H` hours (default 26). Else clear (no `between`). Facts: `age_h` (whole hours since `last_ok_at`, -1 if none), `failed`, `missing`.
8. **The text.** The words live in core (`packages/core/src/texts/operator.ts`, `slo`) and `renderSloAlert` in `packages/core/src/ops/alert-text.ts` joins them; the operator module only sends. Line 1: `ALERT <kind>`, `STILL OPEN <kind> (since <ISO time>)`, `RESOLVED <kind> (open <N> min)` or `TEST <kind>`. Line 2: the facts in words. Line 3 (not for resolved): up to five ids of mailboxes, mails or organizations, then `+N more`. Last line: `Runbook: docs/known-alerts.md#<kind>`. In Polish the words change (`ALARM`, `Instrukcja:`) and the decimal separator is a comma.
9. **No real send outside the operator chat.** Dev and sim leave `OPERATOR_TELEGRAM_CHAT_ID` empty and send nothing real.

### Releases

1. **Every VPS deploy is a release.** A release is a tag `v<x.y.z>` (SemVer, `0.y.z` for now) on a commit of `origin/master`. The version in the root `package.json` must be the tag without `v`. A patch version is fine. The steps before the deploy are in `docs/release-checklist.md`.
2. **`bun run release:prepare <x.y.z>`** sets `version` in `package.json` and moves the items under `## [Unreleased]` of `CHANGELOG.md` to `## [x.y.z] - <UTC date>`, with an empty `[Unreleased]` left. It runs no git command; it prints the next commands. A version that is not `x.y.z` is a usage error (exit 2). A version that is not greater than the current one, or an `[Unreleased]` with no item, is a refusal (exit 1). Both change no file.
3. **`deploy/release.sh v<x.y.z>`** (on the VPS) refuses first, before any fetch, backup or mark, when the env is not split (exit 2, `run deploy/env-split.sh first (state <old|mixed>)`). Then it refuses a dirty tree or a tag that is not on `origin/master`. Then it runs the backup, the disk check, writes the state file `state` in the folder `deploy/release-state/` with `pending`, keeps the running image as `ea-server:<current>`, checks out the tag, builds the image once with the build arg `EA_RELEASE`, runs the migrations in the one-off service `migrate` (`run --rm -T migrate`; it alone holds the migrator URL), starts with `up -d --no-build --wait`, checks `/health` and the `EA_RELEASE` of the running server, runs `check-server-env.sh` (a key, or a failed read, fails the release at `verify` with `pending` still set), and then moves `current` to `previous`. The last line is `release ok <tag> previous <old>`. It never rolls back by itself: a failed migration needs a human choice (a forward fix or a restore).
4. **`deploy/rollback.sh`** goes back with no rebuild and never changes the database. With `pending` set it returns to `current` (the release that broke); else it goes to `previous`. With no target it refuses. It refuses a host that is not split like the release does, and runs no env check: the release before a contract release is a valid target and still holds the migrator URL. A second run with no `pending` swaps `current` and `previous`. It refuses (exit 2, nothing changed) when the host has a `db.env` file in `deploy/` (the database passwords split out of `.env`) and the target commit has no `deploy/compose-lib.sh`: the message tells the operator to undo the env split first.
   The deploy scripts (`release.sh`, `rollback.sh`, `backup.sh`, `logs.sh`, `restore.sh --target new-host`; the last one refuses a host that is not split before any docker call, the drill has no such guard) build their Compose command in one place, `deploy/compose-lib.sh` (`ea_compose_init`): the env file for the database passwords is that `db.env` when it exists, else `.env`.
   **Env layout (ADR 0019).** On the VPS, the file `db.env` in `deploy/` (mode 600, not in git) holds `POSTGRES_PASSWORD`, `MIGRATOR_PASSWORD` and `APP_PASSWORD`; Compose reads it for interpolation and `server` and `cli` never get it, and Compose gives them no admin key (only `DATABASE_URL`, role `app`; the one-off service `migrate` alone gets the migrator URL). `.env` holds every other key and no database key. `env-split.sh` in `deploy/` moves the lines of an old host (`env split ok moved=<n>`; `--undo` moves them back); `check-server-env.sh` in `deploy/` reads the key names of the running server and prints `server env ok keys=<n>` or `server env bad: <names>` (exit 1). The runbook is `deploy/README.md` § Env split. No file holds a copy of `.env` on the host: the old value of a key stays in the password manager.
5. **Release identity.** The image holds `EA_RELEASE` (default `dev`); every log line has the field `release`. `/health` stays `{status, db}`. A plain `up -d --build` stamps `dev`.
6. **Images.** `ea-server:latest` is the running release. `ea-server:<tag>` stays for `current` and `previous`; the prune after a release removes every other `ea-server:v*` and `ea-server:pre-*` tag, including a manual `pre-<ticket>` image.
7. **A failed release** leaves `pending` set. `release.sh` refuses to run again until `deploy/rollback.sh` ran. After a release or a rollback the VPS checkout is detached; run `git checkout master` before a `git merge --ff-only`.
8. **Migration rule.** Migrations are forward only and follow expand and contract (`docs/code-patterns.md` § Migrations). CI runs `bun run db:check-migrations`: a migration newer than the cutoff `CONTRACT_CHECK_AFTER` (`apps/server/src/scripts/lib/check-migrations-rules.ts`) that holds a contract statement (drop, rename, type change, `SET NOT NULL`, `TRUNCATE`, `REVOKE`, a new constraint on an old table) fails unless the file has a line `-- contract: v<x.y.z>`. The check does not see a replace that narrows a CHECK list; a reviewer must.

### Restore

1. **One restore path.** `deploy/restore.sh --target drill|new-host (--stdin | <file.dump.age> <identity file>)` restores a backup for the twice-a-year drill and for a new host. The plain dump travels in a pipe and never touches a disk. Only the `pg_restore` call reads stdin; every other `docker` call gets `</dev/null`. The age identity stays on the machine that runs `age`.
2. **The empty-target guard.** After `up -d --wait db` and the TCP wait (step `db-ready`: `pg_isready -h 127.0.0.1` inside the container, up to 60 probes with `sleep 1` between; no answer exits 1 at `db-ready`; the Postgres image init server listens on the socket only, so a TCP answer means the final server runs; prints `db ready probes=<n>`), and before the image build, both targets read the table count of the `public` schema. More than 0 tables, or a count that is not a number, stops the script: exit 2 for tables (a `new-host` restore never goes over data; a drill needs `--down` first), exit 1 for an unreadable count. A refused run changes nothing.
3. **The steps** (after the guard): build the server image once, `pg_restore --no-owner --role=migrator --exit-on-error`, print `count organizations=N users=N mailboxes=N emails=N`, clear `auth_sessions` (drill: also pause every mailbox and clear `ops_alerts`), the migrations (service `migrate`), `credentials:check` (service `cli`), then `up -d --no-build --wait`. The last line is `restore ok target=<t> seconds=<n>`. Exit 2: refused, nothing changed. Exit 1: a step failed; a drill stack stays up for a look.
4. **`bun run credentials:check`** proves that the `CREDENTIALS_KEY` of the environment opens every stored mailbox secret before the server starts. `countDecryptableCredentials` (`apps/server/src/modules/mail/credentials-check.ts`) reads `mailbox_credentials` of all organizations (no `TenantContext`; `docs/code-patterns.md` § Data access) in pages of 200 and decrypts each row with the AAD `mailbox:<id>`. A password, an app password or an OAuth secret counts in `ok` when it opens (an OAuth secret must also have the stored shape). A wrong key, a wrong key version, changed data or a secret sealed for another mailbox counts in `failed`; no error leaves for a bad row. A database error exits 1 (also when the database does not answer); it is never `ok=0 failed=0`. An argument exits 2 with the usage line. A new `CREDENTIALS_KEY` also orphans the `sender_profiles` rows: their keyed hash cannot be recomputed, so a data-request erase misses them until retention removes them (`docs/capabilities/account-data.md`, item 13).
5. **The output holds counts only.** The one result line is `[credentials-check] credentials ok=<n> failed=<m>` (`createCliOutput` writes the prefix; the text is `credentialsLine` in `apps/server/src/scripts/lib/credentials-check-lines.ts`). No secret, key, password, address, id or error text is printed. A failed run prints `[credentials-check] failed: <error name> [code]`, never the message. Exit 0 when the rows were read, also with `failed` above 0; exit 1 on a config or database error.
6. **`restore.sh` reads that line.** It takes the number after `failed=` from the last line that is the exact result line (with the prefix, or bare). `failed` above 0, or no result line, exits 1 before the server starts. A test runs the real script under `restore.sh` and checks that both agree.
7. **Drill safety** (`deploy/compose.drill.yaml`, `restore.sh --target drill`). The drill shares nothing with the live stack:
   - Own project `ea-drill` (own volume and network, subnet `172.29.0.0/24`), image `ea-drill-server`, no published port, `restart: "no"`, `local` log driver (the log store never sees a drill line).
   - Env file `drill.env` in `deploy/` (made by `--init-env`, mode 600: new database passwords and only the two credentials keys of the live `.env`); the live `.env` is not read.
   - No Telegram token, heartbeat URL, operator chat, web base URL or LLM key; `TRIAGE_LLM_SCOPE`, `ACTIONS_SCOPE` and `SEND_SCOPE` are `off`; every restored mailbox is `paused` before the server starts, so nothing syncs a real mailbox.
   - The script refuses a resolved project named `email-assistant` and a drill service with a published port. It never passes a Compose profile and unsets `COMPOSE_*` variables of the caller.
   - `--down` removes the project, its volume and the image `ea-drill-server` (never `--rmi all`: `postgres:17` is shared with the live stack).

## Entry points

| Kind     | Name                                                                                                                           | Where                                               |
| -------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| job      | `ops.slo` (`30 */5 * * * *`)                                                                                                   | `apps/server/src/start/operator.ts`                 |
| function | `runSloTick`                                                                                                                   | `apps/server/src/modules/operator/slo-job.ts`       |
| function | `checkSyncLag`, `checkUrgentLatency`, `checkLlmErrors`, `checkDisk`, `checkBackupAge`                                          | `apps/server/src/modules/operator/slo-checks.ts`    |
| function | `renderSloAlert`, `renderOperatorEvent`, `operatorEventKey`                                                                    | `packages/core/src/ops/alert-text.ts`, `events.ts`  |
| function | `nextAlertStep`                                                                                                                | `packages/core/src/ops/alert-step.ts`               |
| CLI      | `bun run ops:alerts [--days 7]`: one line per incident of the last days (kind, opened, notices, resolved or `open`, facts)     | `apps/server/src/scripts/ops-alerts.ts`             |
| CLI      | `bun run ops:alert-test (--kind <kind> \| --all)`: sends the `TEST` text of one of the ten kinds, or of all ten, writes no row | `apps/server/src/scripts/ops-alert-test.ts`         |
| CLI      | `bun run release:prepare <x.y.z>`: version and changelog for a release                                                         | `apps/server/src/scripts/release-prepare.ts`        |
| CLI      | `bun run db:check-migrations`: contract statements in new migrations (CI)                                                      | `apps/server/src/scripts/check-migrations.ts`       |
| script   | `deploy/release.sh <tag>`, `deploy/rollback.sh`                                                                                | `deploy/release.sh`, `deploy/rollback.sh`           |
| script   | `deploy/restore.sh --target drill\|new-host`: the restore for a drill and for a new host                                       | `deploy/restore.sh`                                 |
| compose  | `deploy/compose.drill.yaml`: the override of the drill stack (project `ea-drill`)                                              | `deploy/compose.drill.yaml`                         |
| CLI      | `bun run credentials:check`: does `CREDENTIALS_KEY` open every stored mailbox secret? Prints counts only                       | `apps/server/src/scripts/credentials-check.ts`      |
| function | `countDecryptableCredentials`                                                                                                  | `apps/server/src/modules/mail/credentials-check.ts` |
| config   | `SLO_*`, `BACKUP_STATUS_FILE`, `OPERATOR_TELEGRAM_CHAT_ID`, `OPERATOR_LOCALE`                                                  | `apps/server/src/platform/config-ops.ts`            |

## Data

`ops_alerts` (migration `db/migrations/20261115140001_ops_alerts.sql`): one row per incident with the kind, the open, send and resolve times, the notice count and the last facts (numbers only). The table has no `org_id` and no personal data. Rows stay (no retention). Alert texts are never stored.

## Limits

- A bad status file (not the shape of `deploy/backup.sh`) reads as "No backup status file"; the log has no line that tells the two apart.
- No alert for a server or database that is down: Healthchecks.io stays the dead-man (`platform.heartbeat`).
- The alert text is one language per server (`OPERATOR_LOCALE`), not one per reader.
- The operator console list of alerts is F081.
- The runbook for a lost host is `deploy/README.md` § VPS lost. The first real drill ran on 2026-11-19 (restore 173 s, 9 min wall time); the next one is due 2027-05-19.
- `credentials:check` reads every credentials row in one process and needs the database role `app` and the config of the server (`loadConfig`). It does not check that a mailbox login works, only that the stored secret opens.

## Decisions

- ADR 0019 (production stays on the home VPS behind Tailscale; env split; `migrate` service).
- ADR 0024 (structured logs and operator alerts).
- PD-052 (alert thresholds and channel).

## Tests

- `apps/server/test/integration/ops-slo-job.test.ts`
- `apps/server/test/integration/slo-checks.test.ts`
- `apps/server/test/integration/ops-alerts-repo.test.ts`
- `packages/core/src/ops/alert-text.test.ts`
- `packages/core/src/ops/events.test.ts`
- `apps/server/src/modules/operator/slo-host-checks.test.ts`
- `deploy/test/backup.test.ts`
- `deploy/test/release.test.ts`
- `deploy/test/rollback.test.ts`
- `deploy/test/docs-env-split.test.ts`
- `deploy/test/release-identity.test.ts`
- `deploy/test/restore.test.ts`, `deploy/test/compose-drill.test.ts`
- `apps/server/test/integration/credentials-check.test.ts`
- `apps/server/src/scripts/check-migrations.test.ts`
- `apps/server/src/scripts/release-prepare.test.ts`
- `packages/core/src/ops/alert-step.test.ts`
