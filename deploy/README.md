# Pilot host runbook

Install, update and test the pilot on the home VPS. Docker only.
All commands run in the repo root.
Run the commands in bash (the default VPS shell).
`C` below means:

```sh
C="docker compose -f deploy/compose.yaml --env-file .env"
```

The server listens on `127.0.0.1:8080` on the host only (for Tailscale Serve, section Web panel). The `db` service has no host port.

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
   - `HEARTBEAT_URL` (see Heartbeat), `TEST_MAILBOX_ADDRESS` (only for the `testmail` and probe tools), `LOG_LEVEL=info`.
   - `SEND_SCOPE=off` (default) and `SEND_TEST_ADDRESSES` (comma-separated, needed with `SEND_SCOPE=self`). See the section "Approvals and sends".
   - `TRIAGE_LLM_SCOPE`, `ACTIONS_SCOPE` and `SEND_SCOPE` stay `off` until you decide. `all` acts on every active mailbox of the server: read "Customers (S6a)" first.
   - `OPERATOR_CONTACT` and `OPERATOR_TELEGRAM_CHAT_ID` (optional, see "Customers (S6a)").
   - Compose sets `DATABASE_URL`, `MIGRATOR_DATABASE_URL` and `PORT` by itself. Their values in `.env` do not count for `server`.
   - Web panel keys: see the section Web panel. Leave `WEB_BASE_URL` empty to keep the web off, and empty the dev value of `WEB_TRUSTED_ORIGINS` that `cp .env.example .env` copied.
4. Start the database: `$C up -d --wait db`
5. Build the image and migrate: `$C run --build --rm server bun run db:migrate`
6. Create the organisation:
   `$C run --rm server bun run org:create --org-name <name> --email <email> --display-name <name> --plan active`
7. Connect the mailbox. The password goes on stdin. Use `-T`, because the command has no terminal on stdin:
   `read -rsp 'IMAP password: ' P && printf '%s' "$P" | $C run --rm -T server bun run mailbox:connect --org-id <uuid> --address <email>; unset P`
8. Start the server: `$C up -d --build --wait`

## Update

1. Make a backup first: `deploy/backup.sh` (`PATH=$HOME/bin:$PATH deploy/backup.sh` if rclone is in `~/bin`, see Backups). The last line is `backup ok <name> <bytes>`.
2. Check the disk: `df -h /`. Stop if less than 3 GB is free. Run `docker builder prune -f` first, then check again.
3. Update and start:

```sh
git fetch && git merge --ff-only origin/master
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
   Do not set `TELEGRAM_API_ROOT` on the VPS.
2. Check the token: `$C run --rm server bun run telegram:check`. The output is `bot @Email_assistant_vps_bot (id …)`.
3. Restart the server so that it reads the new `.env`: `$C up -d server`. The log shows `telegram: polling as @Email_assistant_vps_bot`.
4. Make a link for a member: `$C run --rm server bun run telegram:link --org-id <uuid> [--user-id <uuid>]`.
   The output is a `https://t.me/<bot>?start=<token>` link. It is a one-time secret that is valid for 15 minutes. Open it on the phone of the member. Do not share it. A used or expired link needs a new `telegram:link` run.
5. Set the digest times if needed: `$C run --rm server bun run digest:times --org-id <uuid> --times 08:00,16:00` (`--times none` switches the digests off). New members get `08:00,16:00` by default.
6. Remove a link: `$C run --rm server bun run telegram:unlink --org-id <uuid> --user-id <uuid>`.

A `409` in the log (`another process polls this bot token`) means that a second process uses the same token, for example the Mac with the pilot token. Stop the other process. The server tries again after 1, 2, 4 … at most 30 minutes. A `401` means that the token is wrong or revoked: fix `.env`, then run `$C up -d server`.

For a mailbox in `auth_error` the owner gets a Telegram notice. Fix it as in the section "Login error (`auth_error`)". Alert texts and fixes: `docs/known-alerts.md`.

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
2. Make a copy of `.env` first: `cp -p .env .env.bak-s5e`. The copy holds every secret. Delete it when the panel works: `rm .env.bak-s5e`.
   Then set these keys in `.env`:
   - `WEB_BASE_URL`: `https://<machine>.<tailnet>.ts.net` (no path, no trailing slash).
   - `WEB_AUTH_SECRET`: make it with `openssl rand -base64 32`. Never print it.
   - `WEB_TRUSTED_PROXIES`: `172.30.0.1` (the gateway from step 1).
   - Leave `WEB_TRUSTED_ORIGINS`, `WEB_MAIL_ALLOW_LOCAL` and `WEB_DIST` empty.
