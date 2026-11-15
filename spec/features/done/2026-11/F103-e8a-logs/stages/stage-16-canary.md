# F103 stage 16 — Canary test

Part of [`../plan.md`](../plan.md). `[risky]`: this test is the proof of the privacy rule (ADR 0024 point 3). Review job before the land. Needs stages 14 (the console guard) and 15 (the capture helper) landed.

One step.

## Step 1 — The canary over the pipeline

**Goal.** One test proves that no planted mail string reaches any log line from sync to digest, with injected errors (D11, ADR 0024 point 3, epic exit "a test proves no mail field passes the redaction").

**Files.** `apps/server/test/integration/log-canary.test.ts` (new).

**Planted strings** (`const run = randomUUID().slice(0, 8)`; every value holds `CANARY` so that a missed one is easy to find): sender address `canary-from-${run}@x.test`, sender name `CANARY-NAME-${run}`, mailbox address `canary-box-${run}@x.test`, subject `CANARY-SUBJECT-${run}`, body phrase `CANARY-BODY-${run}`, LLM summary `CANARY-SUMMARY-${run}`, LLM reason `CANARY-REASON-${run}`, task text `CANARY-TASK-${run}`, IMAP error text `CANARY-IMAP-${run} canary-from-${run}@x.test`, SMTP reply `550 CANARY-SMTP-${run}`, Telegram description `Bad Request: CANARY-TG-${run}`, LLM error body `CANARY-LLMERR-${run}`, a delegate address `canary-delegate-${run}@x.test`.

**Flow** (one `test`, fixed `now` `2026-11-20T10:00:00Z` plus steps, `captureLogs()` at the start, `stop()` in `finally`, all DB work in `withRollback`, other mailboxes paused with `pauseOtherMailboxes`). Copy the setup of each step from the named test; do not invent a new fake.

1. Sync: a fake mail provider (`createFakeMailProvider`, as in `actions-end-to-end.test.ts`) holds one INBOX mail with the planted sender, name, subject and body; run `syncMailbox` (or the mail sync job of `mail-jobs.test.ts`).
2. Sync error: `fake.failOn("folderStatus", new SoftError(<IMAP error text>))`, run the sync job again; then a hard error with the same text.
3. Triage: the triage job with `createFixedLlmClient` that answers the planted summary and reason and a category that plans a delegation to the planted delegate (as in `triage-logs.test.ts` and `actions-send-logs.test.ts`); a second call that fails with the planted LLM error body (as in `triage-logs.test.ts`).
4. Committer and send: run the committer with a fake sender (`createFakeMailSender`) that first fails with an `SmtpSendError` carrying the planted SMTP reply, then succeeds (as in `actions-send-logs.test.ts`).
5. Notices and digest: run the notice detection and the outbox sender with a fake Telegram API that answers one call with a 400 and the planted description (as in `telegram-logs.test.ts`), then a digest for the linked member.
6. Console: `installConsoleGuard()` (stage 14), then `console.error("# SERVER_ERROR: " + <IMAP error text>)` as a library would print it, then the restore function. Install it after `captureLogs()` so that the capture spies are the sink.
7. Web: one `GET /api/me` and one `GET /api/emails` (or the route that lists mails) for the member through `webTestApp` (`web-helpers.ts`).

**Asserts.**

1. `logProblems(capture.lines, planted)` is `[]`.
2. The capture holds at least these events (proves the steps ran): `sync_done`, `sync_soft_error`, `sync_failed`, `triage_done`, `send_retry` or `send_failed`, `committer_done`, `outbox_sent`, `digest_queued`, `console_output`. If a name differs because a conversion stage chose another code, use the code that stage wrote (its table) and say so.
3. At least one line carries a `run_id` (the jobs run through `runJobTick`, or the test wraps each job call in `withLogContext({ job, run_id: randomUUID() }, …)`), and one line carries a `request_id`.

If a step needs a dependency that no existing test builds, leave the step out, keep the others, and report it as a gap (a question in the final message), not a new fake.

**Decisions.** D11, D16. ADR 0024 point 3.

**Check.** `bun test apps/server/test/integration/log-canary.test.ts`. Then a proof that the test can fail: change one line of a converted module locally to log the subject in a code field (for example `reason: email.subject` in `triage_done`), run the canary, see it fail with a problem, revert the change, and run `git status --short` (nothing but the stage's files). Write the failing output start into the final message.

**Done when.** The canary passes; the sabotage run failed and was reverted; the Proof of `plan.md` (`/tmp/f103-s16`) prints `PROOF_OK`.

**Out of scope.** CLI output (not a log; D3). The log store.
