# F108 stage 05 — Contract: the server and `cli` without admin keys [risky]

Needs stage 04: its record `env split ok` in `notes/2026-11-15-vps-deploy-queue.md` § "F108 rollout" (D4: do not spawn before). Needs stage 01: `ea_env_split_state`; stage 02: `deploy/check-server-env.sh`; stage 03: README § Env split. Needs F139: the readiness wait before `guard-empty` in `deploy/restore.sh`; keep it as it is. A worker job.

Part of [`../plan.md`](../plan.md). Interfaces: [`../interfaces.md`](../interfaces.md) § Guards. Risk: security (secret scope) and the production deploy path.

## Carry-over reads

Stage 01–03 files and tests (`compose-lib.sh` `ea_env_split_state`, `check-server-env.sh`); `deploy/release.sh`, `release-lib.sh` (`verify_release`), `rollback.sh`, `restore.sh`; `deploy/README.md` § Env split; the integration tests that start the server or a CLI with the compose env (grep for `MIGRATOR_DATABASE_URL` in `apps/server/src` outside tests: only dev scripts may read it).

## Step 5.1 — Remove the admin keys from `server` and `cli`

**Goal.** The long-running server and the one-off `cli` hold no D5 key (P2, D5).

**Files.** `deploy/compose.yaml` (`server.environment` loses `MIGRATOR_DATABASE_URL`; `cli` inherits it), the compose-config tests (stage 01 test 7 flips).


**Decisions.** D1, D5, D9. The three password keys reach the server only through `../.env`; after the split they are not there. The compose file cannot remove a key that `.env` holds: the guards of step 5.2 and the check of stage 02 cover that. `compose.sim.yaml` and the drill keep their env (D9).

**Test.**
1. `docker compose config --format json`, interpolation file `deploy/db.env` with planted `sentinel-*-81` values, an `.env` (`env_file`) without D5 keys: `server.environment` and `cli.environment` hold no D5 key; `server.environment.DATABASE_URL` user is `app`; `migrate` unchanged from stage 01.
2. Same config (`config` inlines `env_file` values): the `POSTGRES_PASSWORD` and `MIGRATOR_PASSWORD` sentinels appear only under `db` and `migrate`; the `APP_PASSWORD` sentinel appears under `server` and `cli` only inside `DATABASE_URL` (search the JSON text per service).
3. A test that fails if a later change adds a D5 key to `server`, `cli` or any new service that uses image `ea-server` other than `migrate` (iterate the services, do not name them).

## Step 5.2 — Guards and the verify check

**Goal.** No release, rollback or new-host restore runs on a host that is not split, and every release proves the env (D7, D8).

**Files.** `deploy/release.sh`, `deploy/rollback.sh`, `deploy/restore.sh` (`new-host` only), `deploy/release-lib.sh` if the guard lives there; their tests.

**Decisions.** D7, D8. The guard runs first, before `git fetch`, the backup and the `pending` mark. It uses `ea_env_split_state` (stage 01), so `MIGRATOR_DATABASE_URL` left in `.env` makes the state `mixed` and blocks. `release.sh` calls `check-server-env.sh` after the release-name check in its verify step. `rollback.sh` does not call it: release N (expand) is a valid rollback target and still has the migrator URL. The drill target has no guard (its own env, D9). In `restore.sh --target new-host` the guard comes before `up -d --wait db`; the F139 wait and the `guard-empty` step stay after it, unchanged.

**Test.** Release harness with stubs.
4. State `old` → `release.sh v0.9.1` exits 2, stderr names `run deploy/env-split.sh first (state old)`; no `backup.sh` call, no state-file write.
5. State `mixed` (db.env exists, `.env` still holds `MIGRATOR_DATABASE_URL=postgres://migrator:sentinel-u-81@x/y`) → same, `(state mixed)`; no sentinel in output.
6. State `split`, stub env check prints `server env bad: APP_PASSWORD` and exits 1 → `release failed at verify`, exit 1, `pending=v0.9.1` stays in the state file.
7. State `split`, clean env → `release ok v0.9.1 previous <old>`.
8. `rollback.sh` with state `old` → exit 2, nothing changed; with state `split` → runs, and makes no `check-server-env.sh` call.
9. `restore.sh --target new-host` with state `old` → exit 2 before any `docker` call; `--target drill` with state `old` → passes the guard.
10. The F139 test of the readiness wait (`deploy/test/restore.test.ts` or its own file) passes unchanged.

## Step 5.3 — Docs

**Files.** `deploy/README.md` § Env split and § Release (the guard message and what to do), `docs/capabilities/operations.md` (the server env rule), `docs/architecture.md` §10 if it names the env.

**Check.** `bun test deploy/test apps/server/src/deploy-logging.test.ts`.

**Done when.** Tests 1–10 pass; the Proof chain ends with `PROOF_OK`.

**Out of scope.** Any VPS step; other secrets of the server (`CREDENTIALS_KEY`, bot token, LLM keys: the server needs them); a secret manager.

## Proof

The chain of [`../plan.md`](../plan.md) § Proof with `sNN` = `s05`; it ends with `PROOF_OK`.