3. Do the section Update. The migrations of S5 run there.
4. Check the log for the start line `web is on: https://…, dist /app/apps/web/dist`: `$C logs server | grep 'web'`
   The output must show no other line with `web:` or `WEB_BASE_URL is http://`.
5. Start Tailscale Serve (you, sudo): `sudo tailscale serve --bg 8080`
6. Check Serve: `tailscale serve status`

The gateway does not change after `docker compose down` or a Docker upgrade, because the subnet is pinned.

#### Move a running stack to the pinned subnet (once)

A stack that started before the pin has another subnet (`172.18.0.0/16` on the VPS). The change recreates the network and the `db` container. It stops the stack for a short time.

1. Do it outside a pilot week and ask the owner first.
2. Check that `172.30.0.0/24` is free on the host: `docker network ls`, `ip -4 route`. Choose another range in `deploy/compose.yaml` if it clashes.
3. Make a backup of the database: `deploy/backup.sh` (section Backups). Make a copy of `.env`: `cp -p .env .env.bak-f069`.
4. Pull the new compose file. Set `WEB_TRUSTED_PROXIES=172.30.0.1` in `.env`.
5. `$C down && $C up -d --wait`
6. Check: `docker network inspect email-assistant_default --format '{{(index .IPAM.Config 0).Gateway}}'` prints `172.30.0.1`. After the first sign-in, `auth_sessions.ip_address` is a tailnet address.
7. Rollback: restore the old compose file and set `WEB_TRUSTED_PROXIES` to the old gateway (from `.env.bak-f069`). Run `$C down && $C up -d --wait`. Delete `.env.bak-f069` when the move works.

### Give a member a password

1. Make the link: `$C exec server bun run web:invite --org-id <uuid> [--user-id <uuid>]`
2. Open the link on a device in the tailnet. The link works once and for 24 hours.
3. Set a password of 12 to 128 characters.

The login e-mail is the address that you gave to `org:create` (`users.email`), not any other address of the person. A wrong e-mail shows only "Wrong e-mail or password." The log says `better-auth: User not found`.

The same command makes a reset link later. The link is a secret. Do not paste it into a chat with an agent or into a log.

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
| `web is off` in the log                                                     | `WEB_BASE_URL` is empty                                                  | Set `WEB_BASE_URL` in `.env`. Run `$C up -d --wait server`.                                                     |
| `web: dist folder missing` in the log                                       | The image has no web build                                               | Rebuild: `$C up -d --build --wait`.                                                                             |
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

Before an Update, write down the current commit: `git rev-parse HEAD`.

1. Go to the previous commit: `git checkout <previous commit>`
2. Rebuild and start: `$C up -d --build --wait`
3. Stop Serve (you, sudo): `sudo tailscale serve reset`
4. To return later: `git checkout master`

Restore the copy `.env.bak-s5e` only if the edit of `.env` broke another key.

## Assist mode

Change the mode, the `auto` flags and the switches of a mailbox with `mailbox:settings`. Every change is locked and audited. The command prints the settings table with `before -> after` for the changed field.

```sh
$C run --rm server bun run mailbox:settings show --org-id <uuid> --mailbox-id <uuid>
$C run --rm server bun run mailbox:settings mode --org-id <uuid> --mailbox-id <uuid> --mode assist
$C run --rm server bun run mailbox:settings auto --org-id <uuid> --mailbox-id <uuid> --category info --value on
```

- `mode --mode assist` sets the switches `move`, `mark_read` and `flag` on. Add `--keep-switches` to keep the old values. Without it, `mode --mode assist` also expires the `ready` rows of each switch it turns off.
- `auto --value on` needs a go/no-go `go` for the category on real labeled mail (bar 0.98, at least 30 kept). If the gate says no-go, the command exits with code 2. `--force` sets `auto` on anyway and records `forced` in the audit log.
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
- `mailbox:audit` compares INBOX and each enabled synced folder with the rows whose `folder` is that folder (ADR 0014). It prints one line per folder. `cross=<n>` counts a mail that sits in INBOX and in a synced folder: it is no problem. Mail that the system moved is not counted. A user move out of a folder shows as a duplicate.

### Synced folders (ADR 0014)

The sync reads INBOX and, at Interia, `Oferty`, `Społeczności`, `Rachunki` and the spam folder `Wiadomości-śmieci`. The server inserts a row for each of them in `mailbox_folders` when the server lists the exact name.

