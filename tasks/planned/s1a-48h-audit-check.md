> **Status 2026-11-04 — blocked until 2026-11-05T23:30Z.** Left: everything. Do not start before that time (UTC).

> **Blocked until:** 2026-11-05T23:30Z (UTC). Check the time first: `date -u`.
> **Why:** the 48-hour test runs on the VPS until 2026-11-05T23:12Z; the cron end script runs the audit at 23:17Z and writes `~/ea-logs/audit.log`.
> An earlier check finds no audit result. Never run the end script, the audit or a cron change early: it stops or spoils the test.
> **Before that time, an agent may only:** read the logs, for example `tail ~/ea-logs/seed.log` (read-only).

# S1a 48-hour sync test — final check

Scope: follow-up of `tasks/done/s1a-imap-read-pilot-host.md` step 17.1. The user closed S1a on 2026-11-04 before the test ended,
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
6. Log the results in this file and in the S1a log (`tasks/done/s1a-imap-read-pilot-host.md`), then `git mv` this file to `tasks/done/`.

## Done-checklist
- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] New alerts in `docs/known-alerts.md`, if any.

## Log
- 2026-11-04: Created at the S1a close (user request).
