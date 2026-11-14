# F106 stage 12 — VPS deploy and smoke checks

Part of [`../plan.md`](../plan.md). `[risky]` (the real system). **The coordinator runs this stage itself** (`spec/build.md`: VPS steps are pre-approved; backup first, name the rollback target, verify after). No worker job. Needs stages 01–11 landed and the `master` CI run of the last land green.

**Rule of this stage:** no command deletes, erases or exports data of the pilot organization. Every check uses a throwaway test organization made in step 1 of the checks.

## Before

1. `git log --oneline <VPS commit>..origin/master`: other tickets with their own VPS step go first, by their runbook.
2. The deploy brings one F106 migration (`…_account_data.sql`): a function, a table, a trigger. The old code works with them (the trigger only skips tombstoned keys, and no tombstone exists yet).

## Runbook

On the VPS, repo root, `C="docker compose -f deploy/compose.yaml --env-file .env"`; `deploy/README.md` § Update.

1. `git rev-parse HEAD` → the rollback commit.
2. `deploy/backup.sh` → last line `backup ok <name> <bytes>`; stop if not.
3. `docker tag ea-server ea-server:pre-f106`.
4. `df -h /`: stop below 3 GB free (`docker builder prune -f` first).
5. `git fetch && git merge --ff-only origin/master`
6. `$C up -d --wait db`; `$C run --build --rm server bun run db:migrate` → the `Applying` line of `…_account_data.sql`.
7. `T=$(date -u +%Y-%m-%dT%H:%M:%SZ)`; `$C up -d --build --wait`.

## Checks

1. `curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/health` → `200`.
2. Make a test organization: `$C run --rm server bun run org:create --org-name "F106 smoke" --email f106-smoke@x.test --display-name Smoke --plan active` → note its id `S`.
3. Export: `mkdir -m 700 ~/ea-exports`; `$C run --rm -v ~/ea-exports:/exports server bun run org:export --org-id S --recipient <AGE_RECIPIENT of deploy/backup.env> --out /exports/f106-smoke.age` → exit 0; `stat -c '%a %s' ~/ea-exports/f106-smoke.age` → `600` and a size above 0. This closes § Not verified "the image user can write a mounted folder". If the write fails with a permission error: `chown` the folder to the image user's uid (`$C run --rm server id -u`) and add that step to `deploy/README.md` in a follow-up commit.
4. `$C run --rm server bun run org:dsr --org-id S --address nobody@x.test --find` → `mails 0` and exit 0.
5. `$C run --rm server bun run org:delete --org-id S --confirm "F106 smoke"` → `deleted S`; `org:status --org-id S` → not found.
6. `$C logs --since "$T" server | grep -E "dropped_fields|_failed"` → no new line from F106 code.
7. Wait 11 minutes; `$C logs --since "$T" server | grep -c "synced 8bc7f572-a7f5-4fa5-aaab-db16dc663e96: folders"` → lines for the pilot mailbox.
8. **Owner step U1** (optional): the coordinator copies `~/ea-exports/f106-smoke.age` to the owner; the owner runs `age -d -i <backup identity> f106-smoke.age | head -c 300` on the Mac and says whether it opens. Then delete the file on both machines.

Do not turn on `org_delete` for the pilot organization: that is owner step U2.

## Rollback

When runbook step 7 or checks 1, 6 or 7 fail: `git checkout <rollback commit>`; `docker tag ea-server:pre-f106 ea-server`; `$C up -d --no-build --wait`. Never run `db:rollback` (`deploy/README.md` § Roll back): the old code does not call the new function, and the table stays empty. Report the failing check to the owner.

## After

- 24 h without a problem: `docker image rm ea-server:pre-f106`.
- Write the result into `plan.md` § Log (date, commit, check outputs without ids) and close the ticket with `limen ticket done F106`.

## Done when

Checks 1–7 hold, the log line is written, the ticket is closed. U1 does not hold the close.
