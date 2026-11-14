# F103 · E8a Logs: plan

> **Status 2026-11-14 — planned.** 15 stages written; cold review in § "Cold review". Builds after F095 (E1) is in `done/`. Nothing is built yet. Ticket: [ticket.md](ticket.md). Defaults for the owner: [questions.md](questions.md).

## Planning progress

- [x] Collect: ticket, `05-execution-plan.md` §2, E08 page and discovery notes, ADR 0024, F089 (plan, stages, review), `docs/code-patterns.md` § Logs, `eslint.config.js`, `platform/log.ts`, `platform/log-fields.ts`, `platform/errors.ts`, every old-form call site, the log tests, `deploy/compose.yaml`, `deploy/check-logging.sh`, `deploy/README.md`, the stages of F095, F097–F100.
- [x] Facts checked (probes V1–V7, lint count L1).
- [x] Decisions D1–D24.
- [x] stage-01-field-kinds [written]
- [x] stage-02-cli-output [written]
- [x] stage-03-cli-mailbox-scripts [written]
- [x] stage-04-cli-other-scripts [written]
- [ ] stage-05-convert-channels
- [ ] stage-06-convert-telegram
- [ ] stage-07-convert-actions
- [ ] stage-08-convert-mail
- [ ] stage-09-convert-triage-delegation-tenancy
- [ ] stage-10-convert-roots-testmail
- [ ] stage-11-lint-error-everywhere
- [ ] stage-12-canary
- [ ] stage-13-log-drivers-and-cli-service
- [ ] stage-14-log-store
- [ ] stage-15-vps-rollout
- [ ] Cold review (`plan-review-1.md`), fixes in § "Cold review".

## Input

### Owner words and decisions, word for word

From `docs/product/stage-2/epics/E08-operations.md` § Discovery, "Decisions (owner: "I will just use your defaults", 2026-11-13)":

> 2. Log store: VictoriaLogs + vlagent in a Compose profile `ops` (a clean install works without it), tailnet only via `tailscale serve` on its own port, 30 days capped at 1 GB, `mem_limit` 256 MB + 64 MB. Fallback collector: Vector. `deploy/logs.sh` (`docker compose logs` + `jq`) stays as the zero-part baseline. [VictoriaLogs]

> 6. Log content rule: `msg` and `event` are string literals; variable data only in allow-listed fields (ids, codes, counts, durations); errors only through `describeError()`; a lint rule blocks interpolation; a canary test proves no planted mail string reaches any log line. All 426 calls convert. [yes]

> 12. Two tickets: E8a Logs (logger, context, conversion, store), E8b Alerts and releases (SLO job, release scripts, migration check, drill). [yes]

Epic exit lines for E8a: "`docker compose logs` is JSON; a search for one `run_id` in the log store shows the whole run; a test proves no mail field passes the redaction." Owner idea: "easy access to logs from application".

From the coordinator task (2026-11-14): "the lint backlog is 395 old-form calls"; "New log lines use the event form (docs/code-patterns.md Logs)"; "Owner rules: no owner checkpoints for confirmation; an owner step only for what needs the owner's hands (real secrets, real money, a phone); small questions get a default in questions.md."

From `spec/build.md` NEXT (owner decision 2026-11-13): "VPS, ssh and deploy steps are pre-approved; the coordinator does them (backup first, name the rollback target, verify after). Stop for the owner only when a step needs an API key or secret the coordinator cannot get itself."

### Product decisions that bind this plan

- **P1** The store is VictoriaLogs + vlagent in the Compose profile `ops`, tailnet only, 30 days, 1 GB, memory limits 256 MB and 64 MB; Vector is the fallback; `deploy/logs.sh` is the baseline (E8 decision 2, ADR 0024 point 5).
- **P2** Every log call converts; the lint blocks the old form; a canary test proves the rule (E8 decision 6, ADR 0024 points 1, 3).
- **P3** E8a holds the logger, the context, the conversion and the store. Alerts, releases, the migration check and the drill are E8b (E8 decision 12). Rotation landed in F096 (E8 decision 11).
- **P4** No owner checkpoint. An owner step only for the owner's hands.

### Design decisions (D1–D24)

"Default, owner to confirm" marks a small question that is also in [questions.md](questions.md); the stages do not change with its answer.

