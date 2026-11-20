# F108 stage 06 — VPS: the contract release, backup checks, no secret copies [risky]

A coordinator run on the VPS and on this PC; no worker job. Needs the release that carries stage 05 (the guards, `check-server-env.sh` in verify; the board names it v0.4.3). Needs stage 04: its record (state `split`) and the saved crontab file under `~/ea-logs/`.

Part of [`../plan.md`](../plan.md). The rules of stage 04 § Rules apply. Risk: production; the pilot runs on this host.

## Carry-over reads

Stage 04 record in `notes/2026-11-15-vps-deploy-queue.md`; `docs/release-checklist.md`; `deploy/README.md` § Env split, § Backups; `docs/capabilities/backups.md`; `notes/owner-later.md`.

## Part A — The first release with the contract

1. Before the release: `ea_env_split_state` → `split`. Else stop: run stage 04 Part B first.
2. Find the release that first holds stage 05. If another ticket already deployed it, skip to step 3 and use that release. Else make release N+1 by the checklist and run `deploy/release.sh vN+1` (N = `v0.4.2`; its script runs it: it migrates through `migrate`, it has no guard and no env check yet, so step 3 is the check). Rollback target: N.
3. `deploy/check-server-env.sh` → `server env ok keys=<n>`. `$C run --rm -T cli env | cut -d= -f1` holds no D5 key (names only). `$C config --format json` is never printed; the stage 05 tests cover its content.
4. 30-minute watch (checklist step 10). On trouble: `deploy/rollback.sh` (to N; it works on a split host).

## Part B — Backups (read only, P23)

5. VPS: the crontab has one `deploy/backup.sh` line (show it cut as in stage 04 § Rules). `deploy/backup-status/status.json` is the truth: `result` = `ok`, `last_ok_at` under 26 h old (print those two fields only). In `~/ea-logs/backup.log`: the last `backup ok <name> <bytes>` line (its name equals `name` in `status.json`); the counts, never the lines, of `rclone copyto try` and `another backup run holds` over the last 7 days. A lock line means two runs overlapped: check for a second cron line or a manual run, and record it.
6. `bun run ops:alerts` (through `cli`): no open `slo_backup_age` (P4). Record whether `OPERATOR_TELEGRAM_CHAT_ID` (in `.env`) and `BACKUP_PING_URL` (in `deploy/backup.env`) have a value: "set" or "empty", never the value. Empty = F114 owner steps U2 or U3 still open; say so in the report.
7. Bucket (D10, V2), on this PC: `rclone listremotes` (names only). A remote for the backup bucket with read access → `rclone lsl <remote>:<bucket> | sort -k2,3 | tail -n 3` (names, sizes, times). The newest name equals `name` in `status.json`. No such remote → record "bucket listing: owner step O1" and go on.
8. Lifecycle (D11, V1): `rclone backend lifecycle <remote>:<bucket>` → record the days of the rule. Refused or no remote → "lifecycle not read".

## Part C — No secret copies (D30, D12)

9. Find candidates by name only: `ls -a` of `~`, `~/email_assistant`, `~/email_assistant/deploy` for `*.bak*`, `*.env.*` other than `deploy/*.example`, `backup.env`, `db.env`, `drill.env` and `sim.env`.
10. For each `.env` copy: a one-off script on the VPS (written to a mode-700 temp folder, deleted after) prints for each key of the copy one word: `same` (an equal line is in `.env` or `deploy/db.env`), `differs` or `missing`, with the key name only. All `same` → `rm` the copy; record its name. Any other → keep it; record the key names and the words; add an item to `notes/owner-later.md` ("an old env copy holds values the live env lacks: keep or delete?").
11. Delete the crontab copy from stage 04 step 9.

## Part D — Record

12. `docs/capabilities/backups.md`: date of the check, cron time, bucket listing result or "owner step O1", lifecycle days or "not read", the F108 env layout line. Queue note: release N+1, rollback target, check outputs. Commit by explicit path (on `master` through the normal coordinator flow).

**Done when.** Steps 1–12 recorded with their output lines; `server env ok`; no `.env` copy left, or each kept one is in `notes/owner-later.md`.

**Out of scope.** The second-org run and the S6 close (stage 07); the restore drill (F114 stage 09); any change of the bucket, its keys or `backup.env`.
