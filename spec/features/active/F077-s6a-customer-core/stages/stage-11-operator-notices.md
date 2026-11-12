# s6a-customer-core — Stage 11

Part of [`../s6a-customer-core.md`](../s6a-customer-core.md). Read that file's A19–A21, "Differences found at collect" item 5, F5 and "Rules for every step" first, and the master plan's D31.

## Stage 11 — Operator notices frame and the three events

Two steps. The frame is what S6b (auth mail event) and S6f (backup event) extend: one function per event, one dedup key per event.

- [ ] **11.1 Config, dedup by key, the notices module**
  - Goal: an event reaches the operator once (at least once), by Telegram when `OPERATOR_TELEGRAM_CHAT_ID` is set, else as a `warn` line; the text holds ids, dates and counts only.
  - Files:
    - change `apps/server/src/platform/config.ts` (`OPERATOR_TELEGRAM_CHAT_ID` and its check), `apps/server/src/platform/config.test.ts`, `.env.example` (an empty `OPERATOR_TELEGRAM_CHAT_ID=` with the comment "optional: your own Telegram chat id for operator notices (ids only); needs TELEGRAM_BOT_TOKEN");
    - change `apps/server/src/modules/audit/repo.ts` (`auditEvents.operatorNotice = "operator.notice"` with `// data: kind, key`; new `hasAuditKey`), `apps/server/src/modules/audit/index.ts`;
    - change `apps/server/src/modules/mail/repo.ts` (`listAuthErrorMailboxesBefore`), `apps/server/src/modules/mail/index.ts`;
    - create `apps/server/src/modules/channels/operator.ts`; change `apps/server/src/modules/channels/index.ts`;
    - create `apps/server/test/integration/channels-operator.test.ts`;
    - change `docs/code-patterns.md` (the entry-point list: `listAuthErrorMailboxesBefore`, for the operator job).
  - Interfaces:

    ```ts
    // config.ts baseSchema; the superRefine adds: set without TELEGRAM_BOT_TOKEN → issue on OPERATOR_TELEGRAM_CHAT_ID "needs TELEGRAM_BOT_TOKEN"
    OPERATOR_TELEGRAM_CHAT_ID: z.preprocess(emptyAsUndefined, z.string().regex(/^-?\d{1,15}$/).optional()),
    export function operatorChatId(config: Config): number | null;

    // audit/repo.ts
    export function hasAuditKey(db: DbOrTrx, ctx: TenantContext, event: string, key: string): Promise<boolean>; // data->>'key' = key

    // mail/repo.ts — no TenantContext (operator job)
    export function listAuthErrorMailboxesBefore(db: DbOrTrx, before: Date): Promise<{ orgId: string; mailboxId: string; statusChangedAt: Date }[]>;
    // status = 'auth_error' AND status_changed_at <= before AND the organization is not suspended (join as stage 6)

    // channels/operator.ts
    export type OperatorNoticeKind = "trial_ending" | "llm_cap" | "auth_error_24h";
    export interface OperatorNoticeDeps { db: Db; now: () => Date; send: ((text: string) => Promise<void>) | null }
    export interface OperatorNotices {
      run(): Promise<void>; // the hourly job: trial_ending and auth_error_24h
      capReached(ctx: TenantContext, mailboxId: string, dayStart: Date, cap: number): void; // never throws, never blocks
      idle(): Promise<void>; // tests only: resolves when no notify is in flight
    }
    export function createOperatorNotices(deps: OperatorNoticeDeps): OperatorNotices;
    ```

  - Decisions:
    - One inner function `notify(ctx, kind, key, text)`: (1) `doneKeys.has(key)` or `inFlight.has(key)` (in-memory sets) → return; add to `inFlight` (removed in a `finally`); (2) `hasAuditKey(db, ctx, "operator.notice", key)` → add to `doneKeys`, return; (3) `send === null` → `log.warn(\`operator notice ${kind}: ${text}\`)`, else `await send(text)`; (4) `recordAudit(db, ctx, { actor: "system", event: auditEvents.operatorNotice, data: { kind, key } })`; (5) add to `doneKeys`. A throw in (3) → log once per key `operator notice ${kind} failed: ${errorLabel}` (`telegramErrorLabel`for a Telegram error, else`describeError`), no audit row, not in `doneKeys`. For `trial_ending`and`auth_error_24h`the next hourly`run()`tries again. For`llm_cap`the failed key goes into`retryCaps`(key →`{ ctx, kind, text }`), and `capReached`does not try that key again; the next hourly`run()`sends every`retryCaps` entry once more (cold review finding 3: a Telegram outage must not make the triage loop retry on every capped mail). A throw in (2) or (4) →`log.error(\`operator notice ${kind}: ${describeError(error)}\`)`. Why the order: A19 (at least once).
    - Keys and texts (A20, exact; dates as `toISOString()`):
      - `trial_ending:<org id>:<trial_ends_at ms>` — `now < trial_ends_at`: `` `Trial of org ${orgId} ends ${iso}.` ``; else `` `Trial of org ${orgId} ended ${iso}.` ``
      - `llm_cap:<mailbox id>:<dayStart ISO>` — `` `Mailbox ${mailboxId} of org ${orgId} reached the daily LLM cap (${cap} calls) on the quota day from ${dayStartIso}.` ``
      - `auth_error_24h:<mailbox id>:<status_changed_at ms>` — `` `Mailbox ${mailboxId} of org ${orgId} has been in auth_error since ${iso}.` ``
    - `run()`: `listOrganizations(db)` → for each `plan === "trial"` with `trialEndsAt <= now + 3 d` → `trial_ending`; `listAuthErrorMailboxesBefore(db, now − 24 h)` → `auth_error_24h`. Suspended organizations: none (`listOrganizations` holds only `trial` rows for the first rule; the mail query skips them). `run()` never throws: one failing organization does not stop the next.
    - `capReached` is called by the triage job (11.2). It starts `notify` with `void notify(…)` (`notify` catches everything) and returns at once: the triage loop never waits for Telegram. It does not check the plan (the triage job skips suspended organizations already).
    - The audit rows are in the organization of the event, so the D13 deletion (S6c) removes them with the organization.
  - Test (`channels-operator.test.ts`, `withRollback`, fixed `now = 2026-11-12T10:00:00Z`, a fake `send` that records texts):
    `run()` walks every organization of the worktree DB, so each test asserts only on the texts and audit rows that hold its own org or mailbox ids.
    1. A `trial` org ending at `now + 2 d` and one at `now + 5 d` → one text for the first, holding its id and no org name; an audit row `operator.notice` with `{ kind: "trial_ending", key }`; a second `run()` sends nothing (the row dedups; also with a new `createOperatorNotices` instance, so not only the memory set).
    2. A `trial` org ended at `now − 1 d` → the "ended" text once.
    3. `auth_error` mailbox with `status_changed_at = now − 25 h` → one text; `now − 23 h` → none; the same mailbox after a new `status_changed_at` (a new episode) → one more text.
    4. A suspended org with an `auth_error` mailbox at `now − 30 h` → no text.
    5. `send` throws once → no audit row, one error line; the next `run()` sends and writes the row.
    6. `send: null` → a `warn` line `operator notice trial_ending: Trial of org …` (spy on the log) and the audit row.
    7. `capReached` twice with the same key, then `await idle()` → one text; with the next `dayStart` → a second text.
    8. `capReached` with a `send` that never resolves → `capReached` returns at once (under 50 ms); a second call with the same key starts no second send (`inFlight`).
    9. `capReached` with a `send` that throws → after `idle()` no audit row; a second `capReached` with the same key sends nothing; the next `run()` sends it and writes the row.
    10. `config.test.ts`: the key without `TELEGRAM_BOT_TOKEN` → `ConfigError` on `OPERATOR_TELEGRAM_CHAT_ID`; `-1001234` with a token → `operatorChatId` = `-1001234`; `abc` → error.
  - Check: in 11.2.
  - Done when: in 11.2.
  - Out of scope: the auth-mail event (S6b); the backup event (S6f).

