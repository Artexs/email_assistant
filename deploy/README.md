# Pilot host runbook

Install, update and test the pilot on the home VPS. Docker only.
All commands run in the repo root.
Run the commands in bash (the default VPS shell).
`C` below means:

```sh
C="docker compose -f deploy/compose.yaml --env-file deploy/db.env"
```

`deploy/db.env` holds the three database passwords (ADR 0019). A host that was not split yet has no `deploy/db.env`: use `--env-file .env` in `C` there, until § Env split is done.

The server listens on `127.0.0.1:8080` on the host only (for Tailscale Serve, section Web panel). The `db` service has no host port.

## Requirements

- Docker with the Compose plugin, and git.
- For backups (section Backups): `age` (public recipient only) and `rclone`.

## First install

1. Clone the repo and go into it.
2. Make the two env files and lock them. `deploy/db.env` holds the three database passwords for Compose; the server never gets it (ADR 0019). `.env` holds every other key and no database key: delete the lines that the example copies.
   `cp .env.example .env && chmod 600 .env && cp deploy/db.env.example deploy/db.env && chmod 600 deploy/db.env`
   `sed -i -E '/^(POSTGRES_PASSWORD|MIGRATOR_PASSWORD|APP_PASSWORD|MIGRATOR_DATABASE_URL|DATABASE_URL)=/d' .env`
3. Set `POSTGRES_PASSWORD`, `MIGRATOR_PASSWORD` and `APP_PASSWORD` in `deploy/db.env`: URL-safe, each made with `openssl rand -hex 24`. Then set these keys in `.env`:
   - `CREDENTIALS_KEY`: `openssl rand -base64 32`. Keep a copy in a password manager. If you lose the key, you lose all stored mailbox passwords.
   - `CREDENTIALS_KEY_VERSION=1`
   - A new `CREDENTIALS_KEY` also drops every stored push device (phone notices): the stored secret of a device does not open, so the push sender removes the device on the next send (log `push_secret_unreadable`) and its open rows end `no_device`. Members turn notices on again in Settings. A changed `CREDENTIALS_KEY_VERSION` with the old key stored does not remove a device: the sender logs `push_key_version_mismatch` and waits (`docs/known-alerts.md`).
   - `HEARTBEAT_URL` (see Heartbeat), `TEST_MAILBOX_ADDRESS` (only for the `testmail` and probe tools), `LOG_LEVEL=info`. Leave `LOG_FORMAT` unset: Compose pins `json`.
   - `LLM_PROVIDER` (`openai` by default, or `gemini`, `deepseek`) and the key of that provider (`OPENAI_API_KEY`, `GEMINI_API_KEY` or `DEEPSEEK_API_KEY`). No other key picks a model: every role uses the tiers of the provider (§ LLM provider tiers). With `TRIAGE_LLM_SCOPE` not `off` the start needs the key; with `off` the server starts and every LLM tool stops at once with `<KEY> is missing`. `deepseek` is for dev, tests and evals: config refuses it with `TRIAGE_LLM_SCOPE=all` outside the sim stack.
   - `OPENAI_BASE_URL` (optional): the endpoint of the `openai` provider. Empty = `https://api.openai.com/v1`. EU: `https://eu.api.openai.com/v1` with a key of the EU project. Own server: `OPENAI_ENDPOINT_KIND=own` is needed only for a remote https host; the server never gets `OPENAI_API_KEY` (set `OPENAI_OWN_API_KEY` if it needs a key). A bad value stops the start; the log names the key, not the value. See `docs/capabilities/triage.md` rule 16 and the guide `docs/own-model.md`.
   - `SEND_SCOPE=off` (default) and `SEND_TEST_ADDRESSES` (comma-separated, needed with `SEND_SCOPE=self`). See the section "Approvals and sends".
   - `TRIAGE_LLM_SCOPE`, `ACTIONS_SCOPE` and `SEND_SCOPE` stay `off` until you decide. `all` acts on every active mailbox of the server: read "Customers (S6a)" first.
   - `OPERATOR_CONTACT` and `OPERATOR_TELEGRAM_CHAT_ID` (optional, see "Customers (S6a)").
   - Compose sets `DATABASE_URL`, `MIGRATOR_DATABASE_URL` and `PORT` by itself. Keep none of them in `.env`.
   - Web panel keys: see the section Web panel. Leave `WEB_BASE_URL` empty to keep the web off, and empty the dev value of `WEB_TRUSTED_ORIGINS` that `cp .env.example .env` copied.
4. Start the database: `$C up -d --wait db`
5. Build the image and migrate: `$C build server && $C run --rm -T migrate`
6. Create the organisation:
   `$C run --rm cli bun run org:create --org-name <name> --email <email> --display-name <name> --plan active`
7. Connect the mailbox. The password goes on stdin. Use `-T`, because the command has no terminal on stdin:
   `read -rsp 'IMAP password: ' P && printf '%s' "$P" | $C run --rm -T cli bun run mailbox:connect --org-id <uuid> --address <email>; unset P`
8. Start the server: `$C up -d --build --wait`

## Release

Rule: every VPS deploy is a release (a patch version is fine). Do not deploy a bare commit. The steps before the deploy (CI, changelog, tag) are in `docs/release-checklist.md`. What the scripts do is in `docs/capabilities/operations.md` § Releases.

1. Run the release: `deploy/release.sh v<x.y.z>`. The tag must exist on `origin/master` and CI must be green on it (`docs/release-checklist.md`).
2. The script does these steps and stops at the first failure: refuse a host that is not split (below); refuse a dirty tree or a tag that is not on `origin/master`; run `deploy/backup.sh` (the last stdout line must be `backup ok ...`); check the disk (stop under 3 GB free, after `docker builder prune -f`); write the state file `deploy/release-state/state` with `pending`; keep the running image as `ea-server:<current>`; check out the tag; build the image once with `EA_RELEASE=<tag>`; run the migrations in the one-off service `migrate`; start with `up -d --no-build --wait`; check `/health` and the `EA_RELEASE` of the running server; run `deploy/check-server-env.sh` (the running server must hold no database key); then update the state file (`current`, `previous`) and remove old images.
3. The last output line is `release ok <tag> previous <old>`. Any other end is a failed release. A failed release before the `pending` mark prints "nothing changed, no rollback needed". After the mark it prints "roll back with deploy/rollback.sh".
4. Watch for 30 minutes (`docs/release-checklist.md` step 10). On trouble run `deploy/rollback.sh` (§ Roll back a release).

A host that is not split stops the script first, before any fetch, backup or mark: exit 2 and `release refused: run deploy/env-split.sh first (state <old|mixed>)`. State `old`: `.env` still holds the database passwords. State `mixed`: a key is in both files, or `MIGRATOR_DATABASE_URL` is still in `.env`. Run § Env split, check `ea_env_split_state` prints `split`, then run the release again. If the last line is `release failed at verify` and the text above it is `server env bad: <names>`, the server still holds a database key: take that key out of `.env` (the names are key names, never values), run `deploy/rollback.sh`, and release again. The same message with `server env check failed` means the script could not read the server env: look at `$C ps` and `$C logs server`.

The first release on a host has no `current`: the running image becomes `ea-server:pre-<tag>`, so a rollback has a target from then on.

### Roll back a release

Run `deploy/rollback.sh`. It needs no rebuild. It never runs `db:rollback` and never restores the database. The target is `current` when a release is pending (it broke), else `previous`. With no target it refuses (exit 2). The last output line is `rollback ok <target>`. A split host (§ Env split) needs `deploy/env-split.sh --undo` before a rollback to a release older than the split helper; the script refuses and says so. It also refuses a host that is not split (state `old` or `mixed`, same message as the release). It does not run `deploy/check-server-env.sh`: the release before a contract release is a valid target, and it still holds the migrator URL. A failed step leaves the state file as it was. Every "Roll back" section below keeps the SQL notes of its feature: do them as that section says, around the script.

### Release and rollback notes

- `deploy/rollback.sh` with no `pending` mark swaps `current` and `previous`. A second run goes forward again to the release that you left.
- A plain `$C up -d --build` stamps `EA_RELEASE=dev` into the image and the log lines. Use `release.sh` for every deploy.
- The prune after a release removes every `ea-server:v*` and `ea-server:pre-*` tag except `current` and `previous`. A manual `ea-server:pre-<ticket>` image goes at the next release. The old manual tag rule is gone: the release script keeps the rollback image.
- After a release or a rollback the checkout is detached at the commit of that release. Run `git checkout master` before any `git fetch && git merge --ff-only origin/master`. `release.sh` fetches tags itself.
- A failed release (`pending` set) needs `deploy/rollback.sh` before the next `deploy/release.sh`: `release.sh` refuses while a release is pending.
- Both scripts never run `db:rollback`. A broken migration gets a forward fix in a new patch release, or a restore from a backup (§ Backups).

### Log rotation check

After a release that changed a `logging:` block, check the log rotation. The `server` line must end with `json-file 10m 5`. Every other line must end with `local 10m 5`:

```sh
docker inspect --format '{{.Name}} {{.HostConfig.LogConfig.Type}} {{index .HostConfig.LogConfig.Config "max-size"}} {{index .HostConfig.LogConfig.Config "max-file"}}' $($C ps -q)
```

A line that differs: run `$C up -d --force-recreate --wait <service>` for that service, then check again. A recreated container starts a new log file. The first deploy with a changed `logging:` block recreates `db` at `up -d --wait db`: a short DB restart.

Runbook for the first deploy with the changed log drivers (F103 stage 19):

1. Take a backup first (§ Backups).
2. Run `$C stop server` before the `db` recreate. The server pool has no `pool.on("error")` handler, so a running `server` can restart when `db` restarts.
3. Run `$C up -d --wait db`. The new `logging:` block recreates `db`; the named volume `db-data` stays.
4. Run `$C up -d --wait`.

On the dev machine, the next `up` of the shared dev stack also recreates `db` and `greenmail`.

## Docs site (owner steps)

The docs site (`apps/docs`, ADR 0030) deploys from `.github/workflows/docs-deploy.yml`. The deploy workflow is not part of the VPS release. The demo video on its home page is the only owner step here (owner gate G3). The default is no video: with no pin the deploy downloads nothing and the home page shows no video.

1. **Record.** On the dev machine, from a demo-seed run (`docs/release-checklist.md`, the step "When the demo flow changed"): `flock /tmp/email-assistant-shared-tests.lock bun run demo:record --seed <demo seed file>`. The command writes three files to `tmp/demo/` (git-ignored): `demo.mp4`, `demo.en.vtt` and `demo.pl.vtt`. It prints the sha256 of each. Use the video only when the log has `demo_source demo`. A video with `demo_source e2e: not for upload` is never uploaded.
2. **Watch it.** The video and both caption files are public text and public pictures. The owner reads them first.
3. **Upload** to the release `demo-video`. The tag `demo-video` is not `v*`, so the upload starts no deploy.
   - First time: `gh release create demo-video tmp/demo/demo.mp4 tmp/demo/demo.en.vtt tmp/demo/demo.pl.vtt --title "Demo video" --notes "Demo video of the docs site"`
   - A new take: `gh release upload demo-video tmp/demo/demo.mp4 tmp/demo/demo.en.vtt tmp/demo/demo.pl.vtt --clobber`
   - The release holds exactly these three files. An extra file makes the deploy fail (`demo_video_extra`). A file over 20 MB fails (`demo_video_size`).
4. **Pin.** The coordinator commits the three sha256 values to `DEMO_VIDEO_SHA256` and `DEMO_CAPTION_SHA256` (`en`, `pl`) in `apps/docs/src/demo-video.ts`. An upload with `--clobber` changes nothing on the site until that commit: the next deploy build stops with `demo_video_hash <file>` when a downloaded file does not match its pin.
5. **Deploy.** The next release tag deploys the site, or a manual run of the workflow "Docs deploy" in the GitHub UI (`docs/release-checklist.md` step 7; the publication hold `OWNER_REVIEW_PENDING` still applies). The step "Download the pinned demo video" runs `bun apps/docs/scripts/demo-fetch.ts` before `docs:build`; the log has `demo_video on`.

To remove the video: set `DEMO_VIDEO_SHA256` and both `DEMO_CAPTION_SHA256` values back to `null` in one commit. The next deploy shows no video.

## Env split (an existing host)

Use this once, on a host that has no `deploy/db.env` and still holds the database passwords in `.env` (ADR 0019). A new host starts split (§ First install). The tool moves the three passwords, and `MIGRATOR_DATABASE_URL` if `.env` has it, to `deploy/db.env`. It never prints a value and leaves no copy of `.env`.

1. Back up the database: `deploy/backup.sh`. The last line must be `backup ok ...`. Never back up by copying `.env`.
2. Split: `deploy/env-split.sh`. The last line is `env split ok moved=<3|4>`. A second run prints `env split: already split`.
3. Check the state: `source deploy/compose-lib.sh && ea_env_split_state` prints `split`.
4. Check the Compose config: `C="docker compose -f deploy/compose.yaml --env-file deploy/db.env"`, then `$C config --quiet` prints nothing and exits 0.
5. Change every crontab line that calls Compose (`crontab -l`) to `--env-file deploy/db.env`.
6. From the release that holds the contract on, the server and `cli` get no database key from Compose, and `release.sh` runs `deploy/check-server-env.sh` in its verify step. It prints `server env ok keys=<n>`. A line `server env bad: <names>` names the keys that the server still holds. Run it by hand at any time. `deploy/release.sh`, `deploy/rollback.sh` and `deploy/restore.sh --target new-host` refuse a host that is not split (exit 2, nothing changed). Compose cannot remove a key that `.env` holds, so these guards and the check cover a key that comes back by hand. The restore drill and the sim stack keep their own env files.

Roll back to a release that is older than the split helper (it has no `deploy/compose-lib.sh` and reads only `.env`): run `deploy/env-split.sh --undo` first. It appends the lines of `deploy/db.env` to `.env` and removes `deploy/db.env`. `deploy/rollback.sh` refuses with exit 2 and says so, until you do.

## Logs

The server writes one JSON object per line (ADR 0024). Read them as text, without the store, from the repo root:

```sh
bash deploy/logs.sh [--since 1h] [--run <run_id>] [--request <request_id>] [--event <code>] [--level warn] [--follow]
```

The script runs the line below and keeps the lines that match your filters. The line alone needs only `jq`:

```sh
$C logs --no-log-prefix --since 1h server | jq -rR 'fromjson? | [.time, .level, "[\(.module)]", .event, (del(.time, .level, .module, .event, .msg) | to_entries | map("\(.key)=\(.value)") | join(" "))] | join(" ")'
```

Docker keeps at most 5 files of 10 MB for each container (`logging:` in `deploy/compose.yaml`). Older lines are gone, and a recreated container starts empty. At about 0.5 MB a day, the files hold months. Only `server` writes `json-file`, the files that the log store reads. Every other service (Postgres, `cli`, the store itself) writes `local`, so its lines never reach the store. A new service in any Compose file needs the `local` block. `bash deploy/check-logging.sh` checks the drivers and fails on a one-off command that runs in `server`, and CI runs it. It also checks the restore drill file set (`compose.yaml` with `compose.drill.yaml`): there every service writes `local` (a drill line never reaches the store), and no service except `db`, `server` and `cli` runs without a profile.

Follow one job run or one request: use `--run` or `--request` of `deploy/logs.sh`; the browser shows the request id in the `x-request-id` response header. One-off commands run in the `cli` service (`$C run --rm cli bun run <script> …`): readable text, never in the log store. `$C exec server …` prints to your terminal only.

A good start shows `server_listening port=8080`. Module lines that E8a has not converted yet show their old text. A sync run writes `sync_done` with `mailbox_id` and the counts; a failure is `sync_failed` or `sync_soft_error` with `error` and `error_code` (`mail/jobs.ts`).

