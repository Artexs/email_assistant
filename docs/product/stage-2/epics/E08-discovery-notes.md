# E8 · Operations — discovery notes (2026-11-13)

> Long detail for the "Discovery (2026-11-13)" section of `E08-operations.md`. Session: Stage 2 discovery queue row 4 (`05-execution-plan.md` §3). Model: Opus 5.5. Facts for later agents also in `notes/2026-11-13-operations-facts.md`.

## 1. Code cross-check (2026-11-13, commit `51ce4b1`)

| Item (epic page) | Exists today | Partly there | New |
| --- | --- | --- | --- |
| JSON logs | — | `apps/server/src/platform/log.ts` (35 lines): text lines `[module] …` to stdout and stderr, level filter. 73 files call `createLog`; **426 log calls** outside tests. Most put ids into the message text (`action ${action.id}: failed ${reason}`) | JSON writer, field API, dev text mode |
| Redaction by allow-list | Rule "no address, subject or mail text in logs" (convention only). `describeError()` in `platform/errors.ts` gives a log-safe label (name + code, never the message) | 24 log calls still print `error.message` (mostly CLI scripts: `mailbox-connect`, `mailbox-check`, `mailbox-password`; also `mail/jobs.ts:54`, `heartbeat.ts:31`). An IMAP or SMTP server error message can hold an address | Allow-list of field names and value shapes; lint rule; canary test |
| `run_id`, `request_id`, `job` | — (no match for `run_id`, `request_id`, `AsyncLocalStorage` in `apps/server/src`) | `platform/scheduler.ts` names each job (`mail.sync`, `triage.worker`, …) and logs `<name> failed: <label>` | A context per scheduler tick and per HTTP request (`AsyncLocalStorage`, works in Bun: checked locally on 1.4.4; the image runs `oven/bun:1.3.14`) |
| Docker log rotation | — `deploy/compose.yaml` has no `logging:` key; Docker's `json-file` default is no size limit | — | `logging:` options per service |
| Log store with search | — Only `docker compose logs` over `ssh home_vm` (`deploy/README.md` § Logs) | — | Compose profile `ops`: VictoriaLogs + collector, tailnet only |
| Five SLO alerts | Healthchecks.io dead-man (`platform/heartbeat.ts`, 5 min, pings only while the DB answers). Operator notices to `OPERATOR_TELEGRAM_CHAT_ID` with an `operator.notice` audit row (`modules/channels/operator.ts`, S6a D31: `trial_ending`, `llm_cap`, `auth_error_24h`; S6b adds auth mail). User notices `sync_stale` / `sync_ok` per mailbox (`outbox.kind`) | Data for the checks is in Postgres: `mailboxes.last_synced_at` (sync lag), `outbox` rows `kind='urgent'` with `sent_at` (urgent latency), `outbox.status='failed'` | `ops.slo` job, five new operator notice kinds with open/resolved state, backup status file, disk check |
| Release process | `deploy/README.md` § Update (backup, disk check, `git merge --ff-only`, migrate, `up --build`); § Roll back per feature (git checkout + rebuild, about 9 min cold). Version `0.0.1` in `package.json`, never changed. No tags, no `CHANGELOG.md` | CI (`.github/workflows/ci.yml`): lint, typecheck, unit, int, web build, e2e, image build; two known flaky timing tests (S6f fixes them) | `deploy/release.sh`, `deploy/rollback.sh`, tagged images, changelog, checklist, migration rule |
| Migration rollback rule | Migrations are forward-only SQL files in `db/migrations/`; no down files | — | Written rule (expand/contract) + a CI check |
| Restore drill | `deploy/backup.sh` (nightly cron 03:30, `age` + rclone to B2), `deploy/restore-test.sh` (restore on the dev PC, row counts). Restore tests ran 2026-11-03 and 2026-11-07 (`notes/2026-11-03-pilot-vps.md`) | No measured time; never a full rebuild of a lost host | One drill on a clean VM; VPS-lost runbook |

Disk on the VPS (from deploy logs, not measured in this session): 3.8 GB free on 2026-11-11 (83 % used), 3.2 GB free after the F077 deploy on 2026-11-12. Image `ea-server` 673 MB; a cold build needs about 2–3 GB of build cache (`docker builder prune -f` freed 2.09 GB). RAM: unknown.

## 2. Alert design: why the app checks, not a Grafana stack

The epic page and `02` §11.2 assume Grafana alert rules over Loki or metrics. A better fit for this product:

