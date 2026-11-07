# s3-assist-actions — Stage 17

Part of [`../s3-assist-actions.md`](../s3-assist-actions.md). Read that file's "Input" and "Rules for every step" first.

## Stage 17 — Backup restore test on the Mac (P6)

- [x] **17.1 Restore one VPS backup into a throwaway container and log the counts**
  - Goal: the done-when item "backups run and one restore test is logged" holds, with a backup made after the S2 tables exist.
  - Files: this task file ("Results": date, backup file name, counts; one log line); `notes/2026-11-03-pilot-vps.md` (append the restore-test date and counts).
  - Interfaces: none (operations). Runbook: `deploy/README.md` § Backups → "Restore test".
  - Decisions:
    - The backup file: the user downloads the latest `.dump.age` from the B2 bucket (web UI) into `~/ea-backups/` on the Mac, or allows `scp home_vm:ea-backups/<latest>.dump.age ~/ea-backups/` (a read of one file on the VPS; the agent asks first, because the VPS rule holds until stage 19). The `age` identity is `~/.config/ea-backup/age-key.txt` (`notes/2026-11-03-pilot-vps.md`; the runbook's example path is different).
    - Command: `deploy/restore-test.sh ~/ea-backups/<file>.dump.age ~/.config/ea-backup/age-key.txt`. It prints the counts of `organizations`, `users`, `mailboxes`, `emails`. The VPS comparison query (`select count(*) from emails`) runs only when the user allows the read, else the counts are compared with the `/status` and digest figures of the same day (approximate: write "not compared with the VPS").
    - Also check `~/ea-logs/backup.log` has a `backup ok` line for each night since the last check (through the user or the allowed read).
  - Test: none (operations).
  - Check: the script exits 0 and prints four count lines; `docker ps -a` has no `ea-restore-test` container afterwards.
  - Done when: the counts and the date are in "Results" and in the VPS note.
  - Out of scope: a restore into the VPS `db`, a change of the backup script.
