# 0024 — Structured logs with an allow-list, a tailnet log store, and operator alerts checked by the app

- Status: proposed (E8 discovery, 2026-11-13). The owner chose the defaults (PD-051, PD-052); accepted when E8a lands.
- Date: 2026-11-13

## Context

The server writes text log lines (`apps/server/src/platform/log.ts`): `[module]` plus free text. 426 log calls in 73 files put ids into the text, and 24 still print `error.message`, which can hold a mail address when an IMAP or SMTP server answers with an error. The rule "no address, subject or mail text in logs" is a convention, not a check. There is no `run_id` or `request_id`, so one run cannot be followed. The only store is Docker's `json-file` log, with no size limit (`deploy/compose.yaml` has no `logging:` key). The operator reads logs only over SSH.

Alerts today: a Healthchecks.io dead-man (`platform/heartbeat.ts`) and operator notices to a Telegram chat (`modules/channels/operator.ts`, S6a D31) with an `operator.notice` audit row. The Stage 2 plan (`docs/product/stage-2/02-inventory-and-roadmap.md` §11) proposed Grafana + Loki with Grafana alert rules. The home VPS had 3.2 GB of disk free on 2026-11-12 and its RAM is not measured.

## Decision

1. **Log line contract.** One JSON object per line on stdout: `time`, `level`, `module`, `event` (a stable code), `msg` (a constant string), and only allow-listed fields (ids, codes, counts, durations, `release`, `job`, `run_id`, `request_id`). The writer drops any other field and any value that is not a UUID, a number, a boolean or a short code, and counts the drops. `msg` and `event` are string literals at the call site; a lint rule blocks interpolation. Errors reach a log only through `describeError()` (name and code). `LOG_FORMAT=text` gives a readable line in dev.
2. **Context.** The scheduler opens an `AsyncLocalStorage` context per job tick (`job`, `run_id`), the HTTP layer per request (`request_id`, also a response header); per-item code adds `org_id`, `mailbox_id`. Call sites do not pass these ids by hand.
3. **Proof.** A canary test sends a mail with planted strings through the whole pipeline and an injected IMAP error, and fails if any planted string appears in the log output.
4. **Rotation.** Every Compose service sets `logging: { driver: json-file, options: { max-size: 10m, max-file: "5" } }`.
5. **Log store.** VictoriaLogs (single node) and vlagent (file collector, read-only mount of the Docker log files) in an optional Compose profile `ops`. Retention 30 days, capped at 1 GB of disk; memory limits on both containers. The search UI is reachable only on the tailnet through `tailscale serve` on its own port (ADR 0017 rule kept). A clean install works without the profile; `deploy/logs.sh` (`docker compose logs` + `jq`) is the baseline everywhere. No log leaves the host.
6. **Alerts.** An app job `ops.slo` (every 5 min) checks sync lag, urgent latency, LLM failure rate, free disk space and backup age from Postgres, the LLM call outcomes, `statfs` and a backup status file. It sends through the operator notice path (the environment's existing bot to one operator Telegram group; no new bot): one notice when an alert opens, a repeat every 6 h while open, one "resolved" notice; each with an audit row and a link to its `docs/known-alerts.md` entry, never mail content. Healthchecks.io stays the dead-man for "server or DB down" and gets a second check pinged by `backup.sh`. No Grafana, vmalert or Alertmanager.
7. **`docs/known-alerts.md`** entries are keyed by `event` code from now on (the text of `msg` may change; the code does not).

## Consequences

- Every module changes (the 426 calls). The change runs module by module; the lint rule warns until the last module is done, then fails the build.
- The privacy rule of `docs/product/stage-2/03-product-frame.md` §4 ("logs carry ids and counts, not mail content") becomes a tested property, which the E10 security-and-data page can state.
- The VPS runs two more small containers when the `ops` profile is on. A hosted log service is not used, so no new sub-processor. Healthchecks.io receives only timing pings (in use since S1).
- Metrics dashboards, error tracking and traces are not built in Stage 2; a later ADR adds them if the operator console and the log store are not enough.
- If vlagent cannot read the Docker log files well, Vector with `docker_logs` behind a read-only Docker socket proxy replaces it; the rest of this ADR holds.
