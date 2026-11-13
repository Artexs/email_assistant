# F089 stage 06 — Convert `main.ts`, hold the converted files at `error`, prove the start log

Part of [`../plan.md`](../plan.md). Read D10, D14, D18, D24 and D25 of `plan.md` first. Needs stages 01–05 landed. Three steps.

File gate (ticket § Sequenced): this stage edits `main.ts` and `eslint.config.js`. It never builds at the same time as F087 stage 2 or F090 stage 1.

## Step 1 — Convert `main.ts`

**Goal.** Every start and config line of the server is an event with codes and counts only.

**Files.** Change: `apps/server/src/main.ts`.

**Interfaces.** The 20 calls of 2026-11-13. Convert also any `log.*` call in `main.ts` that a later ticket added (D25), by the event code rules of stage 05; list each in the final message. Example: F087 stage 2 adds `` log.info(`features off by FEATURES_OFF: ${…join(", ")}`) ``; its event form is one `log.info("features_off", { count: list.length })` plus one `log.info("feature_killed", { key })` per flag (a comma list does not pass D7).

| Line (2026-11-13) | Today | New |
| --- | --- | --- |
| 28 | `` log.error(`config error: missing or bad keys: ${error.keys.join(", ")}`) `` | `for (const key of error.keys) log.error("config_key_bad", { key });` |
| 30 | `log.error("config error:", error instanceof Error ? error.message : error)` | `log.error("config_load_failed", { ...errorFields(error) })` |
| 39 | `log.info("triage worker is off (TRIAGE_LLM_SCOPE=off)")` | `log.info("triage_scope", { scope: "off" })` |
| 43 | `log.info("triage takes only synthetic mail (TRIAGE_LLM_SCOPE=synthetic)")` | `log.info("triage_scope", { scope: "synthetic" })` |
| 46 | `` log.warn(`triage sends the real mail of every active mailbox to ${providerLabel} (TRIAGE_LLM_SCOPE=all)`) `` | `log.warn("triage_scope", { scope: "all", provider })` |
| 54 | `log.warn("WEB_MAIL_ALLOW_LOCAL is an old name: use MAIL_ALLOW_LOCAL_HOSTS")` | `log.warn("config_key_renamed", { key: "WEB_MAIL_ALLOW_LOCAL" })` |
| 56 | `log.warn("mail: MAIL_ALLOW_LOCAL_HOSTS=true: local mail hosts are allowed")` | `log.warn("mail_local_hosts_allowed")` |
| 62 | `log.error("db role check failed:", error instanceof Error ? error.message : error)` | `log.error("db_role_check_failed", { ...errorFields(error) })` |
| 76 | `log.warn("HEARTBEAT_URL is not set: the heartbeat is off")` | `log.warn("heartbeat_off")` |
| 78 | `log.warn("OPERATOR_CONTACT is empty: the paused banner names no contact")` | `log.warn("operator_contact_empty")` |
| 90 | `` log.warn(`scope targets: ${targets.mailboxes} active mailboxes in …, ${suspended} suspended organizations`) `` | `log.warn("scope_targets", { mailbox_count: targets.mailboxes, org_count: targets.organizations, suspended_count: suspended })` |
| 94 | `` log.warn(`scope targets: count failed (${describeError(error)})`) `` | `log.warn("scope_targets_failed", { ...errorFields(error) })` |
| 119 | `log.info(operatorChat === null ? "operator notices: hourly; log lines only (…)" : "operator notices: hourly; telegram")` | `log.info("operator_notices_on", { kind: operatorChat === null ? "log" : "telegram" })` |
| 131 | `` log.info(`llm provider=${settings.provider} classifier=${settings.classifierModel}`) `` | `log.info("llm_settings", { provider: settings.provider, model: settings.classifierModel })` |
| 176 | `log.info("actions expiry: hourly")` | `log.info("job_scheduled", { job: "actions.expiry" })` |
| 182 | `log.info("delegation chaser: every 15 min (acts at 07:30 local)")` | `log.info("job_scheduled", { job: "delegation.chaser" })` |
| 196 | `log.info("retention: daily at 02:40")` | `log.info("job_scheduled", { job: "platform.retention" })` |
| 202 | `log.info("telegram is off (TELEGRAM_BOT_TOKEN is empty)")` | `log.info("telegram_off")` |
| 205 | `` log.warn(`telegram: TELEGRAM_API_ROOT is set: the bot talks to the Bot API at ${config.TELEGRAM_API_ROOT}, not to Telegram`) `` | `log.warn("telegram_api_root_set")` (the root is a loopback dev URL; D7 drops a URL anyway) |
| 246 | `` log.info(`listening on port ${server.port}`) `` | `log.info("server_listening", { port: server.port })` |

