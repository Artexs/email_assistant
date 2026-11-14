# F103 · E8a Logs: facts and records

Record file of [plan.md](plan.md). Workers read it only when a stage cites a probe (V1–V13) or a "Not verified" item. It holds the owner words, the probes of the planning job, the differences found at collect, and the cold review 1 record. Moved here from `plan.md` at refresh 1 (2026-11-14) to keep `plan.md` under the size rule of `.agents/limen/planner.md`; the text is unchanged except where `plan-refresh-1.md` names a change.

## Owner words and decisions, word for word

From `docs/product/stage-2/epics/E08-operations.md` § Discovery, "Decisions (owner: "I will just use your defaults", 2026-11-13)":

> 2. Log store: VictoriaLogs + vlagent in a Compose profile `ops` (a clean install works without it), tailnet only via `tailscale serve` on its own port, 30 days capped at 1 GB, `mem_limit` 256 MB + 64 MB. Fallback collector: Vector. `deploy/logs.sh` (`docker compose logs` + `jq`) stays as the zero-part baseline. [VictoriaLogs]

> 6. Log content rule: `msg` and `event` are string literals; variable data only in allow-listed fields (ids, codes, counts, durations); errors only through `describeError()`; a lint rule blocks interpolation; a canary test proves no planted mail string reaches any log line. All 426 calls convert. [yes]

> 12. Two tickets: E8a Logs (logger, context, conversion, store), E8b Alerts and releases (SLO job, release scripts, migration check, drill). [yes]

Epic exit lines for E8a: "`docker compose logs` is JSON; a search for one `run_id` in the log store shows the whole run; a test proves no mail field passes the redaction." Owner idea: "easy access to logs from application".

From the coordinator task (2026-11-14): "the lint backlog is 395 old-form calls"; "New log lines use the event form (docs/code-patterns.md Logs)"; "Owner rules: no owner checkpoints for confirmation; an owner step only for what needs the owner's hands (real secrets, real money, a phone); small questions get a default in questions.md."

From `spec/build.md` NEXT (owner decision 2026-11-13): "VPS, ssh and deploy steps are pre-approved; the coordinator does them (backup first, name the rollback target, verify after). Stop for the owner only when a step needs an API key or secret the coordinator cannot get itself."

## Differences found at collect (2026-11-14, commit `0a5c2ee`)

Historic numbers. The numbers at refresh 1 (`560e74e7`: 416 old-form calls in 75 files, 46 `run … server bun` lines in `deploy/README.md` and 1 in `docs/known-alerts.md`) are in [plan-refresh-1.md](plan-refresh-1.md).

- Old-form calls (L1, `eslint apps/server/src -f json`, tests ignored by the config): **395** in 71 files. Scripts 211; channels 53 (`sender.ts` 15, `telegram/bot.ts` 11, `operator.ts` 9, `telegram/polling.ts` 6, `digest-job.ts` 3, `notices/index.ts` 2, `notices/run.ts` 2, `commands.ts` 2, `routes.ts` 2, `callbacks.ts` 1); actions 40; mail 29; triage 27; roots 20 (`web.ts` 10, `composition.ts` 6, `retention.ts` 4); testmail 6; delegation 5; tenancy 4. The discovery count (426) included `platform/` and `main.ts`, which F089 converted.
- `error.message` reaches 17 grep-matched lines: 16 in scripts (D4) and one in `mail/jobs.ts`. In `mail/jobs.ts` four log calls print a server reply: line 54, lines 77–79, and lines 83 and 85 through the variable `message` (read at line 71). Stage 10 removes all four.
- `modules/channels/operator.ts:62` writes the notice text into the log when no operator chat is set. The event form drops the text (`operator_notice_unsent { kind }`); the audit row keeps the notice.
- `web.ts:357` prints the base URL; `polling.ts:67` prints the bot user name with `@`. Both values fail the code rule; the events carry `port` and `bot_id`.
- `deploy/README.md` has 32 one-off lines `$C run … server …`; a cron line at `deploy/README.md:470` runs `mailbox:seed` that way (D13).

## Facts checked (2026-11-14)

Probes ran in `.probe-f103/` in this worktree and `/tmp/f103-*` (binaries downloaded from the GitHub release `v1.54.0` of VictoriaMetrics/VictoriaLogs, SHA-256 checked against the release checksums); deleted before the commit.