- **D1 Field kinds (stage 01).** `platform/log-fields.ts` splits the one name list into three kind lists: `uuidFieldNames` (value: a lower-case UUID string or `null`), `numberFieldNames` (a finite number or `null`), `codeFieldNames` (the F089 D7 rule: a string of 0–64 characters from `[A-Za-z0-9_.:/*-]` without `://`, a finite number, a boolean, or `null`). `logFieldNames` stays exported as the three lists joined (callers and tests keep it). The writer checks each value against the kind of its name; a wrong kind is dropped and counted like an unknown name. `LogFields` becomes a typed record per kind, so after stage 11 `log.info("x", { count: "a" })` does not compile. Reason: a number field cannot carry text, and an id field cannot carry a code-shaped secret; so a new number name needs no privacy review, and the many counters of the conversion are safe. Rejected: one flat list (F089): every new name is a string channel. Default, owner to confirm (Q1).
- **D2 Code values come from closed sets.** A code field gets a value from a closed set in code (a TypeScript union, an enum, a constant table), from config (`model`, `provider`, a scope), from a route pattern, or an error name or code (`errorFields`, `telegramErrorFields`). Never from mail data, user input, or the text of an outside server. A worker may add a new number name freely and lists it in the final message. A new UUID or code name is in the stage file's list; any other new UUID or code name is a question in the final message.
- **D3 CLI output is not a log (stages 02–04).** New `platform/cli.ts`: `createCliOutput(name)` returns `{ print(text: string): void; fail(text: string): void }`. `print` writes `[name] text` to stdout (`console.log("[name]", text)`), `fail` the same to stderr (`console.error`). It ignores `LOG_FORMAT` and the log level, and has no allow-list: the operator reads it in the terminal. Every call in `apps/server/src/scripts/**` moves from `log.*` to `out.print` / `out.fail` with the same printed text, so the 18 test files that match CLI output stay green. Scripts no longer import `createLog` (module code that a script calls still logs events). An import rule lets only `apps/server/src/scripts/**` import `platform/cli.ts`. Reason: a script's output is the answer to the operator (a rule list, a usage text, an IMAP reply); as a log event it loses its content, and as a log line it would be a privacy leak. Rejected: convert scripts to events (the CLIs become unusable). Default, owner to confirm (Q2).
- **D4 Error text in CLI output.** `out.fail` prints `describeError(error)` or `telegramErrorLabel(error)`. Only the scripts that test a connection to a mail server (`mailbox-audit`, `mailbox-check`, `mailbox-connect`, `mailbox-password`, `mailbox-probe-move`, `mailbox-probe-send`, `mailbox-rescan`, `mailbox-seed`, `testmail`, `testmail-target`) may print `error.message`: the operator needs the server's reply to fix a login (ADR 0024 context, discovery notes §4). Telegram errors never print `error.message` (it can hold the bot token, `docs/code-patterns.md` § Style).
- **D5 Event codes for converted lines.** snake_case, at most 64 characters, `<thing>_<what happened>` (`sync_failed`, `outbox_sent`, `committer_auth_error`). The ids and numbers of the old text become fields; the words become the code. A line that names a config state at start becomes `<thing>_<state>` with `config_key` and `scope` (`send_scope_self`). One code for one kind of line; two old lines with the same meaning share a code. Each stage file has the table of its calls with the code and the fields. A call that is not in the table (added by another ticket after this plan) gets a code by these rules; the worker lists it in the final message (D16).
- **D6 Per-item ids by a child logger.** A function that handles one mailbox, action, email or outbox row makes one child at its start: `const mailboxLog = log.with({ org_id: ctx.orgId, mailbox_id: mailboxId })`, and logs through it. `org_id` only when the function has it in scope; never a new DB read for a log line. Name a child `<thing>Log` (the lint finds it by that name, F089 D18).
- **D7 Errors in converted lines.** `...errorFields(error)` (`platform/errors.ts`). Telegram errors: `...telegramErrorFields(error)` (new in stage 05, `modules/channels/telegram/errors.ts`): `{ error: "GrammyError", error_code: <number>, method: <api method> }` for a `GrammyError`, `{ error: "HttpError", method }` for an `HttpError`, else `errorFields(error)`. Never `error.message`, a description, a payload.
- **D8 Lint per converted folder.** Each conversion stage adds its folders to the `error` block of `eslint.config.js` (the block of F089 that holds `platform/**` and `main.ts`), so a parallel ticket cannot add an old-form line there again. Stage 11 replaces the `warn` block and the `error` block by one `error` block for `apps/server/src/**/*.ts` (tests ignored as today) and adds one selector: a log call whose fields object has a property whose value reads `.message` (`${logCall} > ObjectExpression > Property > MemberExpression.value[property.name="message"]`).
- **D9 Remove the old form (stage 11).** After the last conversion, `Log` keeps only the event signature per level; the `@deprecated` overloads and the `legacy_text` path of the writer go. `describeError` stays (CLI output). The writer still checks the event code at run time (a call through a variable or an `any` reaches it): a call that is not in the event form writes `{ event: "log_call_invalid", msg: "log_call_invalid" }` plus the context, never its arguments, and counts one drop.
- **D10 A context per Telegram update (stage 06; F089 D26).** The first middleware of the bot (`modules/channels/telegram/bot.ts`) runs `next()` inside `withLogContext({ job: "telegram.update", run_id: randomUUID() }, next)`. `bot.catch` runs outside that context (the error leaves the middleware chain), so its line carries `update_id` (number field). The long-lived polling loop stays outside any context (F089 D15).
- **D11 Canary test (stage 12, ADR 0024 point 3).** One integration test file in JSON format: a mail with planted strings goes through sync (fake provider), triage (fixed LLM client with a planted reason and summary), the committer (fake provider), a send (fake SMTP sender), the notifier and a digest (fake Telegram API), a web request, and injected errors with planted text (IMAP `failOn`, an SMTP error, a Telegram error with a planted description, an LLM error body). It captures every console line and fails when a line holds a planted string, is not JSON, has a key outside the base keys and `logFieldNames`, has `event` `log_call_invalid`, or has `dropped_fields`. A shared helper `apps/server/test/log-capture.ts` holds the capture and the check; the five marker tests of today (`triage-logs`, `actions-logs`, `actions-send-logs`, `telegram-logs`, `web-auth-logs`) move to it.
- **D12 Log drivers (stage 13; changes ADR 0024 point 4).** Only the `server` service logs with `json-file` (max-size 10m, max-file 5): the collector reads only those files. Every other service (`db`, `greenmail`, the new `cli`, `victorialogs`, `vlagent`) logs with the `local` driver (max-size 10m, max-file 5, compressed by default). Docker writes `json-file` to `<containers>/<id>/<id>-json.log` and `local` to `<containers>/<id>/local-logs/container.log` (V6), so the glob `*/*-json.log` sees only `server`. Reason: Postgres error lines can hold row values (`DETAIL: Key (…)=(…)`), and CLI output holds what the operator asked for; neither may enter the store. `docker logs` works with both drivers. Rejected: one driver for all and a filter in the collector (vlagent has no filter by container, V5); Vector with the Docker socket (a socket proxy can read container env, which holds secrets). Default, owner to confirm (Q3).
- **D13 The `cli` service (stage 13).** `deploy/compose.yaml` gets `cli: { extends: { service: server }, profiles: [cli], logging: <local>, restart: "no", healthcheck: { disable: true }, environment: { LOG_FORMAT: text } }`. Every one-off command in `deploy/README.md` changes from `$C run [--build] [--rm] [-T] server …` to `$C run … cli …`; `$C exec server …` lines stay (exec output never reaches the container log). `bash deploy/check-logging.sh` also fails when a file in `deploy/` or `docs/` (without `docs/product/`) holds `run` followed by options and then ` server ` (pattern in the stage file). `compose run` publishes no ports without `--service-ports`, so the inherited ports do no harm (no `!reset`, which needs Compose 2.24.4+).
- **D14 The store (stage 14).** Profile `ops` in `deploy/compose.yaml`: `victorialogs` (`victoriametrics/victoria-logs:v1.54.0`, flags `-storageDataPath=/vlogs -retentionPeriod=30d -retention.maxDiskSpaceUsageBytes=1GiB -httpListenAddr=:9428`, volume `vlogs-data:/vlogs`, `mem_limit: 256m`, port `127.0.0.1:9428:9428`, healthcheck `["CMD", "/victoria-logs-prod", "-healthcheck", "-httpListenAddr=:9428"]`) and `vlagent` (`victoriametrics/vlagent:v1.54.0`, flags `-remoteWrite.url=http://victorialogs:9428/internal/insert -tmpDataPath=/vlagent -fileCollector.glob=/var/lib/docker/containers/*/*-json.log -fileCollector.ignoreFields=hostname -httpListenAddr=:9429`, mounts `/var/lib/docker/containers:/var/lib/docker/containers:ro` and volume `vlagent-data:/vlagent`, `mem_limit: 64m`, no published port, `depends_on: victorialogs healthy`). `-retentionPeriod` needs the `d` suffix: without it the number is months (V3). The store keeps the server line as a string in `_msg`; a query unpacks it: `"<run_id>" | unpack_json from _msg | sort by (_time)` (V2). Rejected: parse at ingest (vlagent has no option for an inner JSON string).
- **D15 Tailnet access (stage 15).** `tailscale serve --bg --https=9443 http://127.0.0.1:9428` on the VPS; the UI is `https://<vps host>.<tailnet>.ts.net:9443/select/vmui/`. No basic auth: the tailnet holds only the owner's devices (ADR 0017), like the operator console. Default, owner to confirm (Q4).
- **D16 Conversion scope is the code at build time.** A conversion stage converts every old-form call in its folders at its base commit, also lines that other tickets added after this plan. The lint lists them. The tables hold the calls of 2026-11-14 (commit `0a5c2ee`); line numbers drift, so match by text.
- **D17 `docs/known-alerts.md`.** Each conversion stage changes the heading or the quoted line of each entry that quotes a converted line to the event code (ADR 0024 point 7), in the same commit. `grep -n "<old text start>" docs/known-alerts.md` finds them.
- **D18 Docs.** Stage 11: `docs/code-patterns.md` § Logs and § Style (kinds, CLI output, lint everywhere), `.agents/limen/styleguide.md`, `docs/architecture.md` (the "Logs:" security line), ADR 0024 "Progress" and "Status: accepted" (E8a is its acceptance trigger), new `docs/capabilities/logs.md` with its index row. Stage 13: ADR 0024 point 4 (D12), `deploy/README.md`. Stage 14: the store part of `docs/capabilities/logs.md`, `deploy/README.md` § Logs, `deploy/logs.sh`.
- **D19 Seams with other tickets.** (a) After stage 01, a new field name goes to its kind list, not to a flat list (F099 stage 04 adds three numbers, F100 stage 07 `minutes`). (b) After stage 04, a new script prints through `createCliOutput` (F097 `scripts/sim*.ts`, F100 `scripts/stats-week.ts`). (c) After stage 13, a new one-off command in `deploy/README.md` uses `$C run --rm cli …` (F095, F099, F100 edit that file). (d) Conversion stages and the stages of F098 (channels, Telegram), F099 (`actions/send.ts`, `channels/operator.ts`, `composition.ts`, `web.ts`), F100 (`mail/sync.ts`, `mail/jobs.ts`, `channels/commands.ts`, `callbacks.ts`) and F097 (`triage/eval.ts`) edit the same files: the overlaps are advisory (`spec/build.md` NEXT); a land conflict → resume the worker to merge `master` and prove again. The coordinator adds the sentences of § "How to run" step 8 to those spawn prompts.
- **D20 VPS rollout (stage 15).** The coordinator does it (pre-approved): backup first, the rollback target is the commit the VPS runs before the deploy, verify after. The first deploy with the new drivers recreates `db` (a short DB restart, like F096).
- **D21 No web page keys.** F103 adds no panel page or text. If a stage ever adds a web key, it adds it to `apps/web/src/i18n/en.ts` and, once F098 has landed, to `pl.ts`.
- **D22 Stage count.** §2.1 row 9 estimated ≈ 8 stages. This plan has 15: 211 script calls and 184 module calls convert in jobs of at most about 300 changed lines (F089 stage 05 converted 25 calls in about 280 lines), and the store has a VPS stage.
- **D23 Two `cli` usages in tests.** CLI integration tests spawn scripts and match `[name] text` (18 files). The printed text of each converted line stays byte for byte, so these tests do not change. A stage that must change a printed text says so in its table.
- **D24 E6 event names.** `E06-discovery-notes.md` § 5 lists log events with dots (`reply.drafted`); the event code rule has no dots (`reply_drafted`). Reported to the coordinator; not in this ticket.

