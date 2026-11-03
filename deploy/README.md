# Pilot host runbook

Install, update and test the pilot on the home VPS. Docker only.
All commands run in the repo root.
Run the commands in bash (the default VPS shell).
`C` below means:

```sh
C="docker compose -f deploy/compose.yaml --env-file .env"
```

The server has no inbound port. The `db` service has no host port.

## Requirements

- Docker with the Compose plugin, and git.
- For backups (section Backups): `age` (public recipient only) and `rclone`.

## First install

1. Clone the repo and go into it.
2. Make the env file and lock it:
   `cp .env.example .env && chmod 600 .env`
3. Set these keys in `.env`:
   - `POSTGRES_PASSWORD`, `MIGRATOR_PASSWORD`, `APP_PASSWORD`: URL-safe. Make each with `openssl rand -hex 24`.
   - `CREDENTIALS_KEY`: `openssl rand -base64 32`. Keep a copy in a password manager. If you lose the key, you lose all stored mailbox passwords.
   - `CREDENTIALS_KEY_VERSION=1`
   - `HEARTBEAT_URL` (see Heartbeat), `TEST_MAILBOX_ADDRESS` (test mailbox only), `LOG_LEVEL=info`.
   - Compose sets `DATABASE_URL`, `MIGRATOR_DATABASE_URL` and `PORT` by itself. Their values in `.env` do not count for `server`.
4. Start the database: `$C up -d --wait db`
5. Build the image and migrate: `$C run --build --rm server bun run db:migrate`
6. Create the organisation:
   `$C run --rm server bun run org:create --org-name <name> --email <email> --display-name <name>`
7. Connect the mailbox. The password goes on stdin. Use `-T`, because the command has no terminal on stdin:
   `read -rsp 'IMAP password: ' P && printf '%s' "$P" | $C run --rm -T server bun run mailbox:connect --org-id <uuid> --address <email>; unset P`
8. Start the server: `$C up -d --build --wait`

## Update

```sh
git pull
$C up -d --wait db
$C run --build --rm server bun run db:migrate
$C up -d --build --wait
```

## Logs

```sh
$C logs -f server
$C logs --since 1h server
```

A good start shows `listening on port 8080`. Each sync log line has the form `sync <mailbox id> <mode>: fetched …`.

## Reboot

Run once: `sudo systemctl enable docker`.
Both services have `restart: unless-stopped`, so they start after a reboot.
Test once: `sudo reboot`, then `$C ps`. Both services must be `Up` and healthy.

## Heartbeat

1. In Healthchecks.io, make one check: period 5 minutes, grace time 10 minutes.
2. Add an email or Telegram integration to the check.
3. Put the ping URL in `HEARTBEAT_URL` in `.env`, then run `$C up -d server`.
4. Test a stop: `$C stop server`. After the period and the grace time, the alert arrives.
   Then run `$C start server`. The check turns green after the next ping.

## 48-hour test procedure

Start time `T0`. Use the test mailbox only.

1. Cron on the VPS, every hour:
   `0 * * * * cd <repo> && docker compose -f deploy/compose.yaml --env-file .env run --rm -T server bun run mailbox:seed --org-id <org> --mailbox-id <test mailbox> >> ~/ea-logs/seed.log 2>&1`
   Run `mkdir -p ~/ea-logs` first.
2. Move back to INBOX (simulates a system move): in webmail, make the folder `EA-test` and move one stored test mail into it.
   Set the row folder:
   `$C exec db psql -U postgres -d email_assistant -c "update emails set folder = 'EA-test' where id = '<id>'"`
   Move the mail back to INBOX. After the next sync, the row has `returned_at` set and no new row exists.
3. Forced rescan at about hour 24:
   `$C run --rm -T server bun run mailbox:rescan --org-id <org> --mailbox-id <id>`
   The next sync log line has `sync <mailbox id> rescan:`.
4. At the end (48 hours or more), right after a sync:
   `$C run --rm -T server bun run mailbox:audit --org-id <org> --mailbox-id <id> --since <T0 ISO time>`
   The output must be `missing=0 duplicates=0` with exit code 0.
5. Remove the cron line.

## Backups

`deploy/backup.sh` runs every night. It writes an `age`-encrypted `pg_dump` to `BACKUP_DIR` and copies it to a Backblaze B2 bucket with `rclone`.
The `age` private key never lives on the VPS. The VPS has only the public recipient and a bucket key that can only write.
If somebody steals the VPS, they cannot read or delete old backups.

### Bucket (once, in the Backblaze B2 web UI)

1. Make a private bucket, for example `ea-backups`.
2. Add a lifecycle rule to the bucket that removes old files, for example after 90 days. The script never deletes remote files.
3. Make an application key for this bucket only, with write access only (no read, no delete). Keep the key ID and the key.

### Encryption key (once, on the Mac)

1. `age-keygen -o ~/ea-backup-key.txt`. Keep this file off the VPS: put a copy in a password manager.
2. `age-keygen -y ~/ea-backup-key.txt` prints the public recipient `age1…`. Only this value goes to the VPS.

### VPS setup (once)

1. Install `age` and `rclone`.
2. `rclone config`: make a remote of type `b2` (for example `b2`) with the write-only key ID and key.
   The config is in `~/.config/rclone/rclone.conf`. Run `chmod 600 ~/.config/rclone/rclone.conf`. Never put it in git.
3. `cp deploy/backup.env.example deploy/backup.env && chmod 600 deploy/backup.env`, then set:
   - `BACKUP_DIR`: an absolute local folder, for example `/home/<user>/ea-backups`.
   - `AGE_RECIPIENT`: the public recipient `age1…`.
   - `BACKUP_REMOTE`: `<rclone remote>:<bucket>/<path>`, for example `b2:ea-backups/pilot`.
   - `KEEP_DAYS`: days to keep local files (default 7).
   - `COMPOSE`: default `docker compose`.
   `deploy/backup.env` is in `.gitignore`.
4. Run one backup by hand: `deploy/backup.sh`. The last line is `backup ok <name> <bytes>`.
   If `rclone copyto` fails because the write-only key cannot list or read the bucket, add `--no-check-dest` (and `--s3-no-check-bucket` for an `s3` remote) to the `rclone copyto` line in `deploy/backup.sh`.
5. Run `mkdir -p ~/ea-logs`, then add these crontab lines (`crontab -e`). Cron has a small `PATH`, so the first line sets it for `age` and `rclone`:
   `PATH=/usr/local/bin:/usr/bin:/bin`
   `30 3 * * * cd <repo> && deploy/backup.sh >> ~/ea-logs/backup.log 2>&1`

On any failure, `backup.sh` exits with a non-zero code and leaves no `.dump.age` file.
Check `~/ea-logs/backup.log` for one `backup ok` line each night.

### Restore test (on the Mac, once a month)

1. Get one backup file. Download it in the B2 web UI, or use `rclone` with a read key that lives on the Mac only.
2. Run `deploy/restore-test.sh <file>.dump.age ~/ea-backup-key.txt`.
   The script starts a throwaway `postgres:17` container `ea-restore-test` (no network, no port), restores the dump and prints the row counts of `organizations`, `users`, `mailboxes` and `emails`. It removes the container at the end, also on an error.
3. Compare the counts with the VPS at backup time:
   `$C exec db psql -U postgres -d email_assistant -c "select count(*) from emails"`
4. Write the date and the counts in the task log.
