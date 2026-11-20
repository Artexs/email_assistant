# F152 stage 01 — drill rerun on the VPS and the record

Coordinator only: a VPS run (pre-approved, about 10 minutes). Needs a live release that carries `wait_db_tcp` in `deploy/restore.sh` (`v0.4.2` or later) and no release run in flight (D2: the `v0.4.4` release job ends first). May run next to stage 02 (no shared file).

Part of [`../plan.md`](../plan.md). Not `[risky]`: project `ea-drill` only, no live change.

## Before the start

1. On the VPS: `deploy/release-state/state` shows `pending=` empty; `pgrep -f 'deploy/(release|rollback).sh'` prints nothing; the last release's 30-minute watch has ended (D2). Not 03:00–04:00 host time; `df -h /` shows at least 5 GB free (D3). Note whether `ea-sim` runs (leave it). On a failed check: wait, or stop and record.
2. `T` = the `current=` tag of the state file. `T` must carry `wait_db_tcp` (`git show T:deploy/restore.sh | grep -c wait_db_tcp` ≥ 1), and the newest file of `db/migrations` at `T` must equal `select max(version) from schema_migrations` in the live database (D1). Else stop and record.

## Steps

Follow `deploy/README.md` § Drill at `T`, project `ea-drill` only, no Compose profile.

1. Note the id and start time of the live `db` and `server` containers and the live counts (`organizations`, `users`, `mailboxes`, `emails`). Run `PATH=$HOME/bin:$PATH deploy/backup.sh` (D9); note `backup ok <name> <bytes>` and the counts again.
2. Clone from origin into a new folder, `git checkout T`. Run `docker volume ls -q --filter name=ea-drill_`: it must print nothing (D4).
3. In the clone: `deploy/restore.sh --target drill --init-env <live repo>/.env`. If step 2 printed a volume: run `deploy/restore.sh --target drill --down`, check step 2 again (empty), then `--init-env` again.
4. Copy the encrypted backup of step 1 to a temp folder on this PC. Dry check on this PC: `age -d -i ~/.config/ea-backup/age-key.txt <file>.dump.age > /dev/null` exits 0 (D10). Then, once, with `set -o pipefail`: `age -d -i ~/.config/ea-backup/age-key.txt <file>.dump.age | ssh <host> 'cd <clone> && deploy/restore.sh --target drill --stdin'`; save the full output to a log file on this PC (D5).
5. `deploy/restore.sh --target drill --down`; delete the clone and the temp folder on this PC. `docker volume ls -q --filter name=ea-drill_` prints nothing. The live container ids and start times are the same as in step 1.

## Pass

- The run ends `restore ok target=drill seconds=<n>`; it holds `db ready probes=<p>` and `credentials ok=<k> failed=0`; no line `restore failed at`.
- Each drill `count …` value lies between the live counts before and after the backup.
- The live `db` and `server` ids and start times did not change.

## Record

- `notes/2026-11-15-vps-deploy-queue.md`: section "Restore drill record 2 (<date>, F152: the F139 drill rerun)": `T`, backup name and bytes, `seconds=<n>`, wall time, `probes=<p>` with the D6 wording, counts before / drill / after, `credentials ok=<k> failed=0`, the container check, `ea-sim` state, the cleanup, and "the `migrate` service path ran on a host" (D7).
- `docs/known-alerts.md` § restore drill: status `fixed (drill 2, <date>, <tag>)`; remove "drill rerun pending".
- `deploy/README.md` § VPS lost: drill 2 time next to the first drill; remove "The drill rerun that confirms this is pending." § Drill: replace the pointer to the F114 stage file by "the steps below".
- `docs/capabilities/backups.md`: the drill 2 result next to the first drill line.
- Commit the four files with explicit paths.

## On a failure (D5)

- **Operator error** (D10: the pre-drill backup, the dry check or `age` fails, or `ssh` does not connect): fix the cause, record it, run `--down`, check the volume, `--init-env`, and do step 4 again. This is not a rerun of the restore.
- **Drill failure** (any other `restore failed at <step>`, or no `db ready probes=` line): keep the drill stack up, save `$C logs db` (`C` = the drill command of `restore.sh`) to the VPS log folder, record the failure line and the last 20 log lines (no secret), then `--down` and delete the clone. `docs/known-alerts.md`: `open: drill 2 failed at <step>, <date>`. File a new ticket with the failure line, and close F152 with the record (a record, not a block, owner rule 2026-11-20).

**Done when.** The four record files are committed and § Pass holds, or the failure record and the new ticket exist.