A gap or a deviation that a worker finds is a question in its final message, not a choice. The coordinator decides from this "Input" or asks the owner.

## Differences found at collect (2026-11-14, commit `0a5c2ee`)

- Old-form calls (L1, `eslint apps/server/src -f json`, tests ignored by the config): **395** in 71 files. Scripts 211; channels 53 (`sender.ts` 15, `telegram/bot.ts` 11, `operator.ts` 9, `telegram/polling.ts` 6, `digest-job.ts` 3, `notices/index.ts` 2, `notices/run.ts` 2, `commands.ts` 2, `routes.ts` 2, `callbacks.ts` 1); actions 40; mail 29; triage 27; roots 20 (`web.ts` 10, `composition.ts` 6, `retention.ts` 4); testmail 6; delegation 5; tenancy 4. The discovery count (426) included `platform/` and `main.ts`, which F089 converted.
- 17 calls print `error.message`: `mail/jobs.ts` 1 (two calls by the `instanceof` form at lines 54 and 78; the grep counts one line), 16 in scripts (D4).
- `modules/channels/operator.ts:62` writes the notice text into the log when no operator chat is set. The event form drops the text (`operator_notice_unsent { kind }`); the audit row keeps the notice.
- `web.ts:357` prints the base URL; `polling.ts:67` prints the bot user name with `@`. Both values fail the code rule; the events carry `port` and `bot_id`.
- `deploy/README.md` has 29 one-off lines `$C run … server …`; a cron line at `deploy/README.md:470` runs `mailbox:seed` that way (D13).

