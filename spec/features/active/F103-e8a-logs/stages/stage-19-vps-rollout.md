# F103 stage 19 — VPS rollout and the search check

Part of [`../plan.md`](../plan.md). The coordinator runs it on the VPS (`ssh home_vm`), not a worker. VPS steps are pre-approved (`spec/build.md` NEXT): backup first, name the rollback target, verify after. Needs stages 16 and 18 landed and `master` CI green.

Risk: the deploy restarts `server` and recreates `db`; polling and sync pause about a minute. No other deploy at the same time.

## Steps

On the VPS in the repo checkout, `C="docker compose -f deploy/compose.yaml --env-file .env"`. Write each named output into the record (step 11).

1. **Rollback target.** `git rev-parse HEAD` → `<prev>`.
2. **Backup and disk.** `deploy/README.md` § Update steps 1–2 (`backup ok …`; 3 GB free). Less: stop, report "disk" (PD-055 is not this ticket).
3. **Compose and cron.** `docker compose version`; `$C --profile '*' config -q` exits 0 (`extends` and profiles on this Compose; "Not verified" in `../plan-facts.md`). `crontab -l | grep -nE 'run[[:space:]].*server[[:space:]]+bun'`: each match changes to `run --rm -T cli` with `crontab -e`; record old and new line. `docker info --format '{{.DockerRootDir}}'` prints `/var/lib/docker`; another value: stop, report it (the vlagent mount).
4. **Update and start.** § Update step 3 (with `run --build --rm cli bun run db:migrate`).
5. **Drivers.** § Update step 4: `server` `json-file 10m 5`, `db` `local 10m 5`; else force-recreate that service and check again.
6. **Store.** `docker ps -a --format '{{.Names}} {{.Label "com.docker.compose.project"}}'` lists only this project (else report it first: the agent reads every `json-file` log). `$C --profile ops up -d --wait victorialogs vlagent`. `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:9428/select/vmui/` prints `200`.
7. **Tailnet.** `tailscale serve --bg --https=9443 http://127.0.0.1:9428`; if it asks for root or a password: owner step U1, then continue. `tailscale serve status` shows 9443. From a tailnet device: `curl -s -o /dev/null -w '%{http_code}\n' https://<machine>.<tailnet>.ts.net:9443/select/vmui/` prints `200`.
8. **Search check (epic exit line).** Wait for one `mail.sync` tick (at most 5 min). `$C logs --no-log-prefix --since 10m server | jq -rR 'fromjson? | select(.job == "mail.sync") | .run_id' | tail -1` → `<run>`. `$C logs --no-log-prefix --since 15m server | grep -c "<run>"` → `<n>`. After 30 s: `curl -s http://127.0.0.1:9428/select/logsql/query --data-urlencode 'query="<run>" | unpack_json from _msg | stats count() as n'` → `n` equals `<n>`. The UI shows the same lines in time order.
9. **Nothing else in the store.** `M=$(cat /proc/sys/kernel/random/uuid | cut -c1-8)`; markers are planted after the store is up (vlagent reads a new file from its start, V4).
   - CLI: `$C run --rm cli bun -e "console.log('f103-cli-$M')"` prints the marker in the terminal. After 30 s the store query `_time:10m "f103-cli-$M" | stats count() as n` → `0`.
   - Control: `$C exec server bun -e "console.log('f103-exec-$M')"` → `0` in the store.
   - DB: `$C exec -T db psql -U postgres -d email_assistant -c "select 'f103-db-$M'::int"` fails; `$C logs --since 1m db | grep -c "f103-db-$M"` ≥ 1; the store query → `0`.
   - Old form: `_time:1h | unpack_json from _msg | filter event:=log_call_invalid or event:=console_output or dropped_fields:>0 | stats count() as n` → `0`; above 0 is a finding: list `stats by (event, module) count()`.
10. **Memory and disk.** `docker stats --no-stream --format '{{.Name}} {{.MemUsage}}'`: `victorialogs` under 256 MiB, `vlagent` under 64 MiB. `df -h /` after the deploy.
11. **Record** (coordinator's checkout, one commit, explicit paths):
    - `docs/capabilities/logs.md`: "Checked against" the deployed commit; Compose version, memory, `<n>` = store count.
    - ADR 0024: `Status: accepted (E8a landed, YYYY-MM-DD)`; "Progress": "E8a (F103) landed points 1, 3, 4 (driver split), 5, 7; point 6 is E8b."
    - `docs/known-alerts.md`, entry `Log store: vlagent reads no lines`: the date of the first good check.
12. **Rollback** (a check fails, no obvious fix): `$C --profile ops stop victorialogs vlagent`; `tailscale serve --https=9443 off`; `git checkout <prev>`, `$C up -d --build --wait` (`db` recreates again). Report what failed.
13. **Close.** Steps 5–10 hold: `limen ticket done F103` (or `limen land` of the record commit without `--keep-open`), and tell the owner the UI address and the three queries of `deploy/README.md` § Logs.

## Done when

Steps 5–10 hold; the record is committed; the final message names each check with its output.

## Out of scope

SLO alerts and release scripts (E8b). Growing the disk (PD-055).

## Carry-over from stage 16 review

Read `review-16.md` (TG3): list the real paths with mail data that the canary does not drive as a standing limit of the logs capability page, or drive some of them (Telegram inbound updates, delegation chaser, Sent sync, permanent send failures, OAuth refresh errors, the HTTP error handler).
