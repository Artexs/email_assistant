# F104 stage 13 — Pilot deploy

Part of [`../plan.md`](../plan.md). **[risky]**: the real system with the pilot's mail. **The coordinator runs this stage** (`spec/build.md`: VPS steps are pre-approved; backup first, name the rollback target, verify after). No worker job. One owner step: U1. No other VPS deploy at the same time. Model runbook: `spec/features/done/2026-11/F099-e7-t2-platform-controls-send-limits-feature-flags-operator-console-security-log/stages/stage-15-vps-deploy.md`.

Needs stages 01–12 landed and the `master` CI run of the last land green.

## Before the deploy

1. `git log --oneline <VPS commit>..origin/master`. If another ticket in the list has its own VPS step, do that step first by its runbook, check it, then come back.
2. F104 brings two migrations (`…_sent_mail.sql`, `…_outbox_sent_missing.sql`). Both only add (two tables, a trigger, a CHECK member, a CHECK); the old code works with them.
3. If F103 stage 17 has landed, one-off commands run as `$C run --rm cli …` instead of `$C run --rm server …`.

## Runbook

On the VPS, repo root, `C="docker compose -f deploy/compose.yaml --env-file .env"`; based on `deploy/README.md` § Update.

1. `git rev-parse HEAD`: the rollback commit.
2. `deploy/backup.sh` (or `PATH=$HOME/bin:$PATH deploy/backup.sh`): the last line is `backup ok <name> <bytes>`, else stop.
3. `docker tag ea-server ea-server:pre-f104`.
4. `docker builder prune -f`, then `df -h /`; stop below 3 GB free.
5. `git fetch && git merge --ff-only origin/master`
6. `$C up -d --wait db`
7. `$C run --build --rm server bun run db:migrate`: both F104 files among the `Applying` lines.
8. `T=$(date -u +%Y-%m-%dT%H:%M:%SZ); echo "$T"`
9. `$C up -d --build --wait` (exit 0 = health check passed).
10. Pilot ids: `org:status` (the pilot is the oldest organization, `deploy/README.md` § Customers) and the `active` mailbox of that org by `psql`. Ids stay out of the repo.
11. `$C run --rm server bun run org:flag --org-id <pilot org> --flag sent_sync --on`.
12. **U1:** ask the owner to open Settings → the pilot mailbox → "Sent mail" → turn on "Track my sent mail". The card shows the plain line and "The first read of Sent runs at the next sync." Wait for "done".

## Checks

After the next `mail.sync` run (every `MAIL_SYNC_EVERY_MIN`, default 2 minutes):

1. `$C logs --since "$T" server | grep sent_sync_done` → the pilot mailbox id with `status` `done`, `kind` `initial`, then `incremental` lines.
2. `… | grep -E "sent_sync_failed|sent_sync_mark_failed"` → no line.
3. `… | grep dropped_fields` → no line.
4. `mailbox:settings show --org-id <pilot org> --mailbox-id <pilot mailbox>` → `sent: on, folder Wysłane, stored <n>, last <ISO>, first pass done, error none`, `n` > 0. `n` = 0 means Interia keeps no copy (N2): write it in the note and tell the owner.
5. `psql`: `SELECT content, origin, count(*) FROM sent_emails WHERE mailbox_id = '<pilot mailbox>' GROUP BY 1, 2 ORDER BY 1, 2` (DB user and name as the F099 runbook reads them, never by printing secrets) → counts only; after `ceil(pending / 100)` more runs, `pending` is 0 (N3).
6. `psql`: `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'outbox_kind_check'` → ends with `'sent_missing'`.
7. The card shows "Last sent mail seen: …" (the owner, or a screenshot through the tailnet).
8. Telegram: no `sent_missing` notice now (it can come only after 7 quiet days).
9. Answered marks (N4): `SELECT count(*) FROM sent_emails s JOIN emails e ON e.mailbox_id = s.mailbox_id AND e.message_id_header = s.parent_message_id WHERE s.mailbox_id = '<pilot mailbox>' AND s.origin = 'user'` → a count. 0 means no `In-Reply-To`/`References` from Interia's clients, or no answered mail in the window: write which in the note; with replies the owner knows of, 0 is a finding for E5b.

## After

- `notes/<date>-sent-sync-pilot.md`: the counts of checks 4, 5 and 9 (no subject, no address), the first-pass time from the log, the N2–N4 results. Commit it by explicit path.
- The last land moves the ticket to `done/`.

## Rollback

- Behaviour wrong, server healthy: `org:flag --org-id <pilot org> --flag sent_sync --off`. The pass and the notice stop at once; the card says "paused", and the owner can still turn the switch off (that deletes the rows); else retention clears text and headers.
- Server broken: `docker tag ea-server:pre-f104 ea-server && $C up -d --wait` with the rollback commit checked out. Keep the migrations: the old code ignores the new tables, the trigger and the extra CHECK member.