## Facts checked (2026-11-14)

Probes ran in `.probe-f103/` in this worktree and `/tmp/f103-*` (binaries downloaded from the GitHub release `v1.54.0` of VictoriaMetrics/VictoriaLogs, SHA-256 checked against the release checksums); deleted before the commit.

- **V1 vlagent reads the Docker envelope.** A file `containers/abc/abc-json.log` with Docker `json-file` lines (`{"log": "<server JSON>\n", "stream", "time"}`) read by `vlagent-prod -fileCollector.glob=…/containers/*/*-json.log -remoteWrite.url=http://127.0.0.1:19428/internal/insert`: each line arrived with `_msg` = the inner text, `_time` = the Docker `time`, `stream`, `file`, `hostname`. The inner JSON stays a string.
- **V2 Search by run id.** `query=* | unpack_json from _msg | filter run_id:="r-1"` gave the two lines of the run with their fields; `"r-1" | unpack_json from _msg | stats by (event) count()` counted per event; `run_id:="r-1"` without `unpack_json` gave nothing. `GET /select/vmui/` returned 200.
- **V3 Flags.** `victoria-logs-prod -help` (v1.54.0): `-retentionPeriod` "If suffix isn't set, then the duration is counted in months (default 7d)"; `-retention.maxDiskSpaceUsageBytes` takes `1GiB`; both binaries have `-healthcheck` ("useful for Docker HEALTHCHECK in images without curl or wget").
- **V4 Restart and rotation.** After a restart of both binaries, vlagent continued from its checkpoint (no line twice); after `mv x-json.log x-json.log.1` and a new `x-json.log`, the new line arrived once. Resident memory at rest: vlagent 22 MB, VictoriaLogs 26 MB.
- **V5 vlagent has no filter by container or content.** Its flags (`-help`) select files only by `-fileCollector.glob` and `-fileCollector.excludeGlob`; `-fileCollector.ignoreFields` drops fields, not lines. Docker names the folder by container id, so a glob cannot pick a service.
- **V6 Docker log paths.** moby `v28.5.2` `container/container.go:452–473`: `json-file` writes `<root>/<id>-json.log`; `local` writes `<root>/local-logs/container.log`. `daemon/logger/local/local.go`: `local` defaults 20 MB × 5, compressed; accepts `max-size`, `max-file`, `compress`.
- **V7 Images.** Docker Hub `victoriametrics/victoria-logs:v1.54.0` and `victoriametrics/vlagent:v1.54.0` (2026-11-13), linux/amd64 config: entrypoint `/victoria-logs-prod` and `/vlagent-prod`, user `0`, exposed ports 9428 and 9429.
- **V8 Compose.** Compose 5.6.1 (this machine) accepts `extends: { service: server }` with `profiles`, `logging`, `restart`, `healthcheck: { disable: true }` overrides in the same file; `docker compose … config` needs no Docker daemon (it ran without socket access). `deploy/check-logging.sh` passes at `0a5c2ee` (`logging ok: db greenmail server`).
- Code: `fake.failOn(method, error)` exists in `modules/mail/fake/` (throws once). `createFixedLlmClient` in `platform/llm/testing`. The five marker tests spy on `console.log` and `console.error`. Better Auth user ids are UUIDs (`platform/auth.ts:375`, `generateId: "uuid"`). The incoming `x-request-id` is reused only as a lower-cased UUID (F089 D17), and `runJobTick` uses `randomUUID()`, so the context ids pass the UUID kind.
- F089 facts that this plan reuses: `AsyncLocalStorage` survives `await` in Bun 1.4.4 and CI (F089 P1, stage 03 test in CI), lint warnings do not fail `bun run lint` (F089 P4), flat config replaces the options of `no-restricted-syntax` per block (F089 D18).