### Log store (search)

The log store (VictoriaLogs, with the agent vlagent) is in the Compose profile `ops`. Without the profile nothing changes. Start it and stop it:

```sh
$C --profile ops up -d
$C --profile ops stop victorialogs vlagent
```

The UI is `https://<machine>.<tailnet>.ts.net:9443/select/vmui/`. Tailscale Serve proxies to `127.0.0.1:9428` (set up on the VPS in F103 stage 19; the store has no basic auth). Each server line is stored as text in `_msg`, so every query unpacks it first. Three queries to paste in the UI:

```
"<run_id>" | unpack_json from _msg | sort by (_time)
```

```
_time:1h | unpack_json from _msg | filter level:="error" | sort by (_time)
```

```
* | unpack_json from _msg | stats by (event) count() as lines | sort by (lines desc)
```

Limits:

- It keeps 30 days and at most 1 GiB; it uses at most 256 MB (store) and 64 MB (agent) of memory.
- It holds only `server` lines: the agent reads only `json-file` logs, and only `server` writes them. Postgres, `cli`, `exec` and the store itself never reach it.
- The agent also reads the `json-file` logs of any other Compose project on the host. Check with `docker ps -a` before the first start.
- The agent runs as root, because Docker writes its log files with mode `0640`.
- The agent buffers at most 500 MB on disk (`-remoteWrite.maxDiskUsagePerURL`, volume `vlagent-data`) while the store is down.
- The read-only mount of `/var/lib/docker/containers` also lets the `vlagent` container read the `config.v2.json` of each container (its environment and secrets). `vlagent` ships only the `*-json.log` files. For this reason the agent does not use the Docker socket, and it runs only under the profile `ops`.
- No lines? See `docs/known-alerts.md` § "Log store: vlagent reads no lines".

## Login error (`auth_error`)

An `auth_error` notice means the mail server refused the stored password. The sync for that mailbox stops until you store a new password.

1. Check the password in the webmail. For Interia, check the "mail program" switch (see `notes/2026-11-03-interia-imap-capabilities.md`).
2. Store the new password. The CLI tests the IMAP and SMTP login first and saves nothing if the login fails:
   `read -rsp 'New password: ' P && printf '%s' "$P" | $C run --rm -T cli bun run mailbox:password --org-id <uuid> --mailbox-id <uuid>; unset P`
   Add `--secret-kind app_password` if the password is an app password.
3. The mailbox is `active` again. The next sync comes within `MAIL_SYNC_EVERY_MIN` minutes (default 2).

A `paused` mailbox stays paused. Use `/resume` in Telegram.

## Mail server not allowed (`host_blocked`)

A `host_blocked` notice means the server name of the mailbox points to a private or local address. The system does not connect to such an address. The sync, triage and send for that mailbox stop. No mail is lost: it stays on the mail server.

1. Run the check. It prints the status and which side (IMAP or SMTP) the guard refuses, and it makes no connection:
   `$C run --rm -T cli bun run mailbox:check --org-id <uuid> --mailbox-id <uuid>`
2. Check the DNS answer of the provider host from the server container. A real provider host resolves to a public address. A refusal means a wrong host or a DNS change.
3. Run nothing else. At the start of each sync run (every `MAIL_SYNC_EVERY_MIN` minutes) the system checks both hosts again, with no connection. When both pass, the mailbox becomes `active` by itself and the same run syncs it. A password change (see "Login error (`auth_error`)") also ends the state.

Do not set `MAIL_ALLOW_LOCAL_HOSTS` on the VPS.

### Roll back

Roll back the code, not the migration. Do this only for a code rollback to a release older than F085 stage 02: that release cannot read the status `host_blocked` and stops the notice sender. Stop the server container first, so no run of the new code sets the status again:

```sh
$C stop server
$C exec -T db psql -U postgres -d email_assistant <<'SQL'
UPDATE outbox SET status = 'failed', error_code = 'outdated', locked_at = NULL WHERE kind = 'host_blocked' AND status IN ('pending', 'sending');
UPDATE mailboxes SET status = 'active', status_changed_at = now() WHERE status = 'host_blocked';
SQL
```

Then run `deploy/rollback.sh` (§ Roll back a release): it starts the old release. The old code logs the refusal at each run again. Do not run `db:rollback` on a live database.

## Telegram

The server uses long polling (no inbound port). The VPS uses the pilot bot `@Email_assistant_vps_bot`. The dev bot `@Email_assistant_local_bot` stays on the Mac: one bot token allows one poller.

1. Put the pilot bot token in `TELEGRAM_BOT_TOKEN` in the VPS `.env`. Only the user edits this file. Never print the token, never paste it in a chat or a log. An empty value switches Telegram off (the log says `telegram is off`).
   Do not set `TELEGRAM_API_ROOT` on the VPS.
2. Check the token: `$C run --rm cli bun run telegram:check`. The output is `bot @Email_assistant_vps_bot (id …)`. Exit 3 and `unreachable:` mean that the Telegram Bot API did not answer; exit 1 means that the token is missing or refused.
3. Restart the server so that it reads the new `.env`: `$C up -d server`. The log shows the event `telegram_polling_started` (field `bot_id`, the numeric id of the bot).
4. Make a link for a member: `$C run --rm cli bun run telegram:link --org-id <uuid> [--user-id <uuid>]`.
   The output is a `https://t.me/<bot>?start=<token>` link. It is a one-time secret that is valid for 15 minutes. Open it on the phone of the member. Do not share it. A used or expired link needs a new `telegram:link` run.
5. Set the digest times if needed: `$C run --rm cli bun run digest:times --org-id <uuid> --times 08:00,16:00` (`--times none` switches the digests off). New members get `08:00,16:00` by default.
6. Remove a link: `$C run --rm cli bun run telegram:unlink --org-id <uuid> --user-id <uuid>`.

A `409` in the log (the event `telegram_polling_conflict`, field `wait_ms`) means that a second process uses the same token, for example the Mac with the pilot token. Stop the other process. The server tries again after 1, 2, 4 … at most 30 minutes. A `401` means that the token is wrong or revoked: fix `.env`, then run `$C up -d server`.

For a mailbox in `auth_error` the owner gets a Telegram notice. Fix it as in the section "Login error (`auth_error`)". Alert texts and fixes: `docs/known-alerts.md`.

## Phone notices and Telegram detail (F118)

Two flags control this feature. Both are off by default, for every organization. `web_push` turns on the push channel, the phone notices card and the route selects. `telegram_minimal` turns on the Telegram level "Counts and links only" (`minimal`) and the lock of the owner. Rules: [`docs/capabilities/digest-and-notices.md`](../docs/capabilities/digest-and-notices.md) rules 3c to 3f. Decisions: [ADR 0032](../docs/decisions/0032-phone-channel-push-and-telegram-detail.md).

### Make the keys (once)

1. Make the VAPID pair on the VPS or on a machine that you trust: `bun run push:keys`. The command prints three bare lines: `VAPID_PUBLIC_KEY=...`, `VAPID_PRIVATE_KEY=...` and `VAPID_SUBJECT=mailto:<your address>`. Keep a copy in your password manager. No agent reads or prints these keys.
2. Paste the three lines as they are into the VPS `.env` (no prefix, no quotes). Replace `<your address>` with your real address: the push services see it in the token. Keep the old value of each key in the password manager; never leave a copy of `.env` on the host.
3. Check that the lines exist, without printing them: `grep -c '^VAPID_' .env` prints `3`. All three keys or none: a set of one or two stops the server at start, and the log names the key, not its value. An empty set switches Web Push off.
4. Start the new code: `deploy/release.sh v<x.y.z>` (it runs the migrations first). The server needs outbound HTTPS on port 443 to the push services of the browsers of your members (for Chrome on Android: `fcm.googleapis.com`).

A new pair ends every subscribed device (a browser keeps the old public key). A new `CREDENTIALS_KEY` drops every stored device too (§ First install). Members turn notices on again in Settings.

### The phone

The phone needs Tailscale to open the panel (§ Web panel). The push arrives without it: the push service of the browser carries it. Open the panel on the phone, install it (Chrome menu → "Install app"), then Settings → "Phone notices" → "Turn on notices on this device". iOS shows a push only for a panel on the Home Screen (iOS 16.4 or later); this is not tested. Notices stop on a device when its session ends (a sign-out, a lock, a password change; a company sign-in session ends after 12 hours); the next panel load re-binds it.

### Turn it on (pilot organization first)

1. The papers name the push services in the sub-processor table (`web-push`) and the new `TERMS_VERSION` makes every member accept the terms again at the next sign-in. Read the changed texts first (the legal pages are drafts, not legal advice).
2. `$C run --rm cli bun run org:flag --org-id <org id> --flag web_push --on`, and the same with `--flag telegram_minimal --on`.
3. Check: `$C run --rm cli bun run org:flag --org-id <org id>` shows both flags `on`.
4. A member who had a Telegram chat before the migration keeps the level `full`; a member who links later starts at `minimal`. The owner can lock `minimal` for everyone in Settings.

### Roll back

Steps 1 to 3 stop the feature with no harm to mail, Telegram or other organizations. A rollback of the code (steps 4 and 5) needs the care that they describe: read them before you run `deploy/rollback.sh`.

1. Flags off (no deploy needed): `$C run --rm cli bun run org:flag --org-id <org id> --flag web_push --off` and the same with `telegram_minimal`. With `web_push` off the push sender waits, the cards and routes are absent, and every new notice goes to Telegram. A push row that already waits stays `pending` and ends `failed` / `expired` after 24 hours. A member whose route for that notice was "Phone" only gets no Telegram row for it (there is no fallback while the flag is off). With `telegram_minimal` off every member reads `full` again (the messages of before the setting).
2. Remove a phone: Settings → "Phone notices" → "Remove" (before the flag goes off), or sign out on the phone. A removed device ends its open push rows `no_device`; a member with a chat gets the Telegram row of the event.
3. Remove the keys: delete the three `VAPID_*` lines, then `$C up -d --wait server`.
4. Roll back the code only if the server itself misbehaves: `deploy/rollback.sh` (§ Roll back a release). It never rolls back the database, and the new columns and the table `push_subscriptions` are harmless to a build that has the push sender (`v0.3.0` and later). For a rollback to such a build, do these two things first:
   - Turn the flag `telegram_minimal` off (step 1). The code before the level at send time ignores `memberships.telegram_detail`, so a member who chose `minimal` would get `full` text.
   - Let the pending outbox rows drain before a rollback to code older than the minimal render. The digest key `minimal` and the `approval_edit` key `sendId` are refused by the strict views of the older code, so those rows end `failed` / `bad_view` (they are digest text and card edits, not approvals).
5. **A rollback to a build older than the push sender (`v0.2.x`) needs more, and it must happen BEFORE `deploy/rollback.sh`.** That build claims every due outbox row with no filter on the channel (`claimDueOutbox` in `v0.2.1:apps/server/src/modules/channels/repo.ts`), and only then reads the channel and the detail of each row. A push row (`channel = 'push'`) or a row with `detail = 'minimal'` makes that read fail, so the claim fails as a whole and the Telegram rows of every organization that were claimed in the same batch stay `sending`. After 5 minutes the same happens again, so approval requests and notices stop for everyone until the rows are closed. Run, in this order:
   1. Turn `web_push` off (step 1), so that no new push row appears.
   2. Close the push rows: `$C exec -T db psql -U postgres -d email_assistant -c "update outbox set status = 'failed', error_code = 'outdated', locked_at = null where channel = 'push' and status in ('pending', 'sending')"`.
   3. Make the open rows readable for the old build: `$C exec -T db psql -U postgres -d email_assistant -c "update outbox set detail = 'full' where detail = 'minimal' and status in ('pending', 'sending')"` (the old build sends such a row at the level `full`, as step 4 says).
   4. Check, after the two updates: `$C exec -T db psql -U postgres -d email_assistant -c "select count(*) from outbox where status in ('pending', 'sending') and (channel = 'push' or detail = 'minimal')"` prints `0`. Then, and only then, run `deploy/rollback.sh`.

## Web panel

### What it is

The web panel is at `https://<machine>.<tailnet>.ts.net`. Tailscale Serve is open to every device that the tailnet policy (ACL) allows. The default policy of a one-user tailnet allows the owner's own devices only. Run `tailscale status` and look for foreign users before you rely on this. Also check in the admin console that `email-assistant` is not shared with another tailnet. Tailscale Serve on the host adds HTTPS and proxies to `127.0.0.1:8080`.
See [ADR 0016](../docs/decisions/0016-web-panel-static-build-and-better-auth.md) and [ADR 0017](../docs/decisions/0017-web-access-tailscale-serve.md).
The web is off while `WEB_BASE_URL` is empty.
Deploy facts and results of the first VPS install: [`notes/2026-11-12-web-panel-deploy.md`](../notes/2026-11-12-web-panel-deploy.md).

### Tailscale (once)

1. Admin console, page DNS: turn MagicDNS on.
2. Admin console, page DNS: turn HTTPS on. Machine names and the tailnet name go into a public certificate ledger. Accept this only if you agree.
3. On the VPS, install Tailscale (you, sudo): `curl -fsSL https://tailscale.com/install.sh | sh`
4. On the VPS, join the tailnet (you, sudo): `sudo tailscale up --accept-dns=false --hostname=email-assistant`
   Open the login URL that the command prints.
   Check the machine name: `tailscale status` must show `email-assistant`. If it shows another name (the first run registered it as `ubuntu`), run `sudo tailscale set --hostname=email-assistant`. A wrong name gives a wrong panel URL.
   Check the host resolver: `resolvectl status | grep -c 100.100.100.100` must print `0`. If it prints more, run `sudo tailscale set --accept-dns=false`.
5. Admin console, page Machines: for `email-assistant`, choose Disable Key Expiry. Without this, the panel stops after some months.
6. On each client device, install Tailscale and sign in with the same account. Phone: the App Store or Play Store app. Arch Linux PC: `sudo pacman -S tailscale`, then `sudo systemctl enable --now tailscaled`, then `sudo tailscale up`. Keep MagicDNS on, because the tailnet host names resolve only through it.

Never run `tailscale up --force-reauth` over the tailnet. It cuts the connection that you use.

### Turn it on

1. Check the gateway of the Compose network. `deploy/compose.yaml` pins it to `172.30.0.1`. After the first `up` with the pinned file, this command must print `172.30.0.1`:
   `docker network inspect email-assistant_default --format '{{(index .IPAM.Config 0).Gateway}}'`
2. Keep the old value of each key in the password manager; never leave a copy of `.env` on the host. Set these keys in `.env`:
   - `WEB_BASE_URL`: `https://<machine>.<tailnet>.ts.net` (no path, no trailing slash).
   - `WEB_AUTH_SECRET`: make it with `openssl rand -base64 32`. Never print it.
   - `WEB_TRUSTED_PROXIES`: `172.30.0.1` (the gateway from step 1).
   - Leave `WEB_TRUSTED_ORIGINS`, `MAIL_ALLOW_LOCAL_HOSTS`, `WEB_MAIL_ALLOW_LOCAL`, `WEB_DIST`, the `AUTH_SMTP_*` keys and `AUTH_MAIL_FROM` empty. Leave `AUTH_PWNED_CHECK` empty (on).
3. Do the section Release. The migrations of S5 run there.
4. Check the log for the start events `web_on` and `web_operators`: `$C logs server | grep -E 'web_|auth_mail'`
   The output must show no `web_off`, `web_cookies_not_secure` or `web_dist_missing` line. It must also show `auth_mail_off` (the CLI prints invite and reset links).
   Two lines must not show: `pwned_check_off` and `mail_local_hosts_allowed`. Search for them: `$C logs server | grep -E 'pwned_check_off|mail_local_hosts_allowed'`
