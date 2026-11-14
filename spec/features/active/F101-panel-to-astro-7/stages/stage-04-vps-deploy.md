# F101 stage 04 — VPS deploy [risky]

Part of [`../plan.md`](../plan.md). Read its D9, D10 and § Done when. Needs stages 01–03 landed and the `master` CI run of the last land green in `ci`, `e2e` and `image`.

`[risky]`: the real system with the pilot's mail. **The coordinator runs this stage** (`spec/build.md`: VPS steps pre-approved; backup first, rollback target, verify after). No worker, no owner step. No other VPS deploy at the same time. This ticket adds no migration and no `.env` key.

## Before the deploy

`git log --oneline <VPS commit>..origin/master` lists what the deploy brings. Another ticket in the list with its own VPS step (F105, F106 and others landed migrations and runbook steps since the plan): do that step by its runbook first, check it, then come back. Its migration runs at step 8 and its runbook holds its checks.

## Runbook

On the VPS, repo root, `C="docker compose -f deploy/compose.yaml --env-file .env"`; the frame is `deploy/README.md` § Update.

1. `git rev-parse HEAD`: the rollback commit.
2. `deploy/backup.sh` (`PATH=$HOME/bin:$PATH` if needed): last line `backup ok <name> <bytes>`, else stop.
3. `docker tag ea-server ea-server:pre-f101`.
4. `docker builder prune -f`; `df -h /`: stop under 3 GB free.
5. Error baseline of check 7, from the old container (a recreated container starts empty, `deploy/README.md` § Logs): `$C logs --no-log-prefix --since 24h server | jq -rR 'fromjson? | select(.level == "error") | .event' | sort -u > /tmp/f101-errors-before.txt`; write down its line count. Event names only.
6. `git fetch && git merge --ff-only origin/master`
7. `$C up -d --wait db`
8. `$C run --build --rm server bun run db:migrate`: no `Applying` line from this ticket.
9. `T=$(date -u +%Y-%m-%dT%H:%M:%SZ); echo "$T"`
10. `$C up -d --build --wait`: exit 0 = health check passed.
11. The log rotation check of `deploy/README.md` § Update step 4 (`json-file 10m 5`).

## Checks

1. `docker run --rm --entrypoint cat ea-server /app/node_modules/astro/package.json | grep '"version"'` → `"version": "7.4.12",`.
2. `curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/health` → `200`.
3. `curl -sS -o /tmp/f101-login.html -w '%{http_code}\n' http://127.0.0.1:8080/login` → `200`; in the file: `http-equiv="content-security-policy"` 1 time, `default-src 'self'` 1 time, `style-src 'self' 'unsafe-inline';` 1 time, `script-src[^;]*unsafe-inline` 0 times (`grep -c`, `grep -Ec`).
4. The first `/_astro/….js` path of the login file answers `200`.
5. `curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' http://127.0.0.1:8080/settings` → `302`, URL ends in `/login?next=%2Fsettings`.
6. `$C logs --since "$T" server`: `server_listening` 1 or more times; `web is on` 1 or more times (count only: the line holds the origin); `web_dist_missing|web is off` 0 times.
7. After 10 minutes: the step 5 command with `--since "$T"` into `/tmp/f101-errors-after.txt`; `comm -13 /tmp/f101-errors-before.txt /tmp/f101-errors-after.txt` prints nothing. A printed event fails check 7.

Then remove the three `/tmp/f101-*` files.

## Rollback

When step 10 or any check fails:

1. `git checkout <commit of step 1>`
2. `docker tag ea-server:pre-f101 ea-server`
3. `$C up -d --no-build --wait`
4. Check 2 again, and `/login` → `200`.
5. No DB step for this ticket. Another ticket's migration of step 8: that ticket's rollback rule (never `db:rollback` unless its runbook says so).
6. Report the failing check (event names only; no `.env` value, no tailnet name) to the owner; the coordinator decides on D10 (`git revert -m 1 <merge commit of the stage 02 land>`, found by its job id in `git log --merges`; never a force push).
7. The VPS is on a detached HEAD: the next deploy starts with `git checkout master`. Write this into § Log.

## After

- Checks 1–7 hold: `docker image rm ea-server:pre-f101`. A later rollback follows `deploy/README.md` § Web panel, Roll back.
- `plan.md` § Log: date, deployed commit, outputs of checks 1–7 (no ids, no names).
- `limen ticket done` for F101 (F102 and F112 may then start).
- One line to the owner: the panel runs on Astro 7; nothing changes for the user.

## Done when

- Checks 1–7 hold, the old tag is gone, the log line is written, the ticket is closed.