## Not verified

- vlagent in its container reads `/var/lib/docker/containers/*/*-json.log` through the read-only mount on the VPS (V7: it runs as root; V1 ran on plain files). Stage 15 checks it with a search.
- The Compose version on the VPS accepts `extends` with these overrides. Stage 15 runs `docker compose version` and `config --profile '*'` before `up`.
- `tailscale serve` on the VPS without `sudo`. Stage 15 tries; if it asks for a password, owner step U1.
- Memory on the VPS under the limits. Stage 15 reads `docker stats --no-stream`.
- `AsyncLocalStorage` through the grammY middleware chain. Stage 06 test 3 proves it.

## Done when

1. `bun run lint` shows no `no-restricted-syntax` message in `apps/server/src`, and an old-form call in any server file is an `error`. Shown by: stage 11 `lint.log` and `apps/server/src/platform/log-lint.test.ts`.
2. A UUID field with a non-UUID, a number field with a string, and a code field with a space are dropped and counted; `log.info("x", { count: "a" })` does not compile. Shown by: `platform/log.test.ts` (stage 01) and the `@ts-expect-error` line of stage 11.
3. No script imports `createLog`; CLI output keeps its text. Shown by: `grep -rln createLog apps/server/src/scripts` prints nothing (stage 04); the 18 CLI integration tests pass.
4. Every line of one Telegram update carries `job=telegram.update` and its `run_id`. Shown by: stage 06 test.
5. The canary test passes. Shown by: `apps/server/test/integration/log-canary.test.ts` (stage 12).
6. `bash deploy/check-logging.sh` passes: `server` `json-file` 10m × 5, every other service `local` 10m × 5, no one-off `run … server` line in `deploy/` or `docs/`; it fails on each fault. Shown by: `deploy/check-logging.test.ts` (stage 13).
7. `docker compose -f deploy/compose.yaml --profile ops config` holds the two store services with the flags of D14. Shown by: stage 14 test.
8. On the VPS: a search for one `run_id` shows every line of that run; a `$C run --rm cli …` line is not in the store; `docker stats` stays under the limits. Shown by: stage 15 record in `docs/known-alerts.md` and the coordinator's final message.
9. `docs/code-patterns.md`, the styleguide, ADR 0024 (accepted), `docs/capabilities/logs.md` and `docs/known-alerts.md` state the rules. Shown by: stage 11, 13, 14 diffs.

