# F029 stage 05 — Pilot check (coordinator runbook)

Part of [`../plan.md`](../plan.md). **The coordinator runs this stage itself** (`spec/build.md`: VPS, ssh and deploy steps are pre-approved; backup first, name the rollback target, verify after). No worker job. No migration. One optional owner step: O1. It checks Not verified NV1 and NV2, Done when 9, and gives the numbers for questions Q3, Q4 and Q5.

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

Rollback, only if a check below fails in a way that hurts mail (many `user_moves_failed` lines, or rows moved to a wrong folder): `git checkout <rollback commit>`, `docker tag ea-server:pre-f029 ea-server`, `$C up -d --no-build --wait`. No migration to undo; never run `db:rollback`. Report the failing check to the owner. When the checks hold for 24 h: `docker image rm ea-server:pre-f029`.

If F103 stage 17 has landed, one-off commands run as `$C run --rm cli …` instead of `$C run --rm server …` (F103 D19 c). `$C exec db psql …` uses the DB user and name as the F099 stage 15 runbook reads them, never by printing a secret. Print counts and ids only, never a subject, an address or a folder path of a user folder.

## Checks (24 h after `T`; the time of the deploy that carried stage 04)

1. `$C logs --since "$T" server | grep -c "flags_refreshed"` → more than 0 (the flag refresh runs; else the finder never runs: stop and look at `flags_refresh_failed`).
2. `$C logs --since "$T" server | grep -E "user_moves_failed"` → no line (Done when 9). A line → read its `error_code`, write it into the Log of `plan.md`, and open a ticket if it repeats.
3. `$C logs --since "$T" server | grep -E "user_moves_found|user_moves_retry"` → the number of lines and the sum of `count` of each event. 0 is normal when the owner moved nothing by hand.
4. Cost (NV2, Q3): `$C logs --since "$T" server | grep -E "user_moves_checked"` → the number of lines and the largest `count`. The finder's IMAP calls per refresh are at most (enabled synced folders) × ⌈count / 500⌉. Above 3,000 means the refresh rotates (D14). Write both numbers into the Log.
5. Q5 (a system move to `AI/Spam` that the user filed into the provider spam folder): `$C exec db psql … -Atc "SELECT count(*) FROM actions a JOIN emails e ON e.id = a.email_id AND e.org_id = a.org_id WHERE e.mailbox_id = '<pilot mailbox id>' AND a.type = 'move' AND a.payload->>'folder' = 'ai_spam' AND a.status = 'undone' AND a.status_reason = 'user_moved_back' AND a.updated_at >= '<T>' AND e.folder = 'Wiadomości-śmieci'"` → the count. Above 0: tell the owner the count with Q5 (each such row is a "wrong" feedback row for a mail the user also called spam).
6. Q4 (copies): `$C exec db psql … -Atc "SELECT coalesce(max(n), 0) FROM (SELECT count(*) AS n FROM emails WHERE mailbox_id = '<pilot mailbox id>' GROUP BY message_id_header, content_hash) AS c"` → the largest number of identical copies of one mail. Above 5: tell the owner with Q4.

## Owner step O1 (optional, not a stop; NV1)

7. Before you ask: `$C exec db psql … -Atc "SELECT last_uid FROM mailbox_folders WHERE mailbox_id = '<pilot mailbox id>' AND key = 'offers'"` → write it down as `L`; and `… -Atc "SELECT count(*) FROM emails WHERE mailbox_id = '<pilot mailbox id>' AND folder = 'Oferty' AND source_folder = 'Oferty'"` → `N`.
8. Ask the owner once, in the reply that reports the deploy: "Optional check: in Interia webmail, move one INBOX mail that arrived before the newest mail in `Oferty` into `Oferty`, and tell me the time." (An older mail keeps a UID below the `Oferty` cursor, so the move finder, not the normal pass, must see it.)
9. 15 minutes after that time: the count of step 7 again → `N + 1` means the row followed the mail. Then find it: `… -Atc "SELECT id, uid FROM emails WHERE mailbox_id = '<pilot mailbox id>' AND folder = 'Oferty' AND source_folder = 'Oferty' ORDER BY uid"` and compare with a list read at step 7 (run the same query there): the new id's `uid` ≤ `L` and a `user_moves_found` line after the move time → NV1 holds (a webmail move into `Oferty` keeps the UID and the finder found it). The new `uid` > `L` → the owner picked a mail newer than `L`; the normal pass handled it: NV1 is not tested, say so. No new row after 15 minutes → Interia gave the mail a new UID or re-sorted it back: write that into `notes/2026-11-03-interia-imap-capabilities.md` and the Log of `plan.md`, and open a ticket (the finder does not cover that provider behaviour).

## Done when

Checks 1–6 are written into the Log of `plan.md` (counts only), and check 2 shows no line. O1 is done or recorded as not done. Then How to run step 6 of `plan.md` closes F029 and F064.
