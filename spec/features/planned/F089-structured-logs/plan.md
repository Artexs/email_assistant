# F089 · Structured logs: plan

> **Status 2026-11-13 — planning.** Stages are written one by one (§ Planning progress). Builds after F086 is in `done/`. Nothing is built yet. Ticket: [ticket.md](ticket.md). Open defaults for the owner: [questions.md](questions.md).

## Planning progress

- [x] Collect: ticket, plan input, ADR 0024, `07-foundation-plan.md`, `05-execution-plan.md` §2, the plans of F086 and F087, the code of `platform/{log,scheduler,http,config,errors,auth,auth-mail,heartbeat,pwned}.ts`, `platform/llm/client.ts`, `main.ts`, `scripts/job-run.ts`, `eslint.config.js`, the test preload and the log tests.
- [x] Facts checked (probes P1–P5).
- [x] Decisions D7–D27.
- [x] stage-01-writer [written]
- [x] stage-02-format-and-context [written]
- [ ] stage-03-run-and-request-ids (not written yet)
- [ ] stage-04-lint-rule (not written yet)
- [ ] stage-05-convert-platform (not written yet)
- [ ] stage-06-convert-main (not written yet)
- [ ] stage-07-standards (not written yet)
- [ ] Cold review (`plan-review-1.md`), fixes logged in § "Cold review".

## Input

### Plan input of 2026-11-13, word for word (source: ADR 0024, PD-051, review §3.11)

> Written 2026-11-13 from ADR 0024 and the architecture review §3.11. Input of the `plan-task` session. Ticket: [ticket.md](ticket.md). Runs after F086; no migration; safe next to any job.

Facts (2026-11-13), as written:

- `platform/log.ts`: `createLog(module)` returns `debug | info | warn | error` as `console.log` or `console.error` with a `[module]` prefix and a level filter. 409 call sites: scripts 200, channels 52, actions 40, mail 29, platform 28, triage 27, testmail 6, delegation 5, tenancy 3.
- `describeError(error)` gives `name` plus a string or number `code`; `telegramErrorLabel` for Telegram. 24 calls still print `error.message` (ADR 0024 context).
- No `run_id` or `request_id` anywhere. `platform/scheduler.ts` wraps each job with croner `protect` and `catch`. `platform/http.ts` builds the Hono app and middlewares.
- Bun supports `AsyncLocalStorage` from `node:async_hooks`.

Design decisions, as written:

- **D1 API.** `log.info(event: string, fields?: LogFields)`; `event` is a snake_case code literal (`sync_done`, `llm_paused`), `msg` is derived from a small table or equals the event. `LogFields = Record<string, string | number | boolean | null | undefined>`. The old `(...args)` form stays for one release behind the lint warning, so the modules keep working until E8a converts them.
- **D2 Allow-list.** Field names from one list in `platform/log-fields.ts` (`org_id`, `mailbox_id`, `email_id`, `action_id`, `delegation_id`, `user_id`, `job`, `run_id`, `request_id`, `count`, `attempts`, `ms`, `code`, `kind`, `status`, `reason`, `folder_key`, `provider`, `model`, `release`, …). Values: UUID, number, boolean, or a string of at most 64 chars matching `^[A-Za-z0-9_.:/-]+$`. Anything else is dropped and `dropped_fields` is counted on the line. This is the mechanical form of the rule "no mail bodies, addresses or secrets in logs".
- **D3 Context.** `withLogContext({ job, run_id }, fn)` and `withLogContext({ request_id }, fn)` on `AsyncLocalStorage`; the writer merges the context into every line. The scheduler opens one per tick (`run_id` = a UUID), `platform/http.ts` one per request (reuse an incoming `x-request-id` from a trusted proxy only, else a new UUID; always set the response header). Per-item code adds `org_id` and `mailbox_id` with `log.with({ org_id })` (a child logger), so call sites do not repeat them.
- **D4 Lint.** `no-restricted-syntax` selector: `CallExpression[callee.object.name="log"] > TemplateLiteral:first-child` and a string literal that contains `${`, level `warn`. E8a flips it to `error` after the last module converts.
- **D5 Format.** `LOG_FORMAT` in `platform/config.ts`: `json` default; `text` prints `[module] event k=v k=v`; `.env.example` sets `text` for dev. `deploy/compose.yaml` sets nothing (json by default).
- **D6 Errors.** `log.error("x_failed", { code: describeError(error) })`; the writer refuses an `error` field whose value is an `Error` object (it would print a message).