## Rules for every stage

- Read `CLAUDE.md`, `.agents/limen/styleguide.md`, `docs/code-patterns.md` § Logs, the ticket, this file and your stage file first. Build only your stage.
- Format only the files of your stage: `bunx prettier --write <files>`. Never `bun run format` or `prettier --write .` (S2 incident: a builder ran the repo-wide formatter).
- A new or converted log line: `log.<level>("<event_code>", { <fields> })` (D5). Ids through a child logger (D6). Errors only through `...errorFields(error)` or `...telegramErrorFields(error)` (D7). Never `error.message`, mail text, an address, a URL, a token, a folder path or a list of ids in a field. A code value from a closed set only (D2).
- Keep the level of each converted line (`info` stays `info`). Keep the stream (the writer picks it by level).
- The printed text of a CLI line stays byte for byte (D23), unless the stage table says otherwise.
- A test that matches an old log text changes to the event text in the same commit. Before the commit: `grep -rn "<old text start>" apps/server/test apps/server/src --include=*.test.ts` for each converted line.
- The repo is public: no real name, address or user id in a file. Test addresses end in `@x.test`.
- No temporary files inside the worktree (`bun run lint` lints every `.ts` file). Use `/tmp/f103-sNN/`.
- A test with a time uses a fixed `now` (`2026-11-20T10:00:00Z` unless the stage says another). A test that changes the log level or format restores `setLogLevel("info")` and `setLogFormat("text")` in `afterEach`. A spy on `console` is restored in `finally` or `afterEach`.
- All test files of one `bun test` call share one process: read the drop counter as a difference.
- A stage that changes a type fixes every caller and test in the same stage.
- No migration, no `bun.lock` change, no new dependency. Commit by explicit path (`git add <paths>`), never `git add -A`.
- Do not edit `spec/build.md`, `docs/product/stage-2/*` or another ticket.
- A gap or a deviation is a question in your final message, not a choice. List every new field name and every call that was not in your table.

