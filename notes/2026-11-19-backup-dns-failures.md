# Backup failures 2026-11-18, 2026-11-19: B2 DNS error and a 401

Job: diagnose why the VPS nightly backup failed (`deploy/backup.sh`, cron 03:30 UTC, log `~/ea-logs/backup.log` on `ssh home_vm`).
All VPS commands were read-only (list at the end). The VPS was not changed.

## Facts (seen on the VPS, 2026-11-19 ~18:25 UTC)

- `backup.log` has `backup ok` lines for 2026-11-04 to 2026-11-17. For 2026-11-18 and 2026-11-19 it has one line each, both at 03:30:07:
  `CRITICAL: Failed to create file system for destination "b2:email-assistant/pilot/": failed to authorize account: failed to authenticate: Get "https://api.backblazeb2.com/b2api/v4/b2_authorize_account": dial tcp: lookup api.backblazeb2.com on 127.0.0.53:53: server misbehaving`.
  The run fails 5 to 7 seconds after the start (03:30:0x), so it stops at the first B2 call and the dump step before it worked.
  There is no local `ea-20261118…` or `ea-20261119T0330…` file in `~/ea-backups`.
- Crontab: `PATH=/home/serwer/bin:/usr/local/bin:/usr/bin:/bin`, then `30 3 * * * cd /home/serwer/email_assistant && deploy/backup.sh >> /home/serwer/ea-logs/backup.log 2>&1`.
- `/etc/resolv.conf` is the systemd-resolved stub (`nameserver 127.0.0.53`, `search .`). systemd 249.
- `resolvectl status`: the only link with DNS is `enp0s4`, server `192.168.1.1` (the home router). Tailscale link `tailscale0` has no DNS server and scope none.
- `tailscale dns status`: `Tailscale DNS: disabled`. No resolvers configured. Split DNS only for `ts.net`. So Tailscale does not answer `api.backblazeb2.com`.
- At 18:24 UTC DNS works: `resolvectl query --cache=no api.backblazeb2.com` (3 times) and `getent hosts` (5 times) return `104.153.233.180` and `149.137.142.15`. `resolvectl statistics` shows 12357 transactions.
- Manual runs of the same script work: `ea-20261119T094238Z` (release v0.3.0), `…153213Z` (v0.3.1), `…182245Z` (status.json `ok` at 18:22:56).
- The two failed runs are the only failures since 2026-11-04. The VPS has been up 15 days.

## Proved

1. The failure is a name lookup failure inside the resolver chain, not a B2 or key error. The message names `127.0.0.53:53: server misbehaving`.
   (Go prints "server misbehaving" when the resolver answers with an error code such as SERVFAIL.)
2. It is not the cron environment. The cron `PATH` is fine and DNS does not depend on it. Manual runs and cron runs use the same `rclone` (`~/bin/rclone` = 1.75.2) and resolver.
3. It is not the Tailscale DNS setting. `accept-dns` is off and there is no global resolver there.
4. It is not a standing resolver fault. Lookups work now and in the manual runs of 2026-11-19 (09:42, 15:32, 18:22).
5. The script has no retry. One failed lookup fails the run (`deploy/backup.sh` before this change called `rclone copyto` once).
6. A concurrent run can break a run, but not with a 401 (test, see "401" below).

## Not proved (guesses)

- Why `127.0.0.53` answered with an error at 03:30:07 on two nights. Guess: the upstream router `192.168.1.1` returned SERVFAIL or timed out for a short time around 03:30 (a nightly task of the router, or an upstream outage). Nothing on the VPS shows it.
  Cause not seen: `journalctl -u systemd-resolved` is empty for the user `serwer` ("not seeing messages from other users"; `serwer` is not in `adm` or `systemd-journal`, and `sudo` needs a password).
  To prove it, someone with `sudo` runs on the VPS: `sudo journalctl -u systemd-resolved --since "2026-11-18 03:25" --until "2026-11-18 03:40"` and the same for 2026-11-19. Lines such as `Server returned error: SERVFAIL` or `Using degraded feature set` name the cause. Also check the router log at 03:30.
- That the failure at 03:30 on two nights in a row is a fixed-time cause, and not a coincidence. Two nights show a pattern, not proof.
- No `systemd-resolved` restart or DNS change happened between 2026-11-17 and 2026-11-18 that we know of. Unattended upgrades may have run (`/var/log/unattended-upgrades` was not read).

## The 401 at ~18:22 UTC on 2026-11-19

What the owner reported: a 401 from two backup.sh runs at the same time. The line is not in `~/ea-logs/backup.log` (manual runs print to the terminal). `status.json` at 18:24 shows a good run (`at 18:22:56`, dump `ea-20261119T182245Z`). So one run was good; the other is not recorded.

### Proved