- **V1 vlagent reads the Docker envelope.** A file `containers/abc/abc-json.log` with Docker `json-file` lines (`{"log": "<server JSON>\n", "stream", "time"}`) read by `vlagent-prod -fileCollector.glob=…/containers/*/*-json.log -remoteWrite.url=http://127.0.0.1:19428/internal/insert`: each line arrived with `_msg` = the inner text, `_time` = the Docker `time`, `stream`, `file`, `hostname`. The inner JSON stays a string.
- **V2 Search by run id.** `query=* | unpack_json from _msg | filter run_id:="r-1"` gave the two lines of the run with their fields; `"r-1" | unpack_json from _msg | stats by (event) count()` counted per event; `run_id:="r-1"` without `unpack_json` gave nothing. `GET /select/vmui/` returned 200.
- **V3 Flags.** `victoria-logs-prod -help` (v1.54.0): `-retentionPeriod` "If suffix isn't set, then the duration is counted in months (default 7d)"; `-retention.maxDiskSpaceUsageBytes` takes `1GiB`; both binaries have `-healthcheck` ("useful for Docker HEALTHCHECK in images without curl or wget").
- **V4 Restart and rotation.** After a restart of both binaries, vlagent continued from its checkpoint (no line twice); after `mv x-json.log x-json.log.1` and a new `x-json.log`, the new line arrived once. Resident memory at rest: vlagent 22 MB, VictoriaLogs 26 MB. At its first start vlagent logged "no checkpoints file found … vlagent will read log files from the beginning".
- **V5 vlagent has no filter by container or content.** Its flags (`-help`) select files only by `-fileCollector.glob` and `-fileCollector.excludeGlob`; `-fileCollector.ignoreFields` drops fields, not lines. Docker names the folder by container id, so a glob cannot pick a service.
- **V6 Docker log paths.** moby `v28.5.2` `container/container.go:452–473`: `json-file` writes `<root>/<id>-json.log`; `local` writes `<root>/local-logs/container.log`. `daemon/logger/local/local.go`: `local` defaults 20 MB × 5, compressed; accepts `max-size`, `max-file`, `compress`.
- **V7 Images.** Docker Hub `victoriametrics/victoria-logs:v1.54.0` and `victoriametrics/vlagent:v1.54.0` (2026-11-13), linux/amd64 config: entrypoint `/victoria-logs-prod` and `/vlagent-prod`, user `0`, exposed ports 9428 and 9429.
- **V8 Compose.** Compose 5.6.1 (this machine) accepts `extends: { service: server }` with `profiles`, `logging`, `restart`, `healthcheck: { disable: true }` overrides in the same file; `docker compose … config` needs no Docker daemon (it ran without socket access). `deploy/check-logging.sh` passes at `0a5c2ee` (`logging ok: db greenmail server`).
- **V9 The `.message` selector.** With `typescript-eslint`'s parser and `no-restricted-syntax`, the descendant selector `${logCall} > ObjectExpression MemberExpression[property.name="message"]` flagged `{ reason: e.message }`, `{ reason: (error as Error).message }`, `{ reason: e?.message }`, `{ reason: String(e.message) }` and `{ code: e.message.slice(0, 5) }`, and not `{ reason: e.name }`, `{ ...error }`, `{ count: e.messages }`, `{ message: "x" }` (probe `/tmp/f103-lprobe/`, ESLint of the repo; the direct-child form of the first draft missed the cast, optional and call forms, review 1 m11).
- **V10 Field types.** TypeScript 5.9.3 (`tsc -p` with `strict`) on the `LogFields` type of stage 01: `log.info("x", { count: "a" })` and `log.info("x", { subject: "a" })` are errors (both `@ts-expect-error` lines held); a spread `{ ...{ error: "Error" } }` into a type without `error` is an error only by the weak-type rule (TS2559, no property in common).
- **V11 Compose `config` flags.** Compose 5.6.1 on a probe file with profiles and `extends`: with `--no-env-resolution --no-interpolate`, `config` lists the services of every profile without `--profile` and writes the environment of an extended service as an array; with `--no-env-resolution` alone (and the `${…:?}` variables set to dummy values), profiles hold, the environment is a map, and `mem_limit: 256m` renders as the string `"268435456"` (review 1 M3 found the same).
- **V12 Bun crash behaviour.** Bun 1.4.4 (`.bun-version`): `Promise.reject(new Error("MARK-REJ"))` with no handler and a `throw` in a timer each print the message and a source excerpt to stderr and exit with code 1 (probe `/tmp/f103-lprobe/`).
- **V13 CLI-line pattern.** ``grep -cE '(^|[[:space:]])run[[:space:]]([^`]*[[:space:]])?server[[:space:]]+bun([[:space:]]|$)' deploy/README.md`` gives 32 at `0a5c2ee`; the pattern matches `$C run -e KEY=val server bun run x` and `docker compose run --rm -T server bun run x`, and not `$C run --rm cli bun run x`, `$C exec server bun run x`, `the server runs`.
- grammY 1.46.0 (review 1 M4): `bot.handleUpdate` rethrows a middleware error as `BotError`; only the polling loop (`handleUpdates`) calls `bot.errorHandler`, a public property (`bot.d.ts:132`).
- Code: `fake.failOn(method, error)` exists in `modules/mail/fake/` (throws once). `createFixedLlmClient` in `platform/llm/testing`. The five marker tests spy on `console.log` and `console.error`. Better Auth user ids are UUIDs (`platform/auth.ts:375`, `generateId: "uuid"`). The incoming `x-request-id` is reused only as a lower-cased UUID (F089 D17), and `runJobTick` uses `randomUUID()`, so the context ids pass the UUID kind.
- F089 facts that this plan reuses: `AsyncLocalStorage` survives `await` in Bun 1.4.4 and CI (F089 P1, stage 03 test in CI), lint warnings do not fail `bun run lint` (F089 P4), flat config replaces the options of `no-restricted-syntax` per block (F089 D18).

