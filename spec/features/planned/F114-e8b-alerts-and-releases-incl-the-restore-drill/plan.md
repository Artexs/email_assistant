# F114 · E8b Alerts and releases: plan

> **Status 2026-11-15 — planned, nothing built.** Plan base: 089aeb4f. Sources: epic `E08-operations.md` § Discovery, `E08-discovery-notes.md` §2, §5, §6. [scouts.md](scouts.md), [questions.md](questions.md).

## Input

Owner (epic page, 2026-11-13): "I will just use your defaults". Job instruction (2026-11-15): "a restore drill on the VPS is allowed if the plan restores into a SEPARATE database/container and never touches the live database". "owner steps and checkpoints are not a stop: use plan defaults."

### Product (epic decisions; not re-opened)

- **P1** App job checks five SLOs; Healthchecks.io stays the dead-man plus a backup check; no Grafana (decision 3).
- **P2** Operator group via `OPERATOR_TELEGRAM_CHAT_ID`: open, repeat every 6 h, resolved; dev and sim send nothing real (decision 4).
- **P3** Thresholds of decision 5 as config. **P4** SemVer `0.y.z`, tags, changelog, release and rollback scripts, PD-025 eval line (decision 7). **P5** Forward-only, expand/contract, CI check (decision 8). **P6** One timed drill, RPO 24 h, RTO 2 h (decision 9; place by D17).

### Design

- **D1 State table `ops_alerts`** (stage 01; operator module): one row per incident, numbers only. No `org_id`: host-wide (precedent `auth_lockouts`); `NO_PERSONAL_TABLES`, not `TENANT_TABLES`. Rejected: audit rows (`audit_log.org_id` is NOT NULL; disk and backup have no org); memory (a deploy restart loses the open state). Rule exception: Q1.
- **D2 One incident per kind.** Rejected: per mailbox (one IMAP outage = N alerts). The repeat shows the current set.
- **D3 Steps:** pure `nextAlertStep` (stage 01 table). Send first, then write the mark: a crash repeats one notice (at least once, as `channels/operator`). Rejected: mark first (a crash loses the notice). Hysteresis: an open alert closes only on the clear rule.
- **D4 Delivery:** chat set → Telegram direct send; chat unset → the `info` line `slo_alert_sent` counts as the send. A failed send leaves the mark unset; the next tick retries.
- **D5 Text:** English like the other operator notices: kind, phase, numbers, up to 5 ids read at send time, `docs/known-alerts.md#<kind>`. Never mail content or error text.
- **D6 Checks:** fire and clear rules in stages 02 and 04 (discovery notes §2; edge cases solved there: quiet hours, `/resume`, never-synced mailboxes, orgs with no linked chat, suspended orgs, hysteresis). All cross-org, run `withoutTenantScope`. `BACKUP_STATUS_FILE` empty = backup check off (dev, sim, tests).
- **D7 Job `ops.slo`** `30 */5 * * * *`. A check that throws skips its kind this tick; the others run.
- **D8 Placement:** checks, steps, repo, texts in `modules/operator` (layer 5, already reads across orgs). Cross-org readers in their owning modules, listed in the `docs/code-patterns.md` exceptions. `main.ts` injects the send. Rejected: a new module (one more layer for the same reads).
- **D9 Backup status:** `backup.sh` writes `deploy/backup-status/status.json` (format in stage 04), mounted read-only into `server`. The folder is in git, so Docker never creates it as root. `BACKUP_PING_URL` pings Healthchecks; a ping failure never fails the backup. Rejected: the app reads `BACKUP_DIR` file names (host path, no failure state).
- **D10 Release identity:** build arg `EA_RELEASE` (default `dev`); every log line gets `release`. `/health` stays `{status, db}`. Rejected: version in `/health` (public route).
- **D11 Images:** `ea-server:latest` is always the running release; `ea-server:<version>` kept for current and previous; state file `deploy/release-state/state` (`current`, `previous`, `pending`). Replaces the manual `pre-<ticket>` tags. Rejected: a tag variable in `compose.yaml` (every one-off command would need it).
- **D12** `release.sh <tag>`: refusals, steps and verify in stage 05. No automatic rollback: on failure it prints the rollback command. Rejected: automatic rollback (a failed migrate needs a human choice: forward fix or restore).
- **D13** `rollback.sh`: `pending` set → back to `current`; else → `previous`; none → refuse. No rebuild, never a down migration.
- **D14** First tag `v0.1.0`. `CHANGELOG.md` in Keep a Changelog form.
- **D15 Migration check:** flags contract statements in migrations newer than a fixed cutoff unless the file has `-- contract: <release>`; rules in stage 06. Rejected: a git-diff base (differs between CI push, PR and local).
- **D16 One restore path:** `deploy/restore.sh --target drill|new-host`. `new-host` refuses when the live DB has any `organizations` row; `drill` uses only project `ea-drill`.
- **D17 Drill place:** VPS, project `ea-drill` (own volume, subnet `172.29.0.0/24`, no host port), fresh clone at the tag; decrypt on the PC (the key never goes to the VPS), plain dump over ssh. Rejected: clean VM on the PC (no VM tool; jobs have no Docker there); `restore-test.sh` alone (no migrate, no server). Q4.
- **D18 Drill safety:** no Telegram, heartbeat, operator chat, web URL or LLM keys; scopes `off`; mailboxes `paused` in the drill DB before the server starts (no sync-off key exists, scout 4); `down -v` at the end. Detail in stage 07.
- **D19 Counts:** live counts right before and after the drill backup; pass when before ≤ drill ≤ after for `organizations`, `users`, `mailboxes`, `emails`. Rejected: equality (mail arrives during the dump).
- **D20** `credentials:check`: decrypts each mailbox secret; prints counts only.
- **D21 Docs:** new `docs/capabilities/operations.md`; `backups.md`; `docs/known-alerts.md`; `deploy/README.md`; `docs/release-checklist.md`; ADR 0024 Progress.
- **D22 Seams:** F108 (production) uses `release.sh` and D9; F081 console may list `ops_alerts`; F112 docs link the runbooks; F113 sim keeps the chat empty; one-off commands use the service `compose.yaml` has at the base (`cli` after F103 stage 17).

