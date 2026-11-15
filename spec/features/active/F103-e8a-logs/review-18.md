# F103 stage 18 review (Opus 5.5, PASS dd1eef9a)

Model: Opus 5.5, because the stage is risky: the store config decides what is kept, for how long, how much memory and disk it takes, and who reads it.

No BLOCKING. Retention, disk cap, memory limits, the 127.0.0.1-only port, the read-only container-log mount, no ports on vlagent, no change to other services without the `ops` profile, `logs.sh` (values only through `--arg`; injection probes all data), the `_time:1h` query (correct per the LogsQL docs) and the runbook all hold.

TG1/TG2 (proven by mutation; fixed in a Sonnet continue): no test pinned the vlagent mounts, the `-remoteWrite.url` (must be `http://victorialogs:9428/...`) or the absence of `network_mode` (host network would expose `:9429`).

Notes:
- N1 (docs): the read-only `/var/lib/docker/containers` mount also exposes every container's `config.v2.json` (env, secrets) to the vlagent container (it reads only `*-json.log`). State it in `logs.md` Limits.
- N2 (docs, stage 19): vlagent reads every `json-file` container of the host, not only Compose projects; first start reads files from the beginning. Replace the `docker ps -a` hint by `docker ps -aq | xargs docker inspect --format '{{.Name}} {{.HostConfig.LogConfig.Type}}'`.
- N3 (fixed): vlagent had no disk cap on `vlagent-data`; add `-remoteWrite.maxDiskUsagePerURL`.
- N4 (stage 19): VictoriaLogs has no auth and its port also serves `/insert/*`; serve only `/select/` through Tailscale, never the whole port.
- N7 (minor `logs.sh`): a non-string `level` prints a jq error for that line; raw control characters in values reach the terminal; no `--unbuffered` with `--follow`; the script needs the repo root.
- N9: a remote checkout without stage 17's compose file fails with "no such service: cli" until it is pulled: stage 19 order.
- N10: F114 stage 07 must add its drill compose file to the `check-logging.sh` lists.
