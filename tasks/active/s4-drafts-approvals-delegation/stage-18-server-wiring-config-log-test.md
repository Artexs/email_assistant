# s4-drafts-approvals-delegation — Stage 18

Part of [`../s4-drafts-approvals-delegation.md`](../s4-drafts-approvals-delegation.md). Read that file's "Input" and "Rules for every step" first.

## Stage 18 — Server wiring: `SEND_SCOPE`, `SEND_TEST_ADDRESSES`, the jobs, the sender factory, the log test [risky]

- [ ] **18.1 Config keys, `main.ts`, the composition of the deps (D16, D29, D31)**
  - Goal: the server runs the committer with the SMTP sender and the scopes, the expiry job and the chaser, and passes the S4 deps to Telegram; a bad scope config stops the start.
  - Files: change `apps/server/src/platform/config.ts`, `config.test.ts`, `.env.example`, `apps/server/src/main.ts`, `apps/server/src/modules/actions/committer.ts` (the S4 deps), `apps/server/src/modules/channels/telegram/runtime.ts`, `apps/server/src/scripts/mailbox-settings.ts` (S3 stage 14: the `create_draft` switch text loses "(S4: no effect yet)"), `deploy/README.md` (the two keys in the env list; the full section comes in stage 21).
  - Interfaces:

    ```ts
    // config.ts, baseSchema
    SEND_SCOPE: z.enum(["off", "self", "all"]).default("off"),
    SEND_TEST_ADDRESSES: z.preprocess(emptyAsUndefined, z.string().optional()), // comma-separated
    // superRefine additions
    // SEND_SCOPE=self → SEND_TEST_ADDRESSES must parse to ≥ 1 address (each `/^[^\s@]+@[^\s@]+$/`), else an issue on SEND_TEST_ADDRESSES
    // SEND_SCOPE=all → TEST_MAILBOX_ADDRESS required, else an issue on TEST_MAILBOX_ADDRESS
    export function sendTestAddresses(config: Config): string[]; // split, trim, lower-case, unique
    // main.ts
    function sendScope(config: Config): SendScope; // off → { kind: "off" } + info line; self → { kind: "self", addresses } + warn `sends go only to the SEND_TEST_ADDRESSES list (SEND_SCOPE=self)`; all → { kind: "all", mailboxAddress } + warn `sends go to real delegates of the TEST_MAILBOX_ADDRESS mailbox (SEND_SCOPE=all)`
    ```

  - Decisions:
    - `.env.example` lines: `# off = no send goes out (approvals still work; approved sends wait). self = sends go only to the addresses in SEND_TEST_ADDRESSES. all = sends go to real delegates, only for the TEST_MAILBOX_ADDRESS mailbox.` `SEND_SCOPE=off`; `# Your own addresses for test sends (comma-separated), needed with SEND_SCOPE=self. Never another person's address.` `SEND_TEST_ADDRESSES=`.
    - `main.ts`: `const hooks = delegationHooks({ db })` (the `delegation` index); the committer gets `sendScope: sendScope(config)`, `openSender: openSmtpSender`, `compose: composeMessage`, `hooks`; the committer job (S3 8.2) loads the owner and the organization per org per run (stage 11.1); `scheduler.add("actions.expiry", "0 7 * * * *", …)` with `createExpiryJob({ db, now, hooks, uidplus })`; `scheduler.add("delegation.chaser", "20 */15 * * * *", …)` with `createChaserJob({ db, now })`; both runs join the shutdown `allSettled` list (`expiryRun`, `chaserRun`). The Telegram runtime gets `sendScope`, `hooks`, `uidplus` and passes them to the handlers (stage 16). `uidplus = (ctx, mailboxId) => mailboxHasUidplus(db, ctx, mailboxId)` (the `mail` index, stage 7.1) is built once in `main.ts` (the composition root; `actions/scope.ts` stays pure) and passed to the three places: the approvals in the Telegram deps, the expiry job, and the `SettingsDeps.expireReady` wrapper of stage 13.2 where the server builds one.
    - The committer opens the SMTP sender only when `countClaimable(...).sending > 0` for the mailbox and after the IMAP provider; both close in `finally` (stage 12).
    - Start lines: the two scope lines above, `actions expiry: hourly`, `delegation chaser: every 15 min (acts at 07:30 local)`.
    - A dev and ops script `bun run job:run --name actions.expiry|delegation.chaser|actions.committer|channels.notifier [--force]` (`apps/server/src/scripts/job-run.ts`, `package.json`): a composition root that builds the named job with the same deps as `main.ts` (config, db, secrets, hooks, scopes; the notifier needs the Telegram token: without it the script exits 1 with `TELEGRAM_BOT_TOKEN is empty`) and runs it once, then exits 0. `--force` is accepted only with `delegation.chaser`: it skips the 07:30 and once-per-day gate (`runChaserForMailbox(…, { force: true })`, stage 17), so the dev run and the VPS checks can trigger a reminder on demand. The server must not run at the same time on the same DB for `actions.committer` (two committers: the claims are safe, the log lines double): the script prints that warning. The script logs through `log` like the server (no mail data).
  - Test: `job-run-args.test.ts` (a pure parser next to the script): `--name actions.expiry` parses; `--name nope` fails; `--force` with `delegation.chaser` parses, with `actions.expiry` fails. `config.test.ts`: `SEND_SCOPE=self` without the list → `ConfigError` keys `["SEND_TEST_ADDRESSES"]`; with `"A@x.test, b@x.test"` → `sendTestAddresses` = `["a@x.test", "b@x.test"]`; `SEND_SCOPE=all` without `TEST_MAILBOX_ADDRESS` → the key; the default is `off`; `SEND_SCOPE=yes` fails. Manual: `bun run dev` with `.env` (scope `off`) → the log has `sends: off (SEND_SCOPE=off)`, the scheduler lines for `actions.expiry` and `delegation.chaser`, no error; Ctrl+C ends within 15 s.
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`; the manual start.
  - Done when: the tests pass and the manual start shows the lines.
  - Out of scope: the VPS `.env` (stage 22).

- [ ] **18.2 Log test: no mail data in the S4 log lines (D30)**
  - Goal: a test proves that the committer (drafts and sends), the notifier (approvals and results), the expiry job, the chaser and the taps log no recipient, subject, task, draft text, SMTP reply text or secret, and that the expected lines appear.
  - Files: create `apps/server/test/integration/actions-send-logs.test.ts` (the pattern of `actions-logs.test.ts` of S3 stage 15.2: capture the `log` output for the test's duration).
  - Decisions:
    - Setup: an org with a mailbox in `assist`, `create_draft` on, `ACTIONS_SCOPE` `synthetic`, `SEND_SCOPE` `self` with the delegate address in the list; a delegate with marker data: name `MARKER-NAME-<uuid>`, address `marker-delegate-<uuid>@x.test`; two synthetic mails with subject `MARKER-SUBJECT-<uuid>`, sender `marker-sender-<uuid>@x.test`, body `MARKER-BODY-<uuid>`; a draft payload with task `MARKER-TASK-<uuid>`; the fake provider and the fake sender; the flow: committer run (draft applied), `detectApprovals`, `approve` through `handleCallback`, committer run (send applied with the fake sender failing once with `SmtpSendError("envelope", "EENVELOPE", 550, true, false)` on the second mail: one sent, one `smtp_rejected`), `detectSendResults`, the expiry job on a third send with `notified_at` 49 h ago, the chaser at 07:30 on a `sent` delegation with a past due date.
    - Assertions: no captured line contains any marker, `@x.test`, the task, `MARKER`, or the fake SMTP reply text `queued as FAKE`; the lines `action <id>: applied create_draft`, `action <id>: applied send`, `action <id>: failed smtp_rejected (stage envelope, code 550)`, `notice approval queued: outbox <id>`, `notice send_result queued: outbox <id>`, `expiry <mailboxId>: expired 1 (timeout 1, draft_missing 0, not_notified 0, held_timeout 0)`, `chaser <mailboxId>: due 1, overdue 1, reminders 1` exist; `describeError` labels only.
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:int`.
  - Done when: the test passes (user checkpoint 3 after the stage commit; group review of stages 11–18).
  - Out of scope: the Telegram token lines (the S2 log test).
