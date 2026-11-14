# F103 stage 14 — The log store (Compose profile `ops`)

Part of [`../plan.md`](../plan.md). Review job before the land (the store config decides what is kept and who can read it). Needs stage 13 landed.

Three steps. No Docker daemon on the worker machine: the checks use `docker compose config` (V8) only. Stage 15 starts the store on the VPS.

## Step 1 — The two store services

**Goal.** `docker compose --profile ops up -d` starts VictoriaLogs and vlagent; a clean install without the profile works as before (P1, D14).

**Files.** `deploy/compose.yaml`.

**Interfaces.**

```yaml
  # Log store (ADR 0024 point 5): search on the tailnet only (deploy/README.md § Logs). Start: `$C --profile ops up -d`.
  victorialogs:
    image: victoriametrics/victoria-logs:v1.54.0
    profiles: [ops]
    logging: *logging-local
    restart: unless-stopped
    command:
      - -storageDataPath=/vlogs
      # 30d, not 30: a number without a suffix is months.
      - -retentionPeriod=30d
      - -retention.maxDiskSpaceUsageBytes=1GiB
      - -httpListenAddr=:9428
    volumes:
      - vlogs-data:/vlogs
    mem_limit: 256m
    # Loopback only: Tailscale Serve on the host proxies to it (ADR 0017). Never publish on 0.0.0.0.
    ports:
      - "127.0.0.1:9428:9428"
    healthcheck:
      test: ["CMD", "/victoria-logs-prod", "-healthcheck", "-httpListenAddr=:9428"]
      interval: 30s
      retries: 3

  vlagent:
    image: victoriametrics/vlagent:v1.54.0
    profiles: [ops]
    logging: *logging-local
    restart: unless-stopped
    command:
      - -remoteWrite.url=http://victorialogs:9428/internal/insert
      - -tmpDataPath=/vlagent
      # Only json-file logs: the server's. Every other service logs with `local` (ADR 0024 point 4).
      - -fileCollector.glob=/var/lib/docker/containers/*/*-json.log
      - -fileCollector.ignoreFields=hostname
      - -httpListenAddr=:9429
    volumes:
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
      - vlagent-data:/vlagent
    mem_limit: 64m
    depends_on:
      victorialogs:
        condition: service_healthy
```

- Add `vlogs-data: {}` and `vlagent-data: {}` to `volumes:`.
- The images run as root (V7), so the agent reads Docker's `0640` files through the read-only mount.
- The glob also matches the `json-file` logs of containers of other Compose projects on the same host, if any. The VPS runs only this project (stage 15 checks `docker ps`); write this limit into `docs/capabilities/logs.md` § Limits.

**Decisions.** P1, D12, D14. V1–V7.

**Test** (add to `apps/server/src/deploy-logging.test.ts` of stage 13).

1. `docker compose -f deploy/compose.yaml --profile ops config --no-env-resolution --no-interpolate --format json`: `services.victorialogs.command` contains `-retentionPeriod=30d` and `-retention.maxDiskSpaceUsageBytes=1GiB`; `mem_limit` is 268435456 (256m); `ports[0].host_ip` is `127.0.0.1`; `services.vlagent.volumes` has the containers mount with `read_only: true`; `services.vlagent.ports` is absent; both log with `local`.
2. Without `--profile ops`, `config` lists no `victorialogs` and no `vlagent`.
3. `bash deploy/check-logging.sh` passes (it reads `--profile '*'`, so it checks the two new services).

**Check.** `bun test apps/server/src/deploy-logging.test.ts`; `bash deploy/check-logging.sh`.

**Done when.** The three cases pass.

## Step 2 — `deploy/logs.sh`

**Goal.** The zero-part baseline: read the server log as text, filter by run, request, event or level, without the store (P1).

**Files.** `deploy/logs.sh` (new, executable), `apps/server/src/deploy-logging.test.ts` (one case).

**Interfaces.**

