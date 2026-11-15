# F114 stage 07 — One restore path and the drill stack

Part of [`../plan.md`](../plan.md). Decisions P6, D16–D19. Not next to 04 or 05 (Compose files). Opus review (live-data safety). Calls `credentials:check` of stage 08 (tests stub it).

## Step 1 — `deploy/compose.drill.yaml` (override over `compose.yaml`)

- `name: ea-drill` (the live project is `email-assistant`); network subnet `172.29.0.0/24`.
- The same block for `server` **and every service that runs the server image** (the `cli` one-off service of F103 stage 17 extends `server`, and Compose resolves `extends` before the override, so `cli` needs its own block; review 1 B1):
  - image `ea-drill-server` (a drill build never moves the live `ea-server:latest` tag);
  - no published port (`ports: !reset []`);
  - `local` log driver (the live log store reads only `json-file`);
  - env file `deploy/drill.env` instead of `../.env` (`!override`, not appended; the fresh clone has no `.env`);
  - forced env: `TELEGRAM_BOT_TOKEN`, `HEARTBEAT_URL`, `OPERATOR_TELEGRAM_CHAT_ID`, `WEB_BASE_URL` and every LLM provider key empty; `TRIAGE_LLM_SCOPE`, `ACTIONS_SCOPE`, `SEND_SCOPE` `off`.
- No `!reset` or `!override` on the VPS Compose (V2) → fallback: a full drill file; only if stage 09 finds it.

## Step 2 — `deploy/restore.sh`

- **Usage:** `restore.sh --target drill|new-host (--stdin | <file.dump.age> <identity file>)`; `--target drill --init-env <live .env>`; `--target drill --down`.
- **Compose command:** drill = `docker compose -p ea-drill -f deploy/compose.yaml -f deploy/compose.drill.yaml --env-file deploy/drill.env`, fixed in the script; new-host = the README `C`. Refuse when the resolved project name is `email-assistant` and the target is `drill`.
- **`--init-env`:** writes `deploy/drill.env` (mode 600): new `POSTGRES_PASSWORD`, `MIGRATOR_PASSWORD`, `APP_PASSWORD` (`openssl rand -hex 24`); copies only `CREDENTIALS_KEY` and `CREDENTIALS_KEY_VERSION` from the live file; `LOG_LEVEL=info`. Prints no value.
- **Stdin rule:** only the `pg_restore` call reads stdin; every other `docker` call gets `</dev/null` (a `compose exec` forwards stdin and would eat the dump; review 1 N8).
- **Restore steps:**
  1. Start a timer. Drill: build once (`EA_RELEASE` = the checked-out tag); every later call `--no-build`.
  2. `up -d --wait db`.
  3. Empty-target guard (both targets): the `public` schema has no table, else exit 2 (`new-host`: never restore over data; `drill`: run `--down` first). Review 1 N7.
  4. Restore (`--stdin`, or `age -d -i <identity> <file>`) into `pg_restore --no-owner --role=<migrator role> --exit-on-error`, privileges kept, so objects belong to the migrator as after a migrate.
  5. Print `count organizations=N users=N mailboxes=N emails=N`.
  6. Drill only: every mailbox `paused` (no sync of the real mailbox; no sync-off key exists); `delete from ops_alerts` (a restored open row would hide the drill alert; review 1 N10).
  7. Both: `delete from auth_sessions` (README § Backups rule).
  8. Migrate with the one-off service, `--no-build`.
  9. `credentials:check`; `failed > 0` → exit 1 before the server starts.
  10. `up -d --no-build --wait` (the Compose health check is the `/health` proof).
  11. Last line `restore ok target=<t> seconds=<n>`. New-host: also the README pointer to replay the `deleted <org id>` and DSR erase lines.
- **`--down`:** drill → `down -v`, then `docker image rm ea-drill-server` (never `--rmi all`: `postgres:17` is shared with live); new-host → exit 2.
- Plain dump only in a pipe.

## Test

`deploy/test/`, recording stubs for `docker`, `age`, `openssl`; temp repo layout:

1. `--target drill` without `deploy/drill.env` → exit 2, no `docker` call.
2. `--init-env` from a fake live file with `CREDENTIALS_KEY=k1`, `TELEGRAM_BOT_TOKEN=t1` → `drill.env` has `k1`, not `t1`, three new passwords, mode 600; output holds neither `k1` nor a password.
3. Drill `--stdin` → every `docker` call has `-p ea-drill` and both `-f` files; the order of steps 1–10; last line `restore ok target=drill`; only one `--build`.
4. The schema stub reports one table → exit 2 for both targets, no `pg_restore` call.
5. `credentials:check` stub `failed=1` → exit 1, no server `up`.
6. `--down` drill → `down -v` with `-p ea-drill`, then `image rm ea-drill-server`, no `--rmi`; `--down` new-host → exit 2.
7. The `docker` stub reads stdin: in test 3, only the `pg_restore` call sees bytes.
8. YAML of the override: name, subnet, and for `server` and for each service of `compose.yaml` that extends `server`: image, no port, `local` log, env file, forced keys.

## Done when

Tests 1–8 pass; `bash -n` clean; the Proof of `plan.md` prints `PROOF_OK`. Out of scope: `credentials:check` and the runbook (08); running the drill (09).
