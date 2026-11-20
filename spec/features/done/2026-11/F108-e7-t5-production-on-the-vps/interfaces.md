# F108 interfaces

Names that a later stage, another ticket or the operator uses. Part of [plan.md](plan.md).

## Files on the VPS host (git-ignored)

| File | Holds | Mode | Made by |
| --- | --- | --- | --- |
| `.env` | every app key; after the split no D5 key | 600 | operator (exists) |
| `deploy/db.env` | `POSTGRES_PASSWORD`, `MIGRATOR_PASSWORD`, `APP_PASSWORD`; `MIGRATOR_DATABASE_URL` when the old `.env` had it (unused there, kept so the split loses nothing) | 600 | `deploy/env-split.sh` |

`deploy/db.env.example` (committed) lists the three password names with empty values and one comment line: "Compose interpolation file of the VPS; the server never gets it (ADR 0019)".

## Compose helper (stage 01)

`deploy/compose-lib.sh`, sourced from the repo root, runs nothing by itself.
- `EA_D5_KEYS=(POSTGRES_PASSWORD MIGRATOR_PASSWORD APP_PASSWORD MIGRATOR_DATABASE_URL)`: the one list of D5.
- Function `ea_compose_init`: sets `EA_COMPOSE_FILES=(-f deploy/compose.yaml --env-file <file>)` and `EA_COMPOSE=(docker compose "${EA_COMPOSE_FILES[@]}")`; `<file>` = `deploy/db.env` when it exists, else `.env`. Neither file → stderr `compose: no deploy/db.env and no .env`, return 2.
- Function `ea_env_split_state`: prints one word. `split`: db.env exists and `.env` holds no D5 key. `old`: no db.env and `.env` holds the three password keys. `mixed`: any other case. A key counts only as a line that starts with `<KEY>=`.
- Users: `release-lib.sh` (`COMPOSE_CMD`), `backup.sh` (`EA_COMPOSE_FILES` after its own `COMPOSE` word), `logs.sh`, `restore.sh` (target `new-host`), `check-server-env.sh`, `env-split.sh`. The README `C=` line is `docker compose -f deploy/compose.yaml --env-file deploy/db.env` on a split host.

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

No `env_file`, no `ports`, no `volumes`, no healthcheck. Call: `"${EA_COMPOSE[@]}" run --rm -T migrate`. The drill override gives `migrate` `image: ea-drill-server`, local log, `restart: "no"` and `ports: !reset []`, written on the service; not the `x-drill-server` anchor (its `env_file: drill.env` and forced channel env do not belong in `migrate`). `check-logging.sh --drill` allows it.

`rollback.sh` (stage 01): db.env exists and the target commit has no `deploy/compose-lib.sh` → `rollback refused: run deploy/env-split.sh --undo first (target <tag> reads only .env)`, exit 2.

## Scripts (stage 02)

`deploy/env-split.sh [--undo]`, run from the repo root.
- State `old` → writes `deploy/db.env` (600) with the D5 lines of `.env`, then rewrites `.env` without them (other lines and order kept). Last line `env split ok moved=<3|4>`. Exit 0.
- State `split` → `env split: already split`, exit 0, no write.
- Refused before any write (exit 2): a D5 key with `export`, an indent or a space before `=`; a D5 key twice; a `deploy/db.env` without the three passwords. `.env` keeps its owner and mode; no value goes into argv.
- State `mixed` where every D5 line of `.env` is also in db.env with an equal value (a split that stopped between the two renames) → removes them from `.env`, last line `env split ok finished=<n>`. Any other `mixed`, or a key twice → `env split refused: <reason>` (key names only), exit 2, no write.
- `--undo`: state `split` → appends the db.env lines to `.env`, then removes db.env; last line `env split undone moved=<n>`. Else exit 2.
- Never prints a value. Leaves no temp file and no `.env.bak*`.

`deploy/check-server-env.sh`: reads `exec -T server env`, names only. Clean → `server env ok keys=<n>`, exit 0. A D5 key → `server env bad: <names, sorted, comma list>` on stderr, exit 1. Compose or exec failure, or an empty server env → `server env check failed: …` on stderr, exit 2.

## Guards (stage 05)

`release.sh`, `rollback.sh`, `restore.sh --target new-host`: state not `split` → `<script> refused: run deploy/env-split.sh first (state <state>)`, exit 2, before the backup or any change. `release.sh` verify calls `check-server-env.sh`; exit ≠ 0 → `release failed at verify` (pending kept, rollback message as today).

## Seams to other tickets

- F114 drill (ran 2026-11-19 at `v0.3.1`, before stage 01): it does not prove the `migrate` path. The F139 drill rerun on the release that carries stage 01 does (V4).
- F139 (restore readiness wait before `guard-empty`): lands before stage 05; stage 01 and stage 05 keep its wait in `restore.sh`.
- `backup.sh` (lock and B2 retries since 2026-11-19): a lock-refused run exits 75 and writes no status; stage 01 keeps that order (lock, trap, then the helper).
- Release train (2026-11-20): `v0.4.2` (tag `34374ba0`) holds stages 01–03 and the F139 wait, not on the VPS yet (VPS at `v0.4.1`); stage 04 deploys it. `v0.4.3` is the first release with stage 05.
- Stage files with `C=… --env-file .env`: none outside F108 at `f21809c4`. A later one written before stage 04 must use the README `C=` line after it.
- A later one-off DB-admin command runs in `migrate` or `exec db psql -U postgres`; never add a D5 key to `server` or `cli`.