- `bash deploy/logs.sh [--since <docker duration, default 1h>] [--run <run_id>] [--request <request_id>] [--event <code>] [--level <debug|info|warn|error>] [--follow]`. It runs from the repo root, `C="docker compose -f deploy/compose.yaml --env-file .env"` like the README, then `$C logs --no-log-prefix --since "$since" [--follow] server | jq -rR "<program>"`.
- The jq program: `fromjson? | select(<filters>) | [.time, .level, "[\(.module)]", .event, (del(.time, .level, .module, .event, .msg) | to_entries | map("\(.key)=\(.value)") | join(" "))] | join(" ")`. Filters: `.run_id == $run`, `.request_id == $request`, `.event == $event`, level at or above `$level` (order debug < info < warn < error). Pass values with `--arg`, never by string paste into the program.
- `set -euo pipefail`; an unknown option prints the usage to stderr and exits 2.
- The jq program also lives in one function of the script, `render()`, which reads stdin; the test calls the script with `--stdin` (a hidden test option: read lines from stdin instead of `$C logs`).

**Test.**

1. `printf` two JSON lines (one with `run_id` `r-1`, `event` `sync_done`, `count` 3; one with `run_id` `r-2`) plus one non-JSON line into `bash deploy/logs.sh --stdin --run r-1` → one output line: `<time> info [mail] sync_done run_id=r-1 count=3`.
2. `--level warn` on an `info` and a `warn` line prints only the `warn` line.
3. `--bad` exits 2.

(These tests need `jq` on the test machine; CI's ubuntu image has it. If `jq` is missing, the test fails with a clear message: check `Bun.which("jq")` first.)

**Check.** `bun test apps/server/src/deploy-logging.test.ts`; `bash -n deploy/logs.sh`.

**Done when.** The cases pass.

## Step 3 — Docs

**Files and text.**

- `deploy/README.md` § Logs: keep the `jq` line as "without the store"; point to `bash deploy/logs.sh` for the filters; add a sub-section "Log store (search)": start `$C --profile ops up -d`; the UI is `https://<machine>.<tailnet>.ts.net:9443/select/vmui/` after `tailscale serve --bg --https=9443 http://127.0.0.1:9428` (stage 15 sets it up); three queries: one run (`"<run_id>" | unpack_json from _msg | sort by (_time)`), errors of the last hour (`_time:1h | unpack_json from _msg | filter level:=error | sort by (_time)`), counts per event (`_time:24h | unpack_json from _msg | stats by (event) count()`); retention 30 days, at most 1 GiB; memory 256 MB + 64 MB; only the `server` log enters the store; stop: `$C --profile ops stop victorialogs vlagent`.
- `docs/capabilities/logs.md`: stage 11 creates it. If stage 11 has not landed yet, create it here by the template of `docs/capabilities/README.md` with the store part only (and its index row); stage 11 then adds the logger part. Add the store to "What it does now", the entry points (page `vmui` on the tailnet, CLI `deploy/logs.sh`), the data (VictoriaLogs volume `vlogs-data`, 30 days, 1 GiB), the limits (only `server` lines; the glob would also read another Compose project's `json-file` logs on the same host; no basic auth, tailnet only, D15), and a "Checked against" update.
- `docs/known-alerts.md`: one entry `### Log store: vlagent reads no lines` (cause: the Docker root dir is not `/var/lib/docker`, or the server log driver is not `json-file`; fix: `docker info --format '{{.DockerRootDir}}'`, `docker inspect` of the server's log driver, then change the mount).

**Check.** `bun test apps/server/src/capability-map.test.ts`; `bunx prettier --check deploy/README.md docs/capabilities/logs.md docs/known-alerts.md`.

**Done when.** The Proof of `plan.md` for stages 13–14 (`/tmp/f103-s14`) prints `PROOF_OK`.

**Out of scope.** Starting anything on the VPS (stage 15). Alerts from the store (E8b uses the app, not the store).
