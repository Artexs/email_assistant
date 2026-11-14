# F099 stage 15 — VPS deploy [risky]

Part of [`../plan.md`](../plan.md). Read its D1, D2, D23, D26, D32 and § User steps first. Needs stages 01–14 landed and the `master` CI run of the last land green.

`[risky]`: the real system with the pilot's mail. **The coordinator runs this stage itself** (`spec/build.md`: VPS, ssh and deploy steps are pre-approved; backup first, name the rollback target, verify after). No worker job. No owner step: nothing here needs a secret, money or a phone. No other VPS deploy runs at the same time (`docs/product/stage-2/05-execution-plan.md` §4).

## Before the deploy

1. List the commits the deploy brings: `git log --oneline <VPS commit>..origin/master`. If another ticket in the list has its own VPS step, do that step first by its own runbook, check it, then come back.
2. The deploy brings two migrations (`…_send_started_at.sql`, `…_outbox_send_held.sql`). Both only add: a column, an index, a CHECK member and a CHECK. The old code works with them (rollback below).

## Runbook

On the VPS, in the repo root, `C="docker compose -f deploy/compose.yaml --env-file .env"`; based on `deploy/README.md` § Update.

1. `git rev-parse HEAD` — write it down: the rollback commit.
2. `deploy/backup.sh` (or `PATH=$HOME/bin:$PATH deploy/backup.sh`) — the last line is `backup ok <name> <bytes>`. Stop if it is not.
3. `docker tag ea-server ea-server:pre-f099` — the old image for a fast rollback.
4. `docker builder prune -f`, then `df -h /`. Stop if less than 3 GB is free.
5. `cp .env .env.bak-f099`. Never print `.env`.
6. The pilot ids: `$C exec db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT o.id, m.user_id FROM organizations o JOIN memberships m ON m.org_id = o.id AND m.role = 'owner' ORDER BY o.created_at LIMIT 5"` (use the DB user and name the compose file gives the `db` service; if the env names differ, read them with `grep -c` style checks, never by printing values of secrets). The pilot is the oldest organization (`deploy/README.md` § Customers). Write down `<pilot org id>` and `<pilot owner user id>`. User ids are not secrets; keep them out of the repo.
7. Set the operator: if `grep -c '^OPERATOR_USER_IDS=' .env` is `1`, `sed -i 's/^OPERATOR_USER_IDS=.*/OPERATOR_USER_IDS=<pilot owner user id>/' .env`; if it is `0`, `echo 'OPERATOR_USER_IDS=<pilot owner user id>' >> .env`. Do not add the `SEND_LIMIT_*` keys: the defaults are the decision (PD-044).
8. `git fetch && git merge --ff-only origin/master`
9. `$C up -d --wait db`
10. `$C run --build --rm server bun run db:migrate` — expect two `Applying` lines (the two F099 files).
11. `T=$(date -u +%Y-%m-%dT%H:%M:%SZ); echo "$T"` — the start time of the checks.
12. `$C up -d --build --wait` — exit 0 means the health check passed.
13. `$C run --rm server bun run org:flag --org-id <pilot org id> --flag security_log --on` (D32: on for the pilot first).

## Checks

Each with its expected result:

1. `$C logs --since "$T" server | grep -E "send_limits"` → one line with `mailbox_hour` 20, `mailbox_day` 100, `recipient_day` 5.
2. `$C logs --since "$T" server | grep -E "operator ids"` → the count is `1`; the line holds no user id.
3. `$C logs --since "$T" server | grep -E "dropped_fields"` → no line.
4. `curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/health` → `200`.
5. `$C exec db psql … -Atc "SELECT count(*) FROM actions WHERE type = 'send' AND status = 'applied' AND send_started_at IS NULL"` → `0` (the backfill ran).
6. `$C exec db psql … -Atc "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'outbox_kind_check'"` → the list ends with `'send_held'`.
7. `$C run --rm server bun run org:flag --org-id <pilot org id>` → a line `org <pilot org id>: security_log on (row)`; the other flags as before.
8. Wait 11 minutes; `$C logs --since "$T" server | grep -E "sync_done|synced"` → lines for the pilot mailbox, and `grep -E "committer .* failed|send_limited"` → no line (no send hit a limit at deploy).
9. `curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/operator` → `302` (no session: the login redirect, as any page).

## Rollback

When step 12 fails, or check 1, 2, 4 or 8 fails:

1. `git checkout <commit of runbook 1>`
2. `docker tag ea-server:pre-f099 ea-server`
3. `cp .env.bak-f099 .env`
4. `$C up -d --no-build --wait`
5. Never run `db:rollback` (`deploy/README.md` § Roll back): the old code ignores `send_started_at` and accepts the wider outbox CHECK.
6. Report the failing check and its lines to the owner; the coordinator decides whether to revert lands on `master`.

## After

- When the checks hold for 24 h (one look at `$C logs --since 24h server | grep -E "error|failed" | wc -l` against the day before), `docker image rm ea-server:pre-f099` and `rm .env.bak-f099`.
- Write the result into this ticket's `plan.md` § Log (date, commit, the outputs of checks 1, 2, 4–7, no ids), and close the ticket with `limen ticket done`.
- Tell the owner in one line: the console is at `/operator` (signed in as the pilot owner); the security log is in Settings → Account.

## Done when

- Checks 1–9 hold, the log line is written and the ticket is closed.
