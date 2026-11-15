# F114 stage 07 — One restore path, the drill stack, `credentials:check`, VPS-lost runbook

Part of [`../plan.md`](../plan.md). Decisions P6, D16–D20. Not next to 04 or 05 (Compose files). Opus review (live-data safety).

## Step 1 — `deploy/compose.drill.yaml` (override over `compose.yaml`)

- `name: ea-drill` (the live project is `email-assistant`); network subnet `172.29.0.0/24`; `server` image `ea-drill-server` (a drill build must never move the live `ea-server:latest` tag); `server` publishes no port (`ports: !reset []`) and logs with the `local` driver (the live log store reads only `json-file`); `server` env file `deploy/drill.env` (ignored by git) replaces `../.env` (not appended).
- Forced in `server` env: `TELEGRAM_BOT_TOKEN`, `HEARTBEAT_URL`, `OPERATOR_TELEGRAM_CHAT_ID`, `WEB_BASE_URL` and every LLM provider key empty; `TRIAGE_LLM_SCOPE`, `ACTIONS_SCOPE`, `SEND_SCOPE` `off`.
- No `!reset` on the VPS Compose (V2) → fallback: a full drill file; only if stage 08 finds it.

## Step 2 — `deploy/restore.sh`

- **Usage:** `restore.sh --target drill|new-host (--stdin | <file.dump.age> <identity file>)`; `restore.sh --target drill --init-env <live .env>`; `restore.sh --target drill --down`.
- **Compose command:** drill = `docker compose -p ea-drill -f deploy/compose.yaml -f deploy/compose.drill.yaml --env-file deploy/drill.env` (fixed in the script, never from an argument); new-host = the README `C`.
- **`--init-env`:** writes `deploy/drill.env` (mode 600): new `POSTGRES_PASSWORD`, `MIGRATOR_PASSWORD`, `APP_PASSWORD` (`openssl rand -hex 24`); copies only `CREDENTIALS_KEY` and `CREDENTIALS_KEY_VERSION` from the live file; `LOG_LEVEL=info`. Prints no value.
- **Restore steps:** start a timer; `up -d --wait db`; new-host only: refuse (exit 2) when `organizations` has a row; restore (`--stdin`, or `age -d -i <identity>`) into `pg_restore --no-owner --role=<migrator role> --exit-on-error`, privileges kept, so the objects belong to the migrator as after a migrate; print `count organizations=N users=N mailboxes=N emails=N`; drill only: set every mailbox `paused` (no sync of the real mailbox: no sync-off key exists); both: `delete from auth_sessions` (README § Backups rule); migrate (the one-off service of `compose.yaml`); `credentials:check`, `failed > 0` → exit 1 before the server starts; `up -d --wait` (the Compose health check is the `/health` proof); last line `restore ok target=<t> seconds=<n>`.
- New-host only: after `restore ok`, print the README pointer to replay the `deleted <org id>` and DSR erase lines (README § Account data, Restore).
- **`--down`:** drill → `down -v`, then `docker image rm ea-drill-server` (never `--rmi all`: `postgres:17` is shared with the live stack); new-host → exit 2.
- **Decisions:** plain dump only in a pipe; no project name from outside; `restore-test.sh` stays.

## Step 3 — `bun run credentials:check`

- Decrypts each stored mailbox secret (every table with encrypted mailbox secrets at your base). Prints `credentials ok=<n> failed=<m>` only; exit 0, or 1 on a DB error.

## Step 4 — Runbook

`deploy/README.md` § VPS lost: new host (Ubuntu, Docker, git, Tailscale); clone; `.env` keys from the owner's password manager (names only); latest backup from B2 with the owner's read key; `age -d -i <identity> <file> | ssh <host> 'cd <repo> && deploy/restore.sh --target new-host --stdin'` on the owner's machine; `backup.env`, cron, Tailscale serve, Healthchecks; first `release.sh`. RPO 24 h, RTO 2 h; time from stage 08. Also the drill steps. `backups.md`, `operations.md` § Restore.

## Test

`deploy/test/`, stubs for `docker`, `age`, `openssl`, `ssh`; temp repo layout:

1. `--target drill` without `deploy/drill.env` → exit 2, no `docker` call.
2. `--init-env` from a fake live file with `CREDENTIALS_KEY=k1`, `TELEGRAM_BOT_TOKEN=t1` → `drill.env` has `CREDENTIALS_KEY=k1`, no `t1`, three new passwords, mode 600; stdout and stderr hold neither `k1` nor a password.
3. Drill `--stdin` → every `docker` call has `-p ea-drill` and both `-f` files; order: db up, `pg_restore` with `--no-owner` and `--role=`, counts, mailboxes `paused`, `auth_sessions` delete, migrate, `credentials:check`, up; last line `restore ok target=drill`.
4. New-host with an `organizations` count of 1 → exit 2, no `pg_restore` call.
5. `credentials:check` stub `failed=1` → exit 1, no server `up`.
6. `--down` drill → `down -v` with `-p ea-drill`, then `image rm ea-drill-server`, no `--rmi`; `--down` new-host → exit 2.
7. The drill override parsed as YAML: name `ea-drill`, image `ea-drill-server`, no `ports` on `server`, subnet `172.29.0.0/24`, the forced keys empty or `off`.
8. Integration: two credential rows, one encrypted with another key → `credentials ok=1 failed=1`; the output has no secret.

## Done when

Tests 1–8 pass; `bash -n` clean; Proof prints `PROOF_OK`.

Out of scope: running the drill (08); a clean VM (D17).
