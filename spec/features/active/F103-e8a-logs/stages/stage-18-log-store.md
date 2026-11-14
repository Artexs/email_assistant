# F103 stage 18 — The log store (Compose profile `ops`)

Part of [`../plan.md`](../plan.md). Review job before the land (the store config decides what is kept and who reads it). Needs stage 17.

Three steps. No Docker daemon on the worker machine: checks use `docker compose config` only (V8).

## Step 1 — The two store services

**Goal.** `--profile ops up -d` starts VictoriaLogs and vlagent; without the profile nothing changes (P1, D14). Interface (`deploy/compose.yaml`):

```yaml
  # Log store (ADR 0024 point 5), tailnet only.
  victorialogs:
    image: victoriametrics/victoria-logs:v1.54.0
    profiles: [ops]
    logging: *logging-local
    restart: unless-stopped
    command:
      - -storageDataPath=/vlogs
      # 30d: without a suffix the number is months.
      - -retentionPeriod=30d
      - -retention.maxDiskSpaceUsageBytes=1GiB
      - -httpListenAddr=:9428
    volumes:
      - vlogs-data:/vlogs
    mem_limit: 256m
    # Loopback only; Tailscale Serve proxies to it.
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
      # Only json-file logs: the server's (D12).
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
- The images run as root (V7): the agent reads Docker's `0640` files.
- The glob also matches `json-file` logs of another Compose project on the host (stage 19 checks `docker ps -a`; a limit in the capability page).

**Decisions.** P1, D12, D14; V1–V7 (`../plan-facts.md`).

**Test** (in `deploy-logging.test.ts` of stage 17).

1. `config --profile ops` as in stage 17 (dummy passwords, `--no-env-resolution`, no `--no-interpolate`, V11): the victorialogs command holds `-retentionPeriod=30d` and `-retention.maxDiskSpaceUsageBytes=1GiB`; `mem_limit` is `"268435456"`, the vlagent one `"67108864"` (strings, V11); `ports[0].host_ip` is `127.0.0.1`; the vlagent containers mount has `read_only: true`; vlagent has no `ports`; both log `local`.
2. The same command without `--profile ops` lists no `victorialogs` and no `vlagent`.
3. `bash deploy/check-logging.sh` passes (it reads `--profile '*'`: it checks both new services).

**Done when.** The three cases pass.

## Step 2 — `deploy/logs.sh`

**Goal.** The zero-part baseline (P1): the server log as text, filtered by run, request, event or level. Interface (`deploy/logs.sh`, new, executable):

- `bash deploy/logs.sh [--since <duration, default 1h>] [--run <id>] [--request <id>] [--event <code>] [--level <level>] [--follow]`, from the repo root: `$C logs --no-log-prefix --since "$since" [--follow] server | jq -rR "<program>"`.
- The jq program: `fromjson? | select(<filters>)`, then the line form of the README `jq` line, with `.event` as the name. Filters: `.run_id == $run`, `.request_id == $request`, `.event == $event`, level at or above `$level`. Values only through `--arg`.
- `set -euo pipefail`; an unknown option prints the usage to stderr and exits 2. The program lives in `render()` (reads stdin); the hidden option `--stdin` reads lines from stdin instead of `$C logs` (for the test).

**Test.**

1. Two JSON lines (`run_id` `r-1`, `event` `sync_done`, `count` 3; and `run_id` `r-2`) plus a non-JSON line into `bash deploy/logs.sh --stdin --run r-1` → one line: `<time> info [mail] sync_done run_id=r-1 count=3`.
2. `--level warn` on an `info` and a `warn` line prints only the `warn` line.
3. `--bad` exits 2.

(They need `jq`; without it the test fails with a clear message: check `Bun.which("jq")`.)

**Done when.** The cases pass.

## Step 3 — Docs

- `deploy/README.md` § Logs: the `jq` line stays ("without the store"), minus its `legacy_text` branch; point to `deploy/logs.sh`; sub-section "Log store (search)": start `$C --profile ops up -d`; the UI `https://<machine>.<tailnet>.ts.net:9443/select/vmui/` (Serve set up in stage 19); three LogsQL queries, each with `unpack_json from _msg`: one run (`"<run_id>" | unpack_json from _msg | sort by (_time)`), errors of the last hour, counts per event ; limits (30 days, 1 GiB, 256 + 64 MB, only `server` lines); stop with `$C --profile ops stop victorialogs vlagent`.
- `docs/capabilities/logs.md`: the store part (create the page with its index row if stage 13 has not). Entry points `vmui`, `deploy/logs.sh`; data `vlogs-data`; limits: only `server` lines, another project's `json-file` logs, no basic auth (D15).
- `docs/known-alerts.md`: `### Log store: vlagent reads no lines` (cause: Docker root dir not `/var/lib/docker`, or server driver not `json-file`; fix: check `docker info` and `docker inspect`, then the mount).

**Done when.** `capability-map.test.ts` and `prettier --check` pass; the Proof (`/tmp/f103-s18`) prints `PROOF_OK`.

**Out of scope.** The VPS (19). Alerts from the store (E8b).
