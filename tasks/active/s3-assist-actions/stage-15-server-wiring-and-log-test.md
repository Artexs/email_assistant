# s3-assist-actions — Stage 15

Part of [`../s3-assist-actions.md`](../s3-assist-actions.md). Read that file's "Input" and "Rules for every step" first.

## Stage 15 — Server wiring, `ACTIONS_SCOPE`, shutdown, the log test [risky]

- [ ] **15.1 Config key, jobs in `main.ts`, shutdown**
  - Goal: the server runs the committer and the returned job every 15 s under the configured scope, passes the scope to Telegram, and stops cleanly.
  - Files: change `apps/server/src/platform/config.ts`, `apps/server/src/platform/config.test.ts` (if present; else `apps/server/test/integration/config.test.ts`), `.env.example`, `apps/server/src/main.ts`, `apps/server/src/modules/channels/telegram/runtime.ts` (stage 13 added `actionsScope`; `main.ts` passes `config.ACTIONS_SCOPE`).
  - Interfaces: `configSchema` gets `ACTIONS_SCOPE: z.enum(["off", "synthetic", "all"]).default("off")`; `superRefine`: `all` without `TEST_MAILBOX_ADDRESS` → issue on `TEST_MAILBOX_ADDRESS`. `.env.example`:

    ```
    # off = the committer changes nothing in any mailbox (summaries are still saved). synthetic = mailbox changes only for synthetic mail
    # (@ea-seed.test Message-IDs), in every mailbox. all = also real mail, only of the TEST_MAILBOX_ADDRESS mailbox. synthetic is not a security boundary.
    ACTIONS_SCOPE=off
    ```

  - Decisions:
    - `actionsScope(config): ActionsScope` in `main.ts` like `triageScope`: `off` → info line `actions committer: mailbox changes are off (ACTIONS_SCOPE=off)`; `synthetic` → info `actions committer applies mailbox changes to synthetic mail only`; `all` → warn `actions committer applies mailbox changes to the real mail of the TEST_MAILBOX_ADDRESS mailbox (ACTIONS_SCOPE=all)`.
    - Jobs: `scheduler.add("actions.committer", "*/15 * * * * *", …)` and `scheduler.add("triage.returned", "*/15 * * * * *", …)` with `committerRun` / `returnedRun` promises that `shutdown()` adds to the `allSettled` list (the 30 s wait covers them: one mailbox batch of 20 actions takes seconds). The committer job is always built (the scope decides what it claims): `save_summary` rows are applied under every scope.
    - The committer's `secrets` is the `createSecretBox` of `main.ts`; `openProvider` is `openImapProvider`.
    - `GET /health` is unchanged.
  - Test: config: `ACTIONS_SCOPE=all` without `TEST_MAILBOX_ADDRESS` → `ConfigError` with the key `TEST_MAILBOX_ADDRESS`; the default is `off`; a bad value fails. Manual: `bun run dev` with `.env` (scope `off`) → the log has `actions committer: mailbox changes are off` and `scheduler` lines for the two jobs; Ctrl+C ends within 15 s.
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`; the manual start.
  - Done when: the tests pass and the manual start shows the lines.
  - Out of scope: the VPS `.env` (stage 19).

- [ ] **15.2 Log test: no mail data in the S3 log lines (D17)**
  - Goal: a test proves that the committer, the returned job, the Undo tap and the failed-notice detector log no subject, address, summary or folder path from mail data, and that the expected lines appear.
  - Files: create `apps/server/test/integration/actions-logs.test.ts` (the pattern of `triage-logs.test.ts` and `telegram-logs.test.ts`: capture the `log` output for the test's duration).
  - Decisions:
    - Setup: an org with a mailbox in `assist`, scope `synthetic`; three synthetic mails with marker data: subject `MARKER-SUBJECT-<uuid>`, sender `marker-sender-<uuid>@x.test`, summary `MARKER-SUMMARY-<uuid>`; actions `ready` for `save_summary`, `flag`, `mark_read`, `move`; one mail missing from the fake (→ `mail_not_found`); one `failOn("setFlags", HardError)` ×3 across runs (→ `failed` / `hard_error`); one returned row; one Undo tap through `handleCallback`; `detectNotices` for the failed action.
    - Assertions: no captured line contains any marker, the `@x.test` address, or the fake folder path of a mail (`AI/Info` is a key-derived name and may appear only as the key `ai_info`); the lines `committer <mailboxId>: applied 3, failed 2, retry 0` (or the exact counts of the setup), `action <id>: failed mail_not_found`, `action <id>: failed hard_error`, `returned <mailboxId>: processed 1`, `notice action_failed queued: outbox <id>` exist; `describeError` labels only (`HardError`), never an error message.
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:int`.
  - Done when: the test passes (user checkpoint 3 after the stage commit; group review of stages 8–15).
  - Out of scope: the Telegram token and bot lines (S2's log test).