- Show the folders: `$C run --rm server bun run mailbox:settings show --org-id <uuid> --mailbox-id <uuid>`.
- Off switch per folder: `$C run --rm server bun run mailbox:settings sync-folder --org-id <uuid> --mailbox-id <uuid> --key offers|social|bills|junk --value on|off`. INBOX has no switch. `--value on` again clears the cursor: the next sync takes the last 24 hours of that folder.
- `mailbox:rescan` forces a rescan of every synced folder. `mailbox:backfill` reads INBOX only.
- A spam folder mail that the classifier finds valid gets a move into INBOX under the normal move gate (the category `auto` ON). With `auto` OFF, the digest says "would move to INBOX".
- A final failure of a move by APPEND (the rescue, or an Undo into `Oferty`, `Społeczności`, `Rachunki`) can leave the mail in both folders. The `action_failed` notice tells you. Delete the extra copy by hand.
- Roll back the code, not the migration (steps (a) and (b) are in `spec/features/done/2026-11/F058-sync-sort-folders/stages/stage-16-merge-and-vps-deploy.md`, "Rollback"): the migration `sync_folders` only adds (a table, `emails.source_folder`, an index). A `db:rollback` after live use loses the cursors of the non-INBOX folders and the source folder of non-INBOX mail. The INBOX cursor stays in `mailboxes` (dual write), so the old code runs on the new schema. After a code rollback, a `ready` move into INBOX ends as `bad_payload`, and an Undo of `Oferty` mail goes to INBOX (ADR 0014, D24 (d)).
  - (a) Before you switch the checkout, switch the four folders off: `$C run --rm server bun run mailbox:settings sync-folder --org-id <uuid> --mailbox-id <uuid> --key offers|social|bills|junk --value off` (once for each key). Then wait until this query gives 0: `select count(*) from emails where mailbox_id = '<uuid>' and source_folder <> 'INBOX' and status in ('pending', 'processing');` (run it as `postgres` through `$C exec -T db psql -U postgres -d email_assistant -c "…"`). Else the old code triages spam folder mail as INBOX mail.
  - (b) Roll forward: before the new code starts, copy the INBOX cursor that the old code wrote: `update mailbox_folders f set uidvalidity = m.uidvalidity, last_uid = m.last_uid, updated_at = now() from mailboxes m where f.mailbox_id = m.id and f.key = 'inbox';`. A mailbox that the old code connected has no INBOX row: first `insert into mailbox_folders (org_id, mailbox_id, key, path, role, enabled, uidvalidity, last_uid) select org_id, id, 'inbox', 'INBOX', 'inbox', true, uidvalidity, last_uid from mailboxes on conflict do nothing;`. Then switch the four folders on with `sync-folder … --value on`. The cursor is cleared, so the next sync takes the last 24 hours of each folder; the dedup key stops duplicates.

### Notice `action_failed`

The owners get one notice for each failed action. An action fails after 3 hard errors, or at once for an unknown folder. The notice names the action, the subject and where the mail is.

1. Read the log: `$C logs --since 1h server | grep 'action '`. The line `action <id>: failed hard_error` has the reason. Alert texts: `docs/known-alerts.md`.
2. Open `/status` in Telegram. Check that the mailbox is `active`.
3. A failed move leaves the mail in INBOX. A failed Undo (reverse) leaves the mail in its `AI/…` folder. Move the mail by hand in the mail client.
4. The notice names the default `AI/…` folder name. It does not name the real path of `folder_map`.
5. If a reverse move ends `failed`, a stopped COPY can leave a copy in INBOX that the system does not store (no row, no triage). Delete the extra copy by hand.

### Known effects

- Lock order is one order on every path (undo, returned job, committer): the original move row first, then `emails`. No deadlock cycle exists.

### Roll back

Roll back the code, not the migration. A `db:rollback` of `20261107000001_assist_actions` after live use drops `actions.applied_at`. A later migrate then fails on `actions_applied_at_check` for the `applied` and `undone` rows.

## Delegates

A delegate is a person who gets tasks by mail. Manage delegates and delegations from the terminal. Each command needs `--org-id <uuid>`.

- `bun run delegates:add --org-id <uuid> --name <text> --email <address> [--tags a,b,c]`: add a delegate. Output: `added <id>`, `already there`, or `refused: …` (exit 2).
- `bun run delegates:list --org-id <uuid> [--all]`: list active delegates. `--all` also shows disabled ones.
- `bun run delegates:disable --org-id <uuid> --id <uuid>` and `delegates:enable`: switch a delegate off or on.
- `bun run delegations:list --org-id <uuid> [--status drafted|sent|answered|overdue|done|cancelled] [--limit 50]`: list delegations.
- `bun run delegations:done --org-id <uuid> --id <uuid>`: close an answered or overdue delegation. Its pending reminders expire.

