# E8 · Operations

> Tier: Must (minimum), Should (the rest). Status: ready to plan (discovery 2026-11-13, PD-051–PD-055; the "Discovery" section below replaces the sections above where they differ). Size (corrected): Must about 15 stages, 2.9k lines; Should about 6 stages, 0.8k lines. Owner idea: "easy access to logs from application".

## Outcome

The operator can search what the system did, gets an alert when an SLO breaks, and can release and restore with a checklist. No mail content ever reaches a log, a metric or an error report.

## Users

Operator.

## In scope (minimum, Must)

- Structured logs: one JSON object per line with time, level, module, message, `org_id`, `mailbox_id`, `job`, `run_id`, `request_id`, `action_id`, error code; a redaction step drops any field outside an allow-list; human text mode in dev (`platform/log.ts`).
- Docker log rotation (`max-size`, `max-file`) in `deploy/compose.yaml`; check `/etc/docker/daemon.json` on the VPS.
- Log store with search on the tailnet: Grafana + Loki, or VictoriaLogs (lighter), with a collector (Alloy or Vector) that reads the Docker logs; retention 14–30 days. Decide by the VPS RAM budget.
- Five SLO alerts to the operator Telegram chat: sync lag > 10 min, urgent latency > 5 min, LLM error rate, disk, backup age; each links a `docs/known-alerts.md` entry.
- Release process: semantic versions, changelog, a release checklist, one-command deploy and rollback, a tested migration rollback rule. The checklist has the step "model or prompt changed → `eval --sim` holdout report attached" (PD-025) and a line for the sim stack deploy.
- One restore drill with a measured restore time; a VPS-lost runbook.

## In scope (Should)

- Metrics endpoint (Prometheus or OpenTelemetry) and Grafana dashboards "Operations", "Quality", "Cost".
- Error tracking (GlitchTip or Sentry SDK, self-hosted), server and web.
- Traces across sync → triage → committer → send.
- Staging stack on the VPS: reuse the E2b sim stack (`ea-sim`, ADR 0021 draft, PD-020) instead of a new one; load test 10 organizations × 200 mails a day with the E2 injector.
- IMAP IDLE for near-real-time arrival (helps M5).
- Security: threat model per flow, dependency audit bot, secret scanning and image scan in CI, key rotation runbook, DPIA draft, records of processing, breach procedure.

## Out of scope

Hosted services that receive mail metadata (self-hosted by default). A customer-facing status page (E10 can add a static one).

## Dependencies

E1. Independent of E2–E7; can run in parallel.

## Open product questions

