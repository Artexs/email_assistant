# Logs

> Checked against the code at `3626dbef`, 2026-11-15.

## What it does now

Every server log line is an event: a constant code, such as `sync_folder_done`, and a few fields that hold ids, codes, counts or times. The writer drops any field that is not on its allow-list or whose value has the wrong kind, and counts it in `dropped_fields`. The lint fails on any other form in `apps/server/src`, and the typecheck checks the field names and kinds. The VPS prints one JSON object per line; dev and tests print text. CLI scripts print their readable output to the operator's terminal through their own helper, and that output is not a log line. No mail text, address or server error text reaches a log line.

**Log store.** The Compose profile `ops` (`deploy/compose.yaml`) adds `victorialogs` (VictoriaLogs) and `vlagent`. Start it with `$C --profile ops up -d`; without the profile nothing changes. `vlagent` reads the `json-file` logs of the containers (only `server` writes them) and sends them to VictoriaLogs, which keeps 30 days and at most 1 GiB. The port 9428 is on `127.0.0.1` only; Tailscale Serve proxies the UI (`/select/vmui/`) on the tailnet (F103 stage 19). A line is stored as text in `_msg`: a query starts with `unpack_json from _msg`. `deploy/logs.sh` is the baseline without the store: it prints the `server` log as text, filtered by `--run`, `--request`, `--event` or `--level`.

## Rules

1. **Event form.** `log.<level>("<event_code>", { fields })`. The code matches `^[a-z][a-z0-9_]{0,63}$`; `msg` equals it. `Log` has only this signature. A call of another shape writes one `log_call_invalid` line (context fields only, `dropped_fields: 1`, one drop counted) and never prints its argument.
2. **Field kinds.** `uuidFieldNames` take a lower-case UUID or `null`; `numberFieldNames` take a finite number or `null`; `codeFieldNames` take a number, a boolean, `null` or a code of at most 64 characters from `A–Z a–z 0–9 _ . : / * -` without `://`. A wrong name or kind is dropped and counted.
3. **Errors.** `...errorFields(error)` gives `error` (the error name) and `error_code`. `...telegramErrorFields(error)` adds `method`. A log call never reads `.message`.
4. **Context.** A job tick gives `job` and `run_id`; a Telegram update gives `job: "telegram.update"` and a `run_id`; an HTTP request gives `request_id`. A child logger (`const mailboxLog = log.with({ org_id, mailbox_id })`) adds per-item ids. A call on a chain, and a call on a member logger (`this.log.info`, `deps.mailboxLog.info`), is checked by the lint like a call on `log`.
5. **Lint.** In `apps/server/src` (tests excepted), `no-restricted-syntax` (`logEventSelectors` in `eslint.config.js`) and `no-console` are at `error`. The selectors fail on a first argument that is not a snake_case literal, no argument, more than two arguments, a second argument that is not an object literal or a call of `errorFields` / `telegramErrorFields`, and a `.message` inside the fields. `platform/log.ts` and `platform/cli.ts` keep a disable comment for `no-console`.
6. **CLI output.** `createCliOutput(name)` gives `print` (stdout) and `fail` (stderr), each as `[name] text`, in text only. Only `apps/server/src/scripts/` imports it (an `import/no-restricted-paths` border). A script may also log a failure as an event line.
7. **Format.** `LOG_FORMAT=json` prints JSON; any other value, or none, prints `[module] event key=value …`. The server config sets JSON by default and the VPS pins it.
8. **Guards (JSON format, `main.ts`).** `installConsoleGuard()` (`platform/log.ts`) replaces `console.log`, `info`, `debug`, `warn`, `error` and `trace` with a function that writes one `console_output` line (level `warn`, context fields, `dropped_fields: 1`) and never reads its arguments; the writer prints through the saved console. A second install while one is on throws. `installProcessGuard(log)` (`platform/process-guard.ts`) turns an uncaught exception into `process_uncaught_exception` and an unhandled rejection into `process_unhandled_rejection` (field `error`, `error_code` from `errorFields`), then exits 1 as Bun does. Text format (dev) and scripts keep the normal console.

## Entry points