Rule: a delegate address is never a mailbox address of the organization. `delegates:add` refuses it (exit 2).
The audit rows have the actor `cli`.

On the VPS run each command as `$C run --rm server bun run …`. A mail can be delegated only to an active delegate: with no active delegate the classifier does not use the category `delegation`.
A disabled delegate gets no new delegation and no reminder; a send that is already waiting for a tap still shows the name with `(inactive)`.
Close a delegation by hand with `delegations:done` or with the ✅ Done button of the "answered" notice.

## Approvals and sends

State of this section: written from the code of the S4 task. The dev run (stage 19) and the VPS runs (stage 22: self-send, stage 23: the first real delegation) are not done. Only the Interia probe of stage 1 sent a real mail.

How a delegation goes (details: `docs/architecture.md` §4.5):

1. The triage worker plans a draft and a send. The committer puts the draft in the Drafts folder (it needs `ACTIONS_SCOPE` other than `off`, the mailbox mode `assist` and the switch `create_draft` on).
2. The owner gets a Telegram message with the full draft, the recipient and the original sender, and the buttons 📤 Send and ✖️ Reject. Only an owner can tap them.
3. After the tap, the committer sends the mail by SMTP, but only if `SEND_SCOPE` allows it. Then it copies the mail to `Wysłane` and removes the draft.
4. The owner gets a new message with the result.

### `SEND_SCOPE`

`SEND_SCOPE` and `SEND_TEST_ADDRESSES` are in the VPS `.env`. Only the user edits `.env`. Restart the server after a change: `$C up -d server`.

- `off` (default): no mail goes out. A tap still works, and the approved send waits. `/status` says `approved, held by SEND_SCOPE=off`. It expires 48 hours after the tap (`held_timeout`).
- `self`: a mail goes out only when every recipient is in `SEND_TEST_ADDRESSES` (your own addresses, comma-separated). The server refuses to start with `self` and no valid list.
- `all`: every approved send of every active mailbox of an organization that is not `suspended` goes out: delegations and reminders to real delegates, and also clarification questions to the original sender of a mail. Each mail still needs the owner's tap.

### Result notices

Each notice says what happened. The left part is the start of the text.

