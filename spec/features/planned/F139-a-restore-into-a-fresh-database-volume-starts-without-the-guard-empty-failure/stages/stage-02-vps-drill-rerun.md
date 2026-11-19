# F139 stage 02 — drill rerun on the VPS

Coordinator only (VPS run, pre-approved, about 9 minutes). Needs the release that carries stage 01 (`wait_db_tcp` in `deploy/restore.sh`); the board names v0.4.2. A record, not a block (D7): if no such release exists when stage 01 lands, file a follow-up ticket "drill rerun on the release that carries the restore TCP wait" and close F139.

Part of [`../plan.md`](../plan.md).

## Steps

Follow `deploy/README.md` § VPS lost / Drill at the release tag, in project `ea-drill`. Never the live stack, never a Compose profile.

1. Write down the id and start time of the live `db` and `server` containers. Run `deploy/backup.sh`; write down the live counts before and after (`organizations`, `users`, `mailboxes`, `emails`).
2. In a fresh clone at the release tag: if a `deploy/drill.env` or an `ea-drill` volume is left from earlier, run `deploy/restore.sh --target drill --down` first. The run must start on a fresh volume, else it does not test the fix.
3. `deploy/restore.sh --target drill --init-env <live repo>/.env`.
4. From the owner's machine (the age key stays there): `age -d -i ~/ea-backup-key.txt <file>.dump.age | ssh <host> 'cd <clone> && deploy/restore.sh --target drill --stdin'`. Run it once. Do not rerun on failure: a failure is the result.
5. `deploy/restore.sh --target drill --down`; delete the clone. Check that the live container ids and start times did not change.

## Pass

- First run ends with `restore ok target=drill seconds=<n>`; the output holds `db ready probes=<p>` and `credentials ok=<k> failed=0`; no line `restore failed at`.
- Each drill count lies between the live counts before and after the backup.
- Live `db` and `server` ids and start times are the same as in step 1.

## Record

- `notes/2026-11-15-vps-deploy-queue.md`: a new section "Restore drill record 2" with the tag, the backup name, the seconds, `probes=<p>`, the counts, the live container check and the cleanup. `p` > 1 shows the init phase was seen; `p` = 1 means the probe did not see it (write that; the fix still holds by test 1 of stage 01).
- `docs/known-alerts.md` § restore drill: status `fixed (drill 2, <date>, <tag>)`.
- `deploy/README.md` § VPS lost: add the measured time of drill 2 next to the first drill.
- If the release also carries the migrate-service change of the production-on-VPS ticket (F108 stage 01, `deploy/compose-lib.sh`), say so in the record: F108 stage 07 cites this rerun as its V4 proof.

On a failure: keep the stack up for a look (`restore.sh` leaves it), save `$C logs db` to the record without secrets, then `--down`, and reopen the work as a new ticket with the failure line.
