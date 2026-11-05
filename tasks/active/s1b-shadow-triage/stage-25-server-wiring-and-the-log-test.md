# s1b-shadow-triage — Stage 25

Part of [`../s1b-shadow-triage.md`](../s1b-shadow-triage.md). Read that file's "Input" and "Rules for every step" first.

## Stage 25 — Server wiring and the log test [risky]

- [ ] **25.1 `main.ts` scope switch, scheduler entry, no mail text in logs**
  - Goal: the worker runs only when the switch allows it, and no log line carries mail text, a summary, an error message or a key.
  - Files: change `apps/server/src/main.ts`; create `apps/server/test/integration/triage-logs.test.ts`.
  - Interfaces: in `main.ts`, only when `config.TRIAGE_LLM_SCOPE !== "off"`: `const llm = createLlmClient({ apiKey: config.GEMINI_API_KEY, classifierModel: classifierModel(config), timeoutMs: config.GEMINI_TIMEOUT_MS, rpm: config.GEMINI_RPM })`, `const pause = createLlmPause()`, `createTriageJob({ db, llm, pause, scope, batchSize: 5, dailyCap: config.LLM_DAILY_CAP, now: () => new Date() })`, `scheduler.add("triage.worker", "*/15 * * * * *", triage.run)` (croner 6-field pattern).
  - Decisions:
    - `off` → do not build the client and do not register the job; log `info` "triage worker is off (TRIAGE_LLM_SCOPE=off)".
    - `synthetic` → `scope = { kind: "synthetic" }`; log `info` "triage takes only synthetic mail (TRIAGE_LLM_SCOPE=synthetic)".
    - `all` → `scope = { kind: "all", mailboxAddress: config.TEST_MAILBOX_ADDRESS }` (config guarantees the key, step 9.1); log `warn` "triage sends the real mail of the TEST_MAILBOX_ADDRESS mailbox to Gemini (TRIAGE_LLM_SCOPE=all)". Never log the address.
    - The code does not check the billing tier (it cannot see it); ADR 0013 and the `.env.example` comment hold the rule.
    - `isOwnActionId` in `main.ts` stays `async () => false`: S1b makes no drafts and sends nothing.
  - Test (`triage-logs.test.ts`, `withRollback`, `pauseOtherMailboxes` first): call `setLogLevel("debug")` at the start, so the `debug` lines of `llm.ts` are captured too, and `setLogLevel("info")` in `afterEach` / `finally` (review finding 18); spy on `console.log` and `console.error`; build the job with a real `createLlmClient` (marker API key, a fake `generate`) and a pause with a fake clock; mails whose body, subject and from hold marker strings; the fake `generate` throws, in this order: a soft error (a plain object with `status: 503`); an `Error` whose message holds a marker; an error with `status: 400` whose `message` is a JSON body with `API_KEY_INVALID` and a marker in `error.message`; then it returns an `info` answer whose summary and reason hold markers. Run the job until all four calls happened (move the fake clock past each pause and each 5-minute retry wait). No captured line contains any marker (body, subject, address, summary, reason, error message, error body, key); at least one `debug` line was captured (proof that the level was on).
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:unit && bun run test:int`. Then start the server once on the Mac without `TRIAGE_LLM_SCOPE` (`bun run start`, stop it after the first log lines) and see "triage worker is off".
  - Done when: the tests pass and the server starts with the default `off`.
  - Out of scope: the VPS, Telegram notices.

## Added at stage 22 review

- A stale take-back now counts one attempt (stage 22). A restart while a batch runs would count an attempt for every claimed mail not yet tried (up to `batchSize`). In `main.ts`, on SIGTERM / SIGINT, let the running batch finish, or release untried claimed mail with `countAttempt: false`. Decide with the implementer and add a test or a note in the log.

## Added at stage 23 review

- `recoverFromError` in `jobs.ts` has a pause branch (a soft/config error whose release failed) without its own test. Add one if stage 25 touches the job: soft error trips the pause, `releaseEmail` fails once, a mail at `attempts` 2 must stay out of `unsure`.
