# F114 stage 04 review (Opus 5.5, PASS 0815ac4c)

Model: Opus 5.5, because the stage edits `deploy/backup.sh` and `deploy/compose.yaml` (the backup of real data, the deploy path). No BLOCKING.

Fixed in one Sonnet continue (no re-review): TG-1 (a `BACKUP_PING_URL` with a trailing slash had no test; the mutation that removed `%/` survived).

Verified with a stub harness (temp dirs, no real data): `backup.sh` exits non-zero, writes `failed`, pings `<url>/fail` once and leaves no `.part` file for a bad dump (no `PGDMP` magic), pg_dump failing after the magic, age failing, a missing `AGE_RECIPIENT`, a syntax error in backup.env and SIGTERM during the dump; the ping URL is never printed; a good run without curl still exits 0; the status file goes through a temp file and `mv`; the check reads UTC times; an empty, corrupt or mis-shaped file gives firing with `missing=1`; compose mounts `./backup-status:/run/ea-backup:ro` and the dev override turns the check off; the fact names match the stage 03 texts; with no status file there is one alert and then one repeat per `SLO_REPEAT_H`, not a storm.

Notes for stages 05, 07 and 09:
- Stage 05: `release.sh` must read the stdout of `backup.sh` only: a failed ping prints `backup ping failed` on stderr after the `backup ok` line. `compose-backup-status.test.ts` pins `volumes` with `toEqual([one entry])`: a later server volume must update that test. Stage 05 adds `server.build.args` above the edited block: expect a clean text merge.
- Stage 07: the drill override inherits the mount and the env key. The drill clone has no status file, so the drill server sends `slo_backup_age` (stage 09 step 14 knows). Do not `!reset` the server volumes.
- Stage 09 step 4 (V1): compare the container `statfs("/")` with `df -B1 /` on the host and set `SLO_DISK_PATH` when they differ; on a host with several data volumes the overlay can show the wrong volume as OK (plausible, not proven). Step 0 runs the new `backup.sh` before the new server starts.
- N1 (plausible): a far-future `last_ok_at` (host clock error) counts as age 0 and keeps the check clear until that time plus 26 h. A failed run still fires. Possible fix: treat `last_ok_at` more than a few minutes ahead of now as firing.
- N2: when the status folder is not writable a good run exits 0 and pings success; stderr says `backup: cannot write ...`; the server check then fires on the missing or stale file.
- N3 (plausible): a non-existing `SLO_DISK_PATH` makes `checkDisk` throw every tick: only a `slo_check_failed` warn every 5 minutes, no alert.
- N4: `BACKUP_STATUS_FILE` is set in compose `environment` above `.env`: production turns the check off only with an override (D9). Runbook only.
- shellcheck is not installed on this machine: not run.
