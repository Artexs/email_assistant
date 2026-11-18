# F108 interfaces

Names that a later stage, another ticket or the operator uses. Part of [plan.md](plan.md).

## Files on the VPS host (git-ignored)

| File | Holds | Mode | Made by |
| --- | --- | --- | --- |
| `.env` | every app key; after the split no D5 password key | 600 | operator (exists) |
| `deploy/db.env` | `POSTGRES_PASSWORD`, `MIGRATOR_PASSWORD`, `APP_PASSWORD` (exactly these three lines) | 600 | `deploy/env-split.sh` |

`deploy/db.env.example` (committed) lists the three names with empty values and one comment line: "Compose interpolation file of the VPS; the server never gets it (ADR 0019, D1)".

## Compose helper (stage 01)

`deploy/compose-lib.sh`, sourced from the repo root, runs nothing by itself.
- Array `EA_COMPOSE=(docker compose -f deploy/compose.yaml --env-file <file>)`; `<file>` = `deploy/db.env` when it exists, else `.env`.
- Function `ea_compose_init`: sets `EA_COMPOSE`; neither file → prints `compose: no deploy/db.env and no .env` to stderr, returns 2.
- Function `ea_env_split_state`: prints one word: `split` (db.env exists and `.env` holds no D5 password key), `old` (no db.env, `.env` holds all three), `mixed` (any other case). Stage 03 guards use it.
- Users: `release-lib.sh` (`COMPOSE_CMD` comes from it), `backup.sh`, `logs.sh`, `restore.sh` (target `new-host` only), `check-server-env.sh`. The README `C=` line names the same command.

## Compose service `migrate` (stage 01)

```
migrate:
  image: ea-server
  profiles: [cli]
  restart: "no"
  logging: local block
  environment:
    MIGRATOR_DATABASE_URL: postgres://migrator:${MIGRATOR_PASSWORD:?}@db:5432/email_assistant?sslmode=disable
    LOG_FORMAT: text
  command: ["bun", "run", "db:migrate"]
  depends_on: db (service_healthy)
```

No `env_file`, no `ports`, no `volumes`. Call: `"${EA_COMPOSE[@]}" run --rm -T migrate`. The drill override gives `migrate` the drill image block (`image: ea-drill-server`, local log, `restart: "no"`, `ports: !reset []`).

## Scripts (stage 02)

`deploy/env-split.sh [--undo]`, run from the repo root.
- Split: `.env` has all three keys, no `deploy/db.env` → writes `deploy/db.env` (600) with the three lines, rewrites `.env` without them (other lines and their order kept). Last line `env split ok moved=3`. Exit 0.
- Already split (`ea_env_split_state` = `split`) → `env split: already split`, exit 0, no write.
- `mixed` or a key twice → `env split refused: <reason>` (key names only), exit 2, no write.
- `--undo`: `split` → appends the three lines to `.env`, removes `deploy/db.env`; last line `env split undone moved=3`. Else exit 2.
- Never prints a value. Leaves no temp file and no `.env.bak*`.

`deploy/check-server-env.sh`: reads `exec -T server env` names only. Clean → `server env ok keys=<n>`, exit 0. A D5 key → `server env bad: <names, comma list>` on stderr, exit 1. Compose or exec failure → exit 2.

## Guards (stage 03)

`release.sh`, `rollback.sh`, `restore.sh --target new-host`: state not `split` → `… refused: run deploy/env-split.sh first (state <state>)`, exit 2, before the backup or any change. `release.sh` verify calls `check-server-env.sh`; exit ≠ 0 → `release failed at verify` (pending kept, rollback message as today).

## Seams to other tickets

- F114 stage 09 (drill, not run yet): `restore.sh` migrates through `migrate` after stage 01; the drill override covers it.
- Every later ticket that adds a one-off DB-admin command: run it in `migrate` (or `exec db psql -U postgres`), never add an admin key to `server` or `cli`.
