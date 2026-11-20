# F108 stage 04 — VPS: release N and the env split [risky]

A coordinator run on the VPS (`ssh home_vm`, `~/email_assistant`); no worker job. Needs release N = tag `v0.4.2` (`34374ba0`: stages 01–03, not stage 05, D4). Needs the record of the LLM key cleanup on the VPS (one-provider LLM config, F141 owner step O1): `v0.4.2` does not start with a removed LLM key in `.env`.

Part of [`../plan.md`](../plan.md). VPS deploys are pre-approved. Risk: production; the pilot runs on this host. Reads: `docs/release-checklist.md`; `deploy/README.md` § Release, § Env split, § LLM provider tiers; `notes/2026-11-15-vps-deploy-queue.md`.

## Rules (also for stage 06)

- First: `df -h /` (under 5 GB free → stop, tell the owner); `git status` clean; `pending` empty in the state file. Record the rollback target before each release.
- Never print a value of `.env`, `deploy/db.env`, `backup.env`, the crontab or the rclone config. Key names only (`cut -d= -f1`); crontab lines are counted or shown with everything after `cd <repo> &&` cut off.
- Each step records its command and result line in the queue note § "F108 rollout".
- The nightly backup holds a lock for up to about 10 minutes. Start no release and no manual `deploy/backup.sh` near its cron time. `another backup run holds …` (exit 75; a release fails at step `backup`, before `pending`) changed nothing: wait, then run again. `rclone copyto try … failed` lines before `backup ok` are retries.
- A failed step: stop, roll back by checklist step 11, record, report. Never `down -v`; never a DB restore without the owner.

## Part A — Release N (expand)

The VPS runs `v0.4.1`. Make no new release commit or tag.

1. Check: the tag's `deploy/release.sh` has no `check-server-env.sh` call; CI on its commit is green; the F141 O1 record exists and the removed LLM keys are gone from `.env` (names only). No record → stop: it is an owner step with a model check. If another run (the reply-drafts pilot, F115 stage 18) already deployed `v0.4.2`, record that and go to step 3.
2. `deploy/release.sh v0.4.2` (the `v0.4.1` script runs it; its migrate step uses `cli`, which still works at N). Rollback target: `v0.4.1` (it has the push sender: no push-row steps).
3. Checks: `release ok v0.4.2 previous v0.4.1`; health 200; sync lines within 10 minutes; `ops:alerts` none; with the old `C=` form, `$C run --rm -T migrate` exits 0, no migration pending.

## Part B — Split the env

4. V3: the key names of `.env` include the three passwords (and say whether `MIGRATOR_DATABASE_URL` is there). Any other shape: stop and report. The tool refuses (exit 2, no write) a D5 line with `export`, an indent, or a key twice: fix it by hand, then run again.
5. `deploy/backup.sh` → `backup ok <name> <bytes>` (the database backup before the change; no copy of `.env`).
6. `deploy/env-split.sh` → `env split ok moved=<3|4>`. Then `ea_env_split_state` (source the helper) → `split`; `stat -c %a deploy/db.env` → `600`.
7. With the new `C=` line: `$C config --quiet` exits 0, prints nothing; `$C ps` shows `server` and `db` healthy.
8. `$C up -d --wait server` (same image, new env source). Health 200; `printenv EA_RELEASE` = `v0.4.2`; sync lines go on.

## Part C — Cron and one-off lines

9. `crontab -l`: count lines that hold `--env-file .env`. Replace each with `--env-file deploy/db.env` (`crontab -l | sed … | crontab -`). Count again: 0. Keep the old crontab in a mode-600 file under `~/ea-logs/` until stage 06 ends.
10. The next nightly backup (or a manual `deploy/backup.sh`) prints `backup ok`; `status.json` `result` = `ok`.

## Part D — Record

11. Queue note: release N, its rollback target, the backup name, `moved=<n>`, the cron count before and after, and the line `env split ok`. Tell the coordinator: stage 05 may be spawned now.

**Done when.** Steps 1–11 recorded with their output lines; state `split`; no crontab line holds `--env-file .env`; the pilot syncs.

**Rollback.** Before step 6: `deploy/rollback.sh` as usual. After step 6 and before stage 06: the target `v0.4.1` reads only `.env`, so `rollback.sh` refuses; run `deploy/env-split.sh --undo`, undo the cron edit from the saved file, then `deploy/rollback.sh`.

**Out of scope.** Stage 06 work.
