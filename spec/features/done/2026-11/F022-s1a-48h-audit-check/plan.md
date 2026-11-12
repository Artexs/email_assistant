> **Status 2026-11-06 — done.** The audit shows 2 rows only in the DB (mails deleted from the mailbox); the user accepted it as a pass.

> **Blocked until:** 2026-11-05T23:30Z (UTC). Check the time first: `date -u`.
> **Why:** the 48-hour test runs on the VPS until 2026-11-05T23:12Z; the cron end script runs the audit at 23:17Z and writes `~/ea-logs/audit.log`.
> An earlier check finds no audit result. Never run the end script, the audit or a cron change early: it stops or spoils the test.
> **Before that time, an agent may only:** read the logs, for example `tail ~/ea-logs/seed.log` (read-only).

# S1a 48-hour sync test — final check

Scope: follow-up of `spec/features/done/2026-11/F017-s1a-imap-read-pilot-host/plan.md` step 17.1. The user closed S1a on 2026-11-04 before the test ended,
and asked for this ticket to check the result. Needs: S1a. VPS facts: `notes/2026-11-03-pilot-vps.md`.

## Goal
Prove 48 hours of sync on the pilot mailbox with no lost and no duplicate mail, with hourly seed mail and one forced rescan.

## Done when
- `~/ea-logs/audit.log` on the VPS (`ssh home_vm`) has `missing=0 duplicates=0` and `audit exit 0`, after 2026-11-05T23:12Z.
- `~/ea-logs/rescan.log` shows the rescan of 2026-11-04 11:05 UTC, and the next server sync line has `sync <mailbox id> rescan:`.
- `~/ea-logs/seed.log` has about 48 `appended 1` lines and no errors.
- `crontab -l` has only the `PATH` line and the 03:30 backup line (the end script removed the test lines).
- `~/ea-logs/backup.log` has one `backup ok` line per night.

## Plan
1. `ssh home_vm`, then: `cat ~/ea-logs/audit.log`, `cat ~/ea-logs/rescan.log`, `grep -c 'appended 1' ~/ea-logs/seed.log`,
   `grep -iE 'error|fail' ~/ea-logs/seed.log`, `crontab -l`, `grep 'backup ok' ~/ea-logs/backup.log`.
2. Rescan line: `cd ~/email_assistant && docker compose -f deploy/compose.yaml --env-file .env logs --since 2026-11-04T11:00:00Z --until 2026-11-04T11:20:00Z server | grep rescan`
   (server logs can be gone after a restart; then the rescan log and a clean audit are enough).
3. If the audit fails: do not delete anything. Run the audit again by hand
   (`docker compose -f deploy/compose.yaml --env-file .env run --rm -T server bun run mailbox:audit --org-id ac6ed6a2-ee37-461f-9632-cc08cf549e40 --mailbox-id 8bc7f572-a7f5-4fa5-aaab-db16dc663e96 --since 2026-11-03T23:12:00Z`),
   compare with the server sync log lines, and write the cause in `docs/known-alerts.md`.
   Known trap: Interia keeps the UID when a mail moves between folders (see `notes/2026-11-03-interia-imap-capabilities.md`).
   A mail that the user moves out of INBOX and back during the test is not seen again, but it is already stored, so the audit still counts it.
4. If the end script did not run, remove the test cron lines by hand: `crontab -l | grep -vE 'mailbox:seed|mailbox:rescan|ea-48h-end' | crontab -`.
5. Delete `~/ea-48h-end.sh` on the VPS. The seed mails in the inbox can stay, or the user deletes them (subject `EA seed …`).
6. Log the results in this file and in the S1a log (`spec/features/done/2026-11/F017-s1a-imap-read-pilot-host/plan.md`), then `git mv` this file to `tasks/done/`.

## Done-checklist
- [x] Done-when checks pass (name the command and its output in the log).
- [x] New alerts in `docs/known-alerts.md`, if any.

## Log
- 2026-11-04: Created at the S1a close (user request).
- 2026-11-06 15:10Z: Checks on `home_vm`:
  - `cat ~/ea-logs/audit.log`: `inbox=53 stored=55 missing=0 duplicates=2`, `audit exit 2`, `test cron lines removed` (2026-11-05T23:17:01Z).
  - Audit again by hand: `inbox=54 stored=56 missing=0 duplicates=2`, exit 2 (one new real mail after the test).
  - SQL: no `(message_id_header, content_hash)` pair is stored twice. A one-off read-only script listed the 2 rows that are only in the DB:
    `<193c9961-…@interia.pl>` (received 2026-11-03 23:26Z) and `<20261105151058.52AA710000719@fmx205.krk.prod.pf.iadm>` (received 2026-11-05 15:10Z).
    Both are real mails that left INBOX after the sync stored them. The audit counts such rows as "duplicates". No mail is lost and no mail is stored twice.
  - `rescan.log`: `rescan forced`; server log: `sync 8bc7f572-… rescan: fetched 22, stored 7, uid updated 15, returned 0`.
  - `grep -c 'appended 1' seed.log`: 48; `grep -iE 'error|fail' seed.log`: no lines.
  - `crontab -l`: only the `PATH` line and the 03:30 backup line.
  - `backup.log`: `backup ok` on 2026-11-04, 11-05 and 11-06.
  - IMAP search for both Message-IDs in all 9 folders (read-only script): not found. The mails are deleted from the mailbox.
- 2026-11-06: The user accepted the result as a pass (no lost mail, no double row). `rm ~/ea-48h-end.sh` done (`ls`: no such file). Task moved to `done/`.
