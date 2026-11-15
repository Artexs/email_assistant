# F114 stage 05 — Release identity, `release.sh`, `rollback.sh`

Part of [`../plan.md`](../plan.md). Decisions P4, P5, D10–D14. Not next to 04 or 07 (Compose). Opus review.

## Step 1 — The release name in the image and in every log line

- `deploy/Dockerfile`: `ARG EA_RELEASE=dev`, `ENV EA_RELEASE=$EA_RELEASE`. `compose.yaml` `server.build.args`: `EA_RELEASE: ${EA_RELEASE:-dev}`.
- Config `EA_RELEASE`: `^[A-Za-z0-9._-]{1,40}$`, default `dev`.
- Logger: `setLogRelease(release: string)` in `platform/log.ts`; then every JSON line carries `release`. `main.ts` and the script entry call it at start.
- **Test:** 1. `setLogRelease("v0.1.0")`, `log.info("x")` → the JSON line has `"release":"v0.1.0"`. 2. Before any call → no `release` key. 3. `EA_RELEASE="v 1"` → config error naming the key.

## Step 2 — `deploy/release.sh <tag>`

- **State file** `deploy/release-state/state` (folder in git with `.gitkeep`; the file ignored), `key=value` lines: `current`, `current_commit`, `previous`, `previous_commit`, `pending`. Every write: tmp file, then `mv`. Both scripts put `$HOME/bin` first on `PATH` when it exists (rclone for `backup.sh` over ssh, as the cron line).
- **Refusals** (exit 2, no change): tag not `v<major>.<minor>.<patch>`; `git status --porcelain` not empty; tag missing after `git fetch --tags`; tag not an ancestor of `origin/master`; root `package.json` version at the tag ≠ the tag without `v`; `pending` set; tag = `current`.
- **Steps**, in order; a failure prints `release failed at <step>; roll back with deploy/rollback.sh` and exits 1:
  1. `deploy/backup.sh`; its last line must start with `backup ok`.
  2. Disk: free on `/` ≥ 3 GB, else `docker builder prune -f` once and check again.
  3. Write `pending=<tag>`. With no state yet (first release), the same write sets `current=pre-<tag>` and `current_commit` = HEAD, so a rollback has a target from here on.
  4. Keep the running image: tag `ea-server:latest` as `ea-server:<current>`.
  5. `git checkout --detach <tag>`.
  6. Build with `EA_RELEASE=<tag>`; tag the result `ea-server:<tag>` too.
  7. Migrate with the one-off service that `compose.yaml` has (`cli` after F103 stage 17, else `server`), `--no-build`. Never `db:rollback`.
  8. `up -d --no-build --wait` (step 6 is the only build: a later `--build` would stamp `dev`).
  9. Verify: `/health` on `127.0.0.1:8080` is 200 within 120 s, and `EA_RELEASE` in the running `server` = the tag.
  10. State: `previous` ← `current`, `current` ← tag, commits likewise, `pending` cleared.
  11. Prune: remove `ea-server:v*` and `ea-server:pre-*` tags other than `current` and `previous`.
  12. Last line `release ok <tag> previous <previous>`. No automatic rollback (D12).

## Step 3 — `deploy/rollback.sh`

- **Target:** `pending` set → `current` (the release broke); else `previous`. No state, or no target → exit 2.
- **Refusal:** `ea-server:<target>` missing → exit 2, no change.
- **Steps:** `docker tag ea-server:<target> ea-server:latest`; checkout the target commit; `up -d --no-build --wait`; verify `/health` 200 and `EA_RELEASE` = target (`pre-*`: `dev` or empty); state: `pending` → clear it, else swap current and previous. Last line `rollback ok <target>`.
- No migration step: the schema stays (P5).

## Test

`deploy/test/`, recording stubs for `docker`, `git`, `curl`, `df`, `deploy/backup.sh`:

4. Dirty tree → exit 2, no `docker` call.
5. `package.json` `0.1.1` at tag `v0.1.0` → exit 2.
6. Tag not on `origin/master` → exit 2.
7. State `current=v0.1.0`; `release.sh v0.1.1` → calls in order: backup, tag `latest` as `v0.1.0`, checkout, build with `EA_RELEASE=v0.1.1`, migrate, up; state `current=v0.1.1`, `previous=v0.1.0`, `pending` empty; last line `release ok v0.1.1 previous v0.1.0`.
8. No state → `latest` tagged `pre-v0.1.0`; after it `previous=pre-v0.1.0`. Same start, health fails → `rollback.sh` targets `pre-v0.1.0`.
9. Backup stub without `backup ok` → exit 1, no checkout.
10. `df` 2 GB, then 2 GB after prune → exit 1; 2 GB then 5 GB → goes on.
11. Health stub fails → exit 1; `pending=v0.1.1` stays; the output names `rollback.sh`.
12. `rollback.sh` after test 11 → target `v0.1.0`; `docker tag ea-server:v0.1.0 ea-server:latest`; `up` has `--no-build`; `pending` cleared.
13. `rollback.sh` with no `pending` → target `previous`; current and previous swapped.
14. Target image missing → exit 2, state unchanged.
15. Prune with tags `v0.0.9`, `v0.1.0`, `v0.1.1`, `pre-v0.0.1` (current `v0.1.1`, previous `v0.1.0`) → removes `v0.0.9` and `pre-v0.0.1` only.
16. No call log holds `db:rollback`; no `rollback.sh` log holds `db:migrate`; no call after the step 6 build has `--build`.

## Done when

Tests 1–16 pass; `bash -n` (and `shellcheck` if installed) clean; the Proof prints `PROOF_OK`.

Out of scope: changelog, checklist, README (06); the first real release (09).
