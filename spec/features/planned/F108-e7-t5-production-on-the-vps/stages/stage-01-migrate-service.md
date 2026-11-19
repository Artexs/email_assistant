# F108 stage 01 — `migrate` service and one compose helper [risky]

Part of [`../plan.md`](../plan.md). Interfaces: [`../interfaces.md`](../interfaces.md) § Compose helper, § Compose service `migrate`. Risk: the production deploy path (release, rollback, restore, nightly backup).

## Carry-over reads

`deploy/compose.yaml`, `deploy/compose.drill.yaml`, `deploy/release-lib.sh`, `deploy/release.sh`, `deploy/rollback.sh`, `deploy/restore.sh`, `deploy/backup.sh`, `deploy/logs.sh`, `deploy/check-logging.sh` (drill set), the tests in `deploy/test/` (also `compose-drill.test.ts` `serverImageServices`) and `apps/server/src/deploy-logging.test.ts`; `docs/capabilities/operations.md` § Releases.

## Step 1.1 — The compose helper

**Goal.** One place builds the Compose command of every deploy script (D2).

**Files.** New `deploy/compose-lib.sh`; `release-lib.sh` takes `COMPOSE_CMD` from it; `backup.sh`, `logs.sh`, `restore.sh` (`new-host` branch only) use it instead of their own `--env-file .env` line. The README `C=` line stays for now (stage 02 writes the docs).

**Decisions.** D1, D2. `backup.sh` keeps its `COMPOSE` variable from `backup.env` as the command word and takes only `EA_COMPOSE_FILES` from the helper. `ea_env_split_state` lands here (stage 05 uses it). The D5 key list lives once, in the helper (`EA_D5_KEYS`).

**Test.**
1. Temp dir with `.env` only → `EA_COMPOSE` ends with `--env-file .env`.
2. Temp dir with `.env` and `deploy/db.env` → ends with `--env-file deploy/db.env`.
3. Neither file → `ea_compose_init` returns 2, stderr `compose: no deploy/db.env and no .env`.
4. `ea_env_split_state`: (a) db.env + `.env` without D5 keys → `split`; (b) no db.env, `.env` with the three passwords (with or without `MIGRATOR_DATABASE_URL`) → `old`; (c) db.env + `.env` with `APP_PASSWORD=` → `mixed`; (d) db.env + `.env` with only `MIGRATOR_DATABASE_URL=` → `mixed`; (e) no db.env, `.env` with two of three passwords → `mixed`. A comment line `# POSTGRES_PASSWORD=x` and a line `XPOSTGRES_PASSWORD=x` do not count.
5. `backup.sh` with stub `docker` on `PATH` and db.env present: the recorded argv holds `--env-file deploy/db.env`.

## Step 1.2 — Service `migrate`; release, restore and the checks use it

**Goal.** Migrations run in a one-off service that alone holds the migrator URL (D3). In this stage `server` and `cli` keep their env (expand, D4).

**Files.** `deploy/compose.yaml` (new service), `deploy/release.sh` (step `migrate`), `deploy/restore.sh` (step `migrate`, both targets), `deploy/rollback.sh` (guard below), `deploy/compose.drill.yaml` (`migrate` gets the drill block and `ports: !reset []`, as `cli` does), `deploy/check-logging.sh` (the drill set allows `migrate`; the one-off rules of `cli` — behind profile `cli`, no healthcheck, `local` log — apply to `migrate` too), the compose tests.

**Decisions.** D3, D4, D8 (stage 01 part). `credentials:check` and every other `cli` one-off stay on `cli`. The drill image tag and network must reach `migrate` (the comment in `compose.drill.yaml` on `extends` and `<<` applies: write the block on the service). `rollback.sh` refuses (exit 2, nothing changed) when `deploy/db.env` exists and the target commit has no `deploy/compose-lib.sh`: `rollback refused: run deploy/env-split.sh --undo first (target <tag> reads only .env)`.

**Test.**
6. `docker compose config --format json` with a planted `MIGRATOR_PASSWORD=sentinel-m-61` in the interpolation file: `migrate.environment` has exactly the keys `MIGRATOR_DATABASE_URL`, `LOG_FORMAT`; the URL user is `migrator`; `migrate` has no `env_file`, no `ports`, no `volumes`; profile `cli`.
7. Same config: `server.environment.MIGRATOR_DATABASE_URL` still exists (expand; stage 03 removes it). This test changes in stage 03.
8. Drill config (`-p ea-drill`, both files): `migrate.image` = `ea-drill-server`, no published port, network subnet `172.29.0.0/24`, `env_file` absent or not `../.env`.
9. `release.sh` harness: the `migrate` step calls `run --rm -T migrate`; no call holds `cli bun run db:migrate`.
10. `restore.sh` harness, both targets: the `migrate` step calls the `migrate` service; `credentials:check` still runs in `cli`.
11. `rollback.sh` harness: it builds its command through the helper; target commit without `deploy/compose-lib.sh` and db.env present → exit 2 with the message above, no `docker` call, state file unchanged; same target without db.env → runs.
12. `check-logging.sh --drill deploy/compose.yaml deploy/compose.drill.yaml` passes; a temp copy where `migrate` has no profile fails; `deploy-logging.test.ts` drill case and `compose-drill.test.ts` cover `migrate` (image `ea-drill-server`).

**Check.** `bun test deploy/test apps/server/src/deploy-logging.test.ts`.

**Done when.** Tests 1–12 pass; no deploy script in `deploy/` holds the literal `--env-file .env` outside `compose-lib.sh` (this grep must find nothing); the Proof chain ends with `PROOF_OK`.

**Out of scope.** Removing keys from `server` or `cli` (stage 03); the split tool and docs (stage 02); `compose.sim.yaml`; `package.json` `db:*` scripts (local dev, D9).

## Proof

`mkdir -p /tmp/f108-s01 && bun run lint > /tmp/f108-s01/lint.log 2>&1 && bun run typecheck > /tmp/f108-s01/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f108-s01/unit.log 2>&1 && bun run test:int:ci > /tmp/f108-s01/int.log 2>&1 && echo PROOF_OK`