| Kind     | Name                                                                  | Where                                                 |
| -------- | --------------------------------------------------------------------- | ----------------------------------------------------- |
| function | `createLog(module)` (`debug`, `info`, `warn`, `error`, `with`)        | `apps/server/src/platform/log.ts`                     |
| function | `withLogContext({ job, run_id, request_id }, fn)`                     | `apps/server/src/platform/log.ts`                     |
| function | `setLogLevel`, `setLogFormat`, `logFormatFromEnv`, `droppedLogFields` | `apps/server/src/platform/log.ts`                     |
| function | the kind lists and `LogFields` type                                   | `apps/server/src/platform/log-fields.ts`              |
| function | `createCliOutput(name)`                                               | `apps/server/src/platform/cli.ts`                     |
| function | `errorFields(error)`                                                  | `apps/server/src/platform/errors.ts`                  |
| function | `telegramErrorFields(error)`                                          | `apps/server/src/modules/channels/telegram/errors.ts` |
| CLI      | `bun run lint` (the log selectors and `no-console`)                   | `eslint.config.js`                                    |
| CLI      | `bash deploy/logs.sh [--run] [--request] [--event] [--level]`         | `deploy/logs.sh`                                      |
| UI       | `vmui` (VictoriaLogs query UI)                                        | `/select/vmui/` on the tailnet (profile `ops`)        |

## Data

The log store keeps its lines in the volume `vlogs-data` (its agent keeps its read position in `vlagent-data`). The process itself writes only to stdout and stderr; Docker keeps them (`deploy/compose.yaml`). Nothing else is stored. The `dropped_fields` counter lives in process memory (`droppedLogFields`).

## Limits

- The store holds only `server` lines (the Docker log drivers: `server` on `json-file`, every other service on `local`). Lines of Postgres, `cli` and `exec` are never stored.
- `vlagent` reads every `json-file` log of the host. It also reads the logs of another Compose project that uses `json-file`.
- `vlagent` buffers at most 500 MB on disk (`-remoteWrite.maxDiskUsagePerURL=500MB`, volume `vlagent-data`) while the store is down.
- The read-only mount of `/var/lib/docker/containers` also lets the `vlagent` container read the `config.v2.json` of each container (its environment and secrets). `vlagent` ships only the `*-json.log` files. For this reason the agent does not use the Docker socket, and it runs only under the profile `ops`.
- The UI has no basic auth: the tailnet is the only guard (ADR 0017). The VPS setup of Tailscale Serve is F103 stage 19.
- Alerts read no store: E8b (F114) decides whether they will.
- The canary test (`apps/server/test/integration/log-canary.test.ts`) plants a fake sender, subject, body, summary, reason, task, IMAP, SMTP, Telegram and LLM error text through sync, triage, committer, send, notices, digest, the console guard and two web requests. It asserts that no captured line holds a planted value (the `console_output` lines of the guard carry `dropped_fields` by design and are checked for planted values only). It covers the paths that the test runs: a new log path needs its own step. Matching is case-insensitive and covers the base64, base64url and hex forms of each planted value; other encodings are not checked. A string `error.code` that looks like a code (for example `CANARY-CODE-1`) passes the value rule as `error_code`; the canary plants such a code but no driven error carries it.
- Bun's own output before `main.ts` runs (a syntax or an import error at start) prints as today. A library that prints in text format (dev) is not guarded.
- The lint rules read the code shape only. They do not catch a logger under another name (an alias, a destructured method, `log['info']`, a logger variable without the `Log` suffix), `.message` reached through a variable, or `console` through an alias or `globalThis`. A review catches these; the runtime turns a free-text event into `log_call_invalid`.
- The value rule does not stop a secret that looks like a code. Never log a token, a password or a key.

## Decisions

- ADR 0024 (structured logs with an allow-list).

## Tests

- `apps/server/src/platform/log.test.ts`
- `apps/server/src/platform/log-lint.test.ts`
- `apps/server/src/platform/cli.test.ts`
- `apps/server/test/integration/log-context.test.ts`
- `apps/server/test/integration/telegram-logs.test.ts`
- `apps/server/src/deploy-logging.test.ts` (Compose drivers, profile `ops`)
- `apps/server/src/deploy-logs.test.ts` (`deploy/logs.sh`)