5. Start Tailscale Serve (you, sudo): `sudo tailscale serve --bg 8080`
6. Check Serve: `tailscale serve status`

The gateway does not change after `docker compose down` or a Docker upgrade, because the subnet is pinned.

#### Move a running stack to the pinned subnet (once)

A stack that started before the pin has another subnet (`172.18.0.0/16` on the VPS). The change recreates the network and the `db` container. It stops the stack for a short time.

1. Do it outside a pilot week and ask the owner first.
2. Check that `172.30.0.0/24` is free on the host: `docker network ls`, `ip -4 route`. Choose another range in `deploy/compose.yaml` if it clashes.
3. Make a backup of the database: `deploy/backup.sh` (section Backups). Keep the old value of `WEB_TRUSTED_PROXIES` in the password manager; never leave a copy of `.env` on the host.
4. Pull the new compose file. Set `WEB_TRUSTED_PROXIES=172.30.0.1` in `.env`.
5. `$C down && $C up -d --wait`
6. Check: `docker network inspect email-assistant_default --format '{{(index .IPAM.Config 0).Gateway}}'` prints `172.30.0.1`. After the first sign-in, `auth_sessions.ip_address` is a tailnet address.
7. Rollback: restore the old compose file and set `WEB_TRUSTED_PROXIES` to the old gateway (the old value from the password manager). Run `$C down && $C up -d --wait`.

### Invite a customer (S6b)

1. Make the organization, the owner and the link:
   `$C exec server bun run org:invite --org-name <name> --email <email> --display-name <name> [--lang pl|en] [--trial-days N]`
2. Without the auth-mail sender, the command prints the setup link (it works once and for 24 hours). The link is a secret. Do not paste it into a chat with an agent or into a log. Send it to the customer yourself.
3. An address that already has an account stops the command with `user with this email already exists`. Nothing is created.
4. The customer opens the link on a device in the tailnet, accepts the terms and sets a password.

### Give a member a password

1. Make the link: `$C exec server bun run web:invite --org-id <uuid> [--user-id <uuid>] [--print]`
2. Open the link on a device in the tailnet. The link works once and for 24 hours.
3. Set a password of 12 to 128 characters and accept the terms.

With the auth-mail sender on, the link goes by mail. `--print` prints it instead.

The login e-mail is the address that you gave to `org:create` (`users.email`), not any other address of the person. A wrong e-mail shows only "Wrong e-mail or password." The log says `better-auth: User not found`.

The same command makes a reset link later. The link is a secret. Do not paste it into a chat with an agent or into a log.

### Auth mail sender (off on the home VPS)

The sender mails invite, reset and lock messages. It turns on when `AUTH_SMTP_HOST`, `AUTH_SMTP_USER`, `AUTH_SMTP_PASSWORD` and `AUTH_MAIL_FROM` are set (all four or none). `AUTH_SMTP_PORT` (465) and `AUTH_SMTP_SECURITY` (`tls`) have defaults. With the keys empty, `/forgot` shows "Reset by e-mail is off" and the CLI prints the links.

A real sender needs these first:

- A domain, with SPF, DKIM and DMARC records for it.
- Click tracking and open tracking off at the provider. A tracked link stores the setup link at a third party.
- Port 465 (`AUTH_SMTP_SECURITY=tls`) or 587 (`starttls`).

No provider is chosen (P18). A failed auth mail writes a `warn` log line and the operator notice `auth_mail_failed` (`docs/known-alerts.md`).

### Sign-in lock

A user who types a wrong password 10 times in 15 minutes waits 15 minutes. The answer is the same as for a wrong password. To end the lock sooner, make a new link with `web:invite`: a password reset ends the lock. Each lock writes the audit row `web.login_locked`.

### Leaked-password check

Every password set or change asks `api.pwnedpasswords.com` (5 hex characters of the SHA-1 leave the server, not the password). The server needs outbound HTTPS to that host. When it is down, password sets fail with "try again later" and nothing changes. `AUTH_PWNED_CHECK=off` is for tests only.

### Two-factor sign-in (F105)

A member turns on two-factor sign-in in Settings → Account: password, QR code or key in an authenticator app, first code, then 10 backup codes (shown once). Later sign-ins ask for the code after the password.

The operator needs it too. The console and `/api/operator/*` refuse an operator without it. Turn it on before the next console use.

Break-glass owner (one owner of an organization; the one exception to "SSO required", section Company sign-in). List the owners and their state, set the owner, or clear it:

```sh
$C run --rm cli bun run org:break-glass --org-id <uuid>
$C run --rm cli bun run org:break-glass --org-id <uuid> --user-id <uuid> --confirm "<organization name>"
$C run --rm cli bun run org:break-glass --org-id <uuid> --clear --confirm "<organization name>"
```

The set and the clear need `--confirm` with the organization name (case and spaces around it do not matter). Without it the command exits 2; with a wrong name it exits 1 and changes nothing. The list needs none. The user must be an owner and must have two-factor sign-in on. The break-glass owner cannot turn it off.

A member who lost the phone and the backup codes:

1. Check who asks, outside the system: a call to a known number, or in person. Do not trust a mail or a chat message.
2. Run `$C run --rm cli bun run web:two-factor-reset --org-id <uuid> --user-id <uuid> --confirm "<organization name>"`. A missing `--confirm` exits 2; a wrong name exits 1 and changes nothing.
3. The reset ends every session and every trusted device of the user and clears the break-glass mark. The user signs in with the password and can turn two-factor sign-in on again.

Never change `WEB_AUTH_SECRET` without a plan to reset every member's second factor: the secrets and codes are encrypted with it, and a new value makes them unreadable. Each member then needs the reset above.

Each change is an audit row (`web.two_factor_enabled`, `web.two_factor_disabled`, `web.two_factor_reset`, `web.backup_codes_generated`, `web.backup_code_used`, `web.two_factor_locked`, `org.break_glass_set`, `org.break_glass_cleared`) and shows in the security log of an organization.

### Company sign-in (F119)

Members of an organization sign in with the company account of their own identity provider (IdP): Microsoft Entra ID, Google Workspace or another OIDC provider. Only the operator sets it up. No account is made at sign-in: a person must be a member first. The rules are in `docs/capabilities/web-panel.md` rule 4 and `docs/capabilities/tenancy-and-plans.md` rule 7. The decision is ADR 0026.

Before you start:

- Every member must reach the panel on the tailnet (ADR 0017). The IdP sends the browser back to the panel address, so a device outside the tailnet cannot finish a sign-in.
- Keep `WEB_TRUSTED_ORIGINS` empty (section Web panel). It must list no IdP and no loopback origin: the sign-in refuses a loopback address only while the list does not name it.
- Below, `<org-id>` is the organization id, `<company-domain>` is the mail domain of the members (the part after `@` in their addresses), and `<tenant-id>` is the Entra directory id. Never write a real tenant id, a secret or a link with a token into the repo or into a ticket.

1. Turn on the flag (off by default; removal date 2027-06-01):
   `$C run --rm cli bun run org:flag --org-id <org-id> --flag sso_sign_in --on`
2. The administrator of the organization registers an app in the IdP.
   - The redirect URI is the panel address plus the callback path: `<WEB_BASE_URL>/api/auth/sso/callback/<org-id>`. `org:sso` prints it as the `redirect` line after step 3.
   - Scopes: `openid email profile`. Copy the client id. Make one client secret. Keep the secret out of chat, tickets and shell history.
   - Entra: App registrations → New registration, one directory only (single tenant), platform Web. The issuer is tenant-specific: `https://login.microsoftonline.com/<tenant-id>/v2.0`. The issuer with `common` fails (`issuer_mismatch`). A member needs an e-mail address on the account (the `mail` attribute): Entra sends the `email` claim only for an account that has one. The Microsoft documentation names no `email_verified` claim for Entra; the check refuses only an explicit `false`. These Entra facts come from the Microsoft documentation of 2026-11-14. No real tenant has confirmed them yet (F119 stage 16).
   - Google Workspace: an OAuth client of type Web application. The issuer is `https://accounts.google.com`. The sign-in needs the claim `hd` to equal the domain, so a personal Google account never matches. Google runs on the same code and has no real check yet.
3. Store the provider. Paste the secret at the prompt; it never goes on the command line:

   ```sh
   read -rs S; printf '%s\n' "$S" | $C run --rm -T cli bun run --silent org:sso --org-id <org-id> --set --issuer <issuer-url> --domain <company-domain> --client-id <client-id> --client-secret-stdin; unset S
   ```

   - `read -rs` does not echo the secret. `bun run --silent` keeps the command line off stderr: `bun run` otherwise prints the whole command, so a wrong call such as `--client-secret <value>` would show the secret once more, and the shell would keep it in its history. Without the pipe, on a terminal, the input echoes and ends only with Ctrl-D: use the pipe.
   - The command fetches the discovery document of the issuer. It refuses an issuer that is not `https:`, an IP address, a host that resolves to a private address, and a domain that another organization holds. It stores the secret in clear in the database (`sso_providers.oidc_config`): the backups hold it, the export does not. It prints `set new` and the `redirect` line.
   - To rotate the secret, make a new one in the IdP and run the same command. It prints `set secret` and keeps the proof and the links. A new issuer, domain or client id prints `set boundary`: it drops the domain proof, "SSO required", every link and every SSO session. Warn the members first.

4. Prove the domain. `$C run --rm cli bun run org:sso --org-id <org-id>` prints the line `txt _ea-sso.<company-domain> ea-sso=<token>`. Add it as a DNS TXT record of that domain. The token is not a secret. When the record is live, run `$C run --rm cli bun run org:sso --org-id <org-id> --verify`. It prints `verified`, or `error not_found_in_dns` (wait for DNS and run it again). For a test organization with no DNS control (for example an `onmicrosoft.com` domain), the operator vouches for the domain instead: `$C run --rm cli bun run org:sso --org-id <org-id> --attest --confirm <company-domain>`. Each of the two writes an audit row (`sso.domain_verified`, `sso.domain_attested`). Attest only a domain that you know the organization owns.
5. Add the members that have no account yet: `$C run --rm cli bun run org:member --org-id <org-id> --add --email <address> --display-name <name> [--role assistant|owner] [--lang pl|en]`. The address must be the address that the IdP sends. A member who already has an account needs no add: the first company sign-in links the IdP identity by e-mail. A member made by `org:member --add` has no password. When the flag is on and the domain is proved, the login page offers company sign-in: `curl -sS https://<machine>.<tailnet>.ts.net/api/sign-in-options` prints `{"sso":true}`. The member opens the panel, chooses "Sign in with your company account" and types the work e-mail. `org:sso --org-id <org-id>` then shows `linked <n>`.
6. Optional: refuse passwords ("SSO required"). First make a break-glass owner with two-factor sign-in on (section Two-factor sign-in: the owner turns it on in Settings → Account, then you run `org:break-glass`). Then run `$C run --rm cli bun run org:sso --org-id <org-id> --require on`. It refuses, with a list of reasons, until all of these hold: a provider, a proved domain, the flag on, a break-glass owner with TOTP, and every other member on the domain. When it goes on, every password session and every pending code step of the other members ends. A password sign-in or reset of such a member then looks like a wrong password. Only the break-glass owner keeps password and TOTP.
7. An IdP outage: `$C run --rm cli bun run org:sso --org-id <org-id> --require off` reopens passwords at once for members who have one. A member made by `org:member --add` has no password: make a setup link with `web:invite --user-id` (section Give a member a password), or wait for the IdP. The break-glass owner always gets in. Turning the flag `sso_sign_in` off does not reopen passwords: it also closes company sign-in, so only the break-glass owner can sign in. `org:flag` prints a warning for that case. A server start with `FEATURES_OFF` that holds the flag logs `sso_flag_killed_with_sso_required`.
8. Offboarding. Disable the person in the IdP: a company session ends within 12 hours at most, and the IdP refuses a new sign-in. To end access at once, run `$C run --rm cli bun run org:member --org-id <org-id> --user-id <user-id> --end-sessions`. Every `org:member` command needs `--org-id`. The command ends every session of the user in every organization (sessions belong to the user); `--only-sso` ends only the company sessions. `--unlink-sso` removes the IdP link and every company session of the user. The next company sign-in links again by e-mail, so disable the person in the IdP first. No CLI removes a member. If the organization does not require SSO, a member who has a password can still sign in with it after the IdP account is disabled.
9. Remove the provider: `$C run --rm cli bun run org:sso --org-id <org-id> --remove --confirm <company-domain>`. It deletes the links and the company sessions and turns "SSO required" off.
10. A plugin upgrade. Keep `better-auth` and `@better-auth/sso` on one exact version, never below 1.6.27 (an older plugin allowed account takeover through its domain check: GHSA-8c5h-wx78-2cfg). After an upgrade, run these tests before you deploy: `apps/server/test/integration/web-sso-plugin.test.ts`, `web-sso-resolve.test.ts`, `web-sso-session.test.ts`, `web-sso-required.test.ts` and `sso-provider-service.test.ts`. They check that a user cannot register a provider, that `requestSignUp: true` makes no user, that a callback session ends after 12 hours, and that the operator writes take turns with the plugin's lock on the provider row.

Every change is an audit row (`sso.login`, `sso.refused`, `sso.provider_set`, `sso.provider_removed`, `sso.domain_verified`, `sso.domain_attested`, `sso.required_changed`, `sso.unlinked`, `org.member_added`, `web.member_sessions_ended`) and shows in the security log of the organization. The log lines and their causes are in `docs/known-alerts.md`: `sso_refused`, `sso_audit_failed`, `password_sign_in_refused_sso`, `reset_request_refused_sso`, `operator_sso_session_refused`, `sign_in_options_failed` and `sso_flag_killed_with_sso_required`.

### After the first deploy of S6b

Every member sees the terms dialog once at the next sign-in. The legal pages are drafts until S6e.

### Check access

1. From a PC in the tailnet: `curl -sS -D - -o /dev/null "https://<machine>.<tailnet>.ts.net/health"`
   The status is `200` and a `strict-transport-security` header is present.
2. From the LAN, without the tunnel: `curl -m 5 http://<VPS LAN IP>:8080/health`
   The connection is refused.
3. From the phone with Tailscale off (mobile data): the page does not open.
4. On the VPS: `ss -ltn`
   One line shows `127.0.0.1:8080`. No line shows `0.0.0.0:8080`.

### Troubleshooting

| Symptom                                                                     | Cause                                                                    | Fix                                                                                                             |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| The page does not open on a device                                          | Tailscale is off on the device, or MagicDNS is off                       | Turn Tailscale on. Run `tailscale status`. Turn MagicDNS on in the admin console.                               |
| `502` from Serve                                                            | The server is down, or it does not listen on `127.0.0.1:8080`            | Run `$C ps` and `ss -ltn`. Start the server with `$C up -d --wait server`.                                      |
| Certificate error on the first visit                                        | HTTPS is off in the admin console, or the first certificate is not ready | Turn HTTPS on. Wait a short time. Do not retry in a loop: the certificate authority has a rate limit.           |
| `403 bad_origin` on every save                                              | `WEB_BASE_URL` is not the URL in the browser bar                         | Set `WEB_BASE_URL` to the exact URL of the browser bar. Run `$C up -d --wait server`.                           |
| All members share one rate limit, or `auth_sessions.ip_address` is `172.x`  | `WEB_TRUSTED_PROXIES` is not the gateway of the Compose network          | Set it to `172.30.0.1` in `.env`, as the pinned file says. Run `$C up -d --wait server`.                        |
| `web_off` in the log                                                        | `WEB_BASE_URL` is empty                                                  | Set `WEB_BASE_URL` in `.env`. Run `$C up -d --wait server`.                                                     |
| `web_dist_missing` in the log                                               | The image has no web build                                               | Rebuild: `$C up -d --build --wait`.                                                                             |
| The setup link says `This link was used or has expired. Ask for a new one.` | The link was used, or it is older than 24 hours                          | Make a new link (section Give a member a password).                                                             |
| The panel URL is wrong, or the name is `ubuntu`                             | The first `tailscale up` registered the machine under the host name      | Run `sudo tailscale set --hostname=email-assistant`. Set `WEB_BASE_URL` to the new URL.                         |
| Lookups for IMAP, SMTP or Telegram fail after Tailscale starts              | Tailscale changed the host resolver                                      | Run `sudo tailscale set --accept-dns=false`. Check: `resolvectl status \| grep -c 100.100.100.100` prints `0`.  |
| Login shows only "Wrong e-mail or password.", log: `User not found`         | The e-mail is not the address of `org:create` (`users.email`)            | Use the address that you gave to `org:create`.                                                                  |
| The panel stopped after some months                                         | Key expiry was not disabled for the VPS                                  | In the admin console, choose Disable Key Expiry for `email-assistant`. Run `sudo tailscale up` again if needed. |