- Concurrency cannot cause a B2 401. Each `rclone` process logs in to B2 on its own. The status file is local and no HTTP call uses it.
- Concurrency does break runs in a different way. Test (scratch copy of the old `backup.sh` with stubs, two runs started at the start of the same second, 3 rounds): both runs use the same file name `ea-<second>.dump.age`, so the same `.part` file. One run fails with `mv: cannot stat '…dump.age.part': No such file or directory`. Both runs also write the same `status.json.tmp` (read from the code, not shown by the test): the last writer wins, and a `failed` status can hide an `ok` run. The file name uses seconds, so two runs in the same second collide; two runs in different seconds do not share the `.part` file.
- A 401 from this bucket is normal for any call that is not a plain write. The B2 key is write-only. On the VPS, `~/bin/rclone lsf b2:email-assistant/pilot --max-depth 1` (rclone 1.75.2) gives `ERROR : error listing: Unknown 401 (401 unauthorized)`.
  Also the apt `rclone` (1.53, first in the PATH of an `ssh home_vm 'cmd'` call, `/usr/bin/rclone`) gives `Failed to create file system for "b2:email-assistant/pilot": Unknown 401 (401 unauthorized)` for the same command. That is the old alert `Failed to copyto: failed to HEAD for download: Unknown 401`.
  My 6 concurrent 1.53 calls (2 at a time, 3 rounds) all gave 401, and one call alone gave 401, so the 401 does not depend on concurrency.

### Not proved (guesses)

- Which command gave the 401 at 18:22. Best guess: a run started without `~/bin` first in `PATH` (for example `ssh home_vm 'cd email_assistant && deploy/backup.sh'`), so `/usr/bin/rclone` 1.53 ran. I did not test `copyto --no-check-dest` with 1.53, because that uploads to the bucket.
  A second possible guess: a manual `rclone` listing or HEAD check with the write-only key.
- The two runs may have been started by the owner or by an agent at the same time. We have no record.

## Change in this commit

- `deploy/backup.sh`:
  - Retry with backoff for the B2 copy: `BACKUP_RCLONE_TRIES` (default 5) and `BACKUP_RCLONE_DELAY` (default 30 s, doubles each time: 30, 60, 120, 240 s; 450 s in total). `rclone copyto --no-check-dest` is safe to repeat. This covers a short DNS or B2 login failure for the nightly run; it does not cover an outage longer than 7.5 minutes.
  - A `flock` lock on `deploy/backup-status/backup.lock` (the file is in `.gitignore`). A second run exits with code 75 and the message `another backup run holds …`. It takes the lock before the exit trap, so the second run does not write `failed` over the first run's status and does not ping. `flock` exists on the VPS (`/usr/bin/flock`, util-linux 2.37.2).
- `deploy/test/backup.test.ts`: tests 6 to 10 (retry success after 2 failures, stop after N tries, doubled waits, bad settings, lock). `writeEnv` sets `BACKUP_RCLONE_DELAY=0` so old tests do not wait.
- `deploy/README.md` § Backups, `deploy/backup.env.example`, `.gitignore`, `docs/known-alerts.md`.
- Not done: the VPS has the old script until the next release (`git pull` and `deploy/release.sh`). The cron job of tonight (03:30 UTC) still runs the old script unless the owner deploys first.
  A failure that lasts longer than the retries still ends in `failed` and the `slo_backup_age` alert after 26 hours; the Healthchecks.io ping (`/fail`) fires at once if `BACKUP_PING_URL` is set.

## VPS commands run (all read-only, as `serwer`)

`date`; `tail backup.log`; `crontab -l`; `cat /etc/resolv.conf`; `resolvectl status | head`; `resolvectl query [--cache=no]`; `resolvectl statistics`; `getent hosts`;
`journalctl -u systemd-resolved` and `journalctl --since/--until` (empty, no rights); `sudo -n` (refused); `tailscale status`, `tailscale dns status`;
`cat deploy/backup-status/status.json`; `ls` of `~/ea-backups`, `~/ea-logs`, `~/bin`, `/tmp`; `ps`; `uptime`; `id`; `last`; `rclone version`;
`rclone lsf b2:email-assistant/pilot` (rclone 1.53 and 1.75.2; read-only, 401 as expected); `rclone config show` with key values hidden by `sed`;
`cat deploy/backup.env` with `AGE_RECIPIENT` hidden; `command -v flock`.
One exception to "read only": the flock check ran `touch /tmp/x-lock-test-never; rm -f …` (an empty temp file, created and removed at once), and the rclone tests wrote and removed `/tmp/ea-rc-a.err` and `/tmp/ea-rc-b.err`.

## 2026-11-20: the 1.53 copy 401 is proved

- A `copyto` upload with the apt `rclone` 1.53.3 fails: two `ssh home_vm` runs of bare `deploy/backup.sh` (16:26Z and 16:34Z) failed 10 of 10 tries with `Failed to create file system for destination "b2:email-assistant/pilot/": Unknown 401`.
- The same script with the cron `PATH` (`PATH=/home/serwer/bin:/usr/local/bin:/usr/bin:/bin`, `rclone` 1.75.2) printed `backup ok` at 16:43Z and 16:45Z. So the B2 key is good, and the old guess (a run without `~/bin` in `PATH`) is the cause of the 401.
- Logs: `~/ea-logs/f108-s04c/` on the VPS (`05-backup.log`, `05b-rclone-probe.log`, `05c-backup-cron-path.log`). Record: `notes/2026-11-15-vps-deploy-queue.md` § F108 rollout.
- Over ssh, always run `PATH=$HOME/bin:$PATH deploy/backup.sh`.
