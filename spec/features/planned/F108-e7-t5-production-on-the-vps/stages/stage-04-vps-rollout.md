# F108 stage 04 — VPS rollout and backup checks [risky]

Part of [`../plan.md`](../plan.md). A coordinator run on the VPS (`ssh home_vm`, `~/email_assistant`). Needs stages 01–03 landed and release N tagged (plan § How to run). VPS deploys are pre-approved (owner, 2026-11-13). Risk: production; the pilot runs on this host.

## Carry-over reads

`docs/release-checklist.md`; `deploy/README.md` § Release, § Env split, § Backups; `notes/2026-11-15-vps-deploy-queue.md` (the last release and the open items); `notes/owner-later.md`; `docs/known-alerts.md`; the stage 01–03 outcomes.

## Rules

- Before anything: `df -h /` (under 5 GB free → stop, tell the owner), `git status` clean, the state file (`current`, `pending` empty). Name the rollback target in the queue note before each release.
- Never print a value of `.env`, `deploy/db.env`, `backup.env` or the rclone config. Key names only (`cut -d= -f1`).
- Each step records its command and its output line in `notes/2026-11-15-vps-deploy-queue.md` (new section "F108 rollout").
- A failed step: stop, roll back by the release checklist step 11, record, report. Never `down -v`, never a DB restore without the owner.

## Part A — Release N (expand)

1. Release N by `docs/release-checklist.md` (CI green, changelog, `release.sh vN`). Release N holds stages 01–02 and not stage 03.
2. Checks: `release ok`; the log shows the migrate step ran in `migrate` (`docker ps -a` names or the script output); health 200; sync lines in 10 minutes; `ops:alerts` none.

## Part B — Split the env

3. Key names only: the VPS `.env` holds the three password keys (V3). If not, stop: the layout differs from the plan.
4. `deploy/env-split.sh` → `env split ok moved=3`. Then `ea_env_split_state` = `split` (source the helper, print the word).
5. No restart is needed: release N's compose file interpolates from `deploy/db.env`. Prove it: `$C config --quiet` exits 0 (prints nothing).

## Part C — Release N+1 (contract)

6. Release N+1 holds stage 03 (`release.sh vN+1`, run by release N's script). Rollback target: N (it works with `deploy/db.env`).
7. `deploy/check-server-env.sh` → `server env ok keys=<n>`. Also check `cli`: `$C run --rm -T cli env` names only, no D5 key.
8. 30-minute watch (checklist step 10). On trouble: `deploy/rollback.sh` (to N).

## Part D — Backups (read only, P23)

9. VPS: `crontab -l` has the `deploy/backup.sh` line (print that line only); the last line of `~/ea-logs/backup.log` that starts with `backup` is `backup ok <name> <bytes>` from the last night or from the release backup; `deploy/backup-status/status.json` has `result` `ok` and `last_ok_at` under 26 h old (print those two fields only).
10. `ops:alerts` shows no open `slo_backup_age` (P4: the failed-backup notice is this alert). Record whether `OPERATOR_TELEGRAM_CHAT_ID` and `BACKUP_PING_URL` are set (names present or not, never values): unset = F114 owner steps U2, U3 still open; say so in the report.
11. Bucket (D10, V2): on the PC, `rclone listremotes` (names only). A remote for the backup bucket with read access → `rclone lsl <remote>:<bucket> | tail -n 3` (names, sizes, times; no key). The newest object name equals the name in `status.json`. No such remote → record "bucket listing: owner step O1", go on.
12. Lifecycle (D11, V1): `rclone backend lifecycle <remote>:<bucket>` → log the rule (days only). Refused or no remote → log "lifecycle not read".

## Part E — No secret copies (D30, D12)

13. `ls -a ~/email_assistant ~` for `.env.bak*` and `*.env.bak*` (names only).
14. For each file: its key names minus the key names of `.env` ∪ `deploy/db.env`. Empty → `rm` it and record the name. Not empty → keep it, record the extra key names, add an owner item to `notes/owner-later.md`.

## Part F — Record

15. `docs/capabilities/backups.md`: the checked facts (date, cron time, bucket listing result or "owner step", lifecycle days or "not read"). `notes/2026-11-15-vps-deploy-queue.md`: releases N and N+1, rollback target, backup name. Commit by explicit path.

**Done when.** Steps 1–15 recorded with their outputs; `server env ok`; no `.env.bak*` left or each kept file is in `notes/owner-later.md`.

**Out of scope.** The second-org run and S6 close (stage 05); the restore drill (F114 stage 09); any change of the bucket or its keys.