### Turn it off

1. Stop Serve (you, sudo): `sudo tailscale serve reset`
   Alternative: `sudo tailscale serve --https=443 off`
2. Optional: empty `WEB_BASE_URL` in `.env`, then run `$C up -d --wait server`.

The auth tables stay.

### Roll back

Roll back the code, not the migrations. Do not run `db:rollback`: it deletes the auth tables. The old code ignores them.

After the migration, the old code cannot create a user with a mixed-case e-mail. `org:create` fails on the check `users_email_lower_check`. Use a lower-case e-mail.

The release script keeps the previous release: no need to write down a commit.

1. Run `deploy/rollback.sh` (§ Roll back a release). It goes back to the previous release with no rebuild.
2. Stop Serve (you, sudo): `sudo tailscale serve reset`
3. To return to the new code later, run `deploy/release.sh` with a newer tag.

Set the old value of another key back from the password manager only if the edit of `.env` broke it.

## Assist mode

Change the mode, the `auto` flags and the switches of a mailbox with `mailbox:settings`. Every change is locked and audited. The command prints the settings table with `before -> after` for the changed field.

```sh
$C run --rm cli bun run mailbox:settings show --org-id <uuid> --mailbox-id <uuid>
$C run --rm cli bun run mailbox:settings mode --org-id <uuid> --mailbox-id <uuid> --mode assist
$C run --rm cli bun run mailbox:settings auto --org-id <uuid> --mailbox-id <uuid> --category info --value on
```

- `mode --mode assist` sets the switches `move`, `mark_read` and `flag` on. Add `--keep-switches` to keep the old values. Without it, `mode --mode assist` also expires the `ready` rows of each switch it turns off.
- `auto --value on` needs a go/no-go `go` for the category on real labeled mail (bar 0.98, at least 30 kept). If the gate says no-go, the command exits with code 1 (bad arguments exit 2). `--force` sets `auto` on anyway and records `forced` in the audit log.
- `switch --name <name> --value on|off` changes one switch.
- A change that closes a gate expires the `ready` actions it closes. The command prints `expired <n> ready actions`.
- Before you set `ACTIONS_SCOPE=all`, run `mailbox:settings expire-ready`. Real mail of the shadow-scope days then does not move when the scope opens. If `ready mailbox actions left` is above 0, a committer run holds a row: run the command again after 15 seconds.
- You can close a gate as an emergency stop (`mode shadow`, `auto … off` or `switch … off`). No second `expire-ready` is needed.
  `saveTriage` share-locks the settings row and compares its version. A triage batch that started before the change writes nothing for its mails and releases them.
  The next run triages them under the new settings.

### `ACTIONS_SCOPE`

`ACTIONS_SCOPE` in the VPS `.env` is a second gate next to the mode. Only the user edits `.env`. Restart the server after a change: `$C up -d server`.

- `off` (default): the committer changes no mailbox. `/status` says so. The `ready` actions wait and expire after 24 hours.
- `synthetic`: the committer changes only seed mail (`@ea-seed.test` message ids), in every mailbox.
- `all`: the committer acts on every active mailbox of every organization that is not `suspended`, by the mode, the switches and the `auto` flags of each mailbox. A mailbox in `shadow` mode changes nothing. Before you set `all` on a server with more than one mailbox, run `org:status` and pause every mailbox whose owner did not agree (see "Customers (S6a)").

The go/no-go gate: on 2026-11-06 every category was no-go (`spec/features/done/2026-11/F025-s1b-shadow-run/plan.md`). Without an `auto` category, only `flag` actions apply. Use `auto … --force` only when you accept the precision of that category.

### Undo and `mailbox:audit`

- The ↩️ button under a digest line undoes the system changes of that mail for 7 days. After 7 days it answers "Too old to undo".
- An Undo tap under `ACTIONS_SCOPE=off`, or for a paused mailbox, answers "not possible now" and changes nothing.
- A move that a committer run holds at the second of the tap still finishes. The line then shows ↩️ again. Tap it again.
- A second move back of the same mail at Interia is not seen. A mail that the user moves back after 7 days gives no feedback.
- `mailbox:audit` exits 1 when INBOX has lost or duplicate mail (bad arguments exit 2). It compares INBOX and each enabled synced folder with the rows whose `folder` is that folder (ADR 0014). It prints one line per folder. `cross=<n>` counts a mail that sits in INBOX and in a synced folder: it is no problem. Mail that the system moved is not counted. A user move out of a folder shows as a duplicate.

### Synced folders (ADR 0014)

The sync reads INBOX and, at Interia, `Oferty`, `Społeczności`, `Rachunki` and the spam folder `Wiadomości-śmieci`. The server inserts a row for each of them in `mailbox_folders` when the server lists the exact name.

- Show the folders: `$C run --rm cli bun run mailbox:settings show --org-id <uuid> --mailbox-id <uuid>`.
- Off switch per folder: `$C run --rm cli bun run mailbox:settings sync-folder --org-id <uuid> --mailbox-id <uuid> --key offers|social|bills|junk --value on|off`. INBOX has no switch. `--value on` again clears the cursor: the next sync takes the last 24 hours of that folder.
- `mailbox:rescan` forces a rescan of every synced folder. `mailbox:backfill` reads INBOX only.
- A spam folder mail that the classifier finds valid gets a move into INBOX under the normal move gate (the category `auto` ON). With `auto` OFF, the digest says "would move to INBOX".
- A final failure of a move by APPEND (the rescue, or an Undo into `Oferty`, `Społeczności`, `Rachunki`) can leave the mail in both folders. The `action_failed` notice tells you. Delete the extra copy by hand.
- Run `deploy/rollback.sh` for the code (§ Roll back a release). Roll back the code, not the migration: the migration `sync_folders` only adds (a table, `emails.source_folder`, an index). A `db:rollback` after live use loses the cursors of the non-INBOX folders and the source folder of non-INBOX mail. A rollback goes one release back. Every release since the sort-folder sync reads the cursor from `mailbox_folders`, so the old code runs on the new schema. No SQL is needed on a rollback or a roll forward. After a code rollback, a `ready` move into INBOX ends as `bad_payload`, and an Undo of `Oferty` mail goes to INBOX (ADR 0014, D24 (d)).
  - (a) Before you switch the checkout, switch the four folders off: `$C run --rm cli bun run mailbox:settings sync-folder --org-id <uuid> --mailbox-id <uuid> --key offers|social|bills|junk --value off` (once for each key). Then wait until this query gives 0: `select count(*) from emails where mailbox_id = '<uuid>' and source_folder <> 'INBOX' and status in ('pending', 'processing');` (run it as `postgres` through `$C exec -T db psql -U postgres -d email_assistant -c "…"`). Else the old code triages spam folder mail as INBOX mail.
- Contract migration `drop_old_cursor_columns` (it drops `emails.inbox_uid`, `emails.undo_pending_at`, `mailboxes.uidvalidity`, `mailboxes.last_uid` and the copy trigger). Its `-- contract:` line names v0.4.3, the release that stopped every use of these columns.
  - A rollback of the release that carries it is `deploy/rollback.sh` alone, to v0.4.3. No SQL. v0.4.3 names no dropped column.
  - A rollback to an older release is not possible after the migration: the older code reads the dropped columns. Restore from the backup that `deploy/release.sh` took before the migration (§ Backups).
  - `deploy/release.sh` with a tag older than v0.4.3 has the same limit: restore from that backup first.
- Contract migration `drop_style_text` (it drops `organizations.style_text`): a rollback of the release that carries it is `deploy/rollback.sh` alone, to v0.4.4. A rollback to an older release needs a restore from the backup that `deploy/release.sh` took before the migration.

### Notice `action_failed`

The owners get one notice for each failed action. An action fails after 3 hard errors, or at once for an unknown folder. The notice names the action, the subject and where the mail is.

1. Read the log: `$C logs --since 1h server | grep 'action_failed'`. The line has the `reason` and the `action_id`. Alert texts: `docs/known-alerts.md`.
2. Open `/status` in Telegram. Check that the mailbox is `active`.
3. A failed move leaves the mail in INBOX. A failed Undo (reverse) leaves the mail in its `AI/…` folder. Move the mail by hand in the mail client.
4. The notice names the default `AI/…` folder name. It does not name the real path of `folder_map`.
5. If a reverse move ends `failed`, a stopped COPY can leave a copy in INBOX that the system does not store (no row, no triage). Delete the extra copy by hand.

### Known effects

- Lock order is one order on every path (undo, returned job, committer): the original move row first, then `emails`. No deadlock cycle exists.

### Roll back

Run `deploy/rollback.sh` for the code (§ Roll back a release). Roll back the code, not the migration. A `db:rollback` of `20261107000001_assist_actions` after live use drops `actions.applied_at`. A later migrate then fails on `actions_applied_at_check` for the `applied` and `undone` rows.

## Delegates

A delegate is a person who gets tasks by mail. Manage delegates and delegations from the terminal. Each command needs `--org-id <uuid>`.

- `bun run delegates:add --org-id <uuid> --name <text> --email <address> [--tags a,b,c]`: add a delegate. Output: `added <id>`, `already there`, or `refused: …` (exit 1).
- `bun run delegates:list --org-id <uuid> [--all]`: list active delegates. `--all` also shows disabled ones.
- `bun run delegates:disable --org-id <uuid> --id <uuid>` and `delegates:enable`: switch a delegate off or on.
- `bun run delegations:list --org-id <uuid> [--status drafted|sent|answered|overdue|done|cancelled] [--limit 50]`: list delegations.
- `bun run delegations:done --org-id <uuid> --id <uuid>`: close an answered or overdue delegation. Its pending reminders expire.

Rule: a delegate address is never a mailbox address of the organization. `delegates:add` refuses it (exit 1).
The audit rows have the actor `cli`.

On the VPS run each command as `$C run --rm cli bun run …`. A mail can be delegated only to an active delegate: with no active delegate the classifier does not use the category `delegation`.
A disabled delegate gets no new delegation and no reminder; a send that is already waiting for a tap still shows the name with `(inactive)`.
Close a delegation by hand with `delegations:done` or with the ✅ Done button of the "answered" notice.

## Approvals and sends

State of this section: written from the code of the S4 task. The dev run (stage 19) and the VPS runs (stage 22: self-send, stage 23: the first real delegation) are not done. Only the Interia probe of stage 1 sent a real mail.

How a delegation goes (details: `docs/capabilities/drafts-and-send.md` and `docs/capabilities/delegation.md`):

1. The triage worker plans a draft and a send. The committer puts the draft in the Drafts folder (it needs `ACTIONS_SCOPE` other than `off`, the mailbox mode `assist` and the switch `create_draft` on).
2. The owner gets a Telegram message with the full draft, the recipient and the original sender, and the buttons 📤 Send and ✖️ Reject. Only an owner can tap them.
3. After the tap, the committer sends the mail by SMTP, but only if `SEND_SCOPE` allows it. Then it copies the mail to `Wysłane` and removes the draft.
4. The owner gets a new message with the result.

### `SEND_SCOPE`

`SEND_SCOPE` and `SEND_TEST_ADDRESSES` are in the VPS `.env`. Only the user edits `.env`. Restart the server after a change: `$C up -d server`.

- `off` (default): no mail goes out. A tap still works, and the approved send waits. `/status` says `approved, held by SEND_SCOPE=off`. It expires 48 hours after the tap (`held_timeout`).
- `self`: a mail goes out only when every recipient is in `SEND_TEST_ADDRESSES` (your own addresses, comma-separated). The server refuses to start with `self` and no valid list.
- `all`: every approved send of every active mailbox of an organization that is not `suspended` goes out: delegations and reminders to real delegates, and also clarification questions to the original sender of a mail. Each mail still needs the owner's tap.

### Send limits

Each mailbox has three limits (PD-044). Set them in the VPS `.env`; an empty key gives the default. The value is an integer from 1 to 10 000.

| Key                        | Default | Meaning                                              |
| -------------------------- | ------- | ---------------------------------------------------- |
| `SEND_LIMIT_MAILBOX_HOUR`  | 20      | Sends of one mailbox in the last 60 minutes          |
| `SEND_LIMIT_MAILBOX_DAY`   | 100     | Sends of one mailbox in the last 24 hours            |
| `SEND_LIMIT_RECIPIENT_DAY` | 5       | Sends of one mailbox to one address in the last 24 h |

What a hold looks like:

- The approved send stays `approved` and waits. The panel line says "approved, waiting: send limit".
- The owner gets the Telegram notice `send_held` (once per mailbox and day).
- The operator gets the notice `send_limit` (once per mailbox and UTC day) in the operator chat. A failed notice is tried again the next hour.
- The audit row `action.send_limited` names the limit, the end of the window and the mailbox. `last_error` of the action is `send_limit:<kind>`.
- The send goes out at its next claim after the window ends. A send that waits more than 48 hours after the tap expires (`held_timeout`).

To raise a limit: set the key in `.env`, then restart: `$C up -d server`. Never set a limit above the limit of the mail provider. Exchange Online allows 30 mails a minute and 10 000 recipients a day. Gmail allows 2 000 a day (500 for a trial account). Source: the E07 discovery notes W11 and W12.

### Result notices

Each notice says what happened. The left part is the start of the text.

- `✅ Sent to …`: the mail went out. "No copy in Sent" means the copy to `Wysłane` failed; the mail was sent anyway. "The draft stays in Drafts" means the server has no UIDPLUS: delete the draft by hand.
- `❌ Not sent … The mail server refused it` (`smtp_rejected`): the server refused the address or the mail (a 5xx reply). No button. Fix the address (`delegates:disable`, then `delegates:add` with the right address). The draft stays in Drafts. The system does not plan this mail again.
- `❌ Not sent … The send failed 3 times` (`smtp_error`): the connection or the login failed three times. Check `/status` and the mailbox (`mailbox:check`), fix it, then tap 📤 Send again.
- `❌ Not sent … refused the content for now`: the server gave a 4xx reply after the content. The system never retries after the content. Look in `Wysłane` and ask the recipient first, then tap 📤 Send again if the mail did not go out.
- `⚠️ Unknown whether the mail … went out` (`outcome_unknown`): the connection broke after the content, or the server stopped during the send. Check `Wysłane` and ask the recipient. Tap 📤 Send again only if the mail did not go out. If the mail did go out, tap ✅ It went out (owners only): the delegation becomes `sent` with the stored message id, no mail is sent again, and a reply of the delegate is matched. Without this tap the delegation stays `cancelled` and a later reply is not matched. The button shows only for a delegation send, and it does nothing after a resend.
- `⌛ Not sent: the approval expired (48 h)` (`expired`, `timeout`): nobody tapped within 48 hours. The draft was removed (or the notice says it stays).
- `⌛ Not sent: you did not receive the approval request (the account was paused, or it did not go out)` (`not_seen`): the request did not reach you, either before the account was paused (the system ended the send at the resume) or for 48 h while the account ran. The draft was removed (or the notice says it stays). Send the task by hand if it is still needed.
- `⌛ Not sent: it waited 48 h after your approval` (`held_timeout`): a held approval. Read the scope: `SEND_SCOPE`, a paused mailbox (`/resume`), a login error (`mailbox:password`) or a mail server that is not allowed (`host_blocked`). The system does not plan it again; send the task by hand from the draft, which stays in Drafts.
- `⌛ Not sent: no approval request could go out within 7 days` (`not_notified`): no owner was linked, or the draft was not created. Link an owner with `telegram:link`.
- `❌ Not sent: the draft is not in your Drafts folder` (`draft_missing`): the draft failed three times (read `docs/known-alerts.md`, `action_failed` with `reason=hard_error`), or the copy was deleted, moved or sent in the mail client after the tap.
- `⌛ Not sent: the setting was changed` (`policy_changed`): `mode shadow` or `switch create_draft off` closed the gate.
- `⌛ Not sent: the delegation was closed`: a reminder that waited for a tap while the delegate answered or you closed the delegation.

