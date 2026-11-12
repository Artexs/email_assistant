# s5a-web-foundation — Stage 4

Part of [`../plan.md`](../plan.md). Read that file's "Done when", "Owns", S1–S13, "Facts checked", W1–W20, "User steps" and the master plan's "Rules for every step" (`spec/features/done/2026-11/F007-s5-web-panel/plan.md`) first. Decisions named D<n> are in the master plan, W<n> and S<n> in the segment file, "fact <n>" in the segment file's "Facts checked".

## Stage 4 — `web:invite` CLI (D2, W12) and the auth log test [risky]

- [x] **4.1 `web:invite` and the log test**
  - Goal: the owner gets a one-time setup link from the CLI, and a test proves that no token, URL, e-mail address, password, cookie or secret reaches a log line in the whole server-side auth flow.
  - Files: create `apps/server/src/scripts/web-invite.ts`, `apps/server/test/integration/web-auth-logs.test.ts`, `apps/server/test/integration/web-invite-cli.test.ts`; change the root `package.json` (`"web:invite": "bun apps/server/src/scripts/web-invite.ts"`).
  - Interfaces: `bun run web:invite --org-id <uuid> [--user-id <uuid>]`; stdout on success:

    ```
    Open this link within 24 hours:
    <url>
    The link works once. Do not share it. If this user already has a password, the link replaces it and ends every signed-in session.
    ```

    exit 0; log `[web-invite] invite link made for user <id>` at info. Failures (exit 1, one `log.error` line): `usage: bun run web:invite --org-id <uuid> [--user-id <uuid>]`; `WEB_BASE_URL is empty: the web is off; set WEB_BASE_URL and WEB_AUTH_SECRET first`; `pickMemberId`'s own messages (`the organization has no members`, `… pass --user-id`); `user is not a member of this organization`; `no link was produced` (the callback never ran); `failed: <describeError(error)>`.

  - Decisions:
    - The script is `telegram-link.ts` with Better Auth instead of the bot: `readOptions` with `parseArgs` (`org-id`, `user-id`), `loadConfig()`, `createDb`, `assertAppRole`, `pickMemberId(db, orgId, userId, log)`, then `getMembership(db, { orgId }, userId)` for the e-mail, then `createAuth({ databaseUrl: config.DATABASE_URL, baseUrl: config.WEB_BASE_URL, secret: config.WEB_AUTH_SECRET, trustedOrigins: [config.WEB_BASE_URL, ...webTrustedOrigins(config)], onEvent: auditWebEvent(db), sendResetPassword: async ({ url }) => { captured = url } })`, then `auth.api.requestPasswordReset` with the body `email` and `redirectTo` = the `WEB_BASE_URL` plus `/setup`, print, `finally` `close()` and `db.destroy()`.
    - The URL goes to stdout only (like the Telegram link); never to `log`. The e-mail address is never printed. The third stdout line carries the "replaces the password" sentence always (W12 as refined: the CLI does not query `auth_accounts`; the sentence is true in both cases and costs nothing).
    - `web-auth-logs.test.ts` (the pattern of `actions-logs.test.ts`: `spyOn(console, "log")` and `spyOn(console, "error")`, `setLogLevel("debug")`): run the flow of stage 3 tests 1–3 plus one wrong password and one `web:invite`-style capture with marker values: e-mail `marker-<uuid>@x.test`, password `MARKER-PASSWORD-<uuid>-long`, the secret `MARKER-SECRET-<uuid>-padded-to-forty-chars`; collect the token from the captured URL and the cookie value from the sign-in headers. Assert: no captured line contains the e-mail, the password, the secret, the token, the cookie value, `reset-password/` or `callbackURL`; the lines `web: reset requested for user <id>` (when `sendResetPassword` is left to the default: run that variant once) and `better-auth: Invalid password` (the wrong password) exist; every line that holds `user <id>` holds a UUID, not an address. The HTTP side of the same rule (the access log, the error line) is stage 6's log test.
  - Test:
    1. The log test above.
    2. `web-invite-cli.test.ts` (the `org-create` subprocess pattern of `tenancy.test.ts`): run `bun apps/server/src/scripts/web-invite.ts --org-id <org>` with `env: { ...process.env, WEB_BASE_URL: "http://127.0.0.1:8080", WEB_AUTH_SECRET: "x".repeat(40) }` for an organization with one member → exit 0, stdout line 2 starts with `http://127.0.0.1:8080/api/auth/reset-password/` and ends with `?callbackURL=http%3A%2F%2F127.0.0.1%3A8080%2Fsetup`, line 3 holds "replaces it", stderr has no `@`; the token from that URL resets the password through `auth.api.resetPassword` (the link is real). With `WEB_BASE_URL: ""` → exit 1 and the `web is off` message (Bun keeps an empty value and does not refill it from `.env`: fact 21). With two members and no `--user-id` → exit 1 and the `pass --user-id` message. Cleanup as in stage 3.
  - Check: the database guard (segment file, user step 0; it must print `/email_assistant_s5a /email_assistant_s5a`, else stop), then `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the tests pass; a manual `bun run web:invite --org-id <dev org>` with the web keys in the worktree's `.env` prints a link (user step 1; skip the manual run when the keys are not set and say so in the log line).
  - Out of scope: the setup page that consumes the link (stage 11), an e-mail sender (S6).
