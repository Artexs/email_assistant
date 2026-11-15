# F114 stage 04 — Backup status file, backup ping, disk and backup checks

Part of [`../plan.md`](../plan.md). Decisions P1, D6, D9. Needs stage 03 (`SloCheckFn` list in `main.ts`). Edits `compose.yaml`: not next to 05 or 07.

## Step 1 — `deploy/backup.sh` writes a status and pings

- **Status file:** `deploy/backup-status/status.json` (path from the script folder, not from `backup.env`). One line of JSON:
  - ok: `{"result":"ok","at":"<UTC ISO, Z>","name":"ea-….dump.age","bytes":<n>,"last_ok_at":"<same as at>"}`
  - failed: `{"result":"failed","at":"…","name":null,"bytes":null,"last_ok_at":<the old value or null>}`
- **Decisions:**
  - Any non-zero exit after the start writes `failed` (one exit trap), also a bad `backup.env`. The old `last_ok_at` is read from the old file with plain shell tools (no `jq` on the host).
  - Write `status.json.tmp` in the same folder, `chmod 644`, then `mv` (atomic; the script's `umask 077` would hide it from the container user).
  - `deploy/backup-status/.gitkeep` is committed, so the clone owns the folder and Docker never creates it as root; `.gitignore` gets `deploy/backup-status/status.json`.
  - `BACKUP_PING_URL` (new, optional, in `backup.env.example`): success → `curl -fsS -m 10 --retry 3 <url>`; failure → `<url>/fail`. A ping failure prints `backup ping failed` and never changes the exit code. The URL is never printed.
- **Test** (`bun test`, a temp copy of the repo layout, stubs for `docker`, `age`, `rclone`, `curl` on `PATH`; shell tests live in `deploy/test/`, add that path to `test:unit` if no stage did yet):
  1. Good run → exit 0; last line `backup ok <name> <bytes>`; `status.json` `result=ok`, `bytes` = the file size, `last_ok_at = at`; `curl` called once with the URL.
  2. Then `rclone` fails → exit ≠ 0; `result=failed`; `last_ok_at` = the value of run 1; `curl` called with `<url>/fail`; no `.dump.age` and no `.part` file.
  3. `curl` fails on a good run → exit 0; output has `backup ping failed` and not the URL.
  4. `BACKUP_PING_URL` empty → `curl` never called.
  5. After runs 1–2: mode `644`, no `.tmp` file.

## Step 2 — Mount and config

- `compose.yaml` `server`: bind mount `./backup-status` → `/run/ea-backup`, read-only; env `BACKUP_STATUS_FILE=/run/ea-backup/status.json`. The sim and dev compose files stay without it (check off). Keep `deploy/check-logging.sh` and the sim compose check green.
- Config keys (stage 02 pattern): `SLO_DISK_PATH` `/`; `SLO_DISK_FREE_PCT` 15 (1–90); `SLO_DISK_FREE_GB` 2 (0.5–100, decimals); `SLO_BACKUP_MAX_AGE_H` 26 (1–720); `BACKUP_STATUS_FILE` empty = off.

## Step 3 — The two checks

- **Files:** `modules/operator/slo-checks.ts`: `checkDisk(statfs, cfg)` → `SloReading`; `checkBackupAge(readFile, now, cfg)` → `SloReading | null` (null when `BACKUP_STATUS_FILE` is empty). `statfs` (`node:fs/promises`) and `readFile` injected. `main.ts` appends both to the `ops.slo` check list.
- **Rules:**
  - Disk: `free_pct`, `free_gb` (one decimal) from `bavail × bsize` and `blocks × bsize`. Firing: `free_pct < PCT` or `free_gb < GB`. Clear: `free_pct ≥ PCT + 5` and `free_gb ≥ GB + 0.5`. Else between.
  - Backup: zod shape of step 1. Firing: missing, unreadable, bad shape, `result = failed`, or `now − last_ok_at > MAX_AGE_H`. Else clear. Facts `age_h` (−1 when unknown), `failed`, `missing` (0 or 1).
- **Test** (unit, `now = 2026-11-20T10:00:00Z`, defaults):
  6. Disk 14.9 % free of 50 GB → firing; 17 % of 60 GB → between; 20 % and 2.5 GB → clear; 30 % and 1.9 GB → firing.
  7. Backup: no file → firing, `missing = 1`. `ok`, `last_ok_at` 2026-11-19T07:59Z → firing; 2026-11-19T08:01Z → clear. `failed` with a fresh `last_ok_at` → firing, `failed = 1`. Text `{` → firing. Key empty → null.
  8. Text of `slo_backup_age` open with `missing = 1` → line 2 says no status file (stage 03 form).

## Step 4 — Docs

`deploy/README.md` § Backups: the status file, the ping, owner step U2 (`plan.md`). `docs/capabilities/backups.md`: rules and the two Limits lines of E8b updated. `docs/capabilities/operations.md` § Alerts: the two checks.

## Done when

Tests 1–8 pass; the Proof of `plan.md` prints `PROOF_OK`.

## Out of scope

The Healthchecks.io check itself and the `backup.env` value on the VPS (owner step U2, stage 08).
