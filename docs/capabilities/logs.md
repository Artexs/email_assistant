# Logs

> Checked against the code at `3626dbef`, 2026-11-15.

## What it does now

Every server log line is an event: a constant code, such as `sync_folder_done`, and a few fields that hold ids, codes, counts or times. The writer drops any field that is not on its allow-list or whose value has the wrong kind, and counts it in `dropped_fields`. The lint fails on any other form in `apps/server/src`, and the typecheck checks the field names and kinds. The VPS prints one JSON object per line; dev and tests print text. CLI scripts print their readable output to the operator's terminal through their own helper, and that output is not a log line. No mail text, address or server error text reaches a log line.

## Rules

1. **Event form.** `log.<level>("<event_code>", { fields })`. The code matches `^[a-z][a-z0-9_]{0,63}$`; `msg` equals it. `Log` has only this signature. A call of another shape writes one `log_call_invalid` line (context fields only, `dropped_fields: 1`, one drop counted) and never prints its argument.
2. **Field kinds.** `uuidFieldNames` take a lower-case UUID or `null`; `numberFieldNames` take a finite number or `null`; `codeFieldNames` take a number, a boolean, `null` or a code of at most 64 characters from `A–Z a–z 0–9 _ . : / * -` without `://`. A wrong name or kind is dropped and counted.
3. **Errors.** `...errorFields(error)` gives `error` (the error name) and `error_code`. `...telegramErrorFields(error)` adds `method`. A log call never reads `.message`.
4. **Context.** A job tick gives `job` and `run_id`; a Telegram update gives `job: "telegram.update"` and a `run_id`; an HTTP request gives `request_id`. A child logger (`const mailboxLog = log.with({ org_id, mailbox_id })`) adds per-item ids. A call on a chain is checked by the lint like a call on `log`.
5. **Lint.** In `apps/server/src` (tests excepted), `no-restricted-syntax` (`logEventSelectors` in `eslint.config.js`) and `no-console` are at `error`. The selectors fail on a first argument that is not a snake_case literal, no argument, more than two arguments, a second argument that is not an object literal or a call of `errorFields` / `telegramErrorFields`, and a `.message` inside the fields. `platform/log.ts` and `platform/cli.ts` keep a disable comment for `no-console`.
6. **CLI output.** `createCliOutput(name)` gives `print` (stdout) and `fail` (stderr), each as `[name] text`, in text only. Only `apps/server/src/scripts/` imports it (an `import/no-restricted-paths` border). A script may also log a failure as an event line.
7. **Format.** `LOG_FORMAT=json` prints JSON; any other value, or none, prints `[module] event key=value …`. The server config sets JSON by default and the VPS pins it.

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

## Data

None. Lines go to stdout and stderr of the process; Docker keeps them (`deploy/compose.yaml`). The `dropped_fields` counter lives in process memory (`droppedLogFields`).

## Limits

- The log store, the Docker log drivers, the `cli` Compose service and the canary test come with F103 stages 14–19. Today `docker compose logs` is the only reader.
- A library that prints to the console, and a crash print of the runtime, bypass the event writer until the guards of F103 stage 14 land.
- The value rule does not stop a secret that looks like a code. Never log a token, a password or a key.
- Alerts on log lines: E8b (F114).

## Decisions

- ADR 0024 (structured logs with an allow-list).

## Tests

- `apps/server/src/platform/log.test.ts`
- `apps/server/src/platform/log-lint.test.ts`
- `apps/server/src/platform/cli.test.ts`
- `apps/server/test/integration/log-context.test.ts`
- `apps/server/test/integration/telegram-logs.test.ts`