Log lines and what to do: `docs/known-alerts.md`.

### Delegation chaser and expiry

- The chaser job ticks every 15 minutes. It acts once per local day for each mailbox, from 07:30 in the organization timezone, only in mode `assist` with the switch `create_draft` on. A delegation is overdue after its due date (3 days after the send when the mail named no date).
  It plans a reminder for each overdue delegation: at most 2 reminders, 3 days apart, at most 10 per run, shown as one message with 📤 Send all and ✖️ Skip all. A reminder never goes out without a tap.
- The expiry job runs every hour. It closes sends that nobody answered (48 hours after the request), sends that were never announced (7 days), sends whose draft failed, and approved sends that stayed held for 48 hours after the tap.

### Jobs on demand

Run one job once, with the same settings as the server. Add `--force` only to the chaser: it skips the 07:30 and once-per-day gate.

```sh
$C run --rm cli bun run job:run --name actions.expiry
$C run --rm cli bun run job:run --name loops.chaser [--force]
$C run --rm cli bun run job:run --name channels.notifier
$C run --rm cli bun run job:run --name platform.retention
```

`channels.notifier` needs `TELEGRAM_BOT_TOKEN`. `platform.retention` clears the old texts of every organization (the server runs it daily at 02:40); the log event `retention_org_done` holds `org_id` and the row counts (`body_rows`, `header_rows`, …) only. Do not run `--name actions.committer` while the server runs on the same database: the log lines double.

### What the system never does

- It never sends a mail without your tap on 📤 Send (or 📤 Send again, 📤 Send all).
- It never sends outside `SEND_SCOPE`.
- It never sends the same mail again after the content went to the server. After a crash or an unknown result, it looks in `Wysłane`; it does not send.
- It never takes a recipient from mail or LLM text: only from the delegates list, or the sender address of the mail for a clarification question.
- It never sends a draft that you edited in the mail client. Do not send the draft yourself: the system sends the stored text and removes the draft.
- It removes only drafts that it made, found by its header `X-EA-Action-Id`.

### Roll back

Run `deploy/rollback.sh` for the code (§ Roll back a release). Roll back the code, not the migration. A `db:rollback` of `20261108000001_delegation` deletes all `create_draft` and `send` rows, all delegations and all delegates.

## Notices as facts (migration `outbox_view`)

### Update

`deploy/release.sh` runs the migrations before it starts the new code: the code writes `outbox.view`, `channel`, `locale` and `detail`. Rows queued by the old code keep their text and go out as they are.

A later change of a notice view schema (a stricter field, a renamed field) needs care: the sender renders a row up to 24 h after its queue, with the code that runs at the send. Release it only if the new schema still accepts the views of the rows queued in the last 24 h. Otherwise wait until `select count(*) from outbox where status in ('pending', 'sending') and view <> '{}'::jsonb and kind = '<kind>'` is 0, then release. A waiting row that the new schema rejects becomes `failed` / `bad_view` and the user gets no notice.

### Roll back

Run `deploy/rollback.sh` for the code (§ Roll back a release). Roll back the code, not the migration. The code that comes with this migration already renders a row without text, so a rollback to any release that has this migration loses nothing. A release without this migration sends a row without text as an empty message: Telegram refuses it, and the row fails with `bad_request`, approval requests too (their sends expire after 48 h, and the owner gets the result notice). Before a rollback that far, wait until `select count(*) from outbox where text is null and status in ('pending', 'sending')` is 0 (outside the quiet hours the outbox empties within minutes). Do not run `db:rollback`: its down part fails every waiting row without text.

## LLM provider tiers (F141)

One variable picks the provider of every LLM call: `LLM_PROVIDER` (`openai`, `gemini` or `deepseek`) with the key of that provider. Each provider maps two tiers to models: `light` (classifier, drafter, extractor) and `strong` (judge). No env key picks a model. The effort follows the role and the provider (for example the drafter runs at `low` on a provider that takes an effort). `LLM_<ROLE>_TIMEOUT_MS` and `LLM_<ROLE>_RPM` stay.

### Update

Do this before `deploy/release.sh` (owner step O1 of the ticket). A removed key with a value stops the start, so an old `.env` cannot change a model without a notice.

1. At the old release run `bun run llm:check --role <role>` for each of the roles that existed then (`classifier`, `drafter`, `extractor`, `judge`) and keep the lines (model, effort).
2. Delete these 12 keys from the `.env` of the host and from `deploy/sim.env` (`sed -i -E '/^(KEY1|KEY2)=/d' .env` with the names; never print the file):
   - `LLM_JUDGE_PROVIDER`, `LLM_JUDGE_MODEL`, `LLM_JUDGE_REASONING`
   - `LLM_DRAFTER_PROVIDER`, `LLM_DRAFTER_MODEL`, `LLM_DRAFTER_REASONING`
   - `LLM_EXTRACTOR_PROVIDER`, `LLM_EXTRACTOR_MODEL`, `LLM_EXTRACTOR_REASONING`
   - `OPENAI_MODEL_CLASSIFIER`, `GEMINI_MODEL_CLASSIFIER`, `OPENAI_REASONING_EFFORT`
   An empty value is fine; a key with a value is refused.
3. Deploy. Check: the server starts, and `bun run llm:check --role all` prints four lines. Compare model and effort with step 1. A changed model or effort is a production change: stop and ask the owner. Known: the drafter moves from `OPENAI_REASONING_EFFORT` to effort `low`; it is off until `reply_drafts` is on.

### A removed key stops the start

The start log then holds `config_key_bad config_key=<KEY> reason=key_removed` (the key name only, never its value). It means: delete this key from `.env`. Check the old and new names above, remove the line, restart. A `config_key_bad` line without `reason=key_removed` is another bad value: fix the key it names.

### Roll back

Run `deploy/rollback.sh` for the code (§ Roll back a release). The older release reads the model keys again: put back the old lines from your copy of `.env` (they were removed above) before you roll back, or the older release starts on its default models.

## Customers (S6a)

Each customer is one organization with a plan. The operator manages the plan with the commands below. The output holds ids, codes, dates and counts only, never a name or an address.

```sh
$C run --rm cli bun run org:create --org-name <name> --email <email> --display-name <name> --plan trial --trial-days 30
$C run --rm cli bun run org:plan --org-id <org id> --plan suspended
$C run --rm cli bun run org:plan --org-id <org id> --plan active
$C run --rm cli bun run org:plan --org-id <org id> --plan trial --trial-days 14
$C run --rm cli bun run org:plan --org-id <org id> --max-mailboxes 5
$C run --rm cli bun run org:flag --org-id <org id>
$C run --rm cli bun run org:flag --org-id <org id> --flag <key> --on
$C run --rm cli bun run org:flag --org-id <org id> --flag <key> --off
$C run --rm cli bun run org:status [--org-id <org id>]
```

- `org:create --plan trial|active`: the default is `trial` with `--trial-days 30` (1 to 365). The database default of an organization that exists already is `active`.
- `org:plan` changes the plan, the trial end or the mailbox limit (0 to 100) and writes an audit row. Moving a `trial` organization to `active` or `suspended` clears the trial end. Moving to `trial` from another plan needs `--trial-days`.
- `org:flag` lists the feature flags of an organization (each `on` or `off`, with the source: `env`, `row` or `default`) or turns one flag on or off for it, with an audit row `org.flag_changed`. The keys and their defaults are in `packages/core/src/features.ts`. An `--off` is kept when the default later changes. `FEATURES_OFF=<key>,<key>` in the server `.env` turns flags off for every organization at the next restart, without a DB write (the kill switch); an unknown key stops the start.
- `org:status` prints, for each organization: the plan, the trial end, `max_mailboxes`, `resumed_at`, the mailbox counts by status, the last sync, the LLM calls of today and the number of linked Telegram chats.
- `suspended` pauses the customer: no sync, no triage, no action, no send, no reminder, no digest and no notice. Telegram taps and commands answer "account paused". Every write in the web panel answers `403 org_suspended`. The member can still read, sign out and change the password. The approval expiry and the retention job still run. The change to `suspended` cancels the queued messages, except approval requests.
- `mailbox:backfill` refuses a `suspended` organization: exit 1 (bad arguments exit 2), a message with the org id and `org_suspended`, before any IMAP call and with no row changed. Resume the organization first. `mailbox:rescan` and `mailbox:settings` do not check the plan: they make no IMAP call and store no mail.
- After a resume (`--plan active` or `--plan trial`), mail from more than 24 hours before the resume is not triaged (`suspended_backlog`). A send that an owner approved before the pause waits at most 48 hours after the tap.
- The mailbox limit: an organization connects at most `max_mailboxes` mailboxes (default 2). The web and `mailbox:connect` refuse more with `mailbox_limit`. A lower limit does not remove a mailbox that exists.
- `OPERATOR_CONTACT` (an address, set only in the server `.env`): the paused banner and the paused Telegram answer show it. Empty: "contact the operator", and the start log says so when the web is on.
- `OPERATOR_TELEGRAM_CHAT_ID` (your own chat id, needs `TELEGRAM_BOT_TOKEN`): the server sends you three events: a trial that ends in 3 days or has ended, a mailbox that reached the daily LLM cap, and a mailbox in `auth_error` for 24 hours. The texts hold ids only. Empty: the server writes the same text as a `warn` log line. A notice can arrive twice after a crash.
- The start log line `scope targets: <n> active mailboxes in <m> organizations, <k> suspended organizations` shows whom a scope `all` acts on.

**Before you set a scope to `all` on a server with more than one mailbox, run `org:status` and pause every mailbox whose owner did not agree (D2).** The modes are the consent: a mailbox in `shadow` mode changes nothing in the mailbox, and a send always needs a tap. Pause a mailbox with the Pause button of an owner in the panel or with `/pause` in Telegram. Or move the whole organization to `suspended` with `org:plan`.

### Operator console

The page `/operator` shows all customers in one place. It reads the same data as `org:status` and writes the same audit rows as `org:plan` and `org:flag`.

Set up (once, on the server):

1. Find your user id: `$C exec -T db psql -U postgres -d email_assistant -c "select id from users where email = '<your email>'"`. A user id is not a secret, but keep it out of the repo.
2. Put the id in the VPS `.env`: `OPERATOR_USER_IDS=<user id>` (a comma list for more than one operator). Restart: `$C up -d server`.
3. You must be a member of an organization: the page works inside your own sign-in. Every other user gets the 404 page, also for `/operator/index.html` and the same path in other forms.

The console needs two-factor sign-in (F105): an operator without it is sent to Settings → Account (`/settings?two_factor=required`). Turn it on there first.

What the page shows:

- **Organizations:** plan, trial end, mailboxes (all, with a login error, with a server not allowed), last sync, failures in the last 24 hours (sends and notices), AI calls and cost today. It holds ids, codes, counts and dates only: no organization name, no address, no mail text. Map an id to a customer with `org:status` on the server.
- **One organization:** plan state, mailbox limit, each mailbox by id and status, the last runs (sync, AI triage, digest, send, notice), failures, AI calls of the day by model and the feature flags with their source (`off by the server list`, `set by the operator`, `default`).
- **Notices:** the operator notices of all organizations for the last 1, 7 or 30 days (kind and key).
- **Changes:** the plan (with trial days or the mailbox limit) and each flag (on or off) of an organization. A change calls the same function as `org:plan` or `org:flag` and writes the same audit row into that organization, with your user id as actor. It works while your own organization is `suspended`.

The security log of an organization (a card in Settings for owners) is behind the flag `security_log`. Turn it on for an organization:

```sh
$C run --rm cli bun run org:flag --org-id <org id> --flag security_log --on
```

## Account data (F106)

Three commands delete an organization, export its data and find or erase the data of one person who is not a user. The rules and the code are in `docs/capabilities/account-data.md`. The commands print ids, counts, paths and sizes. `org:delete` also prints the mailbox addresses. No command logs an address, an organization name or a mail text.

### Delete an organization

The owner can do it in Settings → Account when the flag `org_delete` is on for the organization (off by default):

```sh
$C run --rm cli bun run org:flag --org-id <org id> --flag org_delete --on
```

The operator can do it with a command. It needs no flag:

```sh
$C run --rm cli bun run org:delete --org-id <org id> --confirm "<organization name>"
```

- The output is `deleted <org id>: mailboxes <n>` and one line `change the password of <address>` for each mailbox. Tell the owner to change these mailbox passwords at the mail provider: the assistant knew them and they still work. The drafts and folders that the assistant made stay in the mailboxes; the owner deletes them in the mail program.
- Everything of the organization goes at once: mailboxes, mail, results, actions, delegations, rules, Telegram links, history, the audit rows and the members' accounts. A member who also belongs to another organization stays. Backups keep the rows until they expire.
- `busy, try again` (exit 1): a lock wait ran out (a mailbox job or an invite holds a row). Nothing changed. Run the command again. `--lock-timeout-ms <ms>` changes the 30 s wait.
- Keep the line `deleted <org id>: …` outside the server (see Restore below).
- After a delete, remove the user id of a deleted operator from `OPERATOR_USER_IDS` at the next change of `.env`.

### Export

An export is an `age`-encrypted file of every table that `EXPORT_MAP` lists. It holds no password hash, credential, token or session. The container has no `age` binary; it needs only the public key (`age1…`) of the person who gets the file.

```sh
mkdir -m 700 <host folder>
$C run --rm -v <host folder>:/exports cli bun run org:export --org-id <org id> --recipient <age1…> --out /exports/<org id>-<date>.age
```

- The output is `exported <org id>: <bytes> bytes` and one line `<table> <count>` for each table. The file has mode 600 and is never replaced: an existing file gives exit 1 (`org_export_refused`, reason `exists`). Choose a new name.
- If the command fails with `EACCES`, the container user `bun` (uid 1000) cannot write the folder, because the folder belongs to your host user (on the pilot VPS uid 1002). Run the command with your own ids: `$C run --rm --user "$(id -u):$(id -g)" -v <host folder>:/exports cli bun run org:export …`. This worked on the pilot VPS on 2026-11-14. Do not use a mode wider than 700.
- Hand the file over by a private channel, never by an open mail. The person decrypts it with `age -d -i <identity file> <file>`. Delete the file on the server and on every other copy after the delivery.
- Each export writes the audit row `org.exported` (it shows in the security log of the organization as "Data export made").

### Data request (a person who is not a user)

GDPR Art. 12(3): answer within one month. Run these commands only on the written instruction of the owner of the organization. The owner keeps the request. The address is on the command line: clear that line from the shell history afterwards.

