# F114 scouts

Four scouts (claude-sonnet-5-5, thinking medium), started 2026-11-15 at base 089aeb4f. Each packet is copied whole from the job log. A packet is a lead; the planner checked the facts that decisions depend on (see plan.md § Facts checked).

## Scout 1

- Job: `2026-11-15-f114-scout-1-998456d2`
- Question: How does an operator notice reach Telegram today, and how would a new periodic job add five alert kinds with open/repeat/resolved state? Cover: apps/server channels/operator notice code (kinds, dedup key, audit row, fallback when OPERATOR_TELEGRAM_CHAT_ID is unset), whether F088 notices-as-facts landed and what interface it gives for a new notice kind, how periodic jobs are scheduled in apps/server main.ts (interval, lock, job_runs rows), and the config pattern for new numeric thresholds (platform/config.ts).

```text
Packet: How an operator notice reaches Telegram at HEAD, and how a periodic job could add five alert kinds with open/repeat/resolved state
Base: 089aeb4f
Verified: `grep -rIl "job_runs" apps ../..` -> no output (no `job_runs` table or code exists); `git status --short` -> clean
Unknowns: Whether `audit_log` rows can carry state changes (open → repeat → resolved). I read only `hasAuditKey` and `recordAudit`, and did not read the schema or retention. I did not read `queueNotice` and its dedup (`channels/notice-queue.ts`).

1. `apps/server/src/modules/channels/operator.ts:19` — `createOperatorNotices` is the only operator path. Kinds: `trial_ending | llm_cap | auth_error_24h | auth_mail_failed | send_limit`.
   - Dedup key is a string per kind, e.g. `auth_error_24h:${mailboxId}:${statusChangedAt.getTime()}` and `send_limit:${mailboxId}:${UTC day}`.
   - Flow: `hasAuditKey` check → `send` → `recordAudit` with `event: operator.notice` and `data:{kind,key}`, written AFTER a successful send, in the org of the event.
   - The notice sends once per key and has no state: no repeat, no resolved.
   - A failed send is retried hourly only for `llm_cap` and `send_limit`, held in an in-memory `retries` map (lost on restart). — observed
2. `apps/server/src/main.ts:131-149` — wiring. `operatorChatId(config)` (`platform/config.ts:532`) returns `number|null`.
   - Unset `OPERATOR_TELEGRAM_CHAT_ID` → `send: null` → `sendOrLog` writes `log.warn("operator_notice_unsent",{kind})`. No audit row is written, so the same notice warns again on every tick.
   - Set → `telegram.sendDirect(chat, text)`; it throws "telegram is off" if there is no bot token.
   - The job is `scheduler.add("channels.operator","0 13 * * * *", …)` (hourly, minute 13, `operator.run()`). — observed
3. `apps/server/src/platform/scheduler.ts:30-52` — scheduler. It uses croner `Cron` in process, with `protect` (a tick is skipped while the job still runs; this is the only lock).
   - `runJobTick` runs `withoutTenantScope` and a log context `{job, run_id}`. It catches failures into one `job_failed` line.
   - No DB lock, no advisory lock, no `job_runs` rows. Observability is logs only.
   - Other jobs in `main.ts`: `platform.heartbeat` `*/5 * * * *` (L111), `mail.sync` via `mailSyncCron` (L109), `platform.retention` `0 40 2 * * *` (L229). — observed
4. F088 "notices as facts" landed (`spec/features/done/2026-11/F088-notices-as-facts`).
   - It covers user-facing Telegram notices only, not operator notices. The interface is `Detector {name, kinds: NoticeKind[], detect(run: OrgRun)}` in `modules/channels/notices/run.ts:39`.
   - Detectors are registered in the `detectors` array in `notices/index.ts:26`. They queue rows through `queue()` → `queueNotice` into the `outbox` table.
   - Kinds are the `noticeKinds` list in `packages/core/src/notices/kinds.ts`. It mirrors the `outbox.kind` CHECK list, so a new kind needs a migration.
   - It is per org, sent to linked member and owner chats, and run by `channels.notifier` every 15 s (`main.ts:263`). It is not a fit for operator-chat alerts as it stands. — observed
5. `apps/server/src/platform/config.ts:141-169` — config pattern. Numeric thresholds use `z.preprocess(emptyAsUndefined, z.coerce.number().int().min(a).max(b).default(n))`.
   - Example: `SEND_LIMIT_MAILBOX_HOUR` (L153) with a comment line above it.
   - Enum example: `MAIL_SYNC_EVERY_MIN` (L160) with a cron helper at L526.
   - `OPERATOR_TELEGRAM_CHAT_ID` is a regex string, marked private, never logged. — observed

Checks: `channels/notices/registry.test.ts`, `run.test.ts`, `platform/scheduler.test.ts` and `platform/config.test.ts` exist (names only, not run); they cover the detector registry, the notice run, scheduler skip and failure, and config parsing. I found no test file for `operator.ts` in the grep results; I did not look for one by name. Nothing covers open/repeat/resolved state.
```