- `✅ Sent to …`: the mail went out. "No copy in Sent" means the copy to `Wysłane` failed; the mail was sent anyway. "The draft stays in Drafts" means the server has no UIDPLUS: delete the draft by hand.
- `❌ Not sent … The mail server refused it` (`smtp_rejected`): the server refused the address or the mail (a 5xx reply). No button. Fix the address (`delegates:disable`, then `delegates:add` with the right address). The draft stays in Drafts. The system does not plan this mail again.
- `❌ Not sent … The send failed 3 times` (`smtp_error`): the connection or the login failed three times. Check `/status` and the mailbox (`mailbox:check`), fix it, then tap 📤 Send again.
- `❌ Not sent … refused the content for now`: the server gave a 4xx reply after the content. The system never retries after the content. Look in `Wysłane` and ask the recipient first, then tap 📤 Send again if the mail did not go out.
- `⚠️ Unknown whether the mail … went out` (`outcome_unknown`): the connection broke after the content, or the server stopped during the send. Check `Wysłane` and ask the recipient. Tap 📤 Send again only if the mail did not go out. If the mail did go out, tap ✅ It went out (owners only): the delegation becomes `sent` with the stored message id, no mail is sent again, and a reply of the delegate is matched. Without this tap the delegation stays `cancelled` and a later reply is not matched. The button shows only for a delegation send, and it does nothing after a resend.
- `⌛ Not sent: the approval expired (48 h)` (`expired`, `timeout`): nobody tapped within 48 hours. The draft was removed (or the notice says it stays).
- `⌛ Not sent: it waited 48 h after your approval` (`held_timeout`): a held approval. Read the scope: `SEND_SCOPE`, a paused mailbox (`/resume`) or a login error (`mailbox:password`). The system does not plan it again; send the task by hand from the draft, which stays in Drafts.
- `⌛ Not sent: no approval request could go out within 7 days` (`not_notified`): no owner was linked, or the draft was not created. Link an owner with `telegram:link`.
- `❌ Not sent: the draft could not be created` (`draft_missing`): the draft failed three times. Read `docs/known-alerts.md` (`action <id>: failed hard_error`).
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
$C run --rm server bun run job:run --name actions.expiry
$C run --rm server bun run job:run --name delegation.chaser [--force]
$C run --rm server bun run job:run --name channels.notifier
$C run --rm server bun run job:run --name platform.retention
```

`channels.notifier` needs `TELEGRAM_BOT_TOKEN`. `platform.retention` clears the old texts of every organization (the server runs it daily at 02:40); the log line `retention org <id>: …` holds counts only. Do not run `--name actions.committer` while the server runs on the same database: the log lines double.

### What the system never does

- It never sends a mail without your tap on 📤 Send (or 📤 Send again, 📤 Send all).
- It never sends outside `SEND_SCOPE`.
- It never sends the same mail again after the content went to the server. After a crash or an unknown result, it looks in `Wysłane`; it does not send.
- It never takes a recipient from mail or LLM text: only from the delegates list, or the sender address of the mail for a clarification question.
- It never sends a draft that you edited in the mail client. Do not send the draft yourself: the system sends the stored text and removes the draft.
- It removes only drafts that it made, found by its header `X-EA-Action-Id`.

### Roll back

Roll back the code, not the migration. A `db:rollback` of `20261108000001_delegation` deletes all `create_draft` and `send` rows, all delegations and all delegates.

## Customers (S6a)

Each customer is one organization with a plan. The operator manages the plan with the commands below. The output holds ids, codes, dates and counts only, never a name or an address.

```sh
$C run --rm server bun run org:create --org-name <name> --email <email> --display-name <name> --plan trial --trial-days 30
$C run --rm server bun run org:plan --org-id <org id> --plan suspended
$C run --rm server bun run org:plan --org-id <org id> --plan active
$C run --rm server bun run org:plan --org-id <org id> --plan trial --trial-days 14
$C run --rm server bun run org:plan --org-id <org id> --max-mailboxes 5
$C run --rm server bun run org:status [--org-id <org id>]
```

- `org:create --plan trial|active`: the default is `trial` with `--trial-days 30` (1 to 365). The database default of an organization that exists already is `active`.
- `org:plan` changes the plan, the trial end or the mailbox limit (0 to 100) and writes an audit row. Moving a `trial` organization to `active` or `suspended` clears the trial end. Moving to `trial` from another plan needs `--trial-days`.
- `org:status` prints, for each organization: the plan, the trial end, `max_mailboxes`, `resumed_at`, the mailbox counts by status, the last sync, the LLM calls of today and the number of linked Telegram chats.
- `suspended` pauses the customer: no sync, no triage, no action, no send, no reminder, no digest and no notice. Telegram taps and commands answer "account paused". Every write in the web panel answers `403 org_suspended`. The member can still read, sign out and change the password. The approval expiry and the retention job still run. The change to `suspended` cancels the queued messages, except approval requests.
- `mailbox:backfill` refuses a `suspended` organization: exit 1, a message with the org id and `org_suspended`, before any IMAP call and with no row changed. Resume the organization first. `mailbox:rescan` and `mailbox:settings` do not check the plan: they make no IMAP call and store no mail.
- After a resume (`--plan active` or `--plan trial`), mail from more than 24 hours before the resume is not triaged (`suspended_backlog`). A send that an owner approved before the pause waits at most 48 hours after the tap.
- The mailbox limit: an organization connects at most `max_mailboxes` mailboxes (default 2). The web and `mailbox:connect` refuse more with `mailbox_limit`. A lower limit does not remove a mailbox that exists.
- `OPERATOR_CONTACT` (an address, set only in the server `.env`): the paused banner and the paused Telegram answer show it. Empty: "contact the operator", and the start log says so when the web is on.
- `OPERATOR_TELEGRAM_CHAT_ID` (your own chat id, needs `TELEGRAM_BOT_TOKEN`): the server sends you three events: a trial that ends in 3 days or has ended, a mailbox that reached the daily LLM cap, and a mailbox in `auth_error` for 24 hours. The texts hold ids only. Empty: the server writes the same text as a `warn` log line. A notice can arrive twice after a crash.
- The start log line `scope targets: <n> active mailboxes in <m> organizations, <k> suspended organizations` shows whom a scope `all` acts on.

**Before you set a scope to `all` on a server with more than one mailbox, run `org:status` and pause every mailbox whose owner did not agree (D2).** The modes are the consent: a mailbox in `shadow` mode changes nothing in the mailbox, and a send always needs a tap. Pause a mailbox with the Pause button of an owner in the panel or with `/pause` in Telegram. Or move the whole organization to `suspended` with `org:plan`.

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