1. Find (a dry run; it changes nothing). For an access request, add a report that is encrypted to the owner's `age` public key:

   ```sh
   $C run --rm cli bun run org:dsr --org-id <org id> --address <address> --find
   mkdir -m 700 <host folder>
   $C run --rm -v <host folder>:/exports cli bun run org:dsr --org-id <org id> --address <address> --find --recipient <age1…> --out /exports/<name>.age
   ```

   The output is counts: `mails`, `mention <table.column> <n>`, `listed delegates`, `listed sender_rules`, `open actions`, `chain actions`, `chain delegations`, and `report <bytes> bytes`. A find that matches nothing prints `warning: no match, check the spelling of the address` (exit 0): check the address. The report holds the whole mail of each mail that goes; handle the file as an export.

2. Send the report or the counts to the owner. Wait for the owner to ask for the erase.
3. Erase. `--confirm` repeats the address:

   ```sh
   $C run --rm cli bun run org:dsr --org-id <org id> --address <address> --erase --confirm <address>
   ```

   The erase is one transaction. It deletes the mails of the person, writes a tombstone for each (sync, rescan and backfill skip them), removes the address from the kept rows (the text becomes `[removed]`), and blanks the stored digests and approval sets that can list the erased mail. It prints `erased mails`, `tombstones`, `scrubbed <table.column> <n>`, `blanked outbox`, `dropped outbox`, `kept delegates`, `kept sender_rules` and the line `record: dsr erase <org id> <date>`.
   - `open action <id>` (exit 1, `open_actions`): a send or draft of a mail that goes, or an action of a kept mail that names the person, is still open. The owner rejects or finishes those sends first. Then run the erase again.
   - `blocked <constraint>` (exit 1): a foreign key that the erase did not expect stopped it. Nothing changed. This is a bug: report the constraint name.
   - `rule mismatch <n>` (exit 1, log `org_dsr_refused` with `reason=rule_mismatch`; the same for `--find`): the database lower-cases a letter of this address unlike the program (the glibc of the database has an older or newer Unicode version than Bun; the locale name is not the cause). Nothing changed. Run `$C run --rm cli bun run org:dsr --org-id <org id> --rule-check`, keep its output with the request record, do not erase by hand, and tell the owner.
   - `own_address` (exit 1): the address is a mailbox of the organization or the e-mail of a member. The command refuses it.
   - A lock wait that runs past 30 s ends with the log line `org_dsr_failed` (exit 1) and changes nothing. Run the command again.

4. Tell the owner what stays:
   - Delegates and sender rules that hold the address stay until the owner changes them (the find lists them).
   - The mail stays in the mailbox. The owner deletes it there if wanted. Telegram messages that were already delivered stay in the chat; nothing can recall them. The owner deletes them there.
   - Backups keep the rows until they expire.

**Erase again** when mail of the person may be stored later. A mail that was never stored has no tombstone. Run the same `--erase` command again after a backfill (`mailbox:backfill`), after the first sync of a newly enabled sync folder, and after a newly connected mailbox. A second run that finds nothing prints zero counts.

**What the match does not find** (limits of the address pattern):

- An address inside an attachment file name, such as `p@x.test.vcf`, is not matched: the pattern reads `.vcf` as a longer domain. The same rule keeps `a@b.com.pl` apart from `a@b.com`.
- An address at the boundary of single quotes or braces (`'p@x.test'`, `{p@x.test}`) is matched only at the start of the text or after a character that is not allowed in a local part.
- A fresh approval set that the sender has claimed (younger than 5 minutes) can still reach Telegram with the erased mail in it.
- An approval card that was already sent and that the erase blanked can still be tapped. The answer then shows `[removed]`.
- Telegram messages that were already delivered cannot be recalled.

### Restore (D20)

