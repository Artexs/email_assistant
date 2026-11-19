# F108 stage 04 — VPS: release N and the env split [risky]

Part of [`../plan.md`](../plan.md). A coordinator run on the VPS (`ssh home_vm`, `~/email_assistant`). Needs stages 01–03 landed; stage 05 is not landed (D4). VPS deploys are pre-approved (owner, 2026-11-13). Risk: production; the pilot runs on this host.

## Carry-over reads

`docs/release-checklist.md`; `deploy/README.md` § Release, § Env split; `notes/2026-11-15-vps-deploy-queue.md` (last release, open items); the outcomes of stages 01–03.

## Rules (also for stage 06)

- Before anything: `df -h /` (under 5 GB free → stop, tell the owner); `git status` clean; the state file has `pending` empty. Write the rollback target into the queue note before each release.
- Never print a value of `.env`, `deploy/db.env`, `backup.env`, the crontab or the rclone config. Key names only (`cut -d= -f1`); crontab lines are counted or shown with everything after `cd <repo> &&` cut off.
- Each step records its command and result line in `notes/2026-11-15-vps-deploy-queue.md` § "F108 rollout".
- A failed step: stop, roll back by checklist step 11, record, report. Never `down -v`; never a DB restore without the owner.

## Part A — Release N (expand)

1. Check that `master` has stages 01–03 and not stage 05. Make release N by `docs/release-checklist.md` steps 1–8 (`release:prepare` commit, green CI, tag). It may carry other landed work.
2. `deploy/release.sh vN` (run by the current release's script; its migrate step uses `cli`, which still works at N).
3. Checks: `release ok vN previous <old>`; health 200; sync lines within 10 minutes; `ops:alerts` none; with the old `C=` form (db.env does not exist yet), `$C run --rm -T migrate` exits 0 with no migration pending (proves the new service on the host).

## Part B — Split the env

4. V3: the key names of `.env` include the three passwords (and say whether `MIGRATOR_DATABASE_URL` is there). Any other shape: stop and report (the plan does not cover it).
5. `deploy/backup.sh` → `backup ok <name> <bytes>` (the database backup before the change; no copy of `.env`).
6. `deploy/env-split.sh` → `env split ok moved=<3|4>`. Then `ea_env_split_state` (source the helper) → `split`; `stat -c %a deploy/db.env` → `600`.
7. With the new `C=` line: `$C config --quiet` exits 0 and prints nothing; `$C ps` shows `server` and `db` healthy. No restart is needed: the running server still has its old env until the next `up`.
8. `$C up -d --wait server` (same image, new env source). Health 200; `printenv EA_RELEASE` = `vN`; sync lines go on.

## Part C — Cron and one-off lines

9. `crontab -l`: count lines that hold `--env-file .env`. For each, replace `--env-file .env` with `--env-file deploy/db.env` (`crontab -l | sed … | crontab -`). Count again: 0. Keep the old crontab in a mode-600 file under `~/ea-logs/` until stage 06 ends, then delete it.
10. The next nightly backup (or a manual `deploy/backup.sh`) prints `backup ok`; `status.json` `result` = `ok`.

## Part D — Record

11. Queue note: release N, its rollback target, the backup name, `moved=<n>`, the cron count before and after. Tell the coordinator: stage 05 may be spawned now.

**Done when.** Steps 1–11 recorded with their output lines; state `split`; no crontab line holds `--env-file .env`; the pilot syncs.

**Rollback.** Before step 6: `deploy/rollback.sh` as usual. After step 6 and before stage 06: a rollback from N goes to the release before N, which reads only `.env`, so `rollback.sh` refuses; run `deploy/env-split.sh --undo`, undo the cron edit from the saved file, then `deploy/rollback.sh`.

**Out of scope.** The contract release and the backup and bucket checks (stage 06).
