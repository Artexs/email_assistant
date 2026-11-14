# F103 stage 19 — VPS rollout and the search check

Part of [`../plan.md`](../plan.md). Run by the coordinator on the VPS (`ssh home_vm`), not by a worker job. VPS, ssh and deploy steps are pre-approved (`spec/build.md` NEXT): backup first, name the rollback target, verify after. Needs stages 16 and 18 landed and the CI run of `master` green.

Risk to other work: the deploy restarts `server` and recreates `db` (the new log driver): Telegram polling and the sync pause for about a minute. No other job may deploy at the same time.

## Steps

All commands on the VPS in the repo checkout, `C="docker compose -f deploy/compose.yaml --env-file .env"` (`deploy/README.md`). Write each output that the checks name into the record (step 10).

1. **Rollback target.** `git rev-parse HEAD` → write it down as `<prev>`.
2. **Backup and disk.** `deploy/README.md` § Update steps 1–2: `deploy/backup.sh` must end with `backup ok …`; `df -h /` must show 3 GB or more free (after `docker builder prune -f` if needed). Less than 3 GB after the prune: stop, report "disk" (the volume growth PD-055 is an owner step of E8b and E2b, not of this ticket).
3. **Compose version and config.** `docker compose version`; `$C --profile '*' config -q` must exit 0 (checks `extends` and the profiles on this Compose; Not verified in `plan.md`). `crontab -l | grep -nE 'run[[:space:]].*server[[:space:]]+bun'`: each match (the `mailbox:seed` line of `deploy/README.md` § test mailbox) changes to `run --rm -T cli` with `crontab -e`; write the old and the new line into the record. `docker info --format '{{.DockerRootDir}}'` must print `/var/lib/docker` (the mount of vlagent). Another value: stop, report it (stage 18 mount).
4. **Update and start.** § Update step 3, with the new `cli` lines: `git fetch && git merge --ff-only origin/master`, `$C up -d --wait db`, `$C run --build --rm cli bun run db:migrate`, `$C up -d --build --wait`.
5. **Drivers.** The check of § Update step 4: `server` ends with `json-file 10m 5`, `db` with `local 10m 5`. A different line: `$C up -d --force-recreate --wait <service>`, check again.
6. **Store.** `docker ps -a --format '{{.Names}} {{.Label "com.docker.compose.project"}}'` lists only this project's containers, also stopped ones (stage 18 limit: the agent reads every `json-file` log on the host; another project's `json-file` container: report it before you start the store). Then `$C --profile ops up -d --wait victorialogs vlagent`. `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:9428/select/vmui/` prints `200`.
7. **Tailnet access.** `tailscale serve --bg --https=9443 http://127.0.0.1:9428`. If it asks for root or a password: owner step U1 (`plan.md` § User steps), then continue. `tailscale serve status` shows port 9443. From a tailnet device (the coordinator's machine when it is on the tailnet): `curl -s -o /dev/null -w '%{http_code}\n' https://<machine>.<tailnet>.ts.net:9443/select/vmui/` prints `200`.
8. **Search check (epic exit line).** Wait for one `mail.sync` tick (at most 5 min). Take its id: `$C logs --no-log-prefix --since 10m server | jq -rR 'fromjson? | select(.job == "mail.sync") | .run_id' | tail -1` → `<run>`. Count the lines in Docker: `$C logs --no-log-prefix --since 15m server | grep -c "<run>"` → `<n>`. Count in the store (allow 30 s for the agent): `curl -s http://127.0.0.1:9428/select/logsql/query --data-urlencode 'query="<run>" | unpack_json from _msg | stats count() as n'` → `n` equals `<n>`. Also run the same query in the UI from step 7 and see the lines in time order.
9. **Nothing else in the store.** Plant a unique marker after the store is up, so a leak shows as a hit. `M=$(cat /proc/sys/kernel/random/uuid | cut -c1-8)`. vlagent reads a new file from its start (V4: "no checkpoints file found … will read log files from the beginning"), so a line written before the agent started is also in scope.
   - CLI: `$C run --rm cli bun -e "console.log('f103-cli-$M')"` prints `f103-cli-<M>` in the terminal. After 30 s: `curl -s http://127.0.0.1:9428/select/logsql/query --data-urlencode "query=_time:10m \"f103-cli-$M\" | stats count() as n"` → `0`.
   - The same with `server` as a control: `$C exec server bun -e "console.log('f103-exec-$M')"` → `0` (exec output is not a container log).
   - DB: `$C exec -T db psql -U postgres -d email_assistant -c "select 'f103-db-$M'::int"` fails and Postgres writes an `ERROR` line with the value to the `db` log (check: `$C logs --since 1m db | grep -c "f103-db-$M"` ≥ 1). The store query for `f103-db-$M` → `0`.
   - Positive control: the server's own log reaches the store (step 8 proved it).
   - Old form: `curl -s http://127.0.0.1:9428/select/logsql/query --data-urlencode 'query=_time:1h | unpack_json from _msg | filter event:=log_call_invalid or event:=console_output or dropped_fields:>0 | stats count() as n'` → `0`; a value above 0 is a finding: list the events with `stats by (event, module) count()`.
10. **Memory and disk.** `docker stats --no-stream --format '{{.Name}} {{.MemUsage}}'`: `victorialogs` under 256 MiB, `vlagent` under 64 MiB. `df -h /` free space after the deploy.
11. **Record.** On the coordinator's checkout, one commit with explicit paths:
    - `docs/capabilities/logs.md`: "Checked against" the deployed commit; the VPS facts (Compose version, memory of both containers, the run check `<n>` = store count).
    - `docs/decisions/0024-structured-logs-and-operator-alerts.md`: `Status: accepted (E8a landed, YYYY-MM-DD)`; "Progress": "E8a (F103) landed points 1, 3, 4 (driver split), 5, 7; point 6 is E8b."
    - `docs/known-alerts.md` entry of stage 18 (`Log store: vlagent reads no lines`): add the date of the first good check.
12. **Rollback** (only if a check fails and a fix is not obvious): `$C --profile ops stop victorialogs vlagent`; `tailscale serve --https=9443 off`; for the app, `git checkout <prev>` and `$C up -d --build --wait` (the old driver block comes back with it; `db` recreates again). Report what failed.
13. **Close.** When steps 5–10 hold: `limen ticket done F103` (or `limen land` of the record commit without `--keep-open`, as the board does), and tell the owner the UI address and the three queries of `deploy/README.md` § Logs.

## Done when

Steps 5–10 hold and the record of step 11 is committed. The coordinator's final message names each check with its output.

## Out of scope

The SLO alerts and release scripts (E8b). Growing the disk (PD-055).