`triageScope(config, providerLabel)` becomes `triageScope(config, provider: LlmProviderId)` and the caller passes `settings.provider` (import the type from `./platform/llm`). `provider.label` is then unused; `provider.configHint` stays. Import `errorFields` from `./platform/errors`; drop `describeError` if unused.

The schedules and texts that the old lines held are in `docs/architecture.md` §8; stage 07 points there.

**Decisions.** D14, D25.

**Test.** Step 3 (the start log). No existing test reads these lines (`grep -rn "listening on port\|triage worker is off\|actions expiry: hourly" apps/server/test apps/server/src` prints nothing on 2026-11-13; run it again and fix any hit).

**Check.** `bunx eslint apps/server/src/main.ts 2>&1 | grep -c "no-restricted-syntax"` prints `0`; `bun run typecheck`.

**Done when.** The count is 0 and typecheck passes.

**Out of scope.** `web.ts`, `composition.ts`, `retention.ts` and the scripts (E8a).

## Step 2 — `error` level for the converted files

**Goal.** An old-form log line in `platform/` or `main.ts` fails the lint (D18).

**Files.** Change: `eslint.config.js`, `apps/server/src/platform/log-lint.test.ts`.

**Interfaces.** Directly after the `warn` block of stage 04:

```js
  {
    // Converted to events (F089): an old-form log line here fails the lint. E8a adds each module when it converts it.
    files: ["apps/server/src/platform/**/*.ts", "apps/server/src/main.ts"],
    ignores: ["**/*.test.ts"],
    rules: { "no-restricted-syntax": ["error", ...logEventSelectors] },
  },
```

In `log-lint.test.ts`, give `logEventSeverities` a third parameter `importPath = "../../platform/log"` that replaces the import path in the header.

**Decisions.** D18.

**Test.** Add `describe("log lint: converted files fail", …)`:

13. `apps/server/src/platform/__log-fixture.ts`, import `./log`, ``log.info(`x ${y}`);`` → `[2]`.
14. `apps/server/src/main.ts` (the real path; `lintText` uses the given text, not the file), import `./platform/log`, `log.error("config error:", e);` → `[2]`.
15. `apps/server/src/platform/__log-fixture.ts`, import `./log`, `log.info("sync_done", { count: 1 });` → `[]`.
16. `apps/server/src/platform/__log-fixture.test.ts`, import `./log`, ``log.info(`x ${y}`);`` → `[]`.
17. `apps/server/src/web.ts`, import `./platform/log`, ``log.info(`x ${y}`);`` → `[1]` (a root that E8a converts stays at `warn`).

**Check.**

```
bun test apps/server/src/platform/log-lint.test.ts
mkdir -p /tmp/f089-s06 && bun run lint > /tmp/f089-s06/lint-step2.log 2>&1; echo "exit $?"; grep -c "no-restricted-syntax" /tmp/f089-s06/lint-step2.log; grep -E "problems? \(" /tmp/f089-s06/lint-step2.log
```

