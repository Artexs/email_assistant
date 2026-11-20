---
opened: 2026-11-20
landed: 2026-11-20
---

# F158 · /tmp never fills up from job caches because a periodic cleanup removes stale cache files

## Outcome

The `/tmp` folder on the owner's machine (RAM, 16 GB, 1,048,576 files) no longer fills up during a busy day of jobs. The two caches that filled it move to the SSD, and a daily systemd cleanup deletes cache files that nobody used in the last 24 hours. This happened on 2026-11-14 and 2026-11-20 ("Disk quota exceeded", "Failed to start process"). Findings: `notes/2026-11-20-tmp-cleanup-handoff.md` § Findings.

## Scope

- Owner decisions (2026-11-20): only the Node compile cache and the Playwright transform cache move; `/tmp` stays RAM. Age limit 24 h, measured from the last use. No custom cleanup script, no cron.
- `~/.config/environment.d/60-caches.conf`: `NODE_COMPILE_CACHE=${HOME}/.cache/node-compile-cache`, `PWTEST_CACHE_DIR=${HOME}/.cache/playwright-transform-cache`.
- `~/.config/user-tmpfiles.d/caches.conf`: `e` lines with age `1d` for both SSD caches, the old `/tmp` cache paths, and `/tmp/f[0-9]*` job folders. Enable `systemd-tmpfiles-clean.timer` (user).
- Keep both files in the repo with one idempotent install script (seam: `scripts/machine/`), so a reinstall restores them. Add an alert line to `docs/known-alerts.md`.

## Out of scope

- A bigger `/tmp`, or `/tmp` on disk for all programs.
- Other users' or other programs' files; `node_modules/.cache/`.

## Acceptance

- `systemd-tmpfiles --user --cat-config` shows the three rules; `systemctl --user list-timers` lists `systemd-tmpfiles-clean.timer`.
- Scratch test: a file with atime and mtime 25 h old is deleted by `systemd-tmpfiles --user --clean`; a file used 1 h ago stays.
- In a shell with the new env, `bunx tsc --version` writes into `~/.cache/node-compile-cache`, not `/tmp`.
- Running the install script twice changes nothing the second time.

## Notes

- "Last use": tmpfiles uses the newest of atime, mtime and ctime. Both mounts use `relatime`, so a file read many times updates atime at most once in 24 h. A cache file in daily use can therefore be deleted; the cost is one rebuild of that entry, which is accepted.
- The env reaches Limen jobs only after the owner logs in again (Herdr inherits the session env). The install script prints that line.
- Plan not needed: one worker job, machine-local, cheap to undo (delete two files, disable the timer).
