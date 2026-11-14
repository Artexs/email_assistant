# F104 stage 12 — Pilot deploy

Part of [`../plan.md`](../plan.md). **[risky]**: the real system with the pilot's mail. **The coordinator runs this stage itself** (`spec/build.md`: VPS, ssh and deploy steps are pre-approved; backup first, name the rollback target, verify after). No worker job. One owner step: U1 (the owner's consent for the existing pilot mailbox). No other VPS deploy runs at the same time (`docs/product/stage-2/05-execution-plan.md` §4). Model: `spec/features/active/F099-e7-t2-platform-controls-send-limits-feature-flags-operator-console-security-log/stages/stage-15-vps-deploy.md` (its lane may be `done/` by then).

Needs stages 01–11 landed and the `master` CI run of the last land green.

## Before the deploy

1. List the commits the deploy brings: `git log --oneline <VPS commit>..origin/master`. If another ticket in the list has its own VPS step, do that step first by its own runbook, check it, then come back.
2. F104 brings two migrations (`…_sent_mail.sql`, `…_outbox_sent_missing.sql`). Both only add: two tables, a CHECK member and a CHECK. The old code works with them (rollback below).
3. If F103 stage 17 has landed, one-off commands run as `$C run --rm cli …` instead of `$C run --rm server …` (F103 D19 c).

## Runbook

On the VPS, in the repo root, `C="docker compose -f deploy/compose.yaml --env-file .env"`; based on `deploy/README.md` § Update.

1. `git rev-parse HEAD` — write it down: the rollback commit.
2. `deploy/backup.sh` (or `PATH=$HOME/bin:$PATH deploy/backup.sh`) — the last line is `backup ok <name> <bytes>`. Stop if it is not.
3. `docker tag ea-server ea-server:pre-f104` — the old image for a fast rollback.
4. `docker builder prune -f`, then `df -h /`. Stop if less than 3 GB is free.
5. `git fetch && git merge --ff-only origin/master`
6. `$C up -d --wait db`
7. `$C run --build --rm server bun run db:migrate` — expect the two F104 files among the `Applying` lines.
8. `T=$(date -u +%Y-%m-%dT%H:%M:%SZ); echo "$T"` — the start time of the checks.
9. `$C up -d --build --wait` — exit 0 means the health check passed.
10. The pilot ids: `$C run --rm server bun run org:status` gives the organization ids (the pilot is the oldest, `deploy/README.md` § Customers); `$C exec db psql … -Atc "SELECT id, status FROM mailboxes WHERE org_id = '<pilot org id>'"` gives the mailbox id (the `active` one). Ids are not secrets; keep them out of the repo.
11. `$C run --rm server bun run org:flag --org-id <pilot org id> --flag sent_sync --on`.
12. Owner step U1: ask the owner to open the panel, Settings → the pilot mailbox → card "Sent mail" → turn on "Track my sent mail". The card must show the plain line and, until the next sync, "The first read of Sent runs at the next sync." Wait for the owner's "done".

## Checks

After the next `mail.sync` run (every 5 min; 2 min after F100 stage 07). Each with its expected result:

1. `$C logs --since "$T" server | grep -E "sent_sync_done"` → a line with the pilot mailbox id, `status` `done`, `kind` `initial`, then later lines with `kind` `incremental`.
2. `$C logs --since "$T" server | grep -E "sent_sync_failed|sent_sync_mark_failed"` → no line.
3. `$C logs --since "$T" server | grep -E "dropped_fields"` → no line.
4. `$C run --rm server bun run mailbox:settings show --org-id <pilot org id> --mailbox-id <pilot mailbox id>` → `sent: on, folder Wysłane, stored <n>, last <ISO>, first pass done, error none` with `n` > 0 (plan N2: Interia keeps webmail and phone-app sends; `n` = 0 means it does not: write it into the note and tell the owner; the card then says "No sent mail in the last 30 days").
5. `$C exec db psql … -Atc "SELECT content, (action_id IS NOT NULL) AS system, count(*) FROM sent_emails WHERE mailbox_id = '<pilot mailbox id>' GROUP BY 1, 2 ORDER BY 1, 2"` (DB user and name as the F099 stage 15 runbook reads them, never by printing secrets) → counts only; after `ceil(pending / 100)` more runs, `pending` is 0 (plan N3).
6. `$C exec db psql … -Atc "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'outbox_kind_check'"` → the list ends with `'sent_missing'`.
7. The panel card shows "Last sent mail seen: …" (the owner or a screenshot through the tailnet).
8. Telegram: no `sent_missing` notice now (the first pass is new; the notice can come only after 7 quiet days).
9. Answered marks on real mail (plan N4): `$C exec db psql … -Atc "SELECT count(*) FROM sent_emails s JOIN emails e ON e.mailbox_id = s.mailbox_id AND e.message_id_header = s.parent_message_id WHERE s.mailbox_id = '<pilot mailbox id>' AND s.origin = 'user'"` → a count (0 means Interia's clients send no `In-Reply-To`/`References`, or the owner answered no stored mail in the window: write which into the note; with replies known from the owner, 0 is a finding for E5b).

## After

- Write `notes/<date>-sent-sync-pilot.md`: the counts of checks 4, 5 and 9 (no subject, no address), the first-pass time from the log lines, N2, N3 and N4 results. Commit it with an explicit path.
- Move the ticket to `done/` with the last land (`limen land` closes it).

## Rollback

- Behaviour wrong but the server healthy: `$C run --rm server bun run org:flag --org-id <pilot org id> --flag sent_sync --off` (the pass and the notice stop at once; the card shows "paused" and the owner can still turn the switch off, which deletes the rows; else retention clears text and headers).
- Server broken: `docker tag ea-server:pre-f104 ea-server && $C up -d --wait` with the rollback commit checked out. Do not roll back the migrations: the old code ignores the new tables and the extra CHECK member.