Owner decisions that bind this plan: ADR 0024 points 1–2 (`docs/decisions/0024-structured-logs-and-operator-alerts.md`), PD-051 (the owner chose the defaults of E8), `07-foundation-plan.md` §4 decision 3 ("F093 and F089 without a `plan-task` session. [recommended: yes]"; this planning job runs anyway, at the coordinator's request).

### Design decisions of this plan (D7–D27)

D1–D6 stay. These decisions make them exact after the fact checks. "Default, owner to confirm" marks a small question that is also in [questions.md](questions.md); the stages do not change with its answer.

- **D7 The value rule, exact.** The writer keeps a field when its value is a finite number, a boolean, `null`, or a string of 0–64 characters that matches `^[A-Za-z0-9_.:/-]*$` and does not contain `://`. A field whose value is `undefined` is left out and not counted. Every other value is dropped and counted: a longer string, a string with any other character (space, `@`, `<`, newline), `NaN`, `Infinity`, an object, an array, an `Error`, a `bigint`, a function. A UUID matches the string rule, so D2's "UUID" needs no own branch. Reason: the set has no `@` and no space, so an address or a free text never passes; `://` stops a URL (`HEARTBEAT_URL` is a secret token, `platform/heartbeat.ts:15`). Rejected: cut a long string to 64 characters (a cut mail subject still leaks).
- **D8 The key rule, exact.** Each line starts with the base keys `time` (ISO 8601 UTC), `level`, `module`, `event`, `msg`, written by the writer. Then come, in this order, the context keys (D15), the child fields (`log.with`), the call fields. A field name must be in `logFieldNames` (`platform/log-fields.ts`); another name is dropped and counted. A name that is already on the line keeps its first value; the later value is dropped and counted (a call can never change `run_id` or `request_id`). When at least one field was dropped, the line ends with `dropped_fields: <n>`. `droppedLogFields()` returns the total of the process (for tests and for E8a).
- **D9 `msg` equals the event code.** No message table in this ticket. Reason: ADR 0024 asks for a constant `msg`; the event code is constant, and a table now would hold 46 copies of the code. E8a or the log store ticket may add a table. Default, owner to confirm (Q1).
- **D10 Event form or old form, at run time.** A call is in the event form when it has 1 or 2 arguments, the first is a string that matches `^[a-z][a-z0-9_]{0,63}$`, and the second is `undefined` or a plain object (prototype `Object.prototype` or `null`). Every other call is in the old form. The old form in `text` is today's exact call `console.log(prefix, ...args)`. The old form in `json` is one line `{ time, level, module, event: "legacy_text", msg: format(...args), …context }` (`format` from `node:util`, the formatter that `console.log` uses). Reason: the modules keep their log content on the VPS until E8a; the text is what they print today, so nothing new leaks. Rejected: drop old-form lines in `json` (all module logs would disappear from the VPS). Default, owner to confirm (Q8).
- **D11 How the writer knows the format.** `setLogFormat(format)` sets it: `main.ts` calls it right after `loadConfig` (next to `setLogLevel`); tests call it. Before the first `setLogFormat` call, the writer reads `process.env.LOG_FORMAT` once, at the first line, with `logFormatFromEnv(env)` (`"text"` → `text`, anything else → `json`). The config schema refuses a bad value at server start: `LOG_FORMAT: z.preprocess(emptyAsUndefined, z.enum(["json", "text"]).default("json"))`. So the scripts (they do not call `setLogFormat`) and the config error lines of `main.ts` (written before `loadConfig` returns) follow the env. The test preload sets `process.env.LOG_FORMAT = "text"` and calls `setLogFormat("text")`, so the existing tests that read `console` spies and the CLI tests that spawn scripts see the text form. Same pattern as `mailAllowLocalFromEnv` and F087 D9.
- **D12 The text form.** An event-form line calls `console.log(prefix, rest)` (or `console.error`) with exactly two arguments: `prefix` is `[module]`, `rest` is `<event>` plus ` key=value` for each key in line order (context, child, call, `dropped_fields`); `null` prints `null`. So `call[0]` stays the prefix (`triage-logs.test.ts:119` filters `call[0] === "[llm]"`), and a joined line reads `[llm] llm_call_failed model=test-model code=http_503`. The text form shows the context ids too. Default, owner to confirm (Q7).
- **D13 Streams.** `debug` and `info` go to `console.log` (stdout), `warn` and `error` to `console.error` (stderr), as today. The level filter works as today. Only `platform/log.ts` calls `console` (with the existing `eslint-disable-next-line no-console` comments).
- **D14 `errorFields(error)`.** New in `platform/errors.ts`: returns `{ error: <name> }` plus `error_code: <code>` when the error has a string or number `code`. `<name>` is `error.name` for an `Error`, else `typeof error`. Never the message. Call sites spread it: `log.error("job_failed", { ...errorFields(error) })`. `describeError` stays for the old-form lines. Reason (refines D6): `describeError` joins name and code with a space (`"Error 503"`), and D7 drops a value with a space (probe P5), so D6's `{ code: describeError(error) }` would always be dropped.
- **D15 Context API.** `withLogContext(context, fn)` in `platform/log.ts`, `context: LogContext = { job?: string; run_id?: string; request_id?: string }`, returns `fn()`'s result. It runs `fn` in an `AsyncLocalStorage` store. A nested call adds its keys to the outer store; a key that the outer store has keeps the outer value (D8 rule). Context values pass D7 like all fields. `log.with(fields)` returns a child `Log` that adds `fields` to each of its lines (D3); a child of a child adds to its parent's fields. Probe P1: the store survives `await` on socket, timer and event-emitter callbacks in Bun 1.4.4, and two runs at once do not mix.
- **D16 Scheduler.** `runJobTick(name, fn)` is exported from `platform/scheduler.ts`. It opens `withLogContext({ job: name, run_id: randomUUID() }, …)`, awaits `fn()`, then logs `job_done` (`debug`, `{ ms }`) or, on a throw, `job_failed` (`error`, `{ ms, ...errorFields(error) }`) inside the context. It never rethrows. `scheduler.add` passes `() => runJobTick(name, fn)` to croner. The croner `catch` option stays as a last guard (it logs `job_failed` with `{ job: name, ...errorFields(error) }`; it cannot fire while `runJobTick` catches). `protect` logs `job_skipped` (`debug`, `{ job: name }`). `scripts/job-run.ts` runs its one job inside `withLogContext({ job: args.name, run_id: randomUUID() }, …)` and keeps its exit codes.
- **D17 HTTP.** The first `app.use("*", …)` of `createApp` (before the access-log middleware) picks the request id: the incoming `x-request-id` header only when `web !== null`, the TCP peer (`web.connInfo(c)`, normalized) is in `web.trustedProxies`, and the value is a UUID (it is lower-cased); else `randomUUID()`. The rule is a pure exported function `incomingRequestId(header, peer, trusted)`. The middleware runs `next()` inside `withLogContext({ request_id })` and then sets the response header with `c.header("x-request-id", id)` after `next()` returns. Probe P2: set after `next()`, the header is on every response kind (JSON, `onError` 500, an `HTTPException` with its own response, a raw `Response` from the auth handler, a redirect, `bodyLimit` 413, the `/api` 401 and 404, a static file, the 404 page); set before `next()`, it is lost on raw responses. Only a UUID is reused. Default, owner to confirm (Q4).
- **D18 Lint.** One constant `logEventSelectors` in `eslint.config.js` with the three selectors of probe P3: the first argument is not a string literal that matches `^[a-z][a-z0-9_]{0,63}$` (this covers D4's template literal and `${` string, and also free text and concatenation); more than two arguments; no argument. The callee is `<object>.<debug|info|warn|error>` where the object name is `log` or ends in `Log` (a child: `mailboxLog`). Level `warn` for `apps/server/src/**/*.ts`. From stage 06 on, level `error` for `apps/server/src/platform/**/*.ts` and `apps/server/src/main.ts`, the converted files, so nobody adds an old-form line there again. E8a adds each converted module to the `error` list and flips the rest at the end. Default, owner to confirm (Q2): D4 had `warn` everywhere. No other block of `eslint.config.js` may set `no-restricted-syntax` for server files (flat config replaces the options of a rule; the comment says so).
- **D19 Allow-list content.** The names that the stages need (stage 01 holds the list): ids `org_id`, `mailbox_id`, `email_id`, `action_id`, `delegation_id`, `outbox_id`, `user_id`; context `job`, `run_id`, `request_id`; counts and times `count`, `attempts`, `ms`, `tokens_in`, `tokens_out`, `mailbox_count`, `org_count`, `suspended_count`, `port`; codes `code`, `error`, `error_code`, `kind`, `status`, `reason`, `scope`, `folder_key`, `provider`, `model`, `method`, `route`, `key`, `release`. A change that logs a new name adds it to the list in the same commit; the review checks that its values are ids, codes, counts or times. Rejected: suffix rules (`*_id`, `*_count`): a name like `subject_id` would pass without a review.
- **D20 Better Auth messages become reason codes.** The Better Auth logger hook (`platform/auth.ts:439–445`) passes library text. Stage 05 maps it with `betterAuthLogReason(message)`: a fixed table of message starts (from the `better-auth:` entries of `docs/known-alerts.md`) to codes; any other text → `other`. The free text no longer reaches the log. `cleanLogText` goes away with its tests. Default, owner to confirm (Q6).
- **D21 The VPS stays on `json`.** `.env.example` gets `LOG_FORMAT=text` (dev). `deploy/compose.yaml` pins `LOG_FORMAT: json` in the `server` environment, next to `PORT`. Reason: a new install copies `.env.example` to `.env`, so without the pin a fresh VPS would print text. This changes D5 ("compose sets nothing"). Default, owner to confirm (Q3).
- **D22 ADR 0024 points.** This ticket lands point 2 and the part of point 1 that the scope holds (the writer, the allow-list, the drop count, the lint in `warn`, the conversion of `platform/` and `main.ts`). Point 3 (the canary test) is out of scope (ticket § "Out of scope": E8a). The ticket's acceptance line said "points 1–3 are marked landed"; this plan corrected it in `ticket.md`.
- **D23 Seven stages.** The input had three. Stage 01 is the `[risky]` writer alone (the allow-list is the privacy guard), so it gets one step and its own review. The config, the context seams, the lint, and the two conversions are separate stages of at most about 300 changed lines. Stage 04 (lint) may run next to stages 02 and 03 (no shared file).
- **D24 Acceptance "`bun run start` writes JSON" is a test.** Stage 06 adds `apps/server/test/integration/main-start-log.test.ts`: it spawns `bun apps/server/src/main.ts` with `LOG_FORMAT=json`, Telegram, web, heartbeat and all scopes off, waits for `server_listening`, sends `SIGTERM`, and checks every line. Reason: a manual start proves it once; the test keeps it true.
- **D25 Conversion scope is the code at build time.** Stages 05 and 06 convert every `log.*` call in `apps/server/src/platform/**` and `apps/server/src/main.ts` that exists at their base commit, also lines that F087, F088 or F090 added after this plan. The lint (stage 04) lists them; after stage 06 the `error` level keeps them converted. The tables in the stage files hold the 46 calls of 2026-11-13; a call not in the table gets an event code by the same rules, and the worker lists it in the final message.
- **D26 Telegram updates get no context now.** Updates come from the grammY polling loop, not from the scheduler or HTTP. E8a adds a context per update. Out of scope here.
- **D27 Stages and other tickets.** F087 stages 1 and 4, F090 stage 1 and F089 stage 02 all edit `platform/config.ts`; F087 stage 2 and F089 stage 02 edit `apps/server/test/preload.ts` and `main.ts`; F087 stages 4 and 5 and F089 stages 03 and 05 edit `platform/http.ts`; F090 stage 1 and F089 stage 05 edit `platform/llm/client.ts`; F089 stage 06 and F087 stage 2, F090 stage 1 edit `main.ts`. These pairs never build at the same time (ticket § Sequenced).

A gap or a deviation that a worker finds is a question in its final message, not a choice. The coordinator decides from this "Input" or asks the owner.

## Differences found at collect (2026-11-13)

- Call count: the lint probe (P3) finds 428 old-form calls in `apps/server/src`: scripts 200, channels 52, actions 40, mail 30, platform 26, triage 27, testmail 6, delegation 5, tenancy 3, and the roots `main.ts` 20, `web.ts` 9, `composition.ts` 6, `retention.ts` 4. The input counted 409 (no roots) and "28" for platform. The ticket's "Conversion of `platform/` and `main.ts` … (28 calls)" is 46 calls: platform 26 (`auth.ts` 7, `auth-mail.ts` 4, `heartbeat.ts` 3, `http.ts` 5, `llm/client.ts` 2, `pwned.ts` 3, `scheduler.ts` 2) and `main.ts` 20.
- `describeError` output has a space, so D6's form fails D2 (D14).
- The ticket acceptance "ADR 0024 points 1–3 are marked landed" conflicts with its own "Out of scope: the canary test" (D22).
- `platform/auth.ts:444` calls the logger through a conditional (`(level === "error" ? log.error : log.warn)(…)`); the lint selector does not see it. Stage 05 rewrites it as an `if`.
- `platform/heartbeat.ts:31` and `main.ts:30,62` print `error.message` (a fetch error can hold the heartbeat URL). Stages 05 and 06 replace them with `errorFields`.
- 12 test files assert on the text of a line that stages 03, 05 or 06 convert (listed in those stages).

## Facts checked (2026-11-13, at commit `88df1c5`)

Probes ran in `.probe-f089/` in this worktree with the `node_modules` of the main checkout (deleted before the commit; their code is in the stage files where it matters). Bun 1.4.4, Hono 4.13.16, croner 11.0.0, ESLint 9.23.0, typescript-eslint 8.28.0, esquery 1.6.0.

- **P1 `AsyncLocalStorage` in Bun.** Two `als.run` calls at once (`Promise.all`), each awaiting: a TCP round trip on one socket opened outside any context (the shape of a `pg` pool connection), a `setTimeout`, a promise resolved from an `EventEmitter` listener registered outside the context, and a nested `als.run`. After each `await`, `getStore()` returned the own store; the nested run saw the merged store and the outer store came back after it; outside, `getStore()` was `undefined`. A croner job whose callback calls `als.run` per tick saw `run_id` 1, then 2.
- **P2 Hono header.** A first middleware that sets `x-request-id` with `c.header` after `await next()` put the header on 12 of 12 response kinds (listed in D17). Set before `next()`, 3 kinds lost it (`HTTPException` with `res`, a raw `Response`, `Response.redirect`). Under `Bun.serve`, a store opened around `next()` was visible in the handler, in a later middleware after its `next()`, and in `onError`; two requests at once kept their own ids.
- **P3 Lint selectors.** With `typescript-eslint`'s parser and `no-restricted-syntax` (selectors of D18 / stage 04), 18 of 18 cases gave the expected count: template literal, free text, `${` in a string, `"config error:", e`, three arguments, identifier, concatenation, a `mailboxLog` child, no argument, a capital letter, a number → 1 warning each; `log.info("sync_done", { mailbox_id })`, `log.info("sync_done")`, `mailboxLog.info("sync_done", {})`, `log.with({…}).info("sync_done")`, `blog.info(…)`, `catalog.info(…)`, `console.info(…)` → 0. `:first-child` in esquery picks `arguments[0]`, not the callee (`log.info()` gave only the "no argument" warning). On `apps/server/src/**/*.ts` the rule gives 428 warnings at 428 call positions (counts in § Differences).
- **P4 Lint does not fail on warnings.** `package.json` `lint` is `eslint .` (no `--max-warnings`); `lint-staged` runs `eslint --fix` (no `--max-warnings`); CI runs `bun run lint` (`.github/workflows/ci.yml:47`). So 428 warnings do not fail a commit or CI.
- **P5 Value rule.** `/^[A-Za-z0-9_.:/-]{0,64}$/.test("Error 503")` is `false`. `util.format("a\nb")` keeps the newline; `JSON.stringify` writes it as `\n`, so a JSON line stays one line. `util.format` applies `%s` in the first argument like `console.log`.
- `createLog` is imported by 75 files, always as `const log = createLog("<module>")`. `ReturnType<typeof createLog>` is a parameter type in `scripts/invite-delivery.ts:20` and `scripts/pick-member.ts:10`; no test passes a fake logger.
- `bunfig.toml` preloads `apps/server/test/preload.ts` for every `bun test` run; it sets `process.env.MAIL_ALLOW_LOCAL_HOSTS` and calls `configureMailHosts`.
- `scripts/limen-prepare.sh` copies the main checkout's `.env` into the job worktree (without the DB URLs), so a worker's `.env` may hold a real `TELEGRAM_BOT_TOKEN`; the stage 06 test sets it empty for the spawned server.
- `main.ts` shutdown on `SIGTERM` waits for the running jobs (at most 30 s) and exits 0 (`main.ts:254–281`).
- `docs/known-alerts.md` has 16 headings for lines that stages 05 and 06 convert (pwned, `web: lockout`, `web: home path failed`, `mail: MAIL_ALLOW_LOCAL_HOSTS=true`, `web: dist folder missing`, `web: reset requested`, seven `better-auth:` entries, `web: user <id> has <n> memberships`, `web: onEvent`).

## Not verified

- The store through `pg` and Kysely awaits on a real DB. P1 used `node:net` sockets, the transport of `pg`. Stage 03's integration test proves it: every line of a triage run over the job DB carries the run's `run_id`.
- ESLint selectors under Bun 1.3.14 (CI). P3 ran on Bun 1.4.4. Stage 04's fixture test runs in CI after the land; the coordinator checks the CI run of `master` (§ How to run).
- The exact Better Auth message texts. Stage 05 takes the table from the `better-auth:` headings of `docs/known-alerts.md`, which were copied from real log lines. A text that does not match gives `reason=other`, not a leak.

## Done when

1. With `LOG_FORMAT=json`, the server writes one JSON object per line, with `time`, `level`, `module`, `event`, `msg` first and only allow-listed keys after them. Shown by: `apps/server/test/integration/main-start-log.test.ts` (stage 06).
2. An unknown field, a long string, a string with a space or `@`, a URL and an `Error` object are dropped and counted. Shown by: `apps/server/src/platform/log.test.ts` (stage 01).
3. Every line of one triage run carries its `job` and `run_id`, every line of one `/api/me` request carries its `request_id`, the two do not mix when they run at once, and the response has `x-request-id`. Shown by: `apps/server/test/integration/log-context.test.ts` (stage 03), `scheduler.test.ts` and `http.test.ts` (stage 03).
4. `bun run lint` warns on `log.info(\`…${x}…\`)` in a module and passes on `log.info("event_code", { … })`; it fails on the old form in `platform/` and `main.ts`. Shown by: `apps/server/src/platform/log-lint.test.ts` (stages 04 and 06).
5. `LOG_FORMAT=text` prints `[module] event key=value …`. Shown by: `log.test.ts` (stage 01).
6. `platform/` and `main.ts` have no old-form log call: `bun run lint` shows no `no-restricted-syntax` message for them. Shown by: stage 06 lint log.
7. `docs/code-patterns.md`, the styleguide, `docs/architecture.md` §8, ADR 0024 and `docs/known-alerts.md` state the log standard. Shown by: stage 07 diff.

## Rules for every stage

- Read `CLAUDE.md`, `.agents/limen/styleguide.md`, `docs/code-patterns.md`, the ticket, this file and your stage file first. Build only your stage.
- Format only the files of your stage: `bunx prettier --write <files>`. Never `bun run format` or `prettier --write .` (S2 incident: a builder ran the repo-wide formatter).
- A new or converted log line is in the event form: `log.<level>("<event_code>", { <allow-listed fields> })`. Event codes are snake_case, at most 64 characters, and name what happened (`auth_mail_failed`), not where. Errors only through `...errorFields(error)` (from stage 01) or, in an old-form line, `describeError(error)`. Never `error.message`, a mail text, an address, a URL, a token or a list of ids in a field.
- Lines that your stage does not convert stay as they are. Do not convert module code (E8a).
- The repo is public: no real name, address or user id in a file. Test addresses end in `@x.test`.
- No temporary files inside the worktree (`bun run lint` lints every `.ts` file). Use `/tmp/f089-sNN/`. A probe edit that a stage file names is reverted at once; `git status --short` shows none of them before the commit.
- A test with a time uses a fixed `now` (`2026-11-20T10:00:00Z` unless the stage says another). A test that changes the log level or format restores `setLogLevel("info")` and `setLogFormat("text")` in `afterEach`. A test that spies on `console` restores the spy in `finally` or `afterEach`.
- All test files of one `bun test` call run in one process, one file after another; module state (level, format, drop counter) carries from file to file. A test reads the drop counter as a difference (after minus before), never as a total.
- A stage that changes a type fixes every caller and test in the same stage, so all checks pass at its commit.
- No migration, no `bun.lock` change, no new dependency. Commit by explicit path (`git add <paths>`), never `git add -A`.
- Do not edit `spec/build.md`, `docs/product/stage-2/*` or another ticket.
- A gap or a deviation is a question in your final message, not a choice.

## Proof

Run after the last commit, as one bash call with nothing after it; read the logs in a separate call. In the final message list as proven only what a saved log shows. `test:int` needs no lock: each job has its own DB (`CLAUDE.md`, 2026-11-13). No stage runs `test:e2e`.

Stages 01–06 (NN = the stage number):

```
mkdir -p /tmp/f089-sNN && bun run lint > /tmp/f089-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f089-sNN/typecheck.log 2>&1 && bun run test:unit > /tmp/f089-sNN/unit.log 2>&1 && bun run test:int > /tmp/f089-sNN/int.log 2>&1 && echo PROOF_OK
```

Stage 07 (docs and two config files; `<files>` = the files the stage changed):

```
mkdir -p /tmp/f089-s07 && bunx prettier --check <files> > /tmp/f089-s07/prettier.log 2>&1 && bun run lint > /tmp/f089-s07/lint.log 2>&1 && bun run test:unit > /tmp/f089-s07/unit.log 2>&1 && echo PROOF_OK
```

From stage 04 on, `lint.log` holds about 380 `no-restricted-syntax` warnings (the E8a backlog). They do not fail the lint (P4). An `error` in the log fails it.

## User checkpoints

- None. The plan has no migration, no real system, no send and no deploy. The VPS changes only at the next deploy (U2).

## User steps

| #   | Step                                                                                                                                                                                                                                                                                   | When                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| U1  | Optional: add `LOG_FORMAT=text` to the dev `.env` of the main checkout, so `bun run dev` and the scripts print the readable form. Without it they print JSON lines. The agent does not read or edit `.env`.                                                                             | after stage 02 lands |
| U2  | At the next deploy: the VPS log becomes JSON lines (`deploy/compose.yaml` pins `LOG_FORMAT: json`). Read them with the `jq` line that stage 07 writes into `deploy/README.md`. A CLI run on the VPS prints readable lines with `docker compose exec -e LOG_FORMAT=text server bun run …`. | next deploy          |

## Review

- A review job before the land for stage 01 `[risky]` (the allow-list is the privacy guard), stage 03 (the request id from a proxy, the context in every line) and stage 05 (the auth log lines). Model: the board's reviewer (`spec/build.md` § TRACK: `claude-sonnet-5-5`, high). Other stages land on the worker's proof.
- Review spawn (after the worker job is done; `<B>` = the job's branch, `NN` and `<slug>` from the stage list):

```
limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
  --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
  --review --detached --branch <B> --label "review s<NN> · F089" \
  "Review F089 stage NN on <B> against spec/features/active/F089-structured-logs/plan.md and stages/stage-NN-<slug>.md. Check that every numbered test exists and asserts what the stage says, and every decision the stage cites. Try to get a mail address, a free text, a URL or an error message into a log line through the changed code. Quote file and line for each finding."
```

## Stages

| #   | Stage                                                                                                                                         | Size       | Mark                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------- |
| 01  | [The writer](stages/stage-01-writer.md) — event form, allow-list, drop count, JSON and text form, `errorFields`                               | ~300 lines | `[risky]` private data in logs  |
| 02  | [Format and context](stages/stage-02-format-and-context.md) — `LOG_FORMAT` config, preload, `.env.example`, compose, `withLogContext`, `log.with` | ~220 lines |                                 |
| 03  | [Run and request ids](stages/stage-03-run-and-request-ids.md) — `runJobTick`, `x-request-id`, `job:run`, the context integration test         | ~300 lines | review                          |
| 04  | [Lint rule](stages/stage-04-lint-rule.md) — `logEventSelectors` in `warn`, the fixture test                                                    | ~130 lines |                                 |
| 05  | [Convert `platform/`](stages/stage-05-convert-platform.md) — 24 calls, Better Auth reasons, tests                                              | ~280 lines | review                          |
| 06  | [Convert `main.ts`](stages/stage-06-convert-main.md) — 20 calls, `error` level for converted files, the start-log test                         | ~250 lines |                                 |
| 07  | [Standards and docs](stages/stage-07-standards.md) — code patterns, styleguide, architecture §8, ADR 0024, known alerts, deploy README          | ~120 lines |                                 |

Order: 01 → 02 → 03 → 05 → 06 → 07, and 04 any time after 01 and before 06. Stage 04 may build at the same time as 02 or 03 (no shared file). No other parallel stages.

## How to run (coordinator)

1. Before the first spawn: F086 is in `spec/features/done/` (ticket § Sequenced). Move the ticket: `git mv spec/features/planned/F089-structured-logs spec/features/active/`, commit (the worktrees see only committed files).
2. Before each spawn, check the file gate of ticket § Sequenced (D27) with `limen jobs`: no F087 or F090 stage that edits the same file is in build.
3. Spawn one stage (NN = two digits, `<slug>` from the stage list):

   ```
   limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
     --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
     --prepare 'bash scripts/limen-prepare.sh' --label "F089-sNN <slug> · F089" \
     "Implement F089 stage NN. Read spec/features/active/F089-structured-logs/ticket.md, plan.md and stages/stage-NN-<slug>.md; build every step of that stage. Final proof: the Proof command of plan.md for your stage (/tmp/f089-sNN), one bash call with nothing after it, run after the last commit; read the logs in a separate call. In the final message, list as proven only what a saved log shows."
   ```

4. When the job finishes: read its final message and `/tmp/f089-sNN/*.log`. For stages 01, 03 and 05, spawn the review job (§ Review) and wait for it; a finding → `limen continue <job-id> "<fix>"` with the same engine flags, then review again (at most 2 rounds, then the owner decides).
5. Land: `limen land <job-id> --yes --keep-open` (stage 07: without `--keep-open`; it closes the ticket). Drop the job DB from the main checkout: `bun run db:worktree <YYYY-MM-DD>-<hash> --drop`.
6. Land stage N before you spawn the next stage, except stage 04 (it may run next to 02 or 03; land it before 06 starts).
7. After stage 02 lands, hand the owner U1. After the land of stage 04, check the CI run of `master` (Not verified: ESLint under Bun 1.3.14).
8. Before the land of stage 06: list the open job branches (`limen jobs`). After the land, tell each open job that edits `platform/` or `main.ts` to rebase and run `bun run lint`: an old-form log line there is now an error.
9. After stage 06 lands: the worker's final message gives the E8a backlog number (the `no-restricted-syntax` warning count). Put it into `spec/build.md` § TRACK (input "Done when").
10. Workers often break the one-`&&` proof form. Accept a check when its saved log shows the pass. A check with no proof at all → `limen continue`.

## Cold review

Not run yet.

## Log

- 2026-11-13: planned by a planning job (Opus 5.5) from the author's input; probes P1–P5.
