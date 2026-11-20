# Handoff: /tmp fills up from caches; periodic cleanup and move to SSD (F158)

Written 2026-11-20 by the coordinator. The next agent has no chat history.

## Goal (owner)
Understand why `/tmp` is RAM, stop it from filling, and decide: (1) move the big caches to the SSD, (2) add a periodic cleanup (timer or cron) of stale files. Owner wants to discuss details first, then the ticket is built.

## Facts observed (2026-11-20, commands run)
- `/tmp` is tmpfs: `mount | grep " /tmp "` -> `tmpfs on /tmp type tmpfs (rw,nosuid,nodev,nr_inodes=1048576,inode64,huge=advise,usrquota)`. Size 16 GB (RAM is 31 GB). File limit 1,048,576.
- Before cleanup: 13 GB used, 962,115 files (92 % of the file limit). Two cache folders held almost all of it:
  - `/tmp/node-compile-cache`: 8 GB, about 660,000 files (Node/Bun compile cache).
  - `/tmp/playwright-transform-cache-1000`: 1.1 GB, about 87,000 files.
- Effect: writes fail with "Disk quota exceeded" or "Failed to start process". Seen on 2026-11-20 in a land check, a `check:job` run, a worker's backup, and `limen ticket check`. Same incident on 2026-11-14 (823,000 files; `notes/2026-11-14-handoff-after-compaction.md` lines 15-18; it already suggested setting `NODE_COMPILE_CACHE` outside `/tmp`).
- Nothing cleans `/tmp` except a reboot. No systemd timer for it exists (`systemctl --user list-timers` shows none).
- `NODE_COMPILE_CACHE` and `TMPDIR` are not set in the coordinator shell (`env | grep`). Who sets `/tmp/node-compile-cache` is not yet checked (guess: Node or Bun default).
- Cleanup done at the end of this session, with the owner's stated intent (delete cache files older than 180 minutes in the two cache folders): `/tmp` now 5.8 GB used (38 %), 471,265 files (45 %).

## Ticket
`spec/features/planned/F158-tmp-never-fills-up-from-job-caches-because-a-periodic-cleanup-removes-stale-cache-files/ticket.md` (commit 819803ad). Scope: hourly systemd user timer plus script (remove cache files older than 3 h, job folders `f<NNN>*` older than 24 h), and decide moving `NODE_COMPILE_CACHE` and the Playwright cache to `~/.cache/`. Needs a plan (`--role planner`) before a build.

## Open questions to discuss
1. Move the caches to the SSD (`~/.cache/`)? Cost: SSD writes and a slower cold start; gain: no RAM use, survives reboot. Where is each cache set (env in `scripts/limen-prepare.sh`, Playwright config, shell profile)?
2. Cleanup age limit (3 h proposed) and whether workers hold a cache file open (age is the guard).
3. Timer or cron; does the cleanup also remove old job folders, and which name patterns are safe.
4. Does Limen itself (not this repo) own `TMPDIR` for jobs? Some workers used `/home/artek/.cache/f143-s09-tmp` and `node_modules/.f143-tmp` to avoid `/tmp`.

## Rules to keep
- VPS: standing owner approval (CLAUDE.md). This ticket is about the local machine only.
- Delete only regenerable caches and folders you created. Never delete `node_modules/.cache/`.
- Chat replies to the owner: max 4 lines; write detail to files (`~/.pi/agent/AGENTS.md`).

## Findings (2026-11-20, second session, commands run)
- Who writes `/tmp/node-compile-cache`: `tsc` and `eslint` call `module.enableCompileCache()` (grep hits in `node_modules/typescript/lib/tsc.js` and `node_modules/eslint/bin/eslint.js`). Node puts the cache in `os.tmpdir()/node-compile-cache` when `NODE_COMPILE_CACHE` is not set. Folder `v26.13.1-x64-310b2ce3-1000` holds 250,960 entries.
- Why it grows: the cache key includes the file path. Each Limen worktree has a new path, so each worktree adds a full new copy of the compiled `tsc`/`eslint`/dependency code. Old entries are never read again.
- Playwright: cache dir is `process.env.PWTEST_CACHE_DIR || os.tmpdir()/playwright-transform-cache-<uid>` (`node_modules/playwright/lib`).
- Now: `/tmp` 5.9 GB / 38 %, 473,259 files / 46 %. `node-compile-cache` 2.3 GB, Playwright 118 MB. `/tmp/.mount_lm-*` (2.3 GB in `du`) is an AppImage FUSE mount, not tmpfs data.
- SSD `/home`: 335 GB free.
- systemd has a user `systemd-tmpfiles-clean.timer` (disabled). A user `~/.config/user-tmpfiles.d/*.conf` with an age field cleans folders without a custom script.
- `~/.config/environment.d/` exists (Omarchy uses it); a file there sets env for every user service and session, so also for Limen jobs started from Herdr after a re-login.

## Proposed design (coordinator, for the owner to confirm)
1. `~/.config/environment.d/60-caches.conf`: `NODE_COMPILE_CACHE=$HOME/.cache/node-compile-cache`, `PWTEST_CACHE_DIR=$HOME/.cache/playwright-transform-cache`. Machine config, not repo config, because tsc/eslint in every repo and in Limen do the same.
2. `~/.config/user-tmpfiles.d/caches.conf`: age 2d for both SSD caches; age 24h for `/tmp/f[0-9]*` job folders; enable `systemd-tmpfiles-clean.timer --user` (daily; add a drop-in for hourly if needed).
3. No custom cleanup script, no cron.
