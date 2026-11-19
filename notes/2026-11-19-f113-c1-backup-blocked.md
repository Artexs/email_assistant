# F113 C1 blocked: VPS backup fails with B2 401 (2026-11-19)

Job `2026-11-19-f113-live-lab-day-on-the-vps-99533a8f`. Runbook step 3 (backup first) failed. No sim step ran.

## Observed (ssh home_vm, ~/email_assistant, checkout v0.3.1, state `current=v0.3.1`)
- `df -h /`: 20 GB free (rule: stop under 5 GB). Disk is fine.
- `deploy/backup.sh` (run twice, 18:22 UTC): `Failed to create file system for destination "b2:email-assistant/pilot/": Unknown 401 (401 unauthorized)`.
- `deploy/backup-status/status.json` now says `result: failed`, `at 2026-11-19T18:22:54Z`, `last_ok_at 2026-11-19T15:32:22Z`. The two runs of this job wrote the failed status. The `slo_backup_age` alert fires when the last good backup is older than 26 h (about 2026-11-20 17:32 UTC).
- The nightly cron (03:30) uses the same script, so it will fail the same way until the B2 credential works again.
- Cause: guess only. The B2 application key (rclone config on the VPS) expired, was revoked or was rotated. Not verified. The fix needs a B2 secret that the coordinator cannot get itself.

## Rollback target if the lab goes on without a fresh backup
- Last good backup: 15:32 UTC today (`last_ok_at`). Production: `ea-server:v0.3.1` current, `ea-server:v0.3.0` previous.
- The sim stack never touches production rows (own project, network, volumes).

## Not done
Steps 3 to 13 of the runbook: no build, no `deploy/sim.env`, no `ea-sim` container, no run, no score.

## Next
Owner or coordinator: fix the B2 credential (or accept the 15:32 backup as the rollback point), then resume at runbook step 4 (build `ea-sim-base:v0.3.1`).
Month spend of the lab machine ledger (`~/.local/state/email-assistant/eval-spend.jsonl`): $2.77 for November, so a $1 day run fits the $20 cap. The VPS ledger starts empty.

## Earlier nightly failures (`~/ea-logs/backup.log` on the VPS)
- Cron runs of 2026-11-18 03:30 and 2026-11-19 03:30 failed too, with a different error: DNS lookup of `api.backblazeb2.com` on `127.0.0.53:53` "server misbehaving". Last cron success: 2026-11-17.
- The 15:32 UTC backup today worked (status file). At 18:22 the error became 401 unauthorized. So two different faults appeared in two days (DNS, then 401). The cause of the 401 is not known.
