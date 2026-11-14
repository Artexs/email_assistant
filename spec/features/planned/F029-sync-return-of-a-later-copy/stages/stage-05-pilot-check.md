# F029 stage 05 — Pilot check (coordinator runbook)

Part of [`../plan.md`](../plan.md). **The coordinator runs this stage itself** (`spec/build.md`: VPS, ssh and deploy steps are pre-approved; backup first, name the rollback target, verify after). No worker job. No migration. One optional owner step: O1. It checks Not verified NV1 and NV2 and Done when 9.

## When

After stage 04 has landed. The code reaches the VPS with the next deploy of `master`. When another ticket deploys `master` after the stage 04 land, use that deploy and skip the deploy part; else deploy with the steps below. No other VPS deploy runs at the same time.

## Deploy (only when no other deploy carried stage 04)

On the VPS, in the repo root, `C="docker compose -f deploy/compose.yaml --env-file .env"`; based on `deploy/README.md` § Update.

1. `git rev-parse HEAD` — write it down: the rollback commit.
2. `deploy/backup.sh` (or `PATH=$HOME/bin:$PATH deploy/backup.sh`) — the last line is `backup ok <name> <bytes>`. Stop if it is not.
3. `docker tag ea-server ea-server:pre-f029` — the old image for a fast rollback.
4. `docker builder prune -f`, then `df -h /`. Stop if less than 3 GB is free.
5. `git fetch && git merge --ff-only origin/master`
6. `$C up -d --build --wait` — exit 0 means the health check passed. Write down the UTC time as `T`.
7. Rollback, only if a check below fails in a way that hurts mail: `git checkout <rollback commit>` and `$C up -d --build --wait` (no migration to undo).

If F103 stage 17 has landed, one-off commands run as `$C run --rm cli …` instead of `$C run --rm server …` (F103 D19 c).

## Checks (24 h after `T`)

1. `$C logs --since "$T" server | grep -c "flags_refreshed"` → more than 0 (the flag refresh runs; else the finder never runs: stop and look at `flags_refresh_failed`).
2. `$C logs --since "$T" server | grep -E "user_moves_failed"` → no line (Done when 9). A line → read its `error_code`, add an entry to the log below, and open a ticket if it repeats.
3. `$C logs --since "$T" server | grep -E "user_moves_found"` → count the lines and the sum of `count`. 0 is normal when the owner moved nothing by hand.
4. NV2 (cost): `$C logs --since "$T" server | grep -E "dropped_fields"` → no line. The candidate count is a debug line; when the log level is `info`, estimate it instead with `$C exec db psql … -Atc "SELECT count(*) FROM emails e JOIN email_flags f ON f.email_id = e.id WHERE e.mailbox_id = '<pilot mailbox id>' AND e.received_at >= now() - interval '30 days' AND f.seen = false AND f.answered = false AND f.flagged = false AND f.first_seen_at IS NULL"` (an upper bound of mail that was never read, gone mail included). Write the number down; above 3,000 means the refresh rotates (D14).

## Owner step O1 (optional, not a stop; NV1)

Ask the owner once, in the reply that reports the deploy: "Optional check: in Interia webmail, move one mail that the assistant stored in INBOX more than 10 minutes ago into `Oferty`, and tell me the time." When the owner did it:

5. 15 minutes after that time: `$C logs --since "<move time>" server | grep -E "user_moves_found"` → a line with the pilot mailbox id and `count` ≥ 1. Then `$C exec db psql … -Atc "SELECT count(*) FROM emails WHERE mailbox_id = '<pilot mailbox id>' AND folder = 'Oferty' AND source_folder = 'Oferty'"` → one more than before the move (read it before you ask the owner). Print counts and ids only, never a subject or an address.
6. Result: the line and the count → NV1 holds. No line after 15 minutes → Interia gave the mail a new UID or re-sorted it: write it into `notes/2026-11-03-interia-imap-capabilities.md` and this plan's Log, and open a ticket (the move finder does not cover that provider behaviour).

## Done when

Checks 1–4 are written into the Log of `plan.md` (counts only), and check 2 shows no line. O1 is done or recorded as not done.