## Proof

Run after the last commit, as one bash call with nothing after it; read the logs in a separate call. In the final message, list as proven only what a saved log shows. `test:int:ci` needs no lock (own DB per job). No stage runs `test:e2e`.

Stages 01–12 (NN = the stage number):

```
mkdir -p /tmp/f103-sNN && bun run lint > /tmp/f103-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f103-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f103-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f103-sNN/int.log 2>&1 && echo PROOF_OK
```

Stages 13 and 14 (deploy files, docs and one unit test):

```
mkdir -p /tmp/f103-sNN && bash deploy/check-logging.sh > /tmp/f103-sNN/check-logging.log 2>&1 && bun run lint > /tmp/f103-sNN/lint.log 2>&1 && bun run test:unit:ci > /tmp/f103-sNN/unit.log 2>&1 && echo PROOF_OK
```

Stage 15 is the VPS rollout; its proof is the check list in its stage file.

The `no-restricted-syntax` warning count in `lint.log` falls with each conversion stage (395 at `0a5c2ee`; other tickets may add or remove some). Each worker writes the count of its `lint.log` in the final message.

## User checkpoints

- None (P4).

## User steps

| #   | Step                                                                                                                                     | When                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| U1  | Only if `tailscale serve` on the VPS asks for a password: run `sudo tailscale serve --bg --https=9443 http://127.0.0.1:9428` on the VPS. | stage 15, only when the coordinator asks |

## Review

