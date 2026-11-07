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

## Login error (`auth_error`)

An `auth_error` notice means the mail server refused the stored password. The sync for that mailbox stops until you store a new password.

1. Check the password in the webmail. For Interia, check the "mail program" switch (see `notes/2026-11-03-interia-imap-capabilities.md`).
2. Store the new password. The CLI tests the IMAP and SMTP login first and saves nothing if the login fails:
   `read -rsp 'New password: ' P && printf '%s' "$P" | $C run --rm -T server bun run mailbox:password --org-id <uuid> --mailbox-id <uuid>; unset P`
   Add `--secret-kind app_password` if the password is an app password.
3. The mailbox is `active` again. The next sync comes within 5 minutes.

A `paused` mailbox stays paused. Use `/resume` in Telegram.

## Telegram

The server uses long polling (no inbound port). The VPS uses the pilot bot `@Email_assistant_vps_bot`. The dev bot `@Email_assistant_local_bot` stays on the Mac: one bot token allows one poller.

1. Put the pilot bot token in `TELEGRAM_BOT_TOKEN` in the VPS `.env`. Only the user edits this file. Never print the token, never paste it in a chat or a log. An empty value switches Telegram off (the log says `telegram is off`).
2. Check the token: `$C run --rm server bun run telegram:check`. The output is `bot @Email_assistant_vps_bot (id …)`.
3. Restart the server so that it reads the new `.env`: `$C up -d server`. The log shows `telegram: polling as @Email_assistant_vps_bot`.
4. Make a link for a member: `$C run --rm server bun run telegram:link --org-id <uuid> [--user-id <uuid>]`.
   The output is a `https://t.me/<bot>?start=<token>` link. It is a one-time secret that is valid for 15 minutes. Open it on the phone of the member. Do not share it. A used or expired link needs a new `telegram:link` run.
5. Set the digest times if needed: `$C run --rm server bun run digest:times --org-id <uuid> --times 08:00,16:00` (`--times none` switches the digests off). New members get `08:00,16:00` by default.
6. Remove a link: `$C run --rm server bun run telegram:unlink --org-id <uuid> --user-id <uuid>`.

A `409` in the log (`another process polls this bot token`) means that a second process uses the same token, for example the Mac with the pilot token. Stop the other process. The server tries again after 1, 2, 4 … at most 30 minutes. A `401` means that the token is wrong or revoked: fix `.env`, then run `$C up -d server`.

For a mailbox in `auth_error` the owner gets a Telegram notice. Fix it as in the section "Login error (`auth_error`)". Alert texts and fixes: `docs/known-alerts.md`.

## Assist mode

Change the mode, the `auto` flags and the switches of a mailbox with `mailbox:settings`. Every change is locked and audited. The command prints the settings table with `before -> after` for the changed field.

```sh
$C run --rm server bun run mailbox:settings show --org-id <uuid> --mailbox-id <uuid>
$C run --rm server bun run mailbox:settings mode --org-id <uuid> --mailbox-id <uuid> --mode assist
$C run --rm server bun run mailbox:settings auto --org-id <uuid> --mailbox-id <uuid> --category info --value on
```

- `mode --mode assist` sets the switches `move`, `mark_read` and `flag` on. Add `--keep-switches` to keep the old values.
- `auto --value on` needs a go/no-go `go` for the category on real labeled mail (bar 0.98, at least 30 kept). If the gate says no-go, the command exits with code 2. `--force` sets `auto` on anyway and records `forced` in the audit log.
- `switch --name <name> --value on|off` changes one switch. `create_draft` has no effect yet (S4).
- A change that closes a gate expires the `ready` actions it closes. The command prints `expired <n> ready actions`.
- Before you set `ACTIONS_SCOPE=all`, run `mailbox:settings expire-ready`. Real mail of the shadow-scope days then does not move when the scope opens. If `ready mailbox actions left` is above 0, a committer run holds a row: run the command again after 15 seconds.

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

1. Install `age` and `rclone`. The B2 backend needs a recent rclone: Ubuntu 22.04 apt has 1.53, which fails. Put rclone 1.75 or later in `~/bin/rclone`.
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
   `backup.sh` calls `rclone copyto --no-check-dest`, because the write-only key cannot read the target (HTTP 401). For an `s3` remote, also add `--s3-no-check-bucket`.
   If you put rclone in `~/bin`, run it as `PATH=$HOME/bin:$PATH deploy/backup.sh`.
5. Run `mkdir -p ~/ea-logs`, then add these crontab lines (`crontab -e`). Cron has a small `PATH`, so the first line sets it for `age` and `rclone`:
   `PATH=/home/<user>/bin:/usr/local/bin:/usr/bin:/bin`
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