- [ ] **11.2 Wiring: the triage cap hook, the Telegram direct send, the hourly job**
  - Goal: the three events fire in the running server, and a slow Telegram never slows triage.
  - Files: change `apps/server/src/modules/triage/jobs.ts` (`TriageJobDeps.onCapReached`), `apps/server/src/modules/channels/telegram/runtime.ts` (`sendDirect`), `apps/server/src/main.ts`; add tests to `apps/server/test/integration/triage-job.test.ts` and `apps/server/src/modules/channels/telegram/runtime.test.ts`.
  - Interfaces:

    ```ts
    // triage/jobs.ts
    export interface TriageJobDeps {
      /* … */ onCapReached?: (ctx: TenantContext, mailboxId: string, dayStart: Date) => void;
    }
    // channels/telegram/runtime.ts
    export interface TelegramRuntime {
      /* … */ sendDirect(chatId: number, text: string, timeoutMs?: number): Promise<void>;
    }
    // sendDirect = bot.api.sendMessage(chatId, text, {}, AbortSignal.timeout(timeoutMs ?? 10_000)).
    // The bot has no request timeout of its own (`telegram/bot.ts:36`; the grammY default is 500 s).
    ```

  - Decisions:
    - `triage/jobs.ts`: in the `capped` branch, after the existing `warnedCap` block, call `deps.onCapReached?.(ctx, mailboxId, outcome.dayStart)` on every capped outcome, **without** `await` (it returns `void`; the operator module dedups in memory and never blocks).
    - `main.ts`: move `let telegram: ReturnType<typeof createTelegramRuntime> | null = null;` (today `main.ts:140`) up, above the triage job. Then `const operatorChat = operatorChatId(config)`; `const operator = createOperatorNotices({ db, now: () => new Date(), send: operatorChat === null ? null : async (text) => { if (telegram === null) throw new Error("telegram is off"); await telegram.sendDirect(operatorChat, text); } })` (the config check guarantees the token when the chat id is set; `send` reads `telegram` at call time). The triage job gets `onCapReached: (ctx, id, day) => operator.capReached(ctx, id, day, config.LLM_DAILY_CAP)`.
    - Scheduler: `scheduler.add("channels.operator", "0 13 * * * *", () => { operatorRun = operator.run(); return operatorRun; })`; add `operatorRun` to the shutdown wait. Start line: `log.info("operator notices: hourly; telegram")` or `log.info("operator notices: hourly; log lines only (OPERATOR_TELEGRAM_CHAT_ID is empty)")`.
    - The operator chat id never reaches a log line (private data of the operator).
  - Test:
    1. `triage-job.test.ts`: `dailyCap: 1`, two pending mails, a recording `onCapReached` → one LLM call, the hook called with `(ctx, mailboxId, dayStart)` of the quota day of `now`.
    2. `triage-job.test.ts`: an `onCapReached` that starts a promise which never resolves → the run still ends, and a second mailbox of another org in the same run is triaged.
    3. `runtime.test.ts`: `sendDirect(42, "x")` calls the fake API `sendMessage` with `chat_id: 42`, `text: "x"` and no reply markup (use the existing fake API helper of the file).
    4. `runtime.test.ts`: a fake API that never answers `sendMessage` → `sendDirect(42, "x", 100)` rejects within 1 s (this checks the "Not verified" fact about the grammY abort signal; if grammY takes no signal there, use `Promise.race` with a timer and log it in the stage log).
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the checks pass.
  - Out of scope: a web view of the notices; quiet hours for the operator.