- A review job before the land for stages 01 `[risky]` (the value kinds are the privacy guard), 02 (the CLI border), 05 and 06 (Telegram errors can hold the token), 08 (IMAP errors hold addresses), 12 `[risky]` (the canary), 13 (the driver split keeps CLI and DB lines out of the store) and 14 (the store config). Model: the board's reviewer (`spec/build.md` § TRACK: `claude-sonnet-5-5`, high). Other stages land on the worker's proof.
- Review spawn (after the worker job is done; `<B>` = the job's branch):

```
limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
  --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
  --review --detached --branch <B> --label "review s<NN> · F103" \
  "Review F103 stage NN on <B> against spec/features/active/F103-e8a-logs/plan.md and stages/stage-NN-<slug>.md. Check that every numbered test exists and asserts what the stage says, and every decision the stage cites. Try to get a mail address, a free text, a URL, a token or an error message into a log line, or a CLI or DB line into the log store, through the changed code. Quote file and line for each finding."
```

## Stages

| #   | Stage                                                                                                          | Size       | Mark                      |
| --- | -------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------- |
| 01  | [Field kinds](stages/stage-01-field-kinds.md) — UUID, number, code lists; writer check; types                   | ~250 lines | `[risky]` private data, review |
| 02  | [CLI output](stages/stage-02-cli-output.md) — `platform/cli.ts`, import border, 11 scripts (60 calls)          | ~260 lines | review                    |
| 03  | [CLI mailbox scripts](stages/stage-03-cli-mailbox-scripts.md) — 10 `mailbox-*` scripts (70 calls)              | ~220 lines |                           |
| 04  | [CLI other scripts](stages/stage-04-cli-other-scripts.md) — 17 scripts (81 calls), scripts at lint error       | ~260 lines |                           |
| 05  | [Convert channels](stages/stage-05-convert-channels.md) — sender, operator, notices, digest (36 calls)        | ~280 lines | review                    |
| 06  | [Convert Telegram](stages/stage-06-convert-telegram.md) — bot, polling (17 calls), context per update          | ~230 lines | review                    |
| 07  | [Convert actions](stages/stage-07-convert-actions.md) — committer, apply, send, drafts, expiry (40 calls)      | ~300 lines |                           |
| 08  | [Convert mail](stages/stage-08-convert-mail.md) — sync, jobs, IMAP client, routes (29 calls)                   | ~280 lines | review                    |
| 09  | [Convert triage, delegation, tenancy](stages/stage-09-convert-triage-delegation-tenancy.md) (36 calls)         | ~280 lines |                           |
| 10  | [Convert roots and testmail](stages/stage-10-convert-roots-testmail.md) — `web.ts`, `composition.ts`, `retention.ts`, testmail (26 calls) | ~220 lines |   |
| 11  | [Lint error everywhere](stages/stage-11-lint-error-everywhere.md) — one error block, old form removed, docs    | ~250 lines |                           |
| 12  | [Canary](stages/stage-12-canary.md) — the pipeline test and the shared capture helper                          | ~300 lines | `[risky]` private data, review |
| 13  | [Log drivers and `cli` service](stages/stage-13-log-drivers-and-cli-service.md) — compose, check, README lines | ~220 lines | review                    |
| 14  | [Log store](stages/stage-14-log-store.md) — profile `ops`, `deploy/logs.sh`, docs                              | ~220 lines | review                    |
| 15  | [VPS rollout](stages/stage-15-vps-rollout.md) — coordinator: deploy, Serve, search check                       | no code    | VPS                       |

Order: 01 → 02 → 03 → 04; 05 → 06; 07; 08; 09; 10; then 11 → 12. Stages 05–10 need 01 and may run in any order, at most two at once (both edit `log-fields.ts`, `eslint.config.js` and `docs/known-alerts.md`: a land conflict is a merge, D19). Stage 11 needs 01–10 landed. Stages 13 and 14 need only 01 landed (13 before 14) and may run next to any stage. Stage 15 needs 12 and 14 landed.

## How to run (coordinator)

1. Before the first spawn: F095 is in `spec/features/done/` (ticket § Sequenced). Move the ticket: `git mv spec/features/planned/F103-e8a-logs spec/features/active/`, commit.
2. Spawn one stage (NN two digits, `<slug>` from the stage list):

   ```
   limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
     --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
     --prepare 'bash scripts/limen-prepare.sh' --label "F103-sNN <slug> · F103" \
     "Implement F103 stage NN. Read spec/features/active/F103-e8a-logs/ticket.md, plan.md and stages/stage-NN-<slug>.md; build every step of that stage. Final proof: the Proof command of plan.md for your stage (/tmp/f103-sNN), one bash call with nothing after it, run after the last commit; read the logs in a separate call. In the final message, list as proven only what a saved log shows."
   ```

3. When the job finishes: read its final message and `/tmp/f103-sNN/*.log`. For the stages of § Review, spawn the review job and read its verdict; a finding → `limen continue <job-id> "<fix>"`, then review again (at most 2 rounds, then the owner decides).
4. Land: `limen land <job-id> --yes --keep-open` (stage 15 closes the ticket: `limen ticket done` after its checks). Drop the job DB: `bun run db:worktree <YYYY-MM-DD>-<hash> --drop`.
5. Parallel rules: § Stages "Order". A land conflict between two conversion stages: `limen continue <job-id> "merge master, resolve, prove again"`.
6. After each conversion land (02–10), check that the warning count in `lint.log` fell; after stage 11 lands, the count is 0: remove the backlog sentence from `spec/build.md` § TRACK.
7. After stage 11 lands, check the CI run of `master` (`gh run list --branch master --workflow CI --limit 3`).
8. Spawn-prompt sentences for other tickets (D19); add the one that applies to each spawn of another ticket's stage that starts after the F103 stage named:
   - after stage 01: "F103 split apps/server/src/platform/log-fields.ts into uuidFieldNames, numberFieldNames and codeFieldNames: add each new field name to the list of its kind (a count or a time → numberFieldNames)." (F099 stage 04, F100 stages 06 and 07, any stage that adds a field.)
   - after stage 04: "F103: scripts in apps/server/src/scripts/ print through createCliOutput (apps/server/src/platform/cli.ts), never createLog; the folder is at lint error for old-form log lines." (F097 `sim*.ts`, F100 `stats-week.ts`.)
   - after each conversion stage: "F103 holds <folders of that stage> at lint error: write log.<level>(\"event_code\", { fields }) (docs/code-patterns.md § Logs)." (F098, F099, F100, F097 stages that edit those folders.)
   - after stage 13: "F103: one-off commands in deploy/README.md use `$C run --rm cli …`, never `run … server`; bash deploy/check-logging.sh fails on the old form." (F095, F099, F100 stages that edit `deploy/README.md`.)
9. Stage 15: the coordinator runs it by its stage file (pre-approved VPS steps). Ask the owner only for U1.
10. Workers often break the one-`&&` proof form. Accept a check when its saved log shows the pass. A check with no proof → `limen continue`.

## Cold review

Not run yet.

## Log

- 2026-11-14: planned by a planning job (Opus 5.5); probes V1–V8 and the lint count L1.
