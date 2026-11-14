# F103 stage 12 — Canary test

Part of [`../plan.md`](../plan.md). `[risky]`: this test is the proof of the privacy rule (ADR 0024 point 3). Review job before the land. Needs stage 11 landed.

Two steps. About 350 changed lines; most are test setup copied from the existing marker tests.

## Step 1 — The shared capture helper; the marker tests use it

**Goal.** One helper captures every log line and checks it; the five marker tests run in JSON format through it (D11).

**Files.**

- `apps/server/test/log-capture.ts` (new; next to `wait-for.ts`)
- `apps/server/test/log-capture.test.ts` (new; unit cases of the helper; it lives in `test/`, so `test:int` runs it)
- `apps/server/test/integration/triage-logs.test.ts`, `actions-logs.test.ts`, `actions-send-logs.test.ts`, `telegram-logs.test.ts`, `web-auth-logs.test.ts` (change: use the helper)

**Interfaces.**

```ts
// apps/server/test/log-capture.ts
export interface CapturedLogs {
  /** Raw console lines (stdout and stderr), one string per call, in order. */
  readonly lines: readonly string[];
  /** Restores the spies, the level and the format. Call it in finally. */
  stop(): void;
}
/** Spies on console.log and console.error, sets LOG_FORMAT json (setLogFormat) and the level (default "debug"). */
export function captureLogs(opts?: { level?: LogLevel }): CapturedLogs;
/** The list of problems; empty when every line is clean. */
export function logProblems(lines: readonly string[], planted: readonly string[]): string[];
```

- A spy call joins its arguments with one space (`args.map(String).join(" ")`), so a text line from a CLI helper call is also caught.
- `logProblems` gives one problem string (no planted text in it: name the planted value by its index) for each line that: holds any planted string (case-sensitive substring); does not parse as one JSON object; has a key that is not `time`, `level`, `module`, `event`, `msg` or in `logFieldNames`; has `event` `log_call_invalid`; has `dropped_fields`; has `msg` other than `event`.
- `stop()` restores `setLogFormat("text")` and `setLogLevel("info")`.

**Test** (`log-capture.test.ts`).

1. A line `{"time":"…","level":"info","module":"m","event":"a","msg":"a","count":1}` and planted `["X-1"]` → no problem.
2. A line that holds `X-1` → one problem whose text does not hold `X-1`.
3. `not json` → one problem; `{"event":"a","msg":"a","subject":"s"}` → one problem (`subject`); a line with `dropped_fields` → one problem; `log_call_invalid` → one problem.
4. `captureLogs()` then `createLog("m").info("a")` → `lines` has one JSON line; after `stop()` a new call is not captured.

**Change of the marker tests.** Each of the five files replaces its own `spyOn(console, …)` setup with `captureLogs()` and its own marker check with `expect(logProblems(capture.lines, Object.values(MARKERS))).toEqual([])`. Keep every positive check of the file (a line that must appear), changed to the JSON form (`JSON.parse` the line, compare `event` and fields). Each test stays in its own file.

**Check.** `bun test apps/server/test/log-capture.test.ts apps/server/test/integration/triage-logs.test.ts apps/server/test/integration/actions-logs.test.ts apps/server/test/integration/actions-send-logs.test.ts apps/server/test/integration/telegram-logs.test.ts apps/server/test/integration/web-auth-logs.test.ts`.

**Done when.** The cases pass.

## Step 2 — The canary over the pipeline

**Goal.** One test proves that no planted mail string reaches any log line from sync to digest, with injected errors (D11, ADR 0024 point 3, epic exit "a test proves no mail field passes the redaction").

**Files.** `apps/server/test/integration/log-canary.test.ts` (new).

**Planted strings** (`const run = randomUUID().slice(0, 8)`; every value holds `CANARY` so that a missed one is easy to find): sender address `canary-from-${run}@x.test`, sender name `CANARY-NAME-${run}`, mailbox address `canary-box-${run}@x.test`, subject `CANARY-SUBJECT-${run}`, body phrase `CANARY-BODY-${run}`, LLM summary `CANARY-SUMMARY-${run}`, LLM reason `CANARY-REASON-${run}`, task text `CANARY-TASK-${run}`, IMAP error text `CANARY-IMAP-${run} canary-from-${run}@x.test`, SMTP reply `550 CANARY-SMTP-${run}`, Telegram description `Bad Request: CANARY-TG-${run}`, LLM error body `CANARY-LLMERR-${run}`, a delegate address `canary-delegate-${run}@x.test`.

**Flow** (one `test`, fixed `now` `2026-11-20T10:00:00Z` plus steps, `captureLogs()` at the start, `stop()` in `finally`, all DB work in `withRollback`, other mailboxes paused with `pauseOtherMailboxes`). Copy the setup of each step from the named test; do not invent a new fake.

1. Sync: a fake mail provider (`createFakeMailProvider`, as in `actions-end-to-end.test.ts`) holds one INBOX mail with the planted sender, name, subject and body; run `syncMailbox` (or the mail sync job of `mail-jobs.test.ts`).
2. Sync error: `fake.failOn("folderStatus", new SoftError(<IMAP error text>))`, run the sync job again; then a hard error with the same text.
3. Triage: the triage job with `createFixedLlmClient` that answers the planted summary and reason and a category that plans a delegation to the planted delegate (as in `triage-logs.test.ts` and `actions-send-logs.test.ts`); a second call that fails with the planted LLM error body (as in `triage-logs.test.ts`).
4. Committer and send: run the committer with a fake sender (`createFakeMailSender`) that first fails with an `SmtpSendError` carrying the planted SMTP reply, then succeeds (as in `actions-send-logs.test.ts`).
5. Notices and digest: run the notice detection and the outbox sender with a fake Telegram API that answers one call with a 400 and the planted description (as in `telegram-logs.test.ts`), then a digest for the linked member.
6. Web: one `GET /api/me` and one `GET /api/emails` (or the route that lists mails) for the member through `webTestApp` (`web-helpers.ts`).

**Asserts.**

1. `logProblems(capture.lines, planted)` is `[]`.
2. The capture holds at least these events (proves the steps ran): `sync_done`, `sync_soft_error`, `sync_failed`, `triage_done`, `send_retry` or `send_failed`, `committer_done`, `outbox_sent`, `digest_queued`. If a name differs because a conversion stage chose another code, use the code that stage wrote (its table) and say so.
3. At least one line carries a `run_id` (the jobs run through `runJobTick`, or the test wraps each job call in `withLogContext({ job, run_id: randomUUID() }, …)`), and one line carries a `request_id`.

If a step needs a dependency that no existing test builds, leave the step out, keep the others, and report it as a gap (a question in the final message), not a new fake.

**Decisions.** D11, D16. ADR 0024 point 3.

**Check.** `bun test apps/server/test/integration/log-canary.test.ts`. Then a proof that the test can fail: change one line of a converted module locally to log the subject in a code field (for example `reason: email.subject` in `triage_done`), run the canary, see it fail with a problem, revert the change, and run `git status --short` (nothing but the stage's files). Write the failing output start into the final message.

**Done when.** The canary passes; the sabotage run failed and was reverted; the Proof of `plan.md` (`/tmp/f103-s12`) prints `PROOF_OK`.

**Out of scope.** CLI output (not a log; D3). The log store.
