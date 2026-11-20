---
opened: 2026-11-20
---

# F158 · /tmp never fills up from job caches because a periodic cleanup removes stale cache files

## Outcome

The `/tmp` folder on the owner's machine (RAM-backed, 16 GB, 1,048,576 files) no longer fills up during a busy day of jobs. A periodic cleanup removes stale cache files, so a job never fails with "disk quota" or "Failed to start process". This happened on 2026-11-14 (823,000 files in `/tmp/node-compile-cache`) and again on 2026-11-20 (about 660,000 files, 92 % of the file limit).

## Scope

- A systemd user timer (hourly) and a small script that removes files older than 3 hours in `/tmp/node-compile-cache` and `/tmp/playwright-transform-cache-*`, and leftover job folders older than 24 hours that match the job naming (`f<NNN>*`).
- Never touch a file that a running job holds; age is the guard. A cleanup run never fails a job.
- Also decide: move `NODE_COMPILE_CACHE` and the Playwright cache to a folder on the SSD (`~/.cache/`), which removes the cause. The cache then survives a reboot and keeps its speed gain.
- Add the install step to the machine setup doc and a line to `docs/known-alerts.md` (alert text, cause, fix).

## Out of scope

- Making `/tmp` bigger or turning it from RAM into a disk folder for all programs.
- Cleaning folders of other users or other programs.

## Acceptance

- After a run, `df -i /tmp` shows under 50 % file use while ten jobs run.
- `systemctl --user list-timers` lists the timer, and the cleanup log names how many files it removed.
- A file younger than the age limit stays after a run (one test with a scratch folder).
