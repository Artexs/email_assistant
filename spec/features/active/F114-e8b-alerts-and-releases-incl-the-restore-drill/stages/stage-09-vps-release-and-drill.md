# F114 stage 09 — First release, rollback test, alert drill, restore drill (VPS)

Part of [`../plan.md`](../plan.md). [risky] (deploy, VPS). Decisions P2, P4, P6, D11–D19. A coordinator run. Pre-approved (owner, 2026-11-13): backup first, name the rollback target, verify after. The live database is never a restore target.

**Gate:** stages 01–08 landed; the v0.2.0 release of the other coordinator thread is verified; disk: `ssh home_vm df -h /` first, under 5 GB free stop and tell the owner (owner, 2026-11-15; PD-055 is no gate); CI green on `master`. U1 is needed for Part C only. On the VPS, run the scripts with `PATH=$HOME/bin:$PATH` (rclone 1.75).

## Part A — Release `v0.1.0` and a rollback

0. Bootstrap (the last untagged deploy; review 1 N4): the VPS has no `release.sh` yet. Back up with the old script, name the rollback target, then `git checkout --detach <green master commit with stages 01–08>`, run the new `deploy/backup.sh` (it writes the first status file, so the new server sees a fresh backup; review 1 N10), migrate, `up -d --build --wait`, verify health. This commit and image become `pre-v0.1.0`.
1. PC: `bun run release:prepare 0.1.0`; commit `release: v0.1.0`; wait for green CI on that commit; `git tag -a v0.1.0 -m v0.1.0`; `git push origin v0.1.0`.
2. VPS: write down the rollback target (HEAD commit and image id of `ea-server:latest`). `git fetch --tags`; `deploy/release.sh v0.1.0` → last line `release ok v0.1.0 previous pre-v0.1.0`. On failure: `deploy/rollback.sh`, record, stop Part A.
3. Verify: the README log-rotation check; `ops_alerts` exists; a server log line has `"release":"v0.1.0"`; `ops:alerts` runs.
4. V1: free bytes of `statfs("/")` in `server` and `df -B1 /` on the host differ by under 1 %; else set `SLO_DISK_PATH` and record it.
5. V4: run `deploy/backup.sh` by hand; `deploy/backup-status/status.json` has `result=ok`; `server` reads `/run/ea-backup/status.json`.
6. `deploy/rollback.sh` → `rollback ok pre-v0.1.0`, time it (no build); the bootstrap commit has the scripts. Then `deploy/rollback.sh` again → `rollback ok v0.1.0`. Both times health 200.

## Part B — Alert drill

7. `OPERATOR_TELEGRAM_CHAT_ID` set? Check with a count only (`grep -c '^OPERATOR_TELEGRAM_CHAT_ID=.' .env`), never print it. Set → `ops:alert-test --all` with the one-off service → five `sent <kind>` lines; U4 for the owner. Unset → record `unsent … no_chat` and U3 as open.
8. After U2: `BACKUP_PING_URL` in `deploy/backup.env`, one `deploy/backup.sh` run; the owner sees the ping.

## Part C — Restore drill (needs U1)

**Waits (owner, 2026-11-15: "we postpone it").** U1 (the `age` key path), U2 (Healthchecks backup URL) and U3 (operator Telegram group) are owner to-dos: `notes/owner-later.md` item 3. Parts A and B run without them; F114 stays open for Part C only.

9. Write down the live `db` and `server` container ids and start times.
10. Live counts (`organizations`, `users`, `mailboxes`, `emails`) = **before**; `deploy/backup.sh` → name; the same counts = **after**.
11. Copy that `.dump.age` file (encrypted) to `/tmp/f114-drill/` on the PC.
12. `172.29.0.0/24` is free (`docker network ls`, `ip route`). Start the wall clock. VPS: clone the origin into `~/ea-drill/repo`, `checkout --detach v0.1.0`; `deploy/restore.sh --target drill --init-env <live repo>/.env`; V2: `docker compose -p ea-drill -f deploy/compose.yaml -f deploy/compose.drill.yaml --env-file deploy/drill.env --profile cli config`: `server` and `cli` have image `ea-drill-server`, no port, env file `drill.env`.
13. PC: `age -d -i <U1 path> /tmp/f114-drill/<name> | ssh home_vm 'cd ~/ea-drill/repo && deploy/restore.sh --target drill --stdin'` → `restore ok target=drill seconds=<n>` and the counts line (V3).
14. Checks: before ≤ drill ≤ after for each count (D19); within 6 min the drill server log has `slo_alert_sent` with `kind=slo_backup_age` (no status file in the clone); no `sync_` event (mailboxes paused); `docker stats` of the drill under 400 MB.
15. Stop the clock. `deploy/restore.sh --target drill --down`; `rm -rf ~/ea-drill`; delete `/tmp/f114-drill/`.
16. The live `db` and `server` ids and start times are those of step 9 (the drill never touched them).

## Record

- `deploy/README.md` § VPS lost: date, backup size, script seconds, wall time, counts, rollback time (step 6). Over 2 h → a finding and a ticket, not a failure.
- `docs/known-alerts.md`: entry "restore drill": time, next drill date (+6 months).
- `notes/2026-11-15-vps-deploy-queue.md`: the release record (rollback target, backup name) and the rule "every deploy is a release".
- `operations.md`, `backups.md`: checked date; E8b Limits lines removed.

## Failure rules

A failed drill: `--down`, record the finding, open a ticket; F114 stays open until a drill passes. Any doubt that a command targets the live project: do not run it.

## Done when

`release ok v0.1.0`; two `rollback ok` lines; five `sent` lines (or U3 recorded open); `restore ok target=drill`; the D19 rule holds; step 16 holds; the records are committed.

## Carry-over from stage 04 review

Read `review-4.md`. Step 4 (V1): compare the container `statfs("/")` with `df -B1 /` on the host and set `SLO_DISK_PATH` when they differ. The drill server (stage 07 override) inherits the backup status mount and sends `slo_backup_age` because the clone has no status file: expect it. Run the new `backup.sh` before the new server starts.

## Carry-over from stage 05 review

- On the VPS confirm: `run --rm -T cli` runs the just-built image; `up -d --no-build` recreates `server` after `docker tag`; `printenv EA_RELEASE`; the rollback target checkout matches its image (review-5.md N1).

## Carry-over from stage 07 review

- On the VPS (Compose 2.40): `docker compose -p ea-drill -f deploy/compose.yaml -f deploy/compose.drill.yaml --env-file deploy/drill.env config --format json | jq .networks` shows exactly one subnet 172.29.0.0/24 and the name `ea-drill_default`; `docker network inspect $(docker network ls -q)` shows no other network on 172.29.0.0/24; the drill config has no live keys for `server` and `cli` and no ports. Compare `df` with the live DB size before the drill (a second DB copy; the build cache stays after `--down`). Never type a profile by hand with the drill files (`--profile ops` would publish 127.0.0.1:9428). See review-7.md.

## Carry-over from stage 08 review

- On a new host `restore.sh` runs `up` before the delete replay: judge on the drill whether the server can sync erased data before the replay removes it (review-8.md). The runbook step 2 prints nothing until the first tag exists; make the first release tag part of this stage.