The exit is `0`, the summary shows `0 errors`, and the count is the E8a backlog (382 on the code of 2026-11-13, plus lines that later tickets added in modules, roots or scripts). Write the count in the final message: the coordinator puts it into `spec/build.md`.

Mutation check, then revert: add `` log.info(`probe ${1}`); `` to the end of `apps/server/src/platform/pwned.ts`; `bunx eslint apps/server/src/platform/pwned.ts` exits 1. Remove the line (`git diff apps/server/src/platform/pwned.ts` is empty).

**Done when.** 17 lint tests pass; the lint exits 0; the mutation check failed and is reverted.

**Out of scope.** Moving any module to the `error` block (E8a).

## Step 3 — The start log test

**Goal.** A test proves the acceptance line "with `LOG_FORMAT=json`, `bun run start` writes one JSON object per line with the base keys and only allow-listed fields" (D24).

**Files.** New: `apps/server/test/integration/main-start-log.test.ts`.

**Interfaces.** One `test(…, 45_000)`:

```ts
const repoRoot = path.resolve(import.meta.dir, "../../../..");
// A free port: bind 0, read it, release it.
const probe = Bun.serve({ port: 0, fetch: () => new Response() });
const port = probe.port;
probe.stop(true);

const proc = Bun.spawn(["bun", "--no-env-file", "apps/server/src/main.ts"], {
  cwd: repoRoot,
  stdout: "pipe",
  stderr: "pipe",
  env: {
    ...process.env, // bun test loaded .env; --no-env-file stops the child from loading it again
    LOG_FORMAT: "json",
    LOG_LEVEL: "info",
    PORT: String(port),
    // Nothing reaches the outside: no bot, no web, no heartbeat, no LLM, no mailbox change, no send.
    TELEGRAM_BOT_TOKEN: "",
    OPERATOR_TELEGRAM_CHAT_ID: "",
    WEB_BASE_URL: "",
    HEARTBEAT_URL: "",
    TRIAGE_LLM_SCOPE: "off",
    ACTIONS_SCOPE: "off",
    SEND_SCOPE: "off",
  },
});
```

Read `proc.stdout` with one reader into a text buffer until the buffer contains `"event":"server_listening"` or 20 s pass (then fail with the buffer's line count, not its text). Then `proc.kill("SIGTERM")`, read the rest of stdout with the same reader until it is done, read `await new Response(proc.stderr).text()`, and `await proc.exited`. In a `finally`, kill the process if it still runs.

Probe P6 of this plan (2026-11-13, Bun 1.4.4): a spawned `bun` keeps an empty env value that the caller passes (a `.env` file does not replace it), and `--no-env-file` stops the `.env` load.

**Decisions.** D24, D21 (the server reads `LOG_FORMAT` through the config).

**Test.**

18. The exit code is `0` (the `SIGTERM` shutdown).
19. Every non-empty line of stdout and stderr parses with `JSON.parse` (a line that does not parse fails the test with its line number only).
20. In every line, the first five keys are `time`, `level`, `module`, `event`, `msg`, and every other key is in `logFieldNames` or is `dropped_fields`.
21. There is a line with `module` `main`, `event` `server_listening` and `port` equal to the chosen port, and one with `event` `triage_scope` and `scope` `off`.
22. No line from `module` `main` has `dropped_fields`.
23. The output has no value of the env that is a secret: it does not contain `process.env.CREDENTIALS_KEY` (skip this check when the key is unset) and not the password part of `process.env.DATABASE_URL` (parse it with `new URL`; skip when empty).

**Check.** `bun test apps/server/test/integration/main-start-log.test.ts` (needs the job DB; about 5 s).

**Done when.** Tests 18–23 pass.

**Out of scope.** Starting the web panel or Telegram in the test.

## Stage done when

- Steps 1–3 are done; the final message gives the backlog count of step 2 and lists any call that was not in the table.
- The Proof of `plan.md` ends with `PROOF_OK` (`NN` = `06`).
