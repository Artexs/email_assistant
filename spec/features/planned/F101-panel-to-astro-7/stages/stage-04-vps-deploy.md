# F101 stage 04 — VPS deploy [risky]

Part of [`../plan.md`](../plan.md). Read its D9, D10, § User steps and § Done when first. Needs stages 01–03 landed and the `master` CI run of the last land green in the `ci`, `e2e` and `image` jobs.

`[risky]`: the real system with the pilot's mail. **The coordinator runs this stage itself** (`spec/build.md`: VPS, ssh and deploy steps are pre-approved; backup first, name the rollback target, verify after). No worker job. No owner step: nothing here needs a secret, money or a phone. No other VPS deploy runs at the same time (`docs/product/stage-2/05-execution-plan.md` §4). This ticket adds no migration.

## Before the deploy

1. List the commits the deploy brings: `git log --oneline <VPS commit>..origin/master` (read the VPS commit with `git rev-parse HEAD` on the VPS). If another ticket in the list has its own VPS step, do that step by its own runbook first, check it, then come back. A migration of another ticket runs at runbook step 7; it is that ticket's change, and its runbook holds its checks.
2. Nothing in `.env` changes for this ticket.

## Runbook

On the VPS, in the repo root, `C="docker compose -f deploy/compose.yaml --env-file .env"`; based on `deploy/README.md` § Update.

1. `git rev-parse HEAD` — write it down: the rollback commit.
2. `deploy/backup.sh` (or `PATH=$HOME/bin:$PATH deploy/backup.sh`) — the last line is `backup ok <name> <bytes>`. Stop if it is not.
3. `docker tag ea-server ea-server:pre-f101` — the old image for a fast rollback.
4. `docker builder prune -f`, then `df -h /`. Stop if less than 3 GB is free.
5. `git fetch && git merge --ff-only origin/master`
6. `$C up -d --wait db`
7. `$C run --build --rm server bun run db:migrate` — no `Applying` line comes from this ticket.
8. `T=$(date -u +%Y-%m-%dT%H:%M:%SZ); echo "$T"` — the start time of the checks.
9. `$C up -d --build --wait` — exit 0 means the health check passed.
10. The log rotation check of `deploy/README.md` § Update step 4 (each line ends with `json-file 10m 5`).

## Checks

Each with its expected result:

1. `docker run --rm --entrypoint cat ea-server /app/node_modules/astro/package.json | grep '"version"'` → `"version": "7.4.12",`.
2. `curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/health` → `200`.
3. `curl -sS -o /tmp/f101-login.html -w '%{http_code}\n' http://127.0.0.1:8080/login` → `200`. Then:
   - `grep -c 'http-equiv="content-security-policy"' /tmp/f101-login.html` → `1`
   - `grep -c "default-src 'self'" /tmp/f101-login.html` → `1`
   - `grep -c "style-src 'self' 'unsafe-inline';" /tmp/f101-login.html` → `1`
   - `grep -Ec "script-src[^;]*unsafe-inline" /tmp/f101-login.html` → `0`
4. `S=$(grep -o '/_astro/[^"]*\.js' /tmp/f101-login.html | head -n 1); curl -sS -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:8080$S"` → `200`.
5. `curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' http://127.0.0.1:8080/settings` → `302` and a URL that ends in `/login?next=%2Fsettings` (the page guard is unchanged).
6. `$C logs --since "$T" server | grep -c server_listening` → `1` or more; `$C logs --since "$T" server | grep -c 'web is on'` → `1` or more (count only: the line holds the panel origin); `$C logs --since "$T" server | grep -Ec 'web_dist_missing|web is off'` → `0` (event names from `apps/server/src/platform/http.ts` and `apps/server/src/web.ts`).
7. Wait 10 minutes. `$C logs --since "$T" server | grep -E '"level":"error"' | wc -l` → the same count as in the 10 minutes before the deploy (`$C logs --since <T minus 10 min> --until "$T" server | grep -E '"level":"error"' | wc -l`); a new error kind that names `web`, `astro` or a page path is a failure.

`rm /tmp/f101-login.html` after the checks.

## Rollback

When runbook step 9 fails, or check 1–6 fails:

1. `git checkout <commit of runbook step 1>`
2. `docker tag ea-server:pre-f101 ea-server`
3. `$C up -d --no-build --wait`
4. Check 2 again (`200`), and `curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/login` → `200`.
5. No DB step: this ticket has no migration. If another ticket's migration ran at step 7, follow that ticket's rollback rule (never `db:rollback` unless its runbook says so).
6. Report the failing check and its output (no `.env` value, no tailnet name) to the owner; the coordinator decides whether to revert the stage 02 land on `master` (D10: `git revert`, never a force push).

## After

- When checks 1–7 hold: `docker image rm ea-server:pre-f101`. A later rollback uses `git checkout <commit>` and `$C up -d --build --wait` (`deploy/README.md` § Web panel, Roll back).
- Write the result into `plan.md` § Log: date, the deployed commit, the outputs of checks 1–6 (no ids, no names).
- Close the ticket: `limen ticket done` for F101 (it moves to `done/`; F102 and F112 may then start).
- Tell the owner in one line: the panel runs on Astro 7; nothing changes for the user.

## Done when

- Checks 1–7 hold, the old image tag is removed, the log line is written and the ticket is closed.