1. Loki vs VictoriaLogs vs Grafana Cloud free tier: decide on the VPS RAM numbers (owner's go to check). The same check decides whether the E2b sim stack (server, DB, GreenMail, fake Telegram) fits on the VPS or runs on the owner's PC (PD-020); disk was 3.8 GB free on 2026-11-11.
2. Alert channel: the operator Telegram chat (exists) or a separate one.

## Risks

- RAM on the home VPS: a Grafana stack can take 1–2 GB; VictoriaLogs alone is far smaller.
- A log flood can fill the disk today (no rotation): do the rotation first, in a small separate ticket.

## Exit

- `docker compose logs` is JSON; a search for one `run_id` in the log store shows the whole run; a test proves no mail field passes the redaction.
- The five alerts fired once each in a drill; the restore drill has a time in `docs/known-alerts.md` or a runbook.
- The release checklist was used for one release.

## Discovery (2026-11-13)

Session: discovery queue row 4. Detail, sources and tables: [`E08-discovery-notes.md`](E08-discovery-notes.md). Facts for later agents: `notes/2026-11-13-operations-facts.md`. ADR draft: `docs/decisions/0024-structured-logs-and-operator-alerts.md` (proposed).

### Verdict: modify

The outcome is right for the thesis: "nothing slips" needs a system that tells the operator when it slips, and a sell-ready product needs searchable, content-free logs and a tested release and restore path. Three changes:
1. **Alerts are checked by the app, not by a Grafana stack.** Four of the five SLOs are facts in Postgres; the operator notice path (Telegram, dedup, audit row) exists. Healthchecks.io (in use) stays the dead-man for "server down" and gets a backup check. So the log store is for search only, and the lightest store wins: VictoriaLogs.
2. **The Should tier shrinks.** Dashboards, GlitchTip, traces and a separate staging stack are dropped (their jobs have owners elsewhere); DPIA, records of processing and the breach procedure move to E7 S6e (PD-049). IMAP IDLE stays here (E3 discovery: a 2-min poll in E3a first).
3. **Size grows.** The JSON logger is small, but 426 log calls put ids and error messages into free text; the allow-list only protects if every call changes.

### Code cross-check (summary; full table in the notes §1)

| Item | Exists today | New |
| --- | --- | --- |
| JSON logs, context ids | `platform/log.ts`: text `[module] …`; 426 calls in 73 files; no `run_id` / `request_id` anywhere | JSON writer, `AsyncLocalStorage` context per job tick and request, field API |
| Redaction | Convention only; `describeError()` (name + code) exists; 24 calls still log `error.message` | Allow-list of fields and value shapes, lint rule, canary test |
| Rotation | None in `deploy/compose.yaml`; Docker `json-file` default has no limit | `logging:` per service |
| Log store | `docker compose logs` over SSH | Compose profile `ops`: VictoriaLogs + vlagent, tailnet only |
| Alerts | Healthchecks.io dead-man; operator notices (`channels/operator.ts`, S6a D31); user `sync_stale` notice | `ops.slo` job, five alert kinds, backup status file |
| Release | `deploy/README.md` § Update; rollback = rebuild (about 9 min); version `0.0.1`, no tags | Release and rollback scripts, tagged images, changelog, checklist |
| Restore | `backup.sh`, `restore-test.sh`, restore tests 2026-11-03 and 11-07 | One timed drill on a clean VM; VPS-lost runbook |

Correction to the page: the urgent-latency target cannot be an E8 alert at 5 min. Sync runs every 5 min (`apps/server/src/main.ts:82`), so M5 (< 5 min) cannot hold at p95 by polling. E8 alerts at 10 min (a broken pipeline); E3 owns M5 and moves the poll to 2 min in E3a; IDLE (E8 Should) later replaces the poll.

### Cross-epic notes (edits for the owner; this session did not edit other pages)

- **E3** (its session ran in parallel and already holds this): 2-min poll in E3a, IDLE stays in E8; the E8 latency alert reads the E3 M5 query (one arrival definition). The Grafana "Quality" and "Cost" dashboards are dropped: the E3 weekly report is the only place for M1–M8.
- **E7** (b, c, d are already in PD-049, PD-050 and PD-046): (a) S6f D31 "failed backup → operator notice" becomes the E8 `slo_backup_age` alert; S6f keeps the upload check and writes the status file. (b) The S6f restore test and the E7 "clean-server install from the README" are proven by the one E8 drill. (c) DPIA draft, records of processing, breach procedure move to S6e. (d) The operator console (F081) lists the alert audit rows; it is also the "Operations" view.
- **E2**: the sim stack is the staging stack (PD-020, already on this page); the VPS look in this session answers whether it fits.
- **E10**: operator docs (runbooks, alerts, release, restore) come from E8; the security-and-data page states "logs hold ids only, 30 days, on the server" and names Healthchecks.io (receives timing pings only, no data).
- Planned tickets: E8 absorbs none. F081 stays in E7; F023 and F073 (provider budget alerts) stay in E3.

### Research facts (sources and dates in the notes §3)

- Docker `json-file` default: no size limit; `local` driver: 5 × 20 MB, compressed (docs.docker.com).
- VictoriaLogs: one binary, built-in search UI, retention by time and disk size; about 16 MB RSS at rest in a third-party benchmark. vlagent: about 28 MiB at 10k logs/s (vendor benchmark, marketing); reads files, no Docker source.
- Loki + Alloy + Grafana: three parts, hundreds of MB (grafana.com, user reports). Grafana Cloud free: 14 days, but data leaves the host (rejected by `03` §4).
- GlitchTip: 512 MB+ and its own Postgres (selfhosting.sh, 2026-02). Healthchecks.io: 20 free checks, Telegram integration (healthchecks.io).
- Expand/contract with forward-only migrations is the common rule (prisma.io data guide; Canopy ADR-016).

### VPS look (2026-11-13, read-only, `ssh home_vm`)

- 16 vCPU, RAM 3.9 GB total, 3.0 GB available; `server` 136 MiB, `db` 37 MiB. Enough for the `ops` profile (about 320 MB with limits) and the E2 sim stack: no RAM change needed.
- Disk: root LV 23.5 GB, 86 % used, 3.2 GB free. The VM disk `sda` is 50 GB; partition `sda3` is 46.9 GB, so about 23 GB in the volume group is not allocated (Ubuntu's installer default). Reclaimable: 862 MB build cache, 673 MB old image.
- Docker 28.5.1, driver `json-file`, no `/etc/docker/daemon.json`: no rotation today.
- Log volume: `server` wrote 239 lines (40 KB) in about 2 h, `db` 65 lines: about 0.5 MB a day. 30 days fit in a few MB; the 1 GB cap is only a guard.
- The VPS runs `cab134f`.

### Decisions (owner: "I will just use your defaults", 2026-11-13)

1. Read-only VPS look. [done, results above]
2. Log store: VictoriaLogs + vlagent in a Compose profile `ops` (a clean install works without it), tailnet only via `tailscale serve` on its own port, 30 days capped at 1 GB, `mem_limit` 256 MB + 64 MB. Fallback collector: Vector. `deploy/logs.sh` (`docker compose logs` + `jq`) stays as the zero-part baseline. [VictoriaLogs]
3. Alerts: an app job `ops.slo` every 5 min checks the five SLOs and sends through the existing operator notices (one notice, repeat every 6 h while open, one "resolved"); Healthchecks.io stays the dead-man and gets a second check pinged by `backup.sh`. No Grafana, vmalert or Alertmanager. [yes]
4. Alert channel: **no new bot.** Each environment keeps its own bot (dev and VPS, as today; one bot cannot serve two environments because Telegram allows one poller per token). The VPS bot sends operator alerts to one Telegram group "EA operator" (`OPERATOR_TELEGRAM_CHAT_ID`), apart from the owner's digest chat; HealthchecksBot joins the same group. Dev and the sim stack send no operator alerts to real Telegram. A normal day sends 0 alerts; an incident sends one notice, a repeat every 6 h while open, and one "resolved". [decided]
5. Thresholds: sync lag > 15 min; urgent mail not notified or notified > 10 min after arrival; LLM failures ≥ 20 % of ≥ 5 calls in 30 min or a quota pause; disk < 15 % or < 2 GB free; last good backup > 26 h or a failed run. Config values. [as listed]
6. Log content rule: `msg` and `event` are string literals; variable data only in allow-listed fields (ids, codes, counts, durations); errors only through `describeError()`; a lint rule blocks interpolation; a canary test proves no planted mail string reaches any log line. All 426 calls convert. [yes]
7. Release: SemVer `0.y.z` until the Stage 2 exit, then `1.0.0`; git tag + `CHANGELOG.md`; `deploy/release.sh <tag>` and `deploy/rollback.sh` keep the previous image, so a rollback needs no rebuild; the checklist includes the PD-025 eval step. [yes]
8. Migrations: forward-only, expand/contract; a release's migration works with the previous release's code; a rollback never runs a down migration; a CI check flags `DROP`, `RENAME`, `ALTER … TYPE` without a `-- contract:` line. [yes]
9. Restore: one drill on a clean VM on your PC (install from the README, restore the latest B2 backup, pilot Telegram and mail switched off, counts match), timed; it also proves the E7 S6f restore test and the E7 clean install. Targets RPO 24 h, RTO 2 h. [yes]
10. Should tier: keep CI security (Dependabot, secret scanning with push protection, Trivy image scan), a `POST /api/client-errors` route for web errors, threat model, key-rotation runbook, load test on the sim stack, IMAP IDLE (after the E3a 2-min poll). Drop dashboards, GlitchTip, traces, a separate staging stack. DPIA, records of processing, breach procedure go to E7 S6e (PD-049). [decided; IDLE stays in E8 to match the E3 discovery, not moved]
11. Log rotation ships first as a tiny ticket next to E1 (a `logging:` block in `deploy/compose.yaml`, deployed with the next VPS deploy), not inside E8a. [yes]
12. Two tickets: E8a Logs (logger, context, conversion, store), E8b Alerts and releases (SLO job, release scripts, migration check, drill). [yes]
13. Disk: grow the root volume into the free space of the volume group before E8b and E2b; no VM change and no new VPS. Owner step, about 1 min, online: `sudo vgs` (check `VFree` is about 23 GB), then `sudo lvextend -r -l +100%FREE /dev/ubuntu-vg/ubuntu-lv`, then `df -h /` (about 46 GB, about 26 GB free). RAM stays 4 GB. Until the step, the sim stack runs on the owner's PC (PD-020 fallback). [decided]
14. Cross-epic lines: E10 page edited in this change; E3 and E7 already hold them (their sessions ran in parallel). [done]
15. Commit the changed files by explicit path. [done]

All other items: the default in brackets above is the decision. Planned tickets: E8 absorbs, replaces or drops none (F081 stays in E7, F023 and F073 in E3). New tickets for `plan-task`: a tiny log-rotation ticket next to E1 (item 11), then E8a Logs and E8b Alerts and releases.

### Risks (confirmed, added, removed)

| Risk | Mitigation |
| --- | --- |
| Disk on the VPS (86 % used, 3.2 GB free) — the main risk until the volume grows | Decision 13 (23 GB free in the volume group); rotation first (11); store capped at 1 GB; release script stops under 3 GB and prunes old images; `slo_disk` alert |
| RAM (3 GB available of 4 GB) | `mem_limit` on both `ops` containers; the owner can add RAM later if the sim stack and `ops` run together and `free -m` drops under 1 GB available |
| The 426-call conversion touches every module while E2, E4, E7 build in parallel: merge conflicts | Convert by module group in short stages, each landed at once; the lint rule warns first and becomes an error after the last group |
| A redaction gap: server error texts (IMAP, SMTP) hold addresses | `describeError()` only; canary test with an injected IMAP error |
| The app cannot alert on its own death | Healthchecks.io dead-man (exists) + backup check |
| Alert noise makes the operator ignore alerts | Hysteresis, 6 h repeat, "resolved" notice, thresholds as config |
| vlagent reads Docker's own files (Docker advises against it) | Read-only mount; probe in E8a stage 1; fallback Vector `docker_logs` behind a read-only socket proxy |
| Removed: "a Grafana stack can take 1–2 GB" | No Grafana in Stage 2 |