A decision gap is a question in the final message.

## Facts checked (HEAD 089aeb4f, 2026-11-15)

Scouts 1–4 (operator path, scheduler, config; SLO sources, logger; release path; restore). Checked by the planner: `channels/operator.ts` dedup by audit row; `metrics-repo.ts` M5 query; `log-fields.ts` has `release`; `compose.yaml` `image: ea-server`, subnet `172.30.0.0/24` (sim `172.31.0.0/24`); README § Backups: the private key is off the VPS; `audit_log.org_id` NOT NULL; `auth_lockouts` has no `org_id`. On the PC: no VM tool, no Docker socket for jobs, `age` present.

## Not verified

- V1 `statfs("/")` in the container equals the host root: stage 08 compares with `df /`.
- V2 VPS Compose supports `!reset`: stage 08 runs `config`. V3 `pg_restore` with `db-init` roles: stage 08. V4 the server reads the mounted status file: stage 08.

## Done when

1. Each kind opens, repeats, resolves (03). 2. `backup.sh` writes the status file and pings (04). 3. Release and rollback with no rebuild (05, 08). 4. The migration check fails on each D15 case (06). 5. Drill time and counts in `deploy/README.md` § VPS lost (08). 6. Five test notices and one real `slo_backup_age` fired (08).

## Rules for every stage

- Read `CLAUDE.md`, the styleguide, `docs/code-patterns.md`, this file and your stage. Build only it. `bunx prettier --write <your files>` only.
- Log lines by F103: `event` codes, allow-listed fields, `errorFields`. A new field name goes to its kind list.
- Shell scripts: `set -euo pipefail`; tests in `deploy/test/` (`bun test`, added to `test:unit`) with stub commands on `PATH`; no real Docker.
- Fixed `now` `2026-11-20T10:00:00Z` (Warsaw). Test addresses `@x.test`.
- Never print a secret or `.env` value. Commit by explicit path. Only stage 01 migrates; no `bun.lock` change.
- A gap or a deviation is a question in the final message, not a choice.

## Proof

```
mkdir -p /tmp/f114-sNN && bun run lint > /tmp/f114-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f114-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f114-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f114-sNN/int.log 2>&1 && echo PROOF_OK
```

## Owner checkpoints and steps

Not a stop (owner, 2026-11-13), except U1.
- U1 (stage 08 drill only): the `age` identity on the PC; tell the coordinator its path.
- U2: Healthchecks.io check "backup" (1 day, grace 2 h) → `BACKUP_PING_URL` in `deploy/backup.env`.
- U3: group "EA operator" with the VPS bot and HealthchecksBot → `OPERATOR_TELEGRAM_CHAT_ID`.
- U4: read the five test notices.

## Review

Opus before land: 01, 03, 05, 07, 08 (migration, sends, deploy, VPS). Sonnet: 02, 04, 06.

## Stages

1. [01 alert state](stages/stage-01-alert-state.md) [risky] migration, repo, `nextAlertStep`.
2. [02 checks](stages/stage-02-checks.md) config, three DB checks.
3. [03 job](stages/stage-03-slo-job.md) job, texts, send, CLIs.
4. [04 backup status](stages/stage-04-backup-status.md) status file, ping, disk and backup checks.
5. [05 release](stages/stage-05-release-scripts.md) identity, release, rollback.
6. [06 migration check and docs](stages/stage-06-migration-check-docs.md).
7. [07 restore](stages/stage-07-restore-path.md) restore script, drill override, `credentials:check`.
8. [08 VPS](stages/stage-08-vps-release-and-drill.md) [risky] first release, alert drill, restore drill.

Order: 01 → 02 → 03 → 04; 05 → 06; 07 any time. 04, 05, 07 touch Compose files: one at a time. 08 last.

## How to run (coordinator)

1. Gate PD-055 done; move to `active/`, commit.
2. Spawn per stage: `limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge --prepare 'bash scripts/limen-prepare.sh' --label "F114-sNN <slug> · F114" "Implement F114 stage NN (spec/features/active/F114-e8b-alerts-and-releases-incl-the-restore-drill/: ticket.md, plan.md, stages/stage-NN-<slug>.md). Run the Proof after the last commit; claim only what a saved log shows."`
3. TRACK land check, `limen land --keep-open`, drop the job DB. After 01: `bun run db:migrate` on the dev DB.
4. Stage 08: a coordinator run.

## Planning progress

- Scouts: 4, all done. Stages 01–08 [written].
- Words (`wc -w`): plan.md 1500; stages 01–08: 694, 637, 695, 640, 685, 656, 699, 667.

## Cold review

Not run yet.

## Log

- 2026-11-15 plan written at 089aeb4f.