## Not verified

- vlagent in its container reads `/var/lib/docker/containers/*/*-json.log` through the read-only mount on the VPS (V7: it runs as root; V1 ran on plain files). Stage 19 step 8 checks it with a search.
- The Compose version on the VPS accepts `extends` with these overrides. Stage 19 step 3 runs `docker compose version` and `config --profile '*'` before `up`.
- `tailscale serve` on the VPS without `sudo`. Stage 19 step 7 tries; if it asks for a password, owner step U1.
- Memory on the VPS under the limits. Stage 19 step 10 reads `docker stats --no-stream`.
- `AsyncLocalStorage` through the grammY middleware chain. Stage 06 tests 3 and 4 prove it.
- Which libraries print to the console in production besides `better-call`. Stage 14's guard covers every caller; stage 19 step 9 counts `console_output` events.
- Whether `docker compose run` output under the `local` driver still shows in the terminal. Docker attaches the terminal to the container streams for any driver; stage 19 step 9 sees the `f103-cli-<M>` print.

## Cold review 1 record

Review 1 ([plan-review-1.md](plan-review-1.md), job `2026-11-14-f103-plan-review-c28abb08`, Opus 5.5 high, candidate `9480681`): FAIL, 7 major, 11 minor. All fixed; none rejected. What changed:

- M1 text from outside the logger (a library's `console.error`, Bun's crash print) reaches the store: new D25 and stage 14 (console guard, process guard, `[risky]`, review); stage 13 sets `no-console` to `error`; the canary (stage 16) prints a planted `# SERVER_ERROR:` line; Done when 5.
- M2 the stage 15 CLI check could never fail: stage 19 step 9 plants unique markers after the store is up (`cli` print, `exec` print, a Postgres `ERROR` line) and expects 0 hits; V4 now records that vlagent reads a new file from its start.
- M3 the Compose checks fail as written: V11 (profiles need interpolation; dummy `${…:?}` values; `mem_limit` is a string); stages 17 and 18 use `--no-env-resolution` without `--no-interpolate`.
- M4 stage 06 tests 2–4 relied on lines that do not exist: rewritten with two unlinked updates, the fake handlers of `telegram-router.test.ts`, an API transformer, and `bot.errorHandler` (grammY fact in § Facts).
- M5 D4 against D23: D4 keeps every existing `error.message` print in CLI output and allows new ones only in the mail-connection scripts; stage 02 names `telegram-link.ts:38` and `web-invite.ts:40`.
- M6 no typecheck in the deploy proof: added to the Proof of stages 17–18.
- M7 stages too big: the canary is split (15 helper, 16 pipeline); channels split into 05 (sender, operator) and 07 (rest, with delegation and tenancy); actions split into 08 (committer, expiry) and 09 (apply, drafts, send); triage alone in 11. The plan has 19 stages (D22).
- m1 counts: the stage table holds 13/55, 10/70, 13/86 for the script stages.
- m2 line numbers: D16 states that a table line is the line of `log.` and that the lint reports a multi-line call one line later; the stage tables note the two-line calls.
- m3 codes: `terms_record_failed` (the code of `platform/auth.ts:320`), and `actions_scope` / `send_scope` with `scope`, as `triage_scope` in `main.ts`.
- m4 D17 grep: D17 now asks for one grep per table row in `docs/known-alerts.md` and `deploy/README.md`; each stage lists the known matches the review found.
- m5 README quotes: `deploy/README.md:102` (stage 06), `:394` (stage 12), `:478` (stage 10).
- m6 the DNS codes: stage 10 adds `MailHostLookupError` with the system code, so `error_code` keeps `ENOTFOUND`.
- m7 old `run … server` commands: D19 (c) and How to run step 8 name F099 `stage-15-vps-deploy.md`; stage 19 step 3 fixes the crontab line; step 6 uses `docker ps -a`.
- m8 stage 13 (now 17) dependency: "needs no other stage" in both places.
- m9 `error.message` in `mail/jobs.ts`: four log calls (54, 77–79, 83, 85), § Differences and stage 10.
- m10 the doc check is shown to fail: `CHECK_LOGGING_DOCS` lets the test run the script on a temp file; the pattern catches `run -e KEY=val server bun` (V13).
- m11 the `.message` selector: descendant form, V9 re-run on five forms.
- Note (shared dev runtime): How to run step 9 and stage 17 say that the next `up` of the dev stack recreates `db` and `greenmail`.
