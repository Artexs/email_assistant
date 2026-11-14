# F105 stage 15 — VPS deploy and checks [risky]

Part of [`../plan.md`](../plan.md). Read its D10, D25, § Owner steps and § Not verified first. Needs stages 01–14 landed and the `master` CI run of the last land green. Stage 13 no longer waits for F099 (refresh 1), so this deploy normally brings all of 01–14. If stage 13 has not landed, this deploy brings 01–12 and 14, and stage 13 goes out with the next deploy of any ticket.

`[risky]`: the real system with the pilot's sign-in. **The coordinator runs this stage itself** (`spec/build.md`: VPS, ssh and deploy steps are pre-approved; backup first, name the rollback target, verify after). No worker job. One owner step (U1): the owner's phone. No other VPS deploy runs at the same time.

## Before the deploy

1. List the commits the deploy brings: `git log --oneline <VPS commit>..origin/master`. If another ticket in the list has its own VPS step, do that step first by its own runbook, check it, then come back.
2. The deploy brings one migration of this ticket (`…_two_factor.sql`). It only adds a table, two columns, a CHECK and an index. The old code works with them (rollback below).
3. Effect on the owner: after the deploy, the owner (the operator in `OPERATOR_USER_IDS`) cannot open `/operator` until the owner turns on two-factor sign-in (U1). Tell the owner before step 11 of the runbook.

## Runbook

On the VPS, in the repo root, `C="docker compose -f deploy/compose.yaml --env-file .env"`; based on `deploy/README.md` § Update.

1. `git rev-parse HEAD` — write it down: the rollback commit.
2. `deploy/backup.sh` (or `PATH=$HOME/bin:$PATH deploy/backup.sh`) — the last line is `backup ok <name> <bytes>`. Stop if it is not.
3. `docker tag ea-server ea-server:pre-f105` — the old image for a fast rollback.
4. `docker builder prune -f`, then `df -h /`. Stop if less than 3 GB is free.
5. No `.env` change: this ticket adds no key. Never print `.env`.
6. The pilot ids, as F099 stage 15 runbook step 6 reads them (oldest organization and its owner; ids are not secrets; keep them out of the repo).
7. `git fetch && git merge --ff-only origin/master`
8. `$C up -d --wait db`
9. `$C run --build --rm server bun run db:migrate` — expect the `Applying` line of `…_two_factor.sql` (and the files of other tickets that the list of "Before" step 1 named).
10. `T=$(date -u +%Y-%m-%dT%H:%M:%SZ); echo "$T"`
11. `$C up -d --build --wait` — exit 0 means the health check passed.

## Checks

1. `curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/health` → `200`.
2. `$C logs --since "$T" server | grep -E "dropped_fields|better_auth_error"` → no line.
3. `$C run --rm server bun run org:break-glass --org-id <pilot org id>` → one line per owner, `two-factor off, break-glass no` for the pilot owner (before U1).
4. `curl -sS -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' -H 'origin: <WEB_BASE_URL origin>' -d '{}' http://127.0.0.1:8080/api/auth/two-factor/get-totp-uri` → `404` (not on the allow-list); the same for `/api/auth/two-factor/send-otp` → `404`. (`WEB_BASE_URL` origin: read it with `grep -c` style care; it is not a secret, but do not paste `.env` lines into a log.)
5. **Owner step U1** (the owner's hands): the owner signs in to the panel, opens Settings → Account → Two-factor sign-in, turns it on with the phone's authenticator app (scan the QR code: this closes the "QR scans in a real app" item of § Not verified), stores the backup codes, signs out and signs in again with a code. The coordinator waits for the owner's "done".
6. After U1: `$C run --rm server bun run org:break-glass --org-id <pilot org id>` → `two-factor on` for the pilot owner. `$C exec db psql … -Atc "SELECT event, data->>'second_factor' FROM audit_log WHERE org_id = '<pilot org id>' AND created_at > '$T' AND event IN ('web.two_factor_enabled', 'web.login') ORDER BY created_at"` → one `web.two_factor_enabled` and at least one `web.login | totp`.
7. The owner opens `/operator` → the console (no redirect). Before U1 the same page sent the owner to `/settings?two_factor=required` (ask the owner; not required).
8. `$C logs --since "$T" server | grep -iE "otpauth|backup_codes"` → no line. (The secret itself cannot be grepped without knowing it; the integration tests prove it.)
9. Wait 11 minutes; `$C logs --since "$T" server | grep -E "sync_done"` → lines for the pilot mailbox (nothing else broke).

Do not set a break-glass owner on the VPS now: the "SSO required" rule that uses it comes with identity B (F119), and a mark would stop the owner from turning TOTP off without the CLI (questions.md Q1, Q6).

## Rollback

When step 11 fails, or check 1, 2, 4 or 9 fails:

1. `git checkout <commit of runbook 1>`
2. `docker tag ea-server:pre-f105 ea-server`
3. `$C up -d --no-build --wait`
4. Never run `db:rollback` (`deploy/README.md` § Roll back): the old code ignores `auth_two_factors`, `users.two_factor_enabled` and `memberships.break_glass`. A member who turned TOTP on signs in with the password only on the old code (the old code has no plugin): tell the owner.
5. Report the failing check and its lines to the owner; the coordinator decides whether to revert lands on `master`.

## After

- When the checks hold for 24 h, `docker image rm ea-server:pre-f105`.
- Write the result into this ticket's `plan.md` § Log (date, commit, the outputs of checks 1–4 and 6–9, no ids). If stage 13 has landed, close the ticket with `limen ticket done F105`; else close it after stage 13 lands.

## Done when

- Checks 1–9 hold, U1 is done, the log line is written, and the ticket is closed (or waits only for stage 13).
