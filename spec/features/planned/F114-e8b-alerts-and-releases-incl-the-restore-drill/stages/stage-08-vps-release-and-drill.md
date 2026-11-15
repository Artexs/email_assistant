# F114 stage 08 — First release, rollback test, alert drill, restore drill (VPS)

Part of [`../plan.md`](../plan.md). [risky] (deploy, VPS). Decisions P2, P4, P6, D11–D19. A coordinator run, not a worker job. Pre-approved (owner, 2026-11-13): backup first, name the rollback target, verify after. The live database is never a restore target.

**Gate:** PD-055 done (root volume grown); stages 01–07 landed; CI green on `master`. U1 is needed for Part C only; Parts A and B do not wait for it.

## Part A — Release `v0.1.0` and a rollback

1. PC: `bun run release:prepare 0.1.0`; commit `release: v0.1.0`; wait for green CI on that commit; `git tag -a v0.1.0 -m v0.1.0`; `git push origin v0.1.0`.
2. VPS: write down the rollback target (HEAD commit and image id of `ea-server:latest`). `git fetch --tags`; `deploy/release.sh v0.1.0` → last line `release ok v0.1.0 previous pre-v0.1.0`. On failure: `deploy/rollback.sh`, record, stop Part A.
3. Verify: the README log-rotation check; `ops_alerts` exists; a server log line has `"release":"v0.1.0"`; `ops:alerts` runs.
4. V1: free bytes of `statfs("/")` inside `server` and of `df -B1 /` on the host differ by under 1 %. Else set `SLO_DISK_PATH` per the finding and record it.
5. V4: run `deploy/backup.sh` by hand; `deploy/backup-status/status.json` has `result=ok`; `server` reads `/run/ea-backup/status.json`.
6. `deploy/rollback.sh` → `rollback ok pre-v0.1.0`, time it (no build). Then `deploy/rollback.sh` again → `rollback ok v0.1.0` (back to the release). Both times health 200.

## Part B — Alert drill

7. `OPERATOR_TELEGRAM_CHAT_ID` set? Check with a count only (`grep -c '^OPERATOR_TELEGRAM_CHAT_ID=.' .env`), never print it. Set → `ops:alert-test --all` with the one-off service → five `sent <kind>` lines; U4 for the owner. Unset → record `unsent … no_chat` and U3 as open.
8. After U2: `BACKUP_PING_URL` in `deploy/backup.env` and one `deploy/backup.sh` run; the Healthchecks check shows a ping (owner reads it; not a stop).

## Part C — Restore drill (needs U1)

9. Write down the live `db` and `server` container ids and start times.
10. Live counts (`organizations`, `users`, `mailboxes`, `emails`) = **before**; `deploy/backup.sh` → name; the same counts = **after**.
11. Copy that `.dump.age` file from `BACKUP_DIR` to `/tmp/f114-drill/` on the PC (still encrypted).
12. Start the wall clock. VPS: clone the origin into `~/ea-drill/repo`, `checkout --detach v0.1.0`; `deploy/restore.sh --target drill --init-env <live repo>/.env`; V2: `docker compose -p ea-drill -f deploy/compose.yaml -f deploy/compose.drill.yaml --env-file deploy/drill.env config` shows no `server` port and image `ea-drill-server`.
13. PC: `age -d -i <U1 path> /tmp/f114-drill/<name> | ssh home_vm 'cd ~/ea-drill/repo && deploy/restore.sh --target drill --stdin'` → `restore ok target=drill seconds=<n>` and the counts line (V3: migrate and the server start prove the roles).
14. Checks: before ≤ drill ≤ after for each count (D19); within 6 min the drill server log has `slo_alert_sent` with `kind=slo_backup_age` (no status file in the clone: the one real alert); no `sync_` event (mailboxes paused); `docker stats` of the drill under 400 MB.
15. Stop the clock. `deploy/restore.sh --target drill --down`; `rm -rf ~/ea-drill`; delete `/tmp/f114-drill/`.
16. The live `db` and `server` ids and start times are those of step 9 (the drill never touched them).

## Record

- `deploy/README.md` § VPS lost: date, backup size, the script seconds, the wall time (clone, build, restore), the counts, the rollback time of step 6. A time over 2 h → a finding line and a ticket, not a failure.
- `docs/known-alerts.md`: a runbook entry "restore drill" with the time and the date of the next drill (in 6 months).
- `notes/2026-11-15-vps-deploy-queue.md`: the release record (rollback target, backup name) and the rule "every deploy is a release".
- `docs/capabilities/operations.md` and `backups.md`: checked date; the backups Limits lines of E8b removed.

## Failure rules

- A failed drill: `--down`, record the finding, open a ticket; F114 stays open until a drill passes.
- Any doubt that a command targets the live project: stop and do not run it.

## Done when

`release ok v0.1.0`; two `rollback ok` lines; five `sent` lines (or U3 recorded open); `restore ok target=drill`; the D19 rule holds; step 16 holds; the records are committed.
