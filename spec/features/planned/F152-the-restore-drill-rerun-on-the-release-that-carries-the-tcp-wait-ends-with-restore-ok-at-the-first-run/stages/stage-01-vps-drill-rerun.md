# F152 stage 01 — drill rerun on the VPS and the record

Coordinator only: a VPS run (pre-approved, about 10 minutes), no worker job. Needs a live release that carries F139 stage 01 (`wait_db_tcp` in `deploy/restore.sh`; `v0.4.2` or later, `v0.4.3` is live) and no release run in flight (D2: the `v0.4.4` release job must end first). May run next to stage 02 (no shared file).

Part of [`../plan.md`](../plan.md). Not `[risky]`: project `ea-drill` only, no live change.

## Before the start

1. On the VPS: the release state file shows `pending=` empty; no `release.sh` or `rollback.sh` process runs (`pgrep -f 'deploy/(release|rollback).sh'` prints nothing); the last release's 30-minute watch has ended (D2). Not between 03:00 and 04:00 host time; `df -h /` shows at least 5 GB free (D3). If one fails: wait, or stop and record why (no drill this run).
2. Write down `T` = the `current=` tag of the state file. `T` must carry `wait_db_tcp` (`git -C <live repo> show T:deploy/restore.sh | grep -c wait_db_tcp` ≥ 1). Else stop (D1, Q1).

## Steps

Follow `deploy/README.md` § VPS lost / Drill at tag `T`, in project `ea-drill`. Never the live project, never a Compose profile with the drill files.

1. Write down the id and start time of the live `db` and `server` containers. Write down the live counts (`organizations`, `users`, `mailboxes`, `emails`), run `deploy/backup.sh`, write down its `backup ok <name> <bytes>` line and the counts again.
2. Make a fresh clone at `T` (for example `~/ea-drill`). Run `docker volume ls -q --filter name=ea-drill_`. It must print nothing (D4).
3. In the clone: `deploy/restore.sh --target drill --init-env <live repo>/.env`. If step 2 printed a volume: now run `deploy/restore.sh --target drill --down`, run step 2's check again (it must print nothing), then `--init-env` again (D4).
4. On this PC (the age key stays here): `age -d -i ~/ea-backup-key.txt <file>.dump.age | ssh <host> 'cd <clone> && deploy/restore.sh --target drill --stdin'`, with the backup of step 1 (copy the encrypted file from the VPS to this PC first if the B2 read key is not at hand). Save the full output to a log file on this PC. Run it once (D5).
5. `deploy/restore.sh --target drill --down`; delete the clone. `docker volume ls -q --filter name=ea-drill_` prints nothing. The live container ids and start times are the same as in step 1.

## Pass

- The first run ends `restore ok target=drill seconds=<n>`; the output holds `db ready probes=<p>` and `credentials ok=<k> failed=0`; no line `restore failed at`.
- Each drill count line (`count organizations=… users=… mailboxes=… emails=…`) lies between the live counts before and after the backup.
- The live `db` and `server` ids and start times did not change.

## Record

- `notes/2026-11-15-vps-deploy-queue.md`: new section "Restore drill record 2 (<date>, F152)": tag `T`, backup name and bytes, `seconds=<n>`, wall time, `probes=<p>` with the D6 meaning, counts before / drill / after, `credentials ok=<k> failed=0`, the live container check, the cleanup, and "the `migrate` service path ran on a host" (D7).
- `docs/known-alerts.md` § restore drill: status `fixed (drill 2, <date>, <tag>)`. Remove the "drill rerun pending" text.
- `deploy/README.md` § VPS lost: the measured time of drill 2 next to the first drill; remove "The drill rerun that confirms this is pending." § Drill: replace the pointer to the F114 stage file by "the steps below" (the result is now written).
- `docs/capabilities/backups.md`: one line with the drill 2 result next to the first drill line.
- Commit these four files with explicit paths; the commit message names F152 stage 01.

## On a failure (D5)

Keep the drill stack up, save `$C logs db` (`C` as in `restore.sh` for the drill) to the VPS log folder, write the failure line and the last 20 log lines with no secret into the queue note record, then `--down` and delete the clone. `docs/known-alerts.md`: `open: drill 2 failed at <step>, <date>`. File a new ticket with the failure line. Close F152 with the record: the rerun is a record, not a block (owner rule 2026-11-20).

**Done when.** The four record files are committed and § Pass holds, or the failure record and the new ticket exist.