- Four of the five SLOs are facts the app already has in Postgres or can read cheaply: sync lag (`mailboxes.last_synced_at`), urgent latency (`emails` arrival → `outbox` `urgent` `sent_at`), LLM error rate (the LLM platform knows each call's outcome), backup age (a status file that `backup.sh` writes, also planned by S6f D31). Disk free space: `statfs` from the server container (checked: `node:fs/promises` `statfs` works in Bun).
- The operator notice path exists (Telegram, dedup key, audit row, log fallback when no chat is set). F081 / the E7 operator console will list these audit rows, so alerts show in the panel for free.
- A check in the app is a unit and integration test, not a dashboard config. The exit line "each alert fired once in a drill" becomes a test plus one manual drill.
- The one thing an in-app check cannot report is its own death. Healthchecks.io (in use since S1) already covers "server or DB down". A second Healthchecks.io check pinged by `backup.sh` covers "the cron did not run" independently of the app.
- Result: no Grafana, no vmalert, no Alertmanager in Stage 2. The log store is only for search, so the lightest store wins.

Alert rules (defaults; thresholds are config values):

| Kind | Fires when | Resolves when | Why this threshold |
| --- | --- | --- | --- |
| `slo_sync_lag` | an `active` mailbox has `last_synced_at` older than 15 min | the next good sync | Sync runs every 5 min (`main.ts:82`); 15 min = three missed runs, no flapping on one slow run. The user notice `sync_stale` stays separate (user side) |
| `slo_urgent_latency` | an `urgent` mail waits more than 10 min from arrival without a sent notice, or a notice went out more than 10 min after arrival | no such mail for 1 h | This alert catches a broken pipeline, not the M5 target. M5 (< 5 min) is measured and reported by E3; same arrival definition |
| `slo_llm_errors` | ≥ 20 % of LLM calls failed in the last 30 min and ≥ 5 calls, or triage paused on quota (`http_429_quota`) | rate < 10 % over 30 min | Hysteresis 20 % / 10 % stops flapping |
| `slo_disk` | free space < 15 % or < 2 GB on the data disk | free ≥ 20 % and ≥ 2.5 GB | The VPS is at 83 %; a deploy needs about 3 GB (`deploy/README.md` § Update) |
| `slo_backup_age` | the last `backup ok` is older than 26 h, or the status file says `failed` | the next `backup ok` | Nightly at 03:30 plus 2 h of slack |

Each open alert sends one notice, repeats every 6 h while open, and sends one "resolved" notice. Every notice carries the kind, the ids, the numbers and a link to its `docs/known-alerts.md` entry. Never mail content.

## 3. Log store comparison (research, 2026-11-13)

| Option | RAM (source) | Parts | Search UI | Verdict |
| --- | --- | --- | --- | --- |
| VictoriaLogs single node + vlagent | Store: one benchmark gives a median RSS of about 16 MB at rest (krabarena.com, "Loki vs VictoriaLogs vs Elasticsearch", accessed 2026-11-13; third-party benchmark); a user runs it with a 128 MiB limit (weblog.antonnovikov.com, 2026-06-10). vlagent: 28 MiB mean at 10k logs/s (victoriametrics.com/blog/log-collectors-benchmark-2026, 2026-03-20; vendor benchmark, marketing) | 2 containers | Built-in `vmui` at `/select/vmui/` (docs.victoriametrics.com/victorialogs/quickstart) | **Default** |
| Grafana Loki + Alloy + Grafana | Loki monolithic is for "up to approximately 20GB per day" (grafana.com Loki deployment modes); one user's cluster: 640 MB for 4 pods (blog.rommelporras.com, 2026-02-12). Alloy 66 MiB at 10k logs/s (same vendor benchmark) | 3 containers | Grafana | Rejected: 3–5× the RAM, three parts to update, for one operator |
| Grafana Cloud free | 0 on the host | — | Grafana | Rejected: mail metadata (ids, org names in errors) leaves the host; breaks the self-hosted promise (`03` §2, §4). Free tier keeps logs 14 days (grafana.com/pricing, accessed 2026-11-13) |
| No store: `docker compose logs` + `jq` | 0 | 0 | none | Kept as the baseline in every install (`deploy/logs.sh`), not as the operator's answer: the owner asked for "easy access to logs" |

Facts the choice depends on:
- Docker `json-file` default: no size limit and one file (docs.docker.com JSON File driver; runbook.academy). The `local` driver defaults to 5 × 20 MB with compression (docs.docker.com Local driver; moby `daemon/logger/local/local.go` v28.5.2). Since Engine 20.10, `docker logs` works with any driver through a local cache ("dual logging", docs.docker.com).
- vlagent has a file collector (`-fileCollector.glob`) with rotation support and checkpoints, and parses JSON lines (`msg`/`message`/`log` → `_msg`, `time`/`ts` → `_time`). It has no Docker-specific source; on one host it reads `/var/lib/docker/containers/*/*-json.log` read-only (docs.victoriametrics.com/victorialogs/vlagent, accessed 2026-11-13). Docker says those files are for the daemon only: a read-only mount is common practice (Promtail and Alloy do the same), but the plan's first stage proves it. Fallback: Vector `docker_logs` through a read-only Docker socket proxy (vector.dev docs).
- VictoriaLogs retention: by time and by disk size (`-retentionPeriod`, `-retention.maxDiskSpaceUsageBytes`; victoriametrics.com/products/victorialogs). `-memory.allowedPercent` limits caches only, not total RSS (GitHub VictoriaMetrics/VictoriaLogs issue 1031): set a Compose `mem_limit` too.

Default settings: VictoriaLogs `-retentionPeriod=30d`, `-retention.maxDiskSpaceUsageBytes=1GiB`, `mem_limit: 256m`; vlagent `mem_limit: 64m`; both in Compose profile `ops`, on the internal network, VictoriaLogs published only on `127.0.0.1` and served on the tailnet by `tailscale serve` on its own HTTPS port (ADR 0017 rule kept). Docker rotation: `json-file`, `max-size: 10m`, `max-file: 5`, per service (the collector reads `json-file`; Compose-level options need no `sudo` and travel with the repo).

## 4. Log line contract (proposal for the plan)

- One JSON object per line: `time` (ISO), `level`, `module`, `event` (stable code such as `action.failed`, the key for `docs/known-alerts.md`), `msg` (a constant string), then allow-listed fields: `org_id`, `mailbox_id`, `user_id`, `email_id`, `action_id`, `delegation_id`, `job`, `run_id`, `request_id`, `release`, `code`, `status`, `count`, `ms`, `attempt`, `kind`, `type`, `scope`. Values: UUID, number, boolean, or a short `[a-z0-9_.-]` code. Any other field or value shape is dropped and counted (`log.dropped` once a minute).
- `msg` and `event` are string literals at the call site. An ESLint rule (`no-restricted-syntax` on a template literal or a variable as the first argument of `log.*`) blocks interpolation. Old calls convert module by module; the rule goes from `warn` to `error` when the last module is done.
- Errors go only through `describeError()` (name + code). `error.message` never reaches a log. CLI scripts that print an error to the operator's terminal may keep the message on stderr in text mode, but never in JSON mode.
- Context: the scheduler opens a context per tick (`job`, `run_id`), HTTP per request (`request_id`, also returned as a response header), and the committer and triage add `org_id`, `mailbox_id` per item. Call sites do not pass these ids by hand.
- Dev: `LOG_FORMAT=text` prints the same record as one readable line (the default when stdout is a TTY).
- Proof: a canary test pushes a mail with planted strings (an address, a subject, a body phrase, an LLM reason) through sync, triage, actions, send, digest and an injected IMAP error, captures all log output, and fails on any planted string.

## 5. Release and rollback (proposal for the plan)

- SemVer `0.y.z` until the Stage 2 exit, then `1.0.0`. Git tag `v0.y.z` on `master`; the image is `ea-server:<version>`; `/health` and every log line carry `release`.
- `CHANGELOG.md` in Keep a Changelog form; one entry per release, written from the landed tickets (E10 turns it into the public changelog and "What is new").
- `deploy/release.sh <tag>`: backup → disk check (stop under 3 GB) → `git checkout <tag>` → build `ea-server:<version>` → migrate → `up -d --wait` → `/health` and a smoke check → keep the previous image tag, prune older ones. `deploy/rollback.sh`: start the previous tagged image; no rebuild (today a rollback rebuilds for about 9 min cold).
- Migration rule: forward-only; expand/contract (prisma.io data guide "expand and contract pattern"; a common rule in 2026 ADRs, e.g. Canopy ADR-016). A release's migrations must work with the previous release's code, so a rollback never needs a down migration. A drop or rename ships one release after the code stopped using the column. A broken migration is fixed by a new forward migration, or by restore from the pre-release backup. A CI check flags `DROP`, `RENAME` and `ALTER … TYPE` in a new migration unless the file has a `-- contract:` line that names the release that stopped the use.
- Checklist (`docs/release-checklist.md`): CI green on the tag; changelog entry; if a model or prompt changed, the E2 `eval --sim` holdout report attached (E2 decision); backup ok; disk ok; release script output; 30 min watch: no new `error` events in the log store, no open SLO alert; capability pages updated (PD-009).

## 6. Restore drill (one drill, three proofs)

E7 S6f has "one restore test on the dev machine" and E7 has "a clean-server install from the README, tested once". E8 has "one restore drill with a measured restore time and a VPS-lost runbook". One drill gives all three:

1. A clean Ubuntu VM on the owner's PC (no repo, no Docker).
2. Follow `deploy/README.md` "First install" only.
3. Fetch the latest backup from B2, decrypt with the `age` key, restore.
4. Start the stack with the pilot `.env` values (Telegram and IMAP **off**: `ACTIONS_SCOPE=off`, no `TELEGRAM_BOT_TOKEN`, so the drill never polls the pilot bot or touches the pilot mailbox), check `/health` and the row counts against the VPS.
5. Record the wall time from "VM booted" to "counts match" in `deploy/README.md` § VPS lost and in a `docs/known-alerts.md`-style runbook entry. Delete the VM.

Targets: RPO 24 h (nightly backup), RTO 2 h. A measured time over 2 h is a finding, not a failure.

## 7. Should tier after the cut

| Item (epic page) | Decision | Where it goes | Why |
| --- | --- | --- | --- |
| Metrics endpoint + Grafana "Operations", "Quality", "Cost" | Drop from Stage 2 | Quality and Cost: E3 weekly report (M1–M8). Operations: E7 operator console (job runs, last errors per org) plus the SLO alerts | One operator; the numbers already have owners and pages. A second UI stack costs RAM on a full host |
| Error tracking (GlitchTip / Sentry) | Drop | `error` events in the log store, grouped by `event`; a small `POST /api/client-errors` route logs web panel errors (name, route, release; no text) | GlitchTip needs 512 MB+ and its own Postgres (selfhosting.sh, 2026-02-09); its value is grouping, which `stats by (event)` in VictoriaLogs gives |
| Traces sync → triage → committer → send | Drop | `run_id` and the per-item ids in logs; the audit log holds the business history | No latency problem to trace at this volume |
| Staging stack | Drop as a separate item | The E2 sim stack (ADR 0021) is the staging stack; a release candidate runs there first when the RAM allows | E2 decision; one second stack, not two |
| Load test 10 orgs × 200 mails/day | Keep (Should) | E8, on the E2 sim stack or the owner's PC, with the E2 injector | Sell-ready proof of the capacity claim |
| IMAP IDLE | Keep (Should), after the E3a 2-min poll | E8 | Finding: sync runs every 5 min (`main.ts:82`), so M5 (< 5 min at p95) cannot hold. The E3 discovery (parallel session) moved the poll to 2 min in E3a and left IDLE in E8; this session first proposed a move to E3 and then kept it in E8 to match. Interia supports IDLE (`notes/2026-11-03-interia-imap-capabilities.md`) |
| Threat model per flow, key rotation runbook | Keep (Should) | E8 | Operator documents |
| Dependency audit bot, secret scanning, image scan in CI | Keep (Should), small | E8 | The repo is public: Dependabot and secret scanning with push protection are free settings; Trivy image scan is one CI step |
| DPIA draft, records of processing, breach procedure | Move | E7 S6e (papers) | Legal papers live with the privacy policy and DPA. The breach procedure links the E8 alert runbooks |

## 8. Size estimate (corrected)

| Part | Stages | Lines (changed) |
| --- | --- | --- |
| Logger, context, redaction, lint rule, canary test | 3 | 600 |
| Convert 426 log calls (by module group, codemod-assisted) | 4 | 1,000 |
| Rotation, log store profile, `deploy/logs.sh`, runbook | 2 | 250 |
| `ops.slo` job, five alerts, backup status file, Healthchecks backup check | 3 | 600 |
| Release and rollback scripts, version and changelog, checklist, migration CI check | 2 | 350 |
| Restore drill and VPS-lost runbook | 1 | 100 |
| **Must** | **15** | **about 2.9k** |
| Should (client errors, load test, CI security, threat model, key rotation) | 6 | 0.8k |

Two tickets: **E8a Logs** (logger, conversion, rotation if not shipped earlier, store) and **E8b Alerts and releases** (SLO job, release scripts, drill). E8b needs the `event` codes of E8a only for its own new lines; it can start after E8a stage 1.

## 9. Open checks for the plan

- vlagent on Docker `json-file` files: does it unwrap the Docker envelope (`{"log": "<our JSON>\n", "stream", "time"}`) into fields, or do we need `unpack_json` at query time? Probe in E8a stage 1; fallback Vector.
- Where the server reads the backup status file: a read-only bind mount of `~/ea-logs/backup-status.json` into the server container (S6f D31 default "status file") — shared with E7 S6f.
- `statfs` on which path: the Postgres volume lives on the host root disk on the pilot VPS; check with `docker volume inspect` during the VPS look.
