# E8 · Operations

> Tier: Must (minimum), Should (the rest). Status: needs a short discovery session on the VPS (RAM, Docker daemon config). Size: minimum about 12 stages, 1.5k lines; should tier about 15 more. Owner idea: "easy access to logs from application".

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