## Scout 2

- Job: `2026-11-15-f114-scout-2-17746f9f`
- Question: Where does the data for five SLO checks live at HEAD: (a) mailbox sync lag (mailboxes.last_synced_at, status values), (b) urgent mail latency (emails arrival column, outbox kind urgent and sent_at), (c) LLM call outcomes and failure counts in the last 30 min and the triage quota pause state (http_429_quota), (d) disk free space from inside the server container (which path/volume), (e) backup age (does deploy/backup.sh write a status file or ping Healthchecks today). Also: the F103 logger API for event lines (function names, allowed fields) that new code must use.

```text
Packet: Where the data for five SLO checks (a–e) lives at HEAD, and the F103 logger API.
Base: 089aeb4f
Verified: `git status --porcelain` -> empty output (worktree clean). I did not run any query. I read files only.
Unknowns:
- The disk path for (d) is a guess. `deploy/compose.yaml` has no volume or tmpfs on `server`. `WORKDIR /app`, `USER bun` is in `deploy/Dockerfile`.
- I did not read the full `audit_log` schema for the `data` jsonb. I read only `recordLlmCall` in `audit/repo.ts`.
- I found no existing SLO or alert code. I did not grep for it.
1. (a) Mailbox sync lag — `mailboxes.last_synced_at timestamptz` (nullable) and `mailboxes.status` in `db/migrations/20261103100001_mail.sql:11,14`. Status values are `'active' | 'auth_error' | 'paused'`. `mail/repo/mailboxes.ts:141` writes `last_synced_at`. `operator/service.ts:63,124` already reads it. The lag is `now() - last_synced_at` for `status='active'` rows. A null value means the mailbox never synced. — observed
2. (b) Urgent latency — `emails.received_at` (`mail.sql:60`, NOT NULL) is the arrival column. `emails.created_at` is the insert time. `outbox` is in `db/migrations/20261106000001_telegram.sql:44-76`: `kind` includes `'urgent'` (`sync_stale` and `sync_ok` are other kinds), `status` is `pending|sending|sent|failed`, `sent_at` is set exactly when `status='sent'`, and `email_id` is required for urgent. `channels/metrics-repo.ts:22-25` already computes latency as `MIN(outbox.sent_at)` for `kind='urgent' AND status='sent'` against `emails.received_at`. That query is weekly and only for emails whose newest `triage_results.category='urgent'`. `channels/notices/urgent.ts:95` enqueues the urgent row. An open alert can use pending urgent rows: `outbox.status IN ('pending','sending')` with `created_at` or `next_attempt_at` old. — observed
3. (c) LLM outcomes — one `audit_log` row per call (`event='llm.call'`, `reason_code`=outcome, `created_at`). `audit/repo.ts:194-210` `recordLlmCall`. The `data` jsonb holds mailbox_id, role, model, endpoint, prompt_version, tokens_in, tokens_out, latency_ms. The failure count in 30 min is `count(*) FILTER (reason_code <> 'ok')` over `created_at > now() - 30 min`. The success code is `ok` (`audit/llm-pause.ts` comment). `audit_log` is org-scoped and has an `(org_id, event, created_at)` index. Quota code: `http_429_quota` (`platform/llm/errors.ts:22,45`, thrown at `providers/openai.ts:165`). Pause state is read two ways. (i) Durable: `audit/llm-pause.ts` `latestLlmPause(db, ctx, {now, softCodes, configCodes})`. The newest `llm.call` row decides. A soft code counts up to 10 min, a config code up to 2 h. It returns `{code, since}`. (ii) In process only: `triage/pause.ts` `createLlmPause()` with `isPaused(now)`. A restart clears it. Soft pause starts at 5 min and doubles to 60 min. `reports/llm-pause.ts` wraps this for `/status` and the digest. — observed
4. (d) Disk free — the `server` service has no volumes (`deploy/compose.yaml:30-57`). The only volume is `db-data:/var/lib/postgresql/data`, mounted in the `db` container only (`compose.yaml:22,68`). A statfs inside `server` on `/` or `/app` reports the Docker host filesystem (overlay) and not the `db-data` mount. The db volume lives under Docker root on the same disk by default. Postgres data cannot be read from `server`. — guessed
5. (e) Backup age — `deploy/backup.sh` writes no status file and does no Healthchecks ping. The grep found no `curl`, `hc-ping` or `healthchecks` in `deploy/`. Its only trace is the file `$BACKUP_DIR/ea-<UTC ts>.dump.age` on the host (`backup.sh:~38,67`), plus the remote copy via `rclone copyto` to `$BACKUP_REMOTE`. The last stdout line is `backup ok <name> <bytes>`. Local retention is `KEEP_DAYS` (default 7). Backup age is therefore the newest file's name or mtime in `BACKUP_DIR` on the host, and the server container cannot see it. The only Healthchecks use is the server heartbeat (`platform/heartbeat.ts`, `HEARTBEAT_URL`, `deploy/README.md:646`). — observed
6. F103 logger — `apps/server/src/platform/log.ts`: `createLog(module)` returns `Log` with `debug|info|warn|error(event, fields?)` and `.with(fields)`. Also `withLogContext({job, run_id, request_id}, fn)`, `setLogLevel`, `setLogFormat`, `logFormatFromEnv`, `droppedLogFields()`. The `event` must match `/^[a-z][a-z0-9_]{0,63}$/` (`log-fields.ts` `EVENT_CODE`). Anything else falls back to the deprecated free-text form (`legacy_text` in JSON). Use `errorFields(error)` from `platform/errors.ts:28` (returns `{error, error_code?}`). Example in `platform/heartbeat.ts`: `log.warn("heartbeat_ping_failed", {...errorFields(error)})`. Allowed fields (`log-fields.ts`; any other field is dropped and counted in `dropped_fields`):
   - uuid: org_id, mailbox_id, email_id, action_id, delegation_id, outbox_id, approval_set_id, item_id, user_id, run_id, request_id.
   - number: count, attempts, ms, tokens_in, tokens_out, mailbox_count, org_count, suspended_count, port, minutes, mailbox_hour, mailbox_day, recipient_day, wait_ms, update_id, bot_id, applied, failed, retry, closed, sent, expired_*, due, overdue, reminders.
   - code (strings of `[A-Za-z0-9_.:/*-]{0,64}`, no `://`, or number/boolean/null): job, code, error, error_code, kind, status, reason, scope, folder_key, provider, model, endpoint, host, role, method, route, config_key, flag, release, slot, command, from_plan, to_plan, enabled, actor.
   - A new field name needs an edit to the matching list in `log-fields.ts`. `platform/log-lint.test.ts` exists (I did not read it). — observed
Checks: `apps/server/src/platform/log.test.ts` and `log-lint.test.ts` cover logger behavior and the field list (guessed from names; not run). `deploy/check-logging.sh` covers only Docker log rotation. No existing check covers backup age or disk space.
```

## Scout 3

- Job: `2026-11-15-f114-scout-3-5c1ff4f5`
- Question: What does the release and deploy path look like at HEAD: deploy/README.md update and rollback sections, deploy/compose.yaml image names and tags, how the server image is built, package.json version, whether /health or logs report a release/version, the migration runner and migration file location and naming, the CI workflow jobs (.github/workflows), any existing release/rollback script, and what notes/2026-11-15-vps-deploy-queue.md says about rollback images and backups.

```text
Packet: Release and deploy path at HEAD (update, rollback, images, version, migrations, CI, scripts, queue note)
Base: 089aeb4f
Verified: `grep -n -A3 '/health' apps/server/src/platform/http.ts` -> `return dbUp ? c.json({ status: "ok", db: "up" }, 200) : c.json({ status: "error", db: "down" }, 503);`
Unknowns: Whether the server logs a version or commit at startup. I saw only `server_listening` with `port` (apps/server/src/main.ts:326). I found no `GIT_SHA`, `RELEASE`, `APP_VERSION` or `BUILD_ID` in apps/server/src, deploy/Dockerfile or .env.example. | The 4 repo notes about the VPS state (queue note and README) are operator records, so I could not check that they match the real VPS.

1. deploy/README.md:43-52 (Update) — Steps: `deploy/backup.sh`; `df -h /` (stop under 3 GB); `git fetch && git merge --ff-only origin/master`; `$C up -d --wait db`; `$C run --build --rm server bun run db:migrate`; `$C up -d --build --wait`; then a log-rotation check. The update makes no image tag and no `ea-server:pre-*` backup tag. — observed
2. deploy/README.md rollback sections (lines 101, 291, 370, 477, 489) — All say "Roll back the code, not the migration" and "Do not run `db:rollback`". Core method (line 293-300): write down `git rev-parse HEAD` before the update, then `git checkout <previous commit>` and `$C up -d --build --wait`. This rebuilds from source and has no image-based rollback. Line 108 has an SQL cleanup for a rollback past F085 stage 02. — observed
3. deploy/compose.yaml:30-33 — The server service has `build: {context: .., dockerfile: deploy/Dockerfile}` and `image: ea-server` with no tag, so the image is `ea-server:latest`. The db service uses `postgres:17`. No registry, and no digest or version pin. /health is the healthcheck (30s interval). Ports are `127.0.0.1:8080:8080`. — observed
4. deploy/Dockerfile — `FROM oven/bun:1.4.4`, which CI checks against `.bun-version`. `bun install --frozen-lockfile --filter "!@ea/docs"`, then `bun run web:build`, `USER bun`, `CMD bun apps/server/src/main.ts`. It has no build args and no version or commit stamp. package.json is `"version": "0.0.1"` (root, apps/web and apps/docs), unchanged and used nowhere. /health returns only `{status, db}`. — observed
5. Migrations — The runner is `dbmate` (package.json:89): `db:migrate` runs `dbmate -e MIGRATOR_DATABASE_URL --no-dump-schema --wait migrate`. `db:rollback` is `dbmate … rollback`. Files are in `db/migrations/`, 31 files, named `YYYYMMDDNNNNNN_name.sql` (latest `20261115130001_approval_edit.sql`). The server image runs it via `$C run --build --rm server bun run db:migrate`. — observed
6. .github/workflows/ci.yml — Triggers are push to `master` and `task/**`, pull_request to master, and workflow_dispatch. Jobs are `ci` (line 14: lint, typecheck, unit, Postgres roles, `db:migrate`, int, `web:build`), `e2e` (line 64: Playwright) and `image` (line 121). The `image` job checks the Bun pin, runs `deploy/check-logging.sh` and checks the sim compose file. It builds `ea-server:ci` and checks its contents. CI does not push or publish an image, and has no deploy or release job. — observed
7. Scripts — deploy/ holds `backup.sh` (age-encrypted pg_dump to BACKUP_DIR plus rclone to B2; last line `backup ok <name> <bytes>`), `restore-test.sh <file>.dump.age <key>` (README Backups section, lines 689-735), `check-logging.sh`, `compose.sim.yaml`, `Dockerfile.sim`. `git ls-files | grep -i -E 'release|rollback'` finds only spec files, so there is no release or rollback script. scripts/ holds `ci-bun.sh`, `limen-prepare.sh`, `plan-drift.sh` and `one-off/`. — observed
8. notes/2026-11-15-vps-deploy-queue.md — The rule is "back up first, tag `ea-server:pre-<ticket>`, deploy a CI-checked pinned commit, verify, then record here". The batch 1 record: the VPS is at `df42788b` (detached HEAD, CI run 43679928874), before `b56d414b`. The rollback image is `ea-server:pre-batch1115`. The backup is `ea-20261115T052116Z.dump.age` (470523 bytes). It says "Roll back the code, not the migrations" and to remove the pre-tag after 24 h. The tag and backup rule lives only in this note, not in deploy/README.md. — observed

Checks: `.github/workflows/ci.yml` `image` job covers the Dockerfile build, Bun pin and contents; it misses any version/commit stamp, any deploy or rollback step, and any restore-drill run. deploy/restore-test.sh and the README Backups section cover the restore test by hand; no CI job runs them.

Note check
- Packet covers all 9 asked areas: proven. `git status --short && git rev-parse --short HEAD && grep -c 'server_listening' apps/server/src/main.ts` exited 0 and printed `089aeb4f` and `1`. That checks the base commit and the log line. Items 1–8 of the packet carry the path and line for each area. Those reads ran in earlier bash calls that used `;`, so they do not count as proof under your rule.
- Every "observed" claim comes from a read at HEAD: not proven. The Verified line quotes real output from the /health read. The other claims came from reads in `;`-joined calls, and I saved no log file for them. The "no GIT_SHA, RELEASE, APP_VERSION or BUILD_ID" claim comes from one grep that printed only unrelated `release*` matches. I never checked the startup log fields beyond `server_listening`.
- Easy-to-miss rule ("Do not edit, create, or delete files. Do not commit."): followed. The same `&&` call printed no `git status --short` lines. It covers the worktree only. I did write the note at `/home/artek/Documents/repos/email_assistant/.limen/jobs/2026-11-15-f114-scout-3-5c1ff4f5/note.md`, which the Limen prompt required. That file is outside the worktree.

The note has no acceptance list to account for. No obligation is missing.
[limen 2026-11-15T05:48:13.169Z] done: pi exited 0
```

## Scout 4

- Job: `2026-11-15-f114-scout-4-295f04b7`
- Question: How can one restore drill run at HEAD without touching the live database: what deploy/backup.sh and deploy/restore-test.sh do step by step (B2, age, rclone, pg_dump format, row counts), what deploy/README.md says about first install and a lost VPS, what the F113 live lab / sim stack (spec/features/active/F113-e2b-live-lab/plan.md, ea-sim compose project) provides that a drill could reuse (separate project name, DB container, ports), and which env switches keep a restored stack from polling Telegram or IMAP (ACTIONS_SCOPE, TELEGRAM_BOT_TOKEN, sync off).

```text
Packet: How to run a restore drill at HEAD without touching the live DB
Base: 089aeb4f
Verified: `git status --short` -> (no output; worktree clean). I did not run backup.sh, restore-test.sh or the sim stack, because there is no Docker socket for agents (F113 plan F4).
Unknowns:
- Whether `deploy/restore-test.sh` runs end to end at HEAD. Not run. Guessed: yes.
- No `SYNC_ENABLED` or similar switch exists. `grep -rn "SYNC_OFF\|SYNC_ENABLED\|MAIL_SYNC_OFF" apps packages` found nothing. `main.ts:109` always adds the `mail.sync` job. A restored DB with active mailboxes and `CREDENTIALS_KEY` would make a started server poll IMAP. The mailbox pause path (`status` values) is not checked.
- `deploy/README.md` has no "lost VPS" section. The grep for "lost|new VPS|from scratch|disaster" found only unrelated lines. A rebuild drill must combine First install, step 4 and 5, with the Restore test.

1. `deploy/backup.sh:44-66` — Steps: needs `deploy/backup.env` (`BACKUP_DIR` absolute, `AGE_RECIPIENT` starts `age1`, `BACKUP_REMOTE` = rclone `remote:bucket/path`, `KEEP_DAYS`). Runs `docker compose -f deploy/compose.yaml --env-file .env exec -T db pg_dump -U postgres -d email_assistant -Fc`. Checks the first 5 bytes are `PGDMP`. Encrypts with `age -r` into `ea-<UTC stamp>.dump.age.part`. Copies with `rclone copyto --no-check-dest` (the B2 key is write-only). Then `mv` to the final name. Deletes local files older than `KEEP_DAYS`. Prints `backup ok <name> <bytes>`. It only reads the live DB. — observed
2. `deploy/restore-test.sh:20-48` — Args: `<file.dump.age> <age identity>`. Starts container `ea-restore-test` from `postgres:17` with `--network none`, no published port and a random password. Waits up to 60 s for `pg_isready` on TCP 127.0.0.1. Runs `age -d | docker exec -i … pg_restore --no-owner --no-privileges --exit-on-error`. Prints counts of `organizations`, `users`, `mailboxes`, `emails`. A trap removes the container. It never touches the live DB or compose project. It does not run migrations, start the server or check schema. The README says to compare counts with the VPS (`select count(*) from emails`). Run it on a machine that holds the private key, not the VPS (README 725-736). — observed
3. `deploy/README.md:19-40, 628-630, 695` — First install: `.env` from `.env.example`; DB passwords; `CREDENTIALS_KEY` (lost key = all mailbox passwords lost); `TRIAGE_LLM_SCOPE`, `ACTIONS_SCOPE`, `SEND_SCOPE` stay `off`. Then `$C up -d --wait db`, `$C run --build --rm server bun run db:migrate`, `org:create`, `mailbox:connect`, `$C up -d --build --wait`. After a real restore: run `delete from auth_sessions;` and replay each `deleted <org id>` and `record: dsr erase` line before the panel opens. B2 bucket, age key and rclone setup are at README 700-722. — observed
4. `deploy/compose.sim.yaml:1-140` — Project `ea-sim` has its own network (172.31.0.0/24, prod uses 172.30.0.0/24), its own volumes (`db-data`, `lab-state`) and its own `db` service (`postgres:17`, user `postgres`, db `email_assistant`, no published port). Roles come from `../db/roles.sql` plus `./db-init`. Only `fake-telegram` publishes a port: `127.0.0.1:8180:8080` (the panel). `greenmail` and `server` share the fake's network namespace. `deploy/sim.env` (from `sim.env.example`) holds `LAB_STACK=ea-sim` and a fake token. `bun run lab:env-check` (`package.json:88`, `lab-env-check.ts`) runs before each container start and refuses a wrong env. `bun run sim:up` starts the stack. A drill could reuse the `db` service plus its volume and ports, or just copy the project-name and no-port pattern. The F113 plan says the plan is "planned… nothing built", so the stack may not be deployed yet. — observed
5. `apps/server/src/main.ts:109,238-271`; `platform/config.ts:112-125`; `composition.ts:30-39` — Env switches. Empty `TELEGRAM_BOT_TOKEN` = no Telegram runtime and no `startPolling` (config.ts:112 "Empty or missing = Telegram off"). With `TELEGRAM_API_ROOT` set, Telegram goes to a loopback fake (the sim way). `ACTIONS_SCOPE=off` (the default) stops the committer's mailbox changes. `SEND_SCOPE=off` and `TRIAGE_LLM_SCOPE=off` are the other scopes. `HEARTBEAT_URL` empty = `heartbeat_off`. `OPERATOR_TELEGRAM_CHAT_ID` needs a token (config.ts:323). `ACTIONS_SCOPE` does not stop IMAP sync: the `mail.sync` cron always runs for every active mailbox, with no sync-off key. The safe options are: do not start `server` (the `restore-test.sh` way), or use the `ea-sim` env where `MAIL_ALLOW_LOCAL_HOSTS=true` points mail to loopback GreenMail. Another way is to pause the mailboxes in the restored DB before the server starts. I did not check that way. — observed (switches), guessed (the mailbox pause way)

Checks:
- `deploy/restore-test.sh` covers decrypt, `pg_restore` and four row counts; it misses migration state, server boot on the dump and `auth_sessions` cleanup.
- `apps/server/src/scripts/sim-compose-check.ts` covers the sim compose rules in CI (named in the compose header); I did not run it.
```
