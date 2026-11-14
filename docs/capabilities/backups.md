# Backups

> Checked against the code at `334f5a0`, 2026-11-14.

## What it does now

Every night the VPS makes an encrypted copy of the whole Postgres database and sends it to a Backblaze B2 bucket. The VPS holds only the public `age` key and a bucket key that can write but not read or delete, so a stolen VPS cannot read or remove old backups. The private key lives on the owner's Mac. Once a month the owner restores one backup into a throwaway container with `deploy/restore-test.sh` and compares the row counts. The owner also makes a backup before each deploy. The app does not run the backup: the host cron runs it, and the app only sends a heartbeat (`docs/architecture.md` §8 Liveness).

## Rules

1. **Backups:** `deploy/backup.sh` at 03:30 every night: `pg_dump`, encrypted with `age` (only the public key on the VPS), copied with `rclone` to a Backblaze B2 bucket with a write-only key; remote retention is a bucket lifecycle rule. `deploy/restore-test.sh` on the Mac; one restore test per month.
   - Check against the code: the 03:30 time is a host crontab line (`30 3 * * * cd <repo> && deploy/backup.sh >> ~/ea-logs/backup.log 2>&1`, `deploy/README.md` § Backups), not a job of the app scheduler. The job list of `docs/architecture.md` §8 does not hold it.
2. **The run of `deploy/backup.sh`.** It reads the file `backup.env` in `deploy/` (`BACKUP_DIR` as an absolute path, `AGE_RECIPIENT` that starts with `age1`, `BACKUP_REMOTE`, `KEEP_DAYS` default 7, `COMPOSE` default `docker compose`; the file is not in git) and stops with a message when a value is bad or `age` or `rclone` is missing. Then:
   1. `pg_dump -Fc` of the database `email_assistant` runs inside the `db` container.
   2. The script checks that the stream starts with the dump magic `PGDMP`. An empty or foreign stream stops the run (`age` would write about 200 bytes for empty input).
   3. `age -r <recipient>` encrypts the stream into `ea-<UTC time>.dump.age.part` in `BACKUP_DIR` (the script sets `umask 077`).
   4. `rclone copyto --no-check-dest` copies the file to `BACKUP_REMOTE`. The flag is needed because the write-only key cannot read the target.
   5. Only after the copy, the script renames the file to its final name, so a failed copy leaves no `.dump.age` file. The last line is `backup ok <name> <bytes>`.
   6. Local files older than `KEEP_DAYS` days are deleted. The script never deletes remote files.
      On any failure the script exits non-zero and removes the unfinished `.part` file.
3. **The remote lifecycle rule.** The bucket has a lifecycle rule that removes old files (for example after 90 days; `deploy/README.md` § Backups, Bucket). It is a setting in the Backblaze web UI, not in the repository.
4. **The restore test.** `deploy/restore-test.sh <backup>.dump.age <age identity file>` runs on a machine that has the private key, never on the VPS. It starts a throwaway `postgres:17` container `ea-restore-test` with no network and no port, waits for Postgres, decrypts the backup into `pg_restore` through a pipe (the plain dump never touches the disk), and prints the row counts of `organizations`, `users`, `mailboxes` and `emails`. It removes the container at the end, also after an error. The owner compares the counts with the VPS at backup time and writes the date and the counts in the task log.
5. **After a real restore.** The dump holds live `auth_sessions` tokens, password hashes and reset tokens. After a real restore, run `delete from auth_sessions;` and ask the members to sign in again.
6. **A backup before each deploy.** Step 1 of `deploy/README.md` § Update is `deploy/backup.sh`; the last line must be `backup ok <name> <bytes>`. It comes before the disk check and the update.

## Entry points

| Kind | Name                                                                                           | Where                       |
| ---- | ---------------------------------------------------------------------------------------------- | --------------------------- |
| CLI  | `deploy/backup.sh` (host cron `30 3 * * *`; by hand before a deploy)                           | `deploy/backup.sh`          |
| CLI  | `deploy/restore-test.sh <backup> <age identity>` (on the Mac, once a month)                    | `deploy/restore-test.sh`    |
| CLI  | settings of the backup: `BACKUP_DIR`, `AGE_RECIPIENT`, `BACKUP_REMOTE`, `KEEP_DAYS`, `COMPOSE` | `deploy/backup.env.example` |
| job  | `platform.heartbeat` (`*/5 * * * *`; the dead-man's-switch, not a backup job)                  | `apps/server/src/main.ts`   |
| CLI  | runbook sections Backups and Update                                                            | `deploy/README.md`          |

## Data

The backup holds the whole database. Files: `BACKUP_DIR/ea-<UTC time>.dump.age` on the VPS (kept `KEEP_DAYS` days), the same name under `BACKUP_REMOTE` (kept by the bucket lifecycle rule), and the log `~/ea-logs/backup.log` with one `backup ok` line each night. The page of retention (`retention.md`) clears texts in the live database, and the older backups still hold them until the lifecycle rule removes the file.

## Limits

- No timed restore drill on a clean VM yet: E8b (F114, PD-054; target RPO 24 h and RTO 2 h).
- No alert when the last backup is older than 26 h or a run failed: E8b (PD-052). Today the only sign is the line in `~/ea-logs/backup.log`.
- The backup holds the database only. The file `.env` is not in it, so a restore on a new host also needs `CREDENTIALS_KEY` (it decrypts the stored mailbox passwords) and the other secrets from the owner's own copy.
- The restore test is manual, once a month, and its result goes to the task log only.

## Decisions

- ADR 0011 (own Postgres in Compose on the home VPS).
- PD-052 and PD-054 (Limits only).

## Tests

No automated test. The restore test is `deploy/restore-test.sh`, run by hand (`deploy/README.md` § Backups).
