# F089 · Structured logs, the first stage of E8a: plan input

> Written 2026-11-13 from ADR 0024 and the architecture review §3.11. Input of the `plan-task` session. Ticket: [ticket.md](ticket.md). Runs after F086; no migration; safe next to any job.

## Facts (2026-11-13)

- `platform/log.ts`: `createLog(module)` returns `debug | info | warn | error` as `console.log` or `console.error` with a `[module]` prefix and a level filter. 409 call sites: scripts 200, channels 52, actions 40, mail 29, platform 28, triage 27, testmail 6, delegation 5, tenancy 3.
- `describeError(error)` gives `name` plus a string or number `code`; `telegramErrorLabel` for Telegram. 24 calls still print `error.message` (ADR 0024 context).
- No `run_id` or `request_id` anywhere. `platform/scheduler.ts` wraps each job with croner `protect` and `catch`. `platform/http.ts` builds the Hono app and middlewares.
- Bun supports `AsyncLocalStorage` from `node:async_hooks`.

## Design decisions

- **D1 API.** `log.info(event: string, fields?: LogFields)`; `event` is a snake_case code literal (`sync_done`, `llm_paused`), `msg` is derived from a small table or equals the event. `LogFields = Record<string, string | number | boolean | null | undefined>`. The old `(...args)` form stays for one release behind the lint warning, so the modules keep working until E8a converts them.
- **D2 Allow-list.** Field names from one list in `platform/log-fields.ts` (`org_id`, `mailbox_id`, `email_id`, `action_id`, `delegation_id`, `user_id`, `job`, `run_id`, `request_id`, `count`, `attempts`, `ms`, `code`, `kind`, `status`, `reason`, `folder_key`, `provider`, `model`, `release`, …). Values: UUID, number, boolean, or a string of at most 64 chars matching `^[A-Za-z0-9_.:/-]+$`. Anything else is dropped and `dropped_fields` is counted on the line. This is the mechanical form of the rule "no mail bodies, addresses or secrets in logs".
- **D3 Context.** `withLogContext({ job, run_id }, fn)` and `withLogContext({ request_id }, fn)` on `AsyncLocalStorage`; the writer merges the context into every line. The scheduler opens one per tick (`run_id` = a UUID), `platform/http.ts` one per request (reuse an incoming `x-request-id` from a trusted proxy only, else a new UUID; always set the response header). Per-item code adds `org_id` and `mailbox_id` with `log.with({ org_id })` (a child logger), so call sites do not repeat them.
- **D4 Lint.** `no-restricted-syntax` selector: `CallExpression[callee.object.name="log"] > TemplateLiteral:first-child` and a string literal that contains `${`, level `warn`. E8a flips it to `error` after the last module converts.
- **D5 Format.** `LOG_FORMAT` in `platform/config.ts`: `json` default; `text` prints `[module] event k=v k=v`; `.env.example` sets `text` for dev. `deploy/compose.yaml` sets nothing (json by default).
- **D6 Errors.** `log.error("x_failed", { code: describeError(error) })`; the writer refuses an `error` field whose value is an `Error` object (it would print a message).

## Stages

1. **Writer, allow-list, context.** Files: `platform/log.ts`, `platform/log-fields.ts`, `platform/log.test.ts`, `platform/config.ts` (`LOG_FORMAT`), `.env.example`, `platform/scheduler.ts` (context per tick), `platform/http.ts` (context per request, header). Tests: the drop rule, the context merge, the text form.
2. **Lint and proof.** Files: `eslint.config.js` (the warn rule, a fixture), conversion of `platform/*.ts` and `main.ts` (28 calls) to the event form, the integration test that one triage run and one `/api/me` carry their ids (reads the captured stdout, the pattern of `triage-logs.test.ts`).
3. **Docs.** Files: `docs/code-patterns.md` § Style (the log standard, the allow-list rule), `.agents/limen/styleguide.md`, `docs/architecture.md` §8 "Logging", ADR 0024 (points 1–3 landed; 4–7 in E8a and E8b), `docs/known-alerts.md` (entries will be keyed by event code from E8a on).

Parallel: stage 1 first; stages 2 and 3 at once after it.

## Done when

- The five acceptance lines hold.
- `bun run lint` shows the warning count as the E8a backlog number in `spec/build.md` § TRACK.