A backup restore brings back the deletes and erases that were made after the backup. Keep each `deleted <org id>: …` line of `org:delete` and each `record: dsr erase …` line of `org:dsr` outside the server (for example in the operator's own notes; the owner keeps the request). After a restore (§ Backups), and before the panel opens, run each of them again: `org:delete` with the same id and name, `org:dsr --erase` with the same address. No table on the server keeps this list, because a restore would roll it back too.

### Hash of the address

The audit rows `dsr.find` and `dsr.erase` hold a hash of the address, never the address. The key comes from `CREDENTIALS_KEY` (HKDF, no new secret). The same address gives the same hash in every organization. A change of `CREDENTIALS_KEY` makes old hashes unmatchable to an address.

Both DSR commands and `org:export` and the refused delete attempts show in the security log of the organization (Account card, flag `security_log`).

## Trust ladder (F110)

Capability page: `docs/capabilities/trust.md` (rules, limits, tests). The trust ladder lets a mailbox earn automatic moves from global evidence, a history check at connect and a tripwire. Eight feature flags carry it (default off). Two parts run in every organization with no flag: the grant that each `auto` stores, and the re-gate (`trust.regate`).

### Release

1. Release with every flag off (`docs/release-checklist.md`). The migrations `20261115180001_trust_ladder.sql`, `20261117120001_history_model_failing.sql` and `20261117140001_unsubscribe_data.sql` only add things: the old release runs on the new schema.
2. Do not change the model, the provider, the reasoning effort or `OPENAI_BASE_URL` in the same release. The first re-gate run stamps every existing `auto` with the grant `legacy` for the running key; a switch in the same release would stamp the new key with no evidence.
3. Check: `bash deploy/logs.sh --since 15m --event trust_regate_done` shows `run=start` with `paused` 0. `$C exec server ls evals/results/gate` lists the gate files of the image.

### Turn the flags on

One flag at a time, one pilot organization first: `$C run --rm cli bun run org:flag --org-id <uuid> --flag <key> --on` (`--off` turns it off). The order and the reasons are in `docs/capabilities/trust.md` rule 22:

1. `trust_ladder`. Then queue a check if a mailbox needs one at once: `$C run --rm cli bun run trust:history-check --org-id <uuid> --mailbox-id <uuid>`. The job `trust.history` runs it; the check ends `done` or `no_result` within an hour, costs at most $0.25, and the report page `/report` shows it. With the gate file of today (provisional) no category is recommended.
2. `user_quiet_hours`. 3. `report_mail` (set `WEB_BASE_URL` first; one member chooses the channel in Settings). 4. `why_lines`, then `spam_review_line`. 5. `panel_review`. 6. `urgency_editor`.
3. `bulk_unsubscribe` last. Set `MAIL_TRUSTED_AUTHSERV_IDS` only to providers that write their own `Authentication-Results` header on top of the mail. Turn it on only on a release that carries the legal version that names the one-click request.

`FEATURES_OFF=<key,key>` in `.env` plus `$C up -d server` forces flags off for every organization.

### Roll back

Roll back the code, not the migrations. Do not run `db:rollback` on a live database: `trust_ladder` first deletes all `trust_report_ready`, `autonomy_paused` and mail-channel outbox rows and drops the history checks, the trips, the quiet hours and the report channels. The old code ignores the new tables and columns.

1. Turn the flags off (`org:flag --off`, or `FEATURES_OFF`).
2. Stop the server, then fail the pending rows that the old code cannot read: the new kinds, every mail-channel row, every `weekly_report` (its evidence lines hold new keys) and the `urgent` rows with the keys `confidence` or `rule` (the old view schemas are strict). The old `claimDueOutbox` claims the whole batch and then throws in the kind check, so one new row blocks the notice sender of every organization:

   ```sh
   $C stop server
   $C exec -T db psql -U postgres -d email_assistant <<'SQL'
   UPDATE outbox SET status = 'failed', error_code = 'outdated', locked_at = NULL
   WHERE status IN ('pending', 'sending')
     AND (kind IN ('trust_report_ready', 'autonomy_paused') OR channel = 'mail'
          OR kind = 'weekly_report'
          OR (kind = 'urgent' AND view ?| array['confidence', 'rule']));
   SQL
   ```

3. Run `deploy/rollback.sh` (§ Roll back a release).
4. What stays: report mails already in INBOX (the old sync has no own-mail check for them and may triage one that it has not read yet), stored history mail (normal retention), and unsubscribe requests already sent. A later F110 start finds a policy with no `grant` and stamps it `legacy` again.
5. The migrations by name, for a development database or a restored backup only (newest first, one `bun run db:rollback` each; the three migrations above are not the only ones after `trust_ladder`, so it cannot be rolled back alone): `20261117140001_unsubscribe_data.sql` drops `unsubscribe_requests` and `email_headers.list_unsubscribe_post`; `20261117120001_history_model_failing.sql` rewrites the reason `model_failing` to `stopped`; `20261115180001_trust_ladder.sql` drops the three trust tables and the four `memberships` columns. A broken migration gets a forward fix in a patch release or a restore from backup.

## Sender context (F120)

Capability page: `docs/capabilities/sender-context.md` (rules, limits, tests). The assistant keeps a count-only profile of each sender of a mailbox, under a keyed hash. Three feature flags carry it (default off, epic `E11a`, remove-by 2027-06-01): `sender_context`, `contact_wait` and `sender_suggestions`. The last two do nothing unless `sender_context` is on. The retention job and the data-request erase run in every organization with no flag.

### Release

1. Release with every flag off (`docs/release-checklist.md`). The migration `20261118120001_sender_context.sql` only adds things (two tables, one column, one value in a CHECK list): the old release runs on the new schema until step 1 of Roll back.
2. Do not move the classifier prompt in the same release: `classifier-v4` has no win and the pointer stays `classifier-v2`.

### Turn the flags on

One flag at a time, one pilot organization first: `$C run --rm cli bun run org:flag --org-id <uuid> --flag <key> --on` (`--off` turns it off). The order:

1. `sender_context`. The job `contacts.refresh` runs hourly at minute 7. To run it now: `$C run --rm cli bun run job:run --name contacts.refresh`. Wait one day. Check: `bash deploy/logs.sh --since 24h --event contacts_refresh_done` shows one line for each mailbox and hour with a small `duration_ms`, and `bash deploy/logs.sh --since 24h --event contacts_refresh_mailbox_failed` shows no line. The sender line in Activity and Approvals shows now.
2. `contact_wait`. New open loops get the wait of their contact. Old loops keep their date.
3. `sender_suggestions` last, on the word of the owner (it is the visible part). A blocklist suggestion needs `sent_sync` (current Sent coverage). The Rules page shows the Suggestions card and the weekly report gets one line.

The known domains for the look-alike rule need `sender_context` and `suspicious_mail`. `suspicious_mail` stays off by the owner decision of 2026-11-15; with it on, the rule can add `lookalike_domain` to mail that was clean before, and that reason blocks drafts and follow-ups.

`FEATURES_OFF=<key,key>` in `.env` plus `$C up -d server` forces flags off for every organization.

### Roll back

Roll back the code, not the migration. Do not run `db:rollback` on a live database: its down part drops both tables and the column `open_loops.usual_reply_days` (after it sets every `contact` loop to `default`). The old code ignores the two tables and the new column, but two things in the new data break it:

- The old code reads `open_loops.due_source` as a strict enum of `stated` and `default` (`toLoopRow`, `loopItemSchema`). A loop with `contact` makes it throw.
- The view schema of a `weekly_report` outbox row is strict. A pending row that holds the key `suggestions` makes the old notice sender throw, and the old `claimDueOutbox` claims the whole batch first, so one such row blocks the notice sender of every organization. This is the only strict view schema that F120 changed: the digest view keeps the rendered text, the loop ids and the line numbers, so the "usual reply" suffix of the brief adds no view key (`apps/server/src/sender-context-docs.test.ts` checks the list).

1. Turn the flags off, in this order: `sender_suggestions`, `contact_wait`, `sender_context` (`org:flag --off`, or `FEATURES_OFF`).
2. Stop the server. Then, before the old image starts, run this once (it is safe to run twice):

   ```sh
   $C stop server
   $C exec -T db psql -U postgres -d email_assistant <<'SQL'
   UPDATE open_loops SET due_source = 'default', usual_reply_days = NULL WHERE due_source = 'contact';
   UPDATE outbox SET status = 'failed', error_code = 'outdated', locked_at = NULL
   WHERE status IN ('pending', 'sending') AND kind = 'weekly_report' AND view ? 'suggestions';
   SQL
   ```

   The due date of each loop stays as it was. A sent or failed `weekly_report` row is not read again, so it needs no change.

3. Run `deploy/rollback.sh` (§ Roll back a release).
4. What stays: both tables, with their rows (the old code has no job that reads or deletes them). While the old release runs, its data-request erase does not know the tables, so it leaves the profiles of the person: erase again after the new release is back. A later start finds the profiles and ages them out by the 12-month rule.
5. The migration by name, for a development database or a restored backup only: `20261118120001_sender_context.sql` (one `bun run db:rollback`). A broken migration gets a forward fix in a patch release or a restore from backup.

## Reply drafts (F115)

Capability page: `docs/capabilities/reply-drafts.md` (rules, limits, tests). For mail that needs an answer, the assistant writes a reply draft under code checks. The draft waits in the Drafts folder and goes out only after an owner taps Send. Two switches carry it, both default off: the org flag `reply_drafts` and the mailbox switch `reply_drafts` (mode `assist` and a password mailbox). The separate org flag `draft_copy_check` makes the Drafts copy check apply to the other draft kinds; a reply always checks.

### Release

1. Release with the flags off (`docs/release-checklist.md`). The migration `20261117130001_reply_drafts.sql` only adds things (two tables, three outbox kinds in a CHECK list, one backfill of the mailbox signature). The old release runs on the new schema until step 3 of Roll back.
2. This release holds the new Telegram consent text (consent version `2026-11-19`, `TERMS_VERSION` `2026-11-19-2`). Every member accepts the terms again at the next sign-in. A member who linked Telegram earlier gets reply data in Telegram only after the Confirm block of the Telegram card in the panel (`/mailboxes`) records the new version. The block shows while `reply_drafts` (or `open_loops`) is on and the owner's consent is older than the text of that flag; until the owner taps Confirm, that owner sees the count and the panel link only.
3. Keep `reply_drafts` OFF on every organization until this release (or a later one) runs on the server. An older release has no consent text for reply data: an owner with the flag on would get "Confirm the new Telegram terms in the panel" and no panel version could cover reply data.

### Turn on (pilot organization first)

1. The server needs `TRIAGE_LLM_SCOPE` on (the drafter job runs only then) and the key of `LLM_PROVIDER`. The drafter runs on the `light` tier of that provider at effort `low` (no model or effort key; § LLM provider tiers). The quality gate G1 is not passed for `drafter-v1`: the reply injection set passed, the holdout missed two PD-083 bars (`docs/capabilities/reply-drafts.md` Limits, the reports in `evals/results/`). Turning the flag on for a pilot organization is therefore an owner decision; a drafter on another model or effort needs a new gate run first.
2. The flag: `$C run --rm cli bun run org:flag --org-id <uuid> --flag reply_drafts --on`. Check: `$C run --rm cli bun run org:flag --org-id <uuid>` shows `reply_drafts` `on`.
3. The mailbox: the owner turns on the reply drafts switch in the style card of the settings page, or `$C run --rm cli bun run mailbox:settings switch --org-id <uuid> --mailbox-id <uuid> --name reply_drafts --value on`. The mailbox must be a password mailbox in `assist` mode; an OAuth mailbox refuses it (`refused: oauth_mailbox`).
4. Wait for the job `replies.drafter` (every 15 s). Check: `bash deploy/logs.sh --since 1h --event reply_drafted` shows one line for each draft, and `bash deploy/logs.sh --since 1h --event reply_draft_error` and `--event reply_sweep_failed` show no line. A draft shows in the Drafts folder and in the panel at `/approvals`.
5. Probe the Drafts copy before you turn on `draft_copy_check` for the other kinds: `$C run --rm cli bun run reply:check-copy --org-id <uuid> --action-id <draft id>` (read only), again after one hour; the two hashes must match (F115 stage 18, probe P1). Mail servers that re-encode a draft make the hash unstable: a reply send then ends `draft_missing` and the copy stays (`docs/known-alerts.md` `draft_copy_unhashed`).

### Turn off

- The flag off (no deploy): `org:flag --org-id <uuid> --flag reply_drafts --off`. No new draft, notice or sample; `approve` of a reply answers `feature_off`; the committer holds an approved reply; the sweep stops. An open reply send ends `expired` / `timeout` 7 days after its creation. `FEATURES_OFF=reply_drafts` in `.env` plus `$C up -d server` forces it off for every organization.
- One mailbox: the switch off (`mailbox:settings switch ... --name reply_drafts --value off`, or the panel) closes every open reply of that mailbox as `policy_changed`, with its draft. A draft copy that is already in the Drafts folder stays there unless the server has UIDPLUS (then the close removes it when its hash matches).

### Roll back

Roll back the code, not the migration. Do not run `db:rollback` on a live database: its down part drops `reply_requests` and `mailbox_profiles` (the typed profiles are lost) and deletes the three notice kinds. The old code ignores both tables, but five things in the new data break it:

- The old `claimDueOutbox` claims a whole batch and then checks the kind. A pending row of the kinds `replies_ready`, `reply_prompt` or `reply_result` fails that check for a release older than stage 03, so one row blocks the notice sender of every organization. A newer old release rejects the view of `replies_ready` (`bad_view`) and slices the review card key `approval:<id>:r<n>` into a bad send id (the sender throws `22P02`).
- The view of a `weekly_report` is strict. Stage 16 added the key `replyDrafts` to its `week`; an older release rejects a row that holds it (`bad_view`).
- A release older than stage 04 does not know the draft kind `reply`: its detector errors on every run for an open reply, and its committer ends an approved one `bad_payload`.
- The panel read model has the new strict fields `endReason`, `replyAllAdds` (item and detail), `view.replyTo`, `view.gaps`, `view.sentVisible` and `reply` on each activity row, and the stats answer has `replyDrafts`. A browser tab that runs the newer page code rejects an answer without them; a tab that runs the older code rejects an answer with them (`z.strictObject`) until it reloads. The old server never sends them. No migration.
- An older release does not know the callback codes `rd`, `ra`, `ru`, `dr` (they parse to null and answer "invalid"), the audit event `reply.requested` (free text column, harmless) and the routes `POST /api/replies`, `/api/approvals/:id/redraft`, `/recipients`, `GET /api/replies/requests/:id`, `GET`, `PUT /api/mailboxes/:id/profile`, the preview and the sample routes (404).

1. Turn the flag off first: `org:flag --org-id <uuid> --flag reply_drafts --off`, or `FEATURES_OFF=reply_drafts`.
2. Stop the server and run the block below once, before the old image starts (it is safe to run twice; it is not indented, so you can copy it from this file as it stands). The first statement is for every rollback to a release older than this one: it fails the pending and sending rows that the old release rejects, among them the `urgent` rows that hold the key `draftable` (the old urgent view is strict). The second statement is only for a rollback to a release older than stage 04 (a release from before the commit `a4065e84`, F115 stage 04): it ends every open reply as the expiry job does, with the reason `rollback`: the send `expired` (no result notice), its `ready` draft `expired` / `send_closed`, and one `action.expired` audit row for each. Delete the second statement for a newer target. The block never touches a reply send that is `applying` (an SMTP call may be under way), a reply draft that is `applying` or `applied`, or a draft copy that is already in the Drafts folder. Before the block, `$C exec -T db psql -U postgres -d email_assistant -c "SELECT id, type, status FROM actions WHERE payload ->> 'kind' = 'reply' AND status = 'applying'"` should list no row. A row there is an interrupted send or draft step: look in `Wysłane` and in the Drafts folder, and delete a stray draft by hand. Do not send the mail again by hand if it is in `Wysłane`. The whole block is one transaction:

```sh
$C stop server
$C exec -T db psql -U postgres -d email_assistant -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
-- (a) notices that an older release cannot read
UPDATE outbox SET status = 'failed', error_code = 'outdated', locked_at = NULL
WHERE status IN ('pending', 'sending')
  AND (kind IN ('replies_ready', 'reply_prompt', 'reply_result')
       OR (kind = 'approval' AND dedup_key ~ '^approval:[0-9a-f-]{36}:r[0-9]+$')
       OR (kind = 'weekly_report' AND view -> 'week' ? 'replyDrafts')
       OR (kind = 'urgent' AND view ? 'draftable'));
-- (b) open reply drafts, for a target older than stage 04 only
WITH closed AS (
  UPDATE actions SET status = 'expired', status_reason = 'rollback', locked_at = NULL, next_attempt_at = NULL,
    result_notified_at = now(), updated_at = now()
  WHERE type = 'send' AND payload ->> 'kind' = 'reply' AND status IN ('awaiting_approval', 'approved')
  RETURNING id, org_id, email_id, depends_on_action_id
), drafts AS (
  UPDATE actions d SET status = 'expired', status_reason = 'send_closed', locked_at = NULL, updated_at = now()
  FROM closed c
  WHERE d.id = c.depends_on_action_id AND d.org_id = c.org_id AND d.type = 'create_draft'
    AND d.reverses_action_id IS NULL AND d.status = 'ready'
  RETURNING d.id, d.org_id, d.email_id
)
INSERT INTO audit_log (org_id, email_id, action_id, actor, event, reason_code, data)
SELECT org_id, email_id, id, 'system', 'action.expired', 'rollback', '{"action_type": "send", "reason": "rollback"}'::jsonb
FROM closed
UNION ALL
SELECT org_id, email_id, id, 'system', 'action.expired', 'send_closed', '{"action_type": "create_draft", "reason": "expired"}'::jsonb
FROM drafts;
COMMIT;
SQL
```

The test `apps/server/test/integration/reply-drafts-rollback.test.ts` runs this block as it stands in this file on the development database (it strips `BEGIN` and `COMMIT` to keep its own rollback).

3. Run `deploy/rollback.sh` (§ Roll back a release).
4. What stays: the two tables with their rows, the drafts in the Drafts folder, the sent replies (a send that was `applied` is history), and `llm.call` rows. While the old release runs, its data-request erase does not know the two tables: erase again after the new release is back. A later start ages the instruction and the sample text out by the 90-day rule.
5. The migration by name, for a development database or a restored backup only: `20261117130001_reply_drafts.sql` (one `bun run db:rollback`; it is not the newest migration, so older ones above it must be rolled back first). A broken migration gets a forward fix in a patch release or a restore from backup.

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

## LLM provider budget

A spent budget stops the triage. The provider answers with `http_429_quota`, and the system pauses all LLM calls until the owner adds credit or raises the budget.
A budget alert warns you before this happens. You do this once. The menu names below are not verified (2026-11). The OpenAI console can differ.

1. Open the OpenAI platform and select the project that owns `OPENAI_API_KEY`.
2. Open the limits or billing settings of the project and set a monthly budget. The pilot used $3 per month (`spec/features/done/2026-11/F026-llm-provider-switch/plan.md`, stage 0).
3. Add an e-mail alert below the budget, for example at 80 %.
4. After a quota pause, send `/status` to the bot. With the flag `llm_pause_line` on, the answer holds a line `⏸ LLM paused since … (http_429_quota)`. The next digest shows the same line.
5. Add credit or raise the budget. Then wait for the pause to end (at most 60 minutes) or run `$C restart server`.

Turn the flag on for an organization (see § Customers):

```
$C run --rm cli bun run org:flag --org-id <org id> --flag llm_pause_line --on
```

## 48-hour test procedure

Start time `T0`. Use the test mailbox only.

1. Cron on the VPS, every hour:
   `0 * * * * cd <repo> && docker compose -f deploy/compose.yaml --env-file deploy/db.env run --rm -T cli bun run mailbox:seed --org-id <org> --mailbox-id <test mailbox> >> ~/ea-logs/seed.log 2>&1`
   Run `mkdir -p ~/ea-logs` first.
2. Move back to INBOX (simulates a system move): in webmail, make the folder `EA-test` and move one stored test mail into it.
   Set the row folder:
   `$C exec db psql -U postgres -d email_assistant -c "update emails set folder = 'EA-test' where id = '<id>'"`
   Move the mail back to INBOX. After the next sync, the row has `returned_at` set and no new row exists.
3. Forced rescan at about hour 24:
   `$C run --rm -T cli bun run mailbox:rescan --org-id <org> --mailbox-id <id>`
   The next sync writes a `sync_folder_done` line with `sync_mode=rescan` (in the text form `org_id`, `mailbox_id` and `folder_key` stand between the two words, so search for `sync_mode=rescan`).
4. At the end (48 hours or more), right after a sync:
   `$C run --rm -T cli bun run mailbox:audit --org-id <org> --mailbox-id <id> --since <T0 ISO time>`
   The output must be `missing=0 duplicates=0` with exit code 0.
   After S3, a user move out of INBOX shows as a duplicate; a system move does not.
5. Remove the cron line.

## Backups

`deploy/backup.sh` runs every night. It writes an `age`-encrypted `pg_dump` to `BACKUP_DIR` and copies it to a Backblaze B2 bucket with `rclone`.
The `age` private key never lives on the VPS. The VPS has only the public recipient and a bucket key that can only write.
If somebody steals the VPS, they cannot read or delete old backups.

The dump holds live `auth_sessions` tokens, password hashes and reset tokens. After a real restore, run `delete from auth_sessions;` and ask the members to sign in again.

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
   - `BACKUP_PING_URL` (optional): the Healthchecks.io ping URL of the backup check (see "Status file and ping"). The URL is a secret.
     `deploy/backup.env` is in `.gitignore`.
4. Run one backup by hand: `deploy/backup.sh`. The last line is `backup ok <name> <bytes>`.
   `backup.sh` calls `rclone copyto --no-check-dest`, because the write-only key cannot read the target (HTTP 401). For an `s3` remote, also add `--s3-no-check-bucket`.
   If you put rclone in `~/bin`, run it as `PATH=$HOME/bin:$PATH deploy/backup.sh`.
5. Run `mkdir -p ~/ea-logs`, then add these crontab lines (`crontab -e`). Cron has a small `PATH`, so the first line sets it for `age` and `rclone`:
   `PATH=/home/<user>/bin:/usr/local/bin:/usr/bin:/bin`
   `30 3 * * * cd <repo> && deploy/backup.sh >> ~/ea-logs/backup.log 2>&1`

On any failure, `backup.sh` exits with a non-zero code and leaves no `.dump.age` file.
The copy to B2 runs up to `BACKUP_RCLONE_TRIES` times (default 5) with waits of `BACKUP_RCLONE_DELAY` seconds (default 30), doubled each time. This covers a short DNS or B2 login failure (alert `failed to authorize account … server misbehaving`).
Only one run works at a time: `backup.sh` takes `flock` on `deploy/backup-status/backup.lock`. A second run exits with code 75, prints `another backup run holds …` and leaves the status file as it is.
Check `~/ea-logs/backup.log` for one `backup ok` line each night.

### Status file and ping

- **Status file.** Each run ends by writing `deploy/backup-status/status.json` (one line of JSON, mode 644, written through a `.tmp` file and renamed). A good run writes `{"result":"ok","at":…,"name":…,"bytes":…,"last_ok_at":<same as at>}`. Any non-zero exit after the start, also a bad `deploy/backup.env`, writes `{"result":"failed","at":…,"name":null,"bytes":null,"last_ok_at":<the old value or null>}`. The file is not in git (`.gitignore`); the folder is (`.gitkeep`), so the clone owns it and Docker never creates it as root.
- **Server check.** `docker compose` mounts the folder read-only into `server` as `/run/ea-backup` and sets `BACKUP_STATUS_FILE=/run/ea-backup/status.json`. The job `ops.slo` reads the file every 5 minutes and sends an operator alert `slo_backup_age` when the file is missing or unreadable, the last run failed, or the last good backup is older than `SLO_BACKUP_MAX_AGE_H` hours (default 26). The mount needs one `$C up -d server` after the update that brings it. Dev and sim keep the check off (`BACKUP_STATUS_FILE` empty).
- **Disk check.** The same job alerts `slo_disk` when the volume `SLO_DISK_PATH` (default `/`) has less than `SLO_DISK_FREE_PCT` percent (default 15) or less than `SLO_DISK_FREE_GB` GB (default 2) free. It resolves at 5 points and 0.5 GB above those values.
- **Ping (owner step U2).** In Healthchecks.io make a check "backup" (period 1 day, grace 2 hours) and copy its ping URL into `BACKUP_PING_URL` in `deploy/backup.env` on the VPS. A good run calls the URL; a failed run calls `<url>/fail`. The call uses `curl -m 10 --retry 3`. A failed ping prints `backup ping failed` and never changes the exit code. The script never prints the URL. Leave the value empty to send no ping.

### Restore test (on the Mac, once a month)

1. Get one backup file. Download it in the B2 web UI, or use `rclone` with a read key that lives on the Mac only.
2. Run `deploy/restore-test.sh <file>.dump.age ~/ea-backup-key.txt`.
   The script starts a throwaway `postgres:17` container `ea-restore-test` (no network, no port), restores the dump and prints the row counts of `organizations`, `users`, `mailboxes` and `emails`. It removes the container at the end, also on an error.
3. Compare the counts with the VPS at backup time:
   `$C exec db psql -U postgres -d email_assistant -c "select count(*) from emails"`
4. Write the date and the counts in the task log.

## VPS lost

Use this section when the host is gone and you need a new one. The same restore path runs the twice-a-year drill (§ Drill). Targets: RPO 24 h (the nightly backup), RTO 2 h. Measured drill time (first drill, 2026-11-19, tag `v0.3.1`, backup `ea-20261119T182245Z.dump.age`, 675190 bytes): `deploy/backup.sh` 10.7 s; `restore.sh` 173 s (`restore ok target=drill seconds=173`); wall time of the drill 548 s (9 min), which includes two failed starts (see below) and one re-clone; a clean run is about 4 min. Counts before, drill and after: `organizations=2 users=2 mailboxes=1 emails=313`. Rollback time (Part A step 6): not measured; no timing was written down. The drill is far under the RTO of 2 h. The drill checked out `v0.3.1`, not `v0.1.0`: `restore.sh` of `v0.1.0` calls `credentials:check`, and that script exists only from `v0.2.0` (the run stopped at step `credentials`). Fault of the first drill, now fixed: on a fresh volume `restore.sh` stopped at `guard-empty` with `the database system is shutting down`, because the `db` health check passes while the image init server still runs. The script now waits (step `db-ready`) until the database answers on TCP, which only the final server does; the first run works. Second drill (2026-11-20, tag `v0.4.4`, backup `ea-20261120T212649Z.dump.age`, 717634 bytes): first run, `db ready probes=2` (the wait saw the init server), `restore.sh` 108 s (`restore ok target=drill seconds=108`), about 3 min from the backup to the cleanup with a cached image build; counts before, drill and after `organizations=2 users=2 mailboxes=1 emails=325`.

What you need before you start: the age identity (`~/ea-backup-key.txt`) on your own machine, a password manager that holds the `.env` keys, and a read key for the B2 bucket on your own machine.

### New host

1. Install on the new Ubuntu host: Docker with the Compose plugin, git and Tailscale. Join the tailnet as in § Web panel, Tailscale (once).
2. Clone the repo and go into it. Check out the tag that ran last (`git tag --sort=-v:refname | head -n 1`).
3. Make `.env` and `deploy/db.env` as in § First install step 2 (it also deletes the database lines from the copied `.env`). Take these keys from the password manager. Never type a value into a chat or a ticket:
   - `CREDENTIALS_KEY` and `CREDENTIALS_KEY_VERSION`: the old values. A new key cannot open the stored mailbox passwords.
   - `TELEGRAM_BOT_TOKEN`, `OPERATOR_TELEGRAM_CHAT_ID`, `HEARTBEAT_URL`.
   - The LLM keys and the web keys (`WEB_BASE_URL`, `WEB_AUTH_SECRET` and the others of § Turn it on).
   - `POSTGRES_PASSWORD`, `MIGRATOR_PASSWORD`, `APP_PASSWORD`: new values, in `deploy/db.env`, not in `.env`. Make each with `openssl rand -hex 24`. The restore makes the roles with them.
4. Get the latest backup file from B2 on your own machine, with the read key (the VPS key cannot read).
5. Restore. The plain dump goes through the pipe and never touches a disk. On your own machine:
   `age -d -i ~/ea-backup-key.txt <file>.dump.age | ssh <host> 'cd <repo> && deploy/restore.sh --target new-host --stdin'`
6. The script starts the database and waits until it answers on TCP (up to 60 probes, 1 s apart; failure: exit 1 at step `db-ready`), refuses a database that has tables (exit 2), builds the image once, restores the dump, clears `auth_sessions`, migrates and then runs `bun run credentials:check`.
   - The check prints one line, `credentials ok=<n> failed=<m>`, with counts only. With `failed` above 0, the script stops with exit 1 and the server stays down: `CREDENTIALS_KEY` or `CREDENTIALS_KEY_VERSION` in `.env` is not the one that sealed the stored secrets. Fix the key, empty the database (`$C down -v`; this is for the new host only, never for the live host), and run step 5 again.
   - The last line is `restore ok target=new-host seconds=<n>`. Write down the seconds.
7. Replay the deletes. A restore brings back deleted organizations and erased data. Run again each `deleted <org id>` line of `org:delete` and each `record: dsr erase` line of `org:dsr` from your own notes (§ Restore (D20) of Account data).
8. Set up the rest, each in its own section: `deploy/backup.env` and the cron line (§ Backups, VPS setup); Tailscale Serve (§ Web panel, Turn it on, steps 5 and 6); the two Healthchecks.io checks, the heartbeat (§ Heartbeat) and the backup ping (§ Backups, Status file and ping).
9. Run the first release so the release state exists: `deploy/release.sh <tag>` (§ Release). Ask the members to sign in again.

### Drill

Run it twice a year, on the VPS, in the separate project `ea-drill` (own volume, own network `172.29.0.0/24`, no host port, image `ea-drill-server`). The drill never touches the live database, the live volumes or a real mailbox. It sends nothing: no Telegram, no heartbeat, no web, no LLM call, no mail. Never use a Compose profile with the drill files. Follow the steps below:

1. Write down the ids and start times of the live `db` and `server` containers, and the live row counts before and after a fresh `deploy/backup.sh`.
2. In a fresh clone at the tag: `deploy/restore.sh --target drill --init-env <live repo>/.env`. It copies only the credentials keys from the live file and makes new database passwords.
3. On your own machine: `age -d -i ~/ea-backup-key.txt <file>.dump.age | ssh <host> 'cd <clone> && deploy/restore.sh --target drill --stdin'`. The last line is `restore ok target=drill seconds=<n>`. The `credentials ok=<n> failed=0` line comes before it.
4. Each drill count lies between the live count before and after the backup. The live container ids and start times did not change.
5. Remove it: `deploy/restore.sh --target drill --down` (removes the project, its volume and its image `ea-drill-server`, never `postgres:17`), then delete the clone.

## Sim stack (`ea-sim`)

The sim stack is a second Compose project on the VPS: its own database, GreenMail, a fake Telegram, the server and the lab (ADR 0021, `docs/capabilities/live-lab.md`). It plays the frozen mail week `lab-01` in real time. It sends no mail and no tap to a real person. It shares nothing with the production stack: other project, network (`172.31.0.0/24`), volumes and ports.

The VPS runs Docker only. These commands need no `bun` on the host. In the commands below, `S` and `L` mean:

```sh
S="docker compose -p ea-sim -f deploy/compose.sim.yaml --env-file deploy/sim.env"
L="$S exec -T lab bun run lab"
```

`$S` is the line of `bun run sim:up`, `sim:down` and `sim:ps` (`package.json`) without the last word. Never run `$S config`: it prints the values of `deploy/sim.env`.

### Rules

- **Every deploy of the sim stack is a release.** The sim images are built from the checkout of a release tag, never from a bare commit or a branch. Production has the same rule (§ Release, `docs/release-checklist.md`). The release tag goes into the sim base image (`EA_RELEASE`), so a sim log line names the release.
- **Never set `SEND_SCOPE=all` or a real bot token in `deploy/sim.env`.** The lab refuses to start (`lab:env-check`, `docs/capabilities/live-lab.md` rule 1).
- **Never point the sim at the production `.env`.** Only the LLM key lines go from `.env` to `deploy/sim.env`, and they are never printed.
- **Never `restart` or recreate `fake-telegram` during a run.** See "Restart order".

### Runbook

1. **Release.** The sim files (`deploy/compose.sim.yaml`, `deploy/Dockerfile.sim`, `deploy/sim.env.example`) and the sim code ship in a release (`docs/release-checklist.md` step 4).
   - If a sim file or the lab code changed since the last release, make a new release first: steps 1 to 9 of `docs/release-checklist.md`, then `deploy/release.sh v<x.y.z>` (§ Release). It runs the backup (step 3), checks the disk and leaves the checkout at the tag.
   - If nothing changed, check that the checkout is at the running release: `git describe --tags --exact-match` must print the tag in the line `current=` of `deploy/release-state/state`. If it does not, run `git checkout --detach <tag>` for that tag, or make a release.
   - Set the tag once: `T=$(git describe --tags --exact-match)`.
2. **Disk.** `df -h /`. Under 5 GB free: stop and tell the owner (owner rule 2026-11-15; the owner grows the root volume, PD-055). Check again after the build.
3. **Backup first.** If step 1 ran `deploy/release.sh`, the backup is done (its last stdout line is `backup ok ...`). Else run `deploy/backup.sh` now. The sim stack never touches production rows, but the backup is the rollback point.
4. **Build.** At the release tag:
   ```sh
   docker build -f deploy/Dockerfile --build-arg EA_RELEASE="$T" -t "ea-sim-base:$T" .
   ```
   The tag `ea-sim-base:<tag>` is for the sim only. Never retag `ea-server`: the release scripts own it. After the env file exists (step 5), `$S build` builds the sim image `ea-sim-server` on top of that base.
5. **Env.** Make the file and lock it first, then fill it. Each command writes the value into the file and prints nothing:
   ```sh
   cp deploy/sim.env.example deploy/sim.env && chmod 600 deploy/sim.env
   for key in CREDENTIALS_KEY WEB_AUTH_SECRET; do sed -i "s|^$key=.*|$key=$(openssl rand -base64 32)|" deploy/sim.env; done
   for key in POSTGRES_PASSWORD MIGRATOR_PASSWORD APP_PASSWORD; do sed -i "s|^$key=.*|$key=$(openssl rand -hex 24)|" deploy/sim.env; done
   sed -i "s|^EA_SERVER_IMAGE=.*|EA_SERVER_IMAGE=ea-sim-base:$T|" deploy/sim.env
   sed -i "s|<host>|email-assistant.<tailnet>.ts.net|" deploy/sim.env
   sed -i -E '/^(OPENAI_|GEMINI_|DEEPSEEK_|LLM_PROVIDER=)/d' deploy/sim.env
   grep -E '^(OPENAI_|GEMINI_|DEEPSEEK_|LLM_PROVIDER=)' .env >> deploy/sim.env
   ```
   Replace `<tailnet>` with the name of your tailnet. The last two lines copy the LLM provider and key lines of `.env` (the sim uses the same provider and tiers as production, ADR 0021 point 5; `DEEPSEEK_API_KEY` is there for a lab run on DeepSeek, which only the sim stack allows with `TRIAGE_LLM_SCOPE=all`). Do not print `.env` or `deploy/sim.env`. Keep a copy of `CREDENTIALS_KEY` in the password manager only if you keep the sim data. Do not change `LAB_STACK`, `TELEGRAM_*`, `SEND_*`, `*_SCOPE`, `HEARTBEAT_URL`, `OPERATOR_*` or `AUTH_SMTP_*`: the guard checks them.
6. **Start and migrate.**
   ```sh
   $S build
   $S up -d --wait
   $S exec -T server bun run db:migrate
   $S restart server
   ```
   `$S up -d --wait` is `bun run sim:up` (the build step comes first because `up` builds only a missing image). Every container command starts with `bun run lab:env-check`: a wrong `deploy/sim.env` stops the container before it polls Telegram or sends mail, and `$S ps` shows it. The restart lets the server jobs start on the migrated schema. Check: `$S ps` shows `db`, `greenmail`, `fake-telegram`, `server` and `lab` running, and `$S logs --no-log-prefix --since 5m server` shows `server_listening`.
7. **Panel.** The panel is on `127.0.0.1:8180` (ADR 0017: tailnet only):
   ```sh
   sudo tailscale serve --bg --https=8443 http://127.0.0.1:8180
   tailscale serve status
   ```
   `WEB_BASE_URL` in `deploy/sim.env` must be `https://<machine>.<tailnet>.ts.net:8443`. The sim has no auth mail (`AUTH_SMTP_*` stays empty). A sign-in link for the owner, after step 8 made the org: `$S exec -T server bun run web:invite --org-id <org id> --print`. The link is a secret: use it once and never paste it into a ticket or a chat.
8. **Seed.** `$L seed` makes the lab organization, its mailbox, delegates, rules, flags and the Telegram link. It prints the org id. The command is safe to run again (it adds only what is missing). `$L seed --org demo` makes the demo organization.
9. **Checks** (record each result in the ticket log). Run them once on a new host, and after a release that changed the sim files.
   - **N1, no outbound mail.** Send a mail from GreenMail to an outside address, then read it back from GreenMail itself:
     ```sh
     $S exec -T lab bun -e 'import nodemailer from "nodemailer"; import { ImapFlow } from "imapflow"; const to = `probe-${Date.now()}@example.com`; const t = nodemailer.createTransport({ host: "127.0.0.1", port: 3025, secure: false, ignoreTLS: true }); console.log((await t.sendMail({ from: "oliver.pemberton@kordelan.test", to, subject: "n1", text: "n1" })).response); const c = new ImapFlow({ host: "127.0.0.1", port: 3143, secure: false, auth: { user: to, pass: "x" }, logger: false }); await c.connect(); console.log("inbox", (await c.status("INBOX", { messages: true })).messages); await c.logout();'
     ```
     Expected: `250 OK` and `inbox 1`: GreenMail stored the mail for its own user. Then look at the sockets of the shared network namespace from the host: `PID=$(docker inspect -f '{{.State.Pid}}' "$($S ps -q fake-telegram)")` and `sudo nsenter -t "$PID" -n ss -tn`. Every peer must be `127.0.0.1` or the `db` address (`172.31.0.x:5432`); no peer on port 25, 465 or 587. `ss` shows live sockets only, so the stored mail is the main proof.
   - **N2, restart of `server`.** `$S restart server`, wait for `$S ps` to show it healthy, then send `/help` as the owner and count the chat messages. The count must grow by at least 2 (your message and the answer of the server): this proves polling and the database:
     ```sh
     $S exec -T lab bun -e 'const u = "http://127.0.0.1:8090/_fake/"; const n = async () => { const r = await fetch(`${u}chats/5550001`); return r.ok ? (await r.json()).messages.length : 0; }; const a = await n(); await fetch(`${u}send`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chatId: 5550001, text: "/help" }) }); await Bun.sleep(8000); console.log(a, "->", await n());'
     ```
   - **N2, restart of `fake-telegram`.** Do this before any run, never during one. `greenmail`, `server` and `lab` share its network namespace and keep the old one: they lose the database, GreenMail and Telegram. `$S restart fake-telegram`, then `$S ps` and `$S logs --no-log-prefix --since 2m server`. If `server` and `lab` do not recover, run `$S up -d --force-recreate greenmail server lab`. GreenMail keeps its mail in memory: a recreate empties it. After it, run `$L seed` again.
   - **N4, disk.** `df -h /` after the build (step 2).
   - **Tailnet.** From your own device, open `https://<machine>.<tailnet>.ts.net:8443`. The sign-in page must load.
10. **Run.**
    - A live day (the routine smoke test, cost cap $1): `$L start --mode day`. The default date is tomorrow in Warsaw. `--date YYYY-MM-DD` picks another day.
    - A live week (cost cap $5): `$L start --mode week --date <a Monday>`. The week needs seven days and a four-day tail.
    - Every measured run after the first needs a fresh organization: stop the run (`$L stop --run <id>`), wait 60 s for the loop to end its tick, then `$L reset --org lab` (it prints what it would delete and exits 1), then `$L reset --org lab --yes`.
    - Each day: `$L status`. Each line shows the counts, the spend and the stop reason. The serve loop (`lab` service) does the work: it injects the mail, plays the delegates and taps as the executive. A run stops itself at its cap or at the end of its tail.
    - The month cap is $20 for all runs on this machine. The ledger is `eval-spend.jsonl` in the state volume.
11. **Score.** After the tail:
    ```sh
    $L score --run <id> --out /var/lib/ea-lab/results
    $S cp lab:/var/lib/ea-lab/results/. /tmp/ea-lab-results/
    ```
    Copy `/tmp/ea-lab-results/sim-*.md` and the `.json` files to a normal checkout of the repo (`scp`) into `evals/results/`, and commit them there with explicit paths. The VPS checkout is detached at a release tag: do not commit on it. The reports hold ids, counts and rates only (no mail text, no address).
12. **Demo.** `$L demo-reset` shows what it would delete; `$L demo-reset --yes` rebuilds the demo organization and starts its week run (shadow on days 1 to 3, assist from day 4; cost cap $5). The run counts in the month cap.
    - After day 1 ended, make a trial export to find a `non_test_address` refusal early: `$L demo-export --day 1 --out /var/lib/ea-lab/trial.json`. The check refuses a bare `@` in any text (it fails safe and prints no value). Delete the file afterwards: `$S exec -T lab rm /var/lib/ea-lab/trial.json`.
    - After day 4: `$L demo-export --day 4 --out /var/lib/ea-lab/demo-day4.json`, then `$S cp lab:/var/lib/ea-lab/demo-day4.json /tmp/demo-day4.json`.
    - Copy the file to the owner's PC. There, with the dev database: `LAB_STATE_DIR=$(mktemp -d) bun run lab demo-import --file <file> --email <owner email>`. `LAB_STATE_DIR` must be an absolute path of an empty scratch folder. `SEND_SCOPE` must not be `all`. The import makes the new organization "Kordelan demo (import)". Add `--replace` to load a newer file over an earlier import.
13. **Restart order.** `fake-telegram` first, then `greenmail`, `server` and `lab`: they share its network namespace. A fake restart loses the chats and the cards of the executive: run `$L seed` after it, so the fake knows each linked chat again. The scorer counts the approvals that expired with no tap. A GreenMail recreate loses all mail: stop the run and reset the organization.
14. **Stop and roll back.**
    - Stop: `$S down` (`bun run sim:down`). The volumes stay (`ea-sim_db-data`, `ea-sim_lab-state`).
    - Roll back the whole stack: `$S down`, then `docker volume rm ea-sim_db-data ea-sim_lab-state`. Production is not affected by either.
    - Roll back to an earlier release: put the old tag in `EA_SERVER_IMAGE` of `deploy/sim.env`, then `$S build` and `$S up -d --force-recreate fake-telegram greenmail server lab` (the earlier base image must still exist: `docker image ls ea-sim-base`). Keep the base images of the last two releases and remove older ones with `docker rmi ea-sim-base:<tag>`. `deploy/rollback.sh` does not touch the sim stack.
