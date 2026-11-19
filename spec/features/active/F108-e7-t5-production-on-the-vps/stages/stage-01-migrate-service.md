# F108 stage 01 — `migrate` service and one compose helper [risky]

Needs: no earlier stage. A worker job. Shares `deploy/restore.sh` with F139 (readiness wait): on a land conflict, merge master, keep both, re-prove. No job that changes Compose files runs next to it.

Part of [`../plan.md`](../plan.md). Interfaces: [`../interfaces.md`](../interfaces.md) § Compose helper, § Compose service `migrate`.

## Carry-over reads

The deploy scripts that build a Compose command, `compose*.yaml`, `check-logging.sh`, `deploy/test/` (the `backup.test.ts` harness: stubs on `PATH`, `BACKUP_RCLONE_DELAY=0`, `flock`), `apps/server/src/deploy-logging.test.ts`, `docs/capabilities/operations.md` § Releases.

## Step 1.1 — The compose helper

**Goal.** One place builds the Compose command of every deploy script (D2). New `deploy/compose-lib.sh`; `release-lib.sh` (`COMPOSE_CMD`), `backup.sh`, `logs.sh` and `restore.sh` (`new-host` only) use it. The README `C=` line stays (stage 03).

**Decisions.** D1, D2. `backup.sh` keeps its `COMPOSE` word from `backup.env` and takes only `EA_COMPOSE_FILES` from the helper. Its helper call comes after the `flock` lock and inside the exit trap: a host with neither env file writes `failed` (the backup alert fires); a run that loses the lock still exits 75 and writes nothing. `ea_env_split_state` lands here (stage 05 uses it). The D5 list lives once, in the helper (`EA_D5_KEYS`).

**Test.**
1. Temp dir with `.env` only → `EA_COMPOSE` ends with `--env-file .env`.
2. Temp dir with `.env` and `deploy/db.env` → ends with `--env-file deploy/db.env`.
3. Neither file → `ea_compose_init` returns 2, stderr `compose: no deploy/db.env and no .env`.
4. `ea_env_split_state`: (a) db.env + `.env` without D5 keys → `split`; (b) no db.env, `.env` with the three passwords (with or without `MIGRATOR_DATABASE_URL`) → `old`; (c) db.env + `.env` with `APP_PASSWORD=` → `mixed`; (d) db.env + `.env` with only `MIGRATOR_DATABASE_URL=` → `mixed`; (e) no db.env, `.env` with two of three passwords → `mixed`. A comment line `# POSTGRES_PASSWORD=x` and a line `XPOSTGRES_PASSWORD=x` do not count.
5. `backup.sh` in the `backup.test.ts` harness with db.env present: the recorded `docker` argv holds `--env-file deploy/db.env`; `backup ok`.
5b. Same harness with neither `.env` nor db.env → exit ≠ 0 and ≠ 75; `status.json` `result` = `failed`.

## Step 1.2 — Service `migrate`; release, restore and the checks use it

**Goal.** Migrations run in a one-off service that alone holds the migrator URL (D3); `server` and `cli` keep their env (expand, D4). `check-logging.sh`: the drill set allows `migrate`; `cli`'s one-off rules apply.

**Decisions.** D3, D4, D8 (stage 01 part). `credentials:check` and every other one-off stay on `cli`. In `compose.drill.yaml`, `migrate` gets image, restart, log and `ports: !reset []` written on the service, not `<<: *drill-server`: that anchor carries `env_file: drill.env` and the forced channel env (now with `VAPID_PRIVATE_KEY`), which `migrate` does not need. In `compose-drill.test.ts` the image, log, restart and port checks cover every service with image `ea-server`; the env checks stay on `server` and `cli`. `rollback.sh` refuses (exit 2, nothing changed) when `deploy/db.env` exists and the target commit has no `deploy/compose-lib.sh`: `rollback refused: run deploy/env-split.sh --undo first (target <tag> reads only .env)`.

**Test.**
6. `docker compose config --format json` with a planted `MIGRATOR_PASSWORD=sentinel-m-61` in the interpolation file: `migrate.environment` has exactly `MIGRATOR_DATABASE_URL` and `LOG_FORMAT`; the URL user is `migrator`; no `env_file`, `ports` or `volumes`; profile `cli`.
7. Same config: `server.environment.MIGRATOR_DATABASE_URL` still exists (expand). Stage 05 flips this test.
8. Drill config (both files, `drill.env` with `MIGRATOR_PASSWORD=drill-migrator`): `migrate` has image `ea-drill-server`, restart `no`, log `local`, no port, no `env_file`; its environment is exactly `MIGRATOR_DATABASE_URL` (password `drill-migrator`) and `LOG_FORMAT`; no `live-` sentinel.
9. `release.sh` harness: the `migrate` step calls `run --rm -T migrate`; no call holds `cli bun run db:migrate`.
10. `restore.sh` harness, both targets: the `migrate` step calls the `migrate` service; `credentials:check` still runs in `cli`.
11. `rollback.sh` harness: target without `deploy/compose-lib.sh` and db.env present → exit 2 with the message above, no `docker` call, state file unchanged; same target without db.env → runs.
12. `check-logging.sh --drill` on both files passes; a temp copy where `migrate` has no profile fails.

**Check.** `bun test deploy/test apps/server/src/deploy-logging.test.ts`.

**Done when.** Tests 1–12 pass; no deploy script in `deploy/` holds the literal `--env-file .env` outside `compose-lib.sh` (this grep must find nothing); the Proof chain ends with `PROOF_OK`.

**Out of scope.** Stages 02, 03, 05; `compose.sim.yaml`; `package.json` `db:*` scripts (D9).

## Proof

The chain of [`../plan.md`](../plan.md) § Proof with `sNN` = `s01`; it ends with `PROOF_OK`.
