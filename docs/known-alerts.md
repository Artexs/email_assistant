# Known alerts

Alerts we have already diagnosed. Before you diagnose an alert, search this file for its text.

When you find the cause of a new alert, add an entry below (newest first).

Status values: `fixed` · `fix pending` · `workaround` · `won't fix` · `investigating`

## Template

### `<exact alert text, or its stable part>`

- **First seen:** YYYY-MM-DD
- **Source:** which module / source / command raised it (log line, monitor)
- **Cause:** what actually went wrong
- **Fix:** what was changed (commit hash, file) or what to do when it fires
- **Status:** fixed / fix pending / workaround / won't fix / investigating

---

### `web undo <kind> mail <id> by user <id>`

- **First seen:** 2026-11-11 (S5d)
- **Source:** `apps/server/src/modules/triage/routes.ts`, `POST /api/actions/undo`. Level `info`. One line for each web Undo. `<kind>` is `started`, `already`, `nothing`, `too_old` or `held`. Ids only, no mail text. There is no line for a 404 or for feedback.
- **Cause:** a member tapped ↩️ on the Activity page. A `started` Undo also writes the `action.undo_requested` audit rows and, for a mail that is not `unsure`, a `wrong` feedback row with source `undo`.
- **Fix:** none. It is a record, not an error. `held` means the mailbox is paused or `ACTIONS_SCOPE` does not admit the mail.
- **Status:** won't fix (expected)

### `action <id>: failed mail_not_found` (in an e2e run after the activity spec)

- **First seen:** 2026-11-11 (S5d, from the code; not seen in the stage 10 run)
- **Source:** the committer (`apps/server/src/modules/actions/apply.ts`), level `warn`, and an `action.failed` audit row. In an e2e run under `ACTIONS_SCOPE=synthetic` after `activity.spec.ts`.
- **Cause:** the spec taps ↩️ on a seeded synthetic mail (Message-ID `…@ea-seed.test>`). The committer then claims the reverse move and the reverse `mark_read`, and looks for the mail in GreenMail, where it does not exist. Expected: at most two lines for each project (the reverse move and the reverse `mark_read` of M1). In the stage 10 run `cleanUpOrg` removed the mailbox before the committer ran, so no line appeared.
- **Fix:** none. It may appear after the activity spec; it is harmless (the seeded mail is not in GreenMail). No retry follows. An `error` line in the same run is not expected: diagnose that one.
- **Status:** won't fix (expected)

### `organization <id> timezone changed by <actor>` and `organization <id> signature changed by <actor>`

- **First seen:** 2026-11-11 (S5c)
- **Source:** `apps/server/src/modules/tenancy/service.ts`, `updateOrganizationSettings`. Level `info`. One line for each changed field. `<actor>` is the user id. The audit rows are `org.timezone_changed` (`from`, `to`) and `org.style_changed` (`set`, no text).
- **Cause:** the owner changed the organization timezone or the signature in the panel. A timezone change can skip, delay or bring forward one or more digests on that day (`notes/2026-11-11-web-settings-rules-facts.md`). A signature change applies to every message built after it, also to the send of an older draft.
- **Fix:** none. It is a record, not an error.
- **Status:** won't fix (expected)

### `refused: rule limit reached (1000)`

- **First seen:** 2026-11-11 (S5c)
- **Source:** the CLI `rules:add` (`apps/server/src/scripts/rules.ts`), on stderr, exit code 1. The web answers 409 `rule_limit` for the same case.
- **Cause:** the organization has 1000 sender rules (`SENDER_RULE_LIMIT` in `packages/core/src/triage/rules.ts`; cap of B7). Two adds at the same time can pass the cap by one or two rows. At the cap, a duplicate also gives this answer, not "already there".
- **Fix:** delete rules that are not needed (Rules page). Change `SENDER_RULE_LIMIT` only with a reason.
- **Status:** won't fix (expected)

### `web: mailbox connect failed: <label>` and `web: mailbox password check failed: <label>`

- **First seen:** 2026-11-11 (S5b)
- **Source:** `apps/server/src/modules/mail/routes.ts`, `POST /api/mailboxes` and `POST /api/mailboxes/:id/password`. Level `info`, one line per 422 or 502 answer.
- **Cause:** a user typo (wrong password, wrong host) or a provider outage or timeout. The label comes from `describeError`; it never holds the password.
- **Fix:** none needed for one line. Many lines in a row for one provider mean an outage or a changed server setting: check the preset hosts in `packages/core/src/mail/providers.ts`. WP and o2 user-name formats are not verified (`notes/2026-11-11-web-mailboxes-facts.md`).
- **Status:** won't fix (expected)

### `web: telegram getMe failed: <label>`

- **First seen:** 2026-11-11 (S5b)
- **Source:** `apps/server/src/modules/channels/routes.ts`. Warning. Only `POST /api/channels/telegram/link` logs it. `GET /api/channels/telegram` and `/api/me` swallow the failure (`.catch(() => null)`). A `getMe` outage shows in the log only when someone clicks "Link Telegram".
- **Cause:** the Telegram API is not reachable (network, wrong `TELEGRAM_API_ROOT`, bad token) or the 3 s limit ran out. The label is `telegramErrorLabel`.
- **Fix:** check the network and the bot token. The link route then answers 502 `telegram_unreachable` and writes no token row. `/api/me` shows `botUsername: null`.
- **Status:** investigating (per case)

### `web: home path failed: <label>`

- **First seen:** 2026-11-11 (S5b)
- **Source:** `apps/server/src/platform/http.ts`, the `/` page gate. Warning.
- **Cause:** `homePath` (the onboarding state of the user) threw, for example a database error.
- **Fix:** none for one line: `/` redirects to `/onboarding`. Read the error label and check the database.
- **Status:** investigating (per case)

### `web: WEB_MAIL_ALLOW_LOCAL=true: the connect form accepts local hosts`

- **First seen:** 2026-11-11 (S5b)
- **Source:** `apps/server/src/web.ts`, once at start. Warning.
- **Cause:** `WEB_MAIL_ALLOW_LOCAL=true` lets the connect form accept local and private hosts. The dev and e2e setups need it for GreenMail.
- **Fix:** the key must be empty or `false` on the VPS. If this line shows on the VPS, remove the key from `.env` and restart.
- **Status:** workaround (dev and e2e only)

### `mailbox <id> removed by user <id>`

- **First seen:** 2026-11-11 (S5b)
- **Source:** `apps/server/src/modules/mail/remove.ts`. Level `info`.
- **Cause:** an owner removed a mailbox in the panel. `delete_mailbox` deleted every row of it. Linked owners get the `mailbox_removed` notice.
- **Fix:** none. It is a record, not an error.
- **Status:** won't fix (expected)

### `sync <mailbox id> failed: … violates foreign key constraint …` right after a removal

- **First seen:** 2026-11-11 (S5b)
- **Source:** `apps/server/src/modules/mail/jobs.ts`, the per-mailbox `catch` of the sync job. Error line, one per run that held the mailbox at that second.
- **Cause:** a sync run inserted a mail into a mailbox that `removeMailbox` deleted at the same time. The triage save is not affected: `saveTriage` returns `lost` and writes nothing (fact 11).
- **Fix:** none. The next tick has no mailbox and is clean. Investigate only when the line repeats with no removal.
- **Status:** won't fix (expected)

### `outbox <id>: lost the claim after the send`

- **First seen:** 2026-11-11 (S5b)
- **Source:** `apps/server/src/modules/channels/sender.ts`. Warning.
- **Cause:** right after a mailbox removal, `delete_mailbox` deleted a `sending` digest row that the sender already held. The digest went out, but the sender could not mark it. The unsent `digests` row stays, so the next digest repeats that period (B7, cold review finding 26).
- **Fix:** none. One repeated period is accepted. Investigate only when the line shows with no removal.
- **Status:** won't fix (expected)

### `sync <mailbox id> folder <key>: failed 3 runs in a row`

- **First seen:** 2026-11-09
- **Source:** `apps/server/src/modules/mail/jobs.ts`, `[mail]` sync job. Error line, once per streak of 3 failed runs of one synced folder (D5).
- **Cause:** the folder read fails in each of 3 runs (IMAP error, a rejected folder, a DB error). The other folders sync as normal. The line names the key, never the path.
- **Fix:** read the warn or error lines before it: `$C logs --since 1h server | grep -E 'failed|tries again|not on the server'`. Switch the folder off if it stays broken: `mailbox:settings sync-folder … --key <key> --value off`. The line comes again only after the folder syncs once.
- **Status:** investigating (per case)

### `sync <mailbox id> folder <key>: not on the server, skipped`

- **First seen:** 2026-11-09
- **Source:** `apps/server/src/modules/mail/sync.ts`. Warning, one per run.
- **Cause:** the folder listing of the server has no folder with the stored path of that row (the user renamed or deleted the folder).
- **Fix:** none needed while the folder is gone: the sync skips that folder and runs the others. Restore the folder name, or switch the row off with `mailbox:settings sync-folder`.
- **Status:** workaround

### `sync <mailbox id>: folder discovery failed: <error>`

- **First seen:** 2026-11-09
- **Source:** `apps/server/src/modules/mail/sync.ts`, discovery of the sort folders. Warning.
- **Cause:** the LIST of the server failed or the insert of the folder rows failed. An auth error is not caught here and ends the run as `auth_error`.
- **Fix:** none needed once. The sync goes on with the stored rows and skips the "not on the server" check for this run. Discovery runs again on the next tick. If it repeats, check the connection and the DB.
- **Status:** investigating (per case)

### `IMAP folder gave no highest UID`

- **First seen:** 2026-11-09
- **Source:** `apps/server/src/modules/mail/imap/client.ts`, `folderStatus()`. A `HardError`, so the folder counts as failed in that run.
- **Cause:** the folder reports mail (`exists` > 0), but `FETCH *` returned nothing. The folder changed during the read, or the server answered wrong.
- **Fix:** the next tick tries again. After 3 runs in a row, the alert `failed 3 runs in a row` follows. Check the folder in the webmail.
- **Status:** investigating (per case)

### `web is off (WEB_BASE_URL is empty)`

- **First seen:** 2026-11-10 (S5a code; seen live with `WEB_BASE_URL= bun run dev`, hand check 8.2)
- **Source:** `apps/server/src/web.ts` (`webDeps`, level `info`, once per process start).
- **Cause:** The server started without `WEB_BASE_URL`, so the web panel is off: no login, no pages, no `/api` routes. The jobs, the Telegram bot and the CLIs work as before.
- **Fix:** No action, and expected until S5e sets the key on the VPS. To turn the panel on, set `WEB_BASE_URL` and `WEB_AUTH_SECRET` in the `.env` (only the user edits `.env`) and restart the server.
- **Status:** won't fix (expected behaviour)

### `web is on: <origin>, dist <path>`

- **First seen:** 2026-11-10 (hand checks 8.2 and 11.3)
- **Source:** `apps/server/src/web.ts` (`webDeps`, level `info`, once per process start).
- **Cause:** The web panel is on. `<origin>` is the origin of `WEB_BASE_URL`, the trust anchor for the cookie and the links. `<path>` is the resolved `WEB_DIST` folder.
- **Fix:** No action. Compare `<path>` with the folder that `bun run web:build` wrote (`apps/web/dist` unless `WEB_DIST` says otherwise). A wrong path gives `web: dist folder missing, pages are off`.
- **Status:** won't fix (expected behaviour)

### `web: dist folder missing, pages are off`

- **First seen:** 2026-11-09 (S5a code; the route matrix of stage 6 covers it)
- **Source:** `apps/server/src/platform/http.ts` (`createApp`, level `warn`, once per process start).
- **Cause:** `WEB_DIST` (default `apps/web/dist`) does not exist or holds no `404.html`, so every `GET` and `HEAD` page path answers 503 `text/plain` "The web build is missing. Run bun run web:build." The `/api/*` routes and `/health` answer as before.
- **Fix:** Run `bun run web:build`, or set `WEB_DIST` to the folder that holds the build (the image sets `/app/apps/web/dist`). Then restart the server.
- **Status:** workaround (build the pages, or set `WEB_DIST`)

### `WEB_BASE_URL is http:// on a non-loopback host: cookies are not Secure`

- **First seen:** 2026-11-10 (S5a code; not seen live)
- **Source:** `apps/server/src/web.ts` (`webDeps`, level `warn`, once per process start).
- **Cause:** `WEB_BASE_URL` uses `http://` and its host is not `localhost`, `127.0.0.1` or `[::1]`. Better Auth adds `Secure` to the session cookie only for an `https://` base URL, so the browser sends the cookie in clear text.
- **Fix:** Use an `https://` origin: behind Tailscale Serve on the VPS (S5e). An `http://` non-loopback origin is for a test network only.
- **Status:** fix pending (S5e sets an `https://` `WEB_BASE_URL` on the VPS)

### `web: reset requested for user <id>`

- **First seen:** 2026-11-09 (S5a code; not seen live)
- **Source:** `apps/server/src/platform/auth.ts` (the default `sendResetPassword`, level `info`).
- **Cause:** A `request-password-reset` reached a `createAuth` instance that has no own `sendResetPassword`. It cannot happen over HTTP in S5: the `/api/auth/*` allow-list answers 404 for that path. `web:invite` passes its own callback and prints the link, so it logs no line.
- **Fix:** Investigate: a line means a code path changed or a new `createAuth` caller exists. Check who builds the auth instance without `sendResetPassword` (`webDeps` in `web.ts`, `web-invite.ts`).
- **Status:** investigating

### `better-auth: Invalid password`

- **First seen:** 2026-11-09 (S5a code; a wrong sign-in makes it, for example in the Playwright smoke of stage 13)
- **Source:** `apps/server/src/platform/auth.ts` (Better Auth `sign-in.mjs` text through the logger, level `warn`, `cleanLogText` applied).
- **Cause:** One sign-in came with a wrong password. The answer is the same 401 `INVALID_EMAIL_OR_PASSWORD` as for an unknown e-mail, so the text never says which of the two is wrong.
- **Fix:** No action for one line. Many lines per minute from one address mean someone guesses: the rate limit answers 429 after 3 tries in 10 s (W9). S6 adds the lockout (`tasks/planned/web-public-hardening.md`).
- **Status:** won't fix (expected behaviour)

### `better-auth: User not found`

- **First seen:** 2026-11-09 (S5a code; not seen live)
- **Source:** `apps/server/src/platform/auth.ts` (Better Auth text through the logger, level `warn`).
- **Cause:** A sign-in or a reset named an e-mail with no `users` row. The user answers the same 401 as a wrong password (no hint which one).
- **Fix:** No action for one line; many lines from one address mean someone guesses (see the rate limit line above). A real user who sees the 401 text needs a setup link (`bun run web:invite`).
- **Status:** won't fix (expected behaviour)

### `better-auth: Reset Password: User not found`

- **First seen:** 2026-11-09 (S5a code; not seen live)
- **Source:** `apps/server/src/platform/auth.ts` (Better Auth text through the logger, level `warn`).
- **Cause:** A reset came with a token whose user row is gone (the organization or the user was removed). The reset does nothing.
- **Fix:** No action. Make a new setup link for the user (`bun run web:invite --org-id … --user-id …`) or remove the old link.
- **Status:** won't fix (expected behaviour)

### `better-auth: Invalid callbackURL: <url>`

- **First seen:** 2026-11-09 (S5a code; the stage 3 fix review found the text)
- **Source:** `apps/server/src/platform/auth.ts` (Better Auth origin check through the logger, level `error`). `cleanLogText` replaces the URL itself with `<url>`.
- **Cause:** A request to `/api/auth/reset-password/<token>` or another auth path carried a `callbackURL` outside `WEB_BASE_URL` and `WEB_TRUSTED_ORIGINS`: a hand-edited or foreign link.
- **Fix:** No action for one line. Many lines mean someone probes the route. When a real link fires it, check `WEB_TRUSTED_ORIGINS` (the built shape needs its own origin, for example `http://127.0.0.1:8080`). Never paste such a link into a task file or a ticket: it holds a reset token.
- **Status:** investigating

### `better-auth: Invalid origin: <url>`

- **First seen:** 2026-11-10 (S5a code; the final review found the path; not seen live)
- **Source:** `apps/server/src/platform/auth.ts` (the Better Auth origin check through the logger, level `error`). `cleanLogText` replaces the URL with `<url>`.
- **Cause:** A non-safe `/api/auth/*` request had no `Origin` header (or `Origin: null`) and `Sec-Fetch-Site: same-origin`, so our origin check let it through. Better Auth then checked the `Referer` header and found a foreign site. A browser does not send this combination. A script with hand-made headers does. Better Auth answers 403.
- **Fix:** No action for one line. Many lines from one address mean someone probes the auth routes: the rate limit holds them. When a real browser gets it, check `WEB_TRUSTED_ORIGINS` and the `Referrer-Policy` header (`same-origin`).
- **Status:** investigating

### `better-auth: Database schema mismatch … Missing tables …` and `GET /api/auth/*: BetterAuthError SCHEMA_MISMATCH`

- **First seen:** 2026-11-10 (S5a merge: the first `test:e2e` run after a new migration)
- **Source:** `apps/server/src/platform/auth.ts` (the Better Auth logger at start) and `apps/server/src/platform/http.ts` (`onError`, one line per auth request).
- **Cause:** The server started before `bun run db:migrate` added the auth tables or columns. Better Auth checks the schema once and keeps the mismatch until the process restarts (`@better-auth/core` `db/schema-check.mjs`), so every login answers 500 even after the migration ran.
- **Fix:** Run `bun run db:migrate`, then restart the server. The deploy runs the migration before `up` (`deploy/README.md`). The e2e server command runs `db:migrate` before the server starts (`apps/web/e2e/playwright.config.ts`).
- **Status:** fixed (e2e config); a deploy that starts the server before the migration still gets it

### `better-auth: Rate limiting could not determine a client IP …`

- **First seen:** 2026-11-09 (S5a code; not seen live)
- **Source:** `apps/server/src/platform/auth.ts` (the Better Auth rate limiter through the logger, level `warn`).
- **Cause:** A request reached Better Auth with no usable `x-client-ip`. The server sets `x-client-ip` before Better Auth (W1), so this line means that wiring changed; Better Auth then falls back to one shared per-path bucket for every client.
- **Fix:** Must not appear. If it does, the builder of the auth request or the `/api/auth/*` mount changed: check `authRequest` and `clientAddress` (with `peerAddress`) in `apps/server/src/platform/http.ts` and `WEB_TRUSTED_PROXIES`.
- **Status:** investigating

### `web: user <id> has <n> memberships; using the oldest`

- **First seen:** 2026-11-09 (S5a code; the route matrix of stage 6 covers it)
- **Source:** `apps/server/src/platform/http.ts` (`requireTenant`, level `warn`, once per process and user id).
- **Cause:** The user is a member of more than one organization. S5 has no organization switcher, so `requireTenant` takes the oldest membership (`listMembershipsOfUser`, ordered by `created_at, org_id`).
- **Fix:** No action for one line: the user sees the oldest organization, and the audit rows of the web events go there. A second organization is a bug of the setup until a switcher exists.
- **Status:** won't fix (expected behaviour)

### `web: no organization for user <id>`

- **First seen:** 2026-11-09 (S5a code; not seen live)
- **Source:** `apps/server/src/web.ts` (`auditWebEvent`, level `warn`).
- **Cause:** A user with no membership signed in or set a password. There is no organization for the audit row `web.login`, `web.password_set` or `web.password_changed`. The login itself succeeded.
- **Fix:** Give the user a membership: `bun run org:create` makes an owner; any other user needs an invitation (S5b). Until then that user's `/api/me` answers 403 `no_organization` and the shell shows "Your account is not in any organization. Ask the owner for an invitation."
- **Status:** investigating

### `web: audit <kind> failed: <label>`

- **First seen:** 2026-11-09 (S5a code; not seen live)
- **Source:** `apps/server/src/web.ts` (`auditWebEvent`, level `error`). `<kind>` is `login`, `password_set` or `password_changed`.
- **Cause:** The audit row of a login or a password change was not written: a database error in `recordAudit` or in the membership query. The login itself succeeded, because the composer catches every `onEvent` error.
- **Fix:** Read the label and check the DB (connection, migration state, the `audit_log` rows). One row is missing for that event; the next login writes its own.
- **Status:** investigating

### `web: onEvent <kind> failed: <label>`

- **First seen:** 2026-11-09 (S5a code; not seen live)
- **Source:** `apps/server/src/platform/auth.ts` (`report`, level `error`).
- **Cause:** The injected `onEvent` of an auth event rejected. `auditWebEvent` catches its own errors, so this line means the composition root supplies another `onEvent`, or that function changed. The login or the password change itself succeeded.
- **Fix:** Check the `onEvent` wiring in `apps/server/src/web.ts`. `auditWebEvent` must return without a throw; an audit miss must never fail a login.
- **Status:** investigating

### `# SERVER_ERROR: <message and stack>`

- **First seen:** 2026-11-09 (S5a code, stage 3 fix review; not seen live)
- **Source:** `better-call` `router.mjs` (`console.error`), not our logger. It follows our own `better-auth: <text>` line.
- **Cause:** An error that is not a `better-call` `APIError` was thrown inside Better Auth, for example a database error. The line holds the full message and stack, so it can hold database text. `onAuthError` cannot suppress it.
- **Fix:** Read our own `better-auth:` line first (name and code only); use this line for the stack. A database label: check the DB. Cut database text before you paste the line into a task file or a ticket.
- **Status:** investigating

### `POST /api/… 403` bursts in the debug access log (`bad_origin`)

- **First seen:** 2026-11-09 (S5a code; the route matrix of stage 6 covers it)
- **Source:** `apps/server/src/platform/http.ts`: the access log at level `debug` and the origin check that answers 403 `{ error: "bad_origin" }`.
- **Cause:** A client sent a non-safe `/api/*` request without a trusted `Origin` (no `Origin` and no `Sec-Fetch-Site: same-origin` counts as untrusted). A browser on another origin, a proxy that drops `Origin`, or a `curl` call does this. The server refuses before any handler runs.
- **Fix:** Check `WEB_TRUSTED_ORIGINS`: it must hold the browser origin (the built shape needs its own, for example `http://127.0.0.1:8080`). Check that the reverse proxy passes `Origin`. Set `LOG_LEVEL=debug` only while you diagnose.
- **Status:** workaround (set the key or the proxy)

### `deps: bump better-auth …` (a Dependabot pull request)

- **First seen:** 2026-11-10 (stage 15.1; the first weekly run follows the merge)
- **Source:** a Dependabot pull request from `.github/dependabot.yml` (ecosystem `bun`, `directory: /`, weekly, `better-auth` only, at most 2 open PRs).
- **Cause:** Dependabot found a newer `better-auth`. The pins are exact, so one PR holds `apps/server/package.json`, `apps/web/package.json` and `bun.lock` together.
- **Fix:** Read the release notes (security releases are listed on better-auth.com/blog), run `bun run test:int` (the `web-auth*` tests) and `bun run web:build && bun run test:e2e`, then merge and deploy (S5e runbook). Never merge a bump with a red auth test. If no PR arrives, see user step 4 of `tasks/done/s5a-web-foundation.md`: the fallback is a second entry with `directory: /apps/server`.
- **Status:** won't fix (a process entry, not a fault)

### `runSend > 3: a lost response is repeated with the same key` and `AgentMail fake > holdResponseNext: … ^ this test timed out after 5000ms`

- **First seen:** 2026-11-10 (CI run on the S5a branch and on `master`; the `ci` job, `test:unit`)
- **Source:** `apps/server/src/modules/testmail/send.test.ts` and `apps/server/src/modules/testmail/agentmail/fake.test.ts` (unit tests, no database).
- **Cause:** Each test sends twice through the fake AgentMail server with a held response and a client timeout of 200 ms. On this PC each test takes about 0.2 s (checked 2026-11-10); on a CI runner the same two tests take about 5.2 s, just over the 5 s default test timeout of `bun test`, so they fail. The extra time on CI is not diagnosed. The S5a branch does not touch `apps/server/src/modules/testmail/`: the same two fail on `master`.
- **Fix:** Give the two tests their own longer timeout (the third argument of `test`, as `apps/server/test/integration/mail-seed.test.ts` does with `30_000`). A re-run is not a fix. The `test-mail-traffic` task owns the fix.
- **Status:** fix pending

### `mailbox:seed and mailbox:audit CLI > seed exits 1 … ^ this test timed out after 5000ms.`

- **First seen:** 2026-11-07
- **Source:** CI `bun run test:int`, `apps/server/test/integration/mail-seed.test.ts` (runs 42414616787 on `master`, 42417654598 on PR #1).
- **Cause:** the test starts six CLI processes one after the other. Their sum is near the 5 s default test timeout (3.9 s locally) and above it on a CI runner.
- **Fix:** the test has its own timeout of 30 s (`tasks/done/flaky-mail-seed-cli-test.md`). Local run: 3.9 s. It failed in 4 of 6 CI runs on 2026-11-07, so a re-run is not a fix.
- **Status:** fixed

### `job:run: TELEGRAM_BOT_TOKEN is empty`

- **First seen:** 2026-11-07 (S4 code; not seen live)
- **Source:** `apps/server/src/scripts/job-run.ts` (`[job-run]`, level `error`, exit code 1).
- **Cause:** `bun run job:run --name channels.notifier` ran with no `TELEGRAM_BOT_TOKEN` in the environment. The notifier cannot send without the bot token.
- **Fix:** Set `TELEGRAM_BOT_TOKEN` in the `.env` of that environment (only the user edits `.env`), then run the command again. The other jobs (`actions.expiry`, `delegation.chaser`) need no token.
- **Status:** won't fix (expected behaviour)

### `notice send_result queued: outbox <id>`

- **First seen:** 2026-11-07 (S4 code; not seen live, the dev run (stage 19) and the VPS runs (stages 22, 23) are open)
- **Source:** `apps/server/src/modules/channels/notices.ts` (`[channels]`, level `info`).
- **Cause:** A send ended (`applied`, `failed`, `expired` or `rejected`) and the notice job queued one result message for each linked owner. The dedup key is `send_result:<action id>`, and `actions.result_notified_at` is set in the same transaction.
- **Fix:** No action for the line. Read the message in Telegram; the meaning of each text is in `deploy/README.md`, "Approvals and sends". The same line exists for the kinds `approval_set` and `delegation_answered`.
- **Status:** won't fix (expected behaviour)

### `notice approval queued: outbox <id>`

- **First seen:** 2026-11-07 (S4 code; not seen live, the dev run (stage 19) and the VPS runs (stages 22, 23) are open)
- **Source:** `apps/server/src/modules/channels/notices.ts` (`[channels]`, level `info`).
- **Cause:** A send is `awaiting_approval`, its draft is `applied` and the mailbox is `active`, so the notice job queued one approval request for each linked owner. The dedup key is `approval:<action id>`; `actions.notified_at` is set in the same transaction. The 48-hour approval time counts from `notified_at`.
- **Fix:** No action. If no request arrives in Telegram, check that an owner is linked (`telegram:link`) and that the draft is `applied`.
- **Status:** won't fix (expected behaviour)

### `chaser <mailboxId>: skipped settings`

- **First seen:** 2026-11-07 (S4 code; not seen live)
- **Source:** `apps/server/src/modules/delegation/chaser.ts` (`[delegation]`, level `info`; once per mailbox and process start). The same file writes `chaser <mailboxId>: skipped gate` once, when the first tick comes before 07:30 local time or after the run of the day.
- **Cause:** The mailbox is not in mode `assist`, or its switch `create_draft` is off, or the settings changed during the run (the chaser compares the settings version). The chaser makes no reminder for this mailbox.
- **Fix:** No action if you want no reminders. To get them: `mailbox:settings mode --mode assist` and `mailbox:settings switch --name create_draft --value on` (`deploy/README.md`, "Assist mode"). `skipped gate` is normal.
- **Status:** won't fix (expected behaviour)

### `chaser <mailboxId>: due <n>, overdue <o>, reminders <r>`

- **First seen:** 2026-11-07 (S4 code; not seen live)
- **Source:** `apps/server/src/modules/delegation/chaser.ts` (`[delegation]`, level `info`; once per mailbox and day, only when `<n>` > 0).
- **Cause:** The daily chaser run found `<n>` delegations past their due date. It marked `<o>` of them `overdue` and planned `<r>` reminders (draft + send, `awaiting_approval`). The owners get one approval message for the set.
- **Fix:** No action. Tap 📤 Send all or ✖️ Skip all in Telegram. A reminder never goes out without a tap.
- **Status:** won't fix (expected behaviour)

### `notice <kind> <id>: skipped: <error>`

- **First seen:** 2026-11-07 (S4 code; not seen live)
- **Source:** `apps/server/src/modules/channels/notices.ts` (`[channels]`, level `warn`; `<kind>` is `approval`, `approval_set`, `send_result` or `delegation_answered`). Once per process and row.
- **Cause:** The notice job could not build the message for one row (for example a draft payload that does not parse, a missing mailbox, or a missing organization). It skips that row and goes on with the others. The row keeps failing on every tick until someone fixes it, and the owner gets no message for it.
- **Fix:** Find the row with a read-only query (`$C exec db psql -U postgres -d email_assistant -c "<sql>"`):
  `approval`: `select id, status, notified_at, payload->>'kind' from actions where id = '<id>';`
  `approval_set`: `select id, status, notified_at from actions where payload->>'set_id' = '<id>';`
  `send_result`: `select id, status, status_reason, result_notified_at from actions where id = '<id>';`
  `delegation_answered`: `select id, status, answered_notified_at from delegations where id = '<id>';`
  Read `<error>` and the row, and fix the cause (a bug: file it with the action type, never with the payload). To stop the retries you can set `notified_at` (approval), `result_notified_at` (send_result) or `answered_notified_at` (delegation_answered) by hand: this writes to the database, so do it only after the user says go.
- **Status:** investigating

### `expiry <mailboxId>: expired <n> (timeout <t>, draft_missing <d>, not_notified <u>, held_timeout <h>)`

- **First seen:** 2026-11-07 (S4 code; not seen live: the hourly timing is checked in the dev run, stage 19, which is open)
- **Source:** `apps/server/src/modules/actions/expiry.ts` (`[actions]`, level `info`; job `actions.expiry`, every hour).
- **Cause:** The job closed `<n>` sends as `expired`: `timeout` (48 h after the approval request), `draft_missing` (its draft failed or was removed), `not_notified` (no request went out within 7 days) and `held_timeout` (approved, but held for 48 h after the tap). Each gives the owners a result notice.
- **Fix:** No action for `timeout`. A high `held_timeout` means sends were held: check `SEND_SCOPE`, a paused mailbox or a login error. A high `not_notified` means no owner is linked. The line `expiry <mailboxId> failed: <label>` (level `error`) means one mailbox failed; the next hour tries again.
- **Status:** won't fix (expected behaviour)

### `committer <mailboxId>: SEND_SCOPE=<kind>, <n> approved sends wait`

- **First seen:** 2026-11-07 (S4 code; not seen live)
- **Source:** `apps/server/src/modules/actions/committer.ts` (`[actions]`, level `info`; once per mailbox and process start).
- **Cause:** `SEND_SCOPE` is `off` (the default), or `self` with recipients that are not in `SEND_TEST_ADDRESSES`, or `all` for another mailbox. `<n>` sends are `approved` with an applied draft, and the scope does not admit them. They stay `approved`.
- **Fix:** No action if you want no sends. To send: set `SEND_SCOPE` (and `SEND_TEST_ADDRESSES`) in the `.env` and restart the server (`deploy/README.md`, "Approvals and sends"). Held sends expire 48 h after the tap (`held_timeout`).
- **Status:** won't fix (expected behaviour)

### `action <id>: failed hard_error` (a `create_draft` row)

- **First seen:** 2026-11-07 (S4 code; not seen live)
- **Source:** `apps/server/src/modules/actions/drafts.ts` (`[actions]`, level `warn`). A draft with a bad payload gives `action <id>: failed bad_payload` from the same file.
- **Cause:** The draft APPEND (or its recovery, or the removal of a draft) failed with a hard error three times. The draft is `failed`, its open sends expire (`draft_missing`) and the owners get a notice. For a reverse row (draft removal) the notice says that the draft stays in Drafts.
- **Fix:** Read the audit row `action.failed` (`attempts`, `error`) and run `bun run mailbox:check`. Check that the Drafts folder exists and the mailbox is not full. For a reverse row, delete the draft by hand in the mail client. For `bad_payload`, file a bug with the action type (never with the payload).
- **Status:** investigating

### `action <id>: sent copy failed: <Class code>`

- **First seen:** 2026-11-07 (S4 code; not seen live)
- **Source:** `apps/server/src/modules/actions/send.ts` (`[actions]`, level `warn`).
- **Cause:** The mail went out (the send is `applied`), but the copy to `Wysłane` failed: the locate or the APPEND gave an error. `provider_result.sent_copy` is `failed`, and the audit row `action.sent_copy_failed` holds the error label. The owners read "No copy in Sent".
- **Fix:** No action for the mail: it was sent. Add the copy by hand if you need it. If it repeats, check the `Sent` folder with `bun run mailbox:check`.
- **Status:** investigating

### `action <id>: failed outcome_unknown (stage <s>, code <c>)`

- **First seen:** 2026-11-07 (S4 code; not seen live)
- **Source:** `apps/server/src/modules/actions/send.ts` (`[actions]`, level `warn`).
- **Cause:** The system cannot tell if the mail went out. Either the SMTP error had stage `unknown` (a connection that broke during or after the content, or an error that is not a typed SMTP error), or the process stopped while the send was `applying` and the recovery found no copy in `Wysłane`. The row is `failed`, the delegation is `cancelled` (`outcome_unknown`), and the system does not send again by itself.
- **Fix:** Look in `Wysłane` and ask the recipient. If the mail did not go out, tap 📤 Send again in the result notice. If it went out, do nothing (the delegation stays `cancelled`: follow-up `tasks/planned/delegation-went-out-button.md`).
- **Status:** investigating

### `action <id>: failed smtp_error (stage <s>, code <c>)`

- **First seen:** 2026-11-07 (S4 code; not seen live)
- **Source:** `apps/server/src/modules/actions/send.ts` (`[actions]`, level `warn`).
- **Cause:** One of three: a hard error before the content (`connect`, `login` or `envelope`) three times; a 4xx or another non-5xx error after the content (`content`: the server may have the mail, so the system does not retry); or the mail could not be built three times (`compose`). The row is `failed` and the owners get a notice with 📤 Send again.
- **Fix:** For `content`, look in `Wysłane` and ask the recipient before you tap Send again. Otherwise check `/status` and `bun run mailbox:check`, fix the cause, then tap Send again. The line `action <id>: send retry (stage <s>, code <c>)` (level `warn`) is a try that will repeat in 5 minutes; a soft error does not count.
- **Status:** investigating

### `action <id>: failed smtp_rejected (stage <s>, code <n>)`

- **First seen:** 2026-11-07 (S4 code; not seen live)
- **Source:** `apps/server/src/modules/actions/send.ts` (`[actions]`, level `warn`).
- **Cause:** The mail server refused the mail with a 5xx reply, at the envelope (`MAIL FROM`, `RCPT TO`) or after the content. `<s>` is `envelope` or `content`, `<n>` is the reply code. The row is `failed`. The draft stays in Drafts and the delegation is `cancelled`. There is no Send again button, because the address or the mail is wrong.
- **Fix:** Check the delegate address (`delegates:list`). Replace it with `delegates:disable` and `delegates:add`. The system does not plan the mail again; send it by hand from the draft if you need it.
- **Status:** investigating

### `mailbox:settings: refused: <category> did not pass go/no-go (use --force to set auto on anyway)`

- **First seen:** 2026-11-07 (S3 code; not seen live, the dev run with the phone (stage 16) and the VPS deploy (stage 19) are open)
- **Source:** `apps/server/src/scripts/mailbox-settings.ts` (`[mailbox-settings]`, level `error`, exit code 2).
- **Cause:** A command `auto <category> on` named a category whose S1b go/no-go row is not `go` (precision below 0.98 or fewer than 30 kept labels). The gate refuses the change.
- **Fix:** No action if you did not want `auto` on. Read the line `go/no-go <category>: …` before it. To set `auto` anyway, run the command again with `--force`; the audit row records `forced`.
- **Status:** won't fix (expected behaviour)

### `notice action_failed queued: outbox <id>`

- **First seen:** 2026-11-07 (S3 code; not seen live, the dev run with the phone (stage 16) and the VPS deploy (stage 19) are open)
- **Source:** `apps/server/src/modules/channels/notices.ts` (`[channels]`, level `info`).
- **Cause:** An action became `failed` and the notice job queued one `action_failed` message for the user. The text says which action failed and why. The dedup key is `action_failed:<action id>`, so one action gives one notice.
- **Fix:** No action for the alert. Read the audit row `action.failed` of the action (`reason_code`). The user decides in the mailbox. See `deploy/README.md`, "Assist mode".
- **Status:** won't fix (expected behaviour)

### `returned <mailboxId>: processed <n>`

- **First seen:** 2026-11-07 (S3 code; not seen live, the dev run with the phone (stage 16) and the VPS deploy (stage 19) are open)
- **Source:** `apps/server/src/modules/triage/returned.ts` (`[triage]`, level `info`; job `triage.returned`, every 15 s).
- **Cause:** The job processed <n> mails that the sync marked as returned to INBOX (`emails.returned_at`). Only some get a feedback row: `imap_move` for a user move back; none after an Undo or for an `unsure` mail.
- **Fix:** No action. A line `returned <id>: <label>` at level `error` means one row failed; read the label and check the DB.
- **Status:** won't fix (expected behaviour)

### `expired <n> ready actions`

- **First seen:** 2026-11-07 (S3 code; not seen live, the dev run with the phone (stage 16) and the VPS deploy (stage 19) are open)
- **Source:** `apps/server/src/scripts/mailbox-settings.ts` (`[mailbox-settings]`, level `info`; the commands `expire-ready` and every gate-closing setter).
- **Cause:** The CLI closed <n> `ready` mailbox actions as `expired`. A gate change (`mode shadow`, `auto off`, `switch off`, `mode assist` without `--keep-switches` when it turns a switch off) does this in the same transaction. The line shows only when a gate closed or `<n>` > 0. `expire-ready` does it on request.
- **Fix:** No action. Run `expire-ready` before you set `ACTIONS_SCOPE=all`, so that old `ready` rows do not apply. The next line shows how many `ready` mailbox actions are left.
- **Status:** won't fix (expected behaviour)

### `sync <mailboxId> returned below cursor: list hit the limit <n>`

- **First seen:** 2026-11-07 (S3 code; not seen live, the dev run with the phone (stage 16) and the VPS deploy (stage 19) are open)
- **Source:** `apps/server/src/modules/mail/sync.ts` (`[mail]`, level `warn`).
- **Cause:** The list of mails moved in the last 7 days has 500 rows (`RETURN_CHECK_LIMIT`). The check looks at the newest 500 only, so older moved mails are not checked for a return.
- **Fix:** Check how many mails the system moved in 7 days. If the number is real, raise the limit in a task. No data is lost: the check only misses returns of the oldest rows.
- **Status:** investigating

### `sync <mailboxId> returned below cursor: checked <n>, returned <m>, copies <c>`

- **First seen:** 2026-11-07 (S3 code; not seen live, the dev run with the phone (stage 16) and the VPS deploy (stage 19) are open)
- **Source:** `apps/server/src/modules/mail/sync.ts` (`[mail]`, level `info`; one line per sync that has moved mails).
- **Cause:** <n> mails moved in the last 7 days were looked up in INBOX below the UID cursor, <m> of them came back (Interia keeps the UID). `copies` > 0 means a copy of a moved mail sits below the cursor while the original is still in its folder. The same copy counts again on every sync for 7 days. The debug line `sync <mailboxId> copy below cursor: email <id>` names the row.
- **Fix:** `returned` > 0 is normal after a user move back. `copies` > 0: no loss, but the system does not store or triage the copy. Switch the log level to debug to see the rows. Follow-up: `tasks/planned/copy-below-cursor.md`.
- **Status:** investigating

### `committer <mailboxId>: <Class code>; the next tick tries again`

- **First seen:** 2026-11-07 (S3 code; not seen live, the dev run with the phone (stage 16) and the VPS deploy (stage 19) are open)
- **Source:** `apps/server/src/modules/actions/committer.ts` (`[actions]`, level `warn`).
- **Cause:** Opening the mailbox failed with a soft error (network, timeout, server busy). The claimed actions go back to `ready` and no try counts.
- **Fix:** No action. The next tick (15 s) tries again. If it repeats for hours, run `bun run mailbox:check` and check the pilot mailbox and the network.
- **Status:** won't fix (expected behaviour)

### `committer <mailboxId>: login failed, status is now auth_error`

- **First seen:** 2026-11-07 (S3 code; not seen live, the dev run with the phone (stage 16) and the VPS deploy (stage 19) are open)
- **Source:** `apps/server/src/modules/actions/committer.ts` (`[actions]`, level `warn`).
- **Cause:** The mailbox refused the login (IMAP, or since S4 the SMTP login of a send). The committer set the mailbox status to `auth_error`; the sync notice tells the user. The claimed actions go back to `ready`; an approved send goes back to `approved` with no count and no mail sent.
- **Fix:** Fix the secret (password or app password) with `bun run mailbox:password` and set the mailbox to `active` again. Actions wait and apply later if they are younger than 24 h and the mail is younger than 7 days; older ones expire.
- **Status:** investigating

### `action <id>: <Class code>, try <n> of 3`

- **First seen:** 2026-11-07 (S3 code; not seen live, the dev run with the phone (stage 16) and the VPS deploy (stage 19) are open)
- **Source:** `apps/server/src/modules/actions/apply.ts` (`[actions]`, level `warn`).
- **Cause:** An IMAP call failed. A soft error (network, timeout) waits 5 minutes and does not count as a try. A hard error waits 5 minutes and counts. After the third hard error the action is `failed` (`hard_error`).
- **Fix:** No action for try 1 and 2. Read the `last_error` column of the action. For a repeat, check the mailbox with `bun run mailbox:check`.
- **Status:** won't fix (expected behaviour)

### `action <id>: failed bad_payload`

- **First seen:** 2026-11-07 (S3 code; not seen live, the dev run with the phone (stage 16) and the VPS deploy (stage 19) are open)
- **Source:** `apps/server/src/modules/actions/apply.ts` (`[actions]`, level `warn`).
- **Cause:** The payload of the action row is wrong (for example a missing folder key or UID). This is a bug in the code that planned the action, not a mailbox problem. The action is `failed` at once.
- **Fix:** Read the audit row `action.failed` and the `payload` of the action. File a bug with the action type. Never put the payload in the bug text if it holds mail data.
- **Status:** investigating

### `action <id>: failed hard_error`

- **First seen:** 2026-11-07 (S3 code; not seen live, the dev run with the phone (stage 16) and the VPS deploy (stage 19) are open)
- **Source:** `apps/server/src/modules/actions/apply.ts` (`[actions]`, level `warn`).
- **Cause:** The third hard error in a row for the same action. The action is `failed`, the audit row `action.failed` has `reason_code` `hard_error` and the error label. The user gets an `action_failed` notice.
- **Fix:** Read the audit data (`attempts`, `error`). Check the mailbox with `bun run mailbox:check`. The mail stays where it was; the user can move it by hand.
- **Status:** investigating

### `action <id>: failed mail_not_found`

- **First seen:** 2026-11-07 (S3 code; not seen live, the dev run with the phone (stage 16) and the VPS deploy (stage 19) are open)
- **Source:** `apps/server/src/modules/actions/apply.ts` (`[actions]`, level `warn`).
- **Cause:** The locate did not find the mail in its folder (the user moved or deleted it). The action is `failed` at once, without retries. An original action sends no notice; a reverse (Undo) action does.
- **Fix:** No action. The user changed the mailbox on their own. If it happens for mail that the user did not touch, check the identity locate (`locate.ts`) and the folder facts in `notes/2026-11-07-assist-actions-facts.md`.
- **Status:** won't fix (expected behaviour)

### `committer: ACTIONS_SCOPE=off, <n> mailbox actions wait in mailbox <id>`

- **First seen:** 2026-11-07 (S3 code; not seen live, the dev run with the phone (stage 16) and the VPS deploy (stage 19) are open)
- **Source:** `apps/server/src/modules/actions/committer.ts` (`[actions]`, level `info`; once per mailbox and process start).
- **Cause:** `ACTIONS_SCOPE` is `off` (the default), so the committer applies no mailbox change. <n> mailbox actions are `ready` and wait. The count has `move`, `mark_read` and `flag` actions, and since S4 (M10) also `create_draft` rows (drafts wait for the same scope). `save_summary` is not counted.
- **Fix:** No action if you want no changes. To apply them: set `ACTIONS_SCOPE=synthetic` or `all` in the `.env`, run `expire-ready` first when the rows are old (`deploy/README.md`, "Assist mode"), and restart the server.
- **Status:** won't fix (expected behaviour)

### `committer <mailboxId>: expired <n> stale actions`

- **First seen:** 2026-11-07 (S3 code; not seen live, the dev run with the phone (stage 16) and the VPS deploy (stage 19) are open)
- **Source:** `apps/server/src/modules/actions/committer.ts` (`[actions]`, level `warn`).
- **Cause:** The committer found <n> `ready` actions that waited longer than 24 hours (D21) and closed them as `expired`. This happens after the scope was `off`, the mailbox had an `auth_error` or the server was down.
- **Fix:** No action. The mail stays in INBOX. If it repeats, find why the committer did not apply the actions in time (scope, `auth_error`, a pause).
- **Status:** won't fix (expected behaviour)

### `callback failed: <label>`

- **First seen:** 2026-11-06 (S2 code; not seen live in the stage 21 dev run or the stage 23 pilot run, 2026-11-07)
- **Source:** `apps/server/src/modules/channels/telegram/bot.ts` (`[telegram]`, level `error`).
- **Cause:** The handler of a button tap threw an error (a database error or a bug). The label is `GrammyError <method> <code>`, `HttpError <method>` or the `describeError` text. The user sees "Something went wrong".
- **Fix:** Read the label. A database label: check the DB and the migration state. Repeat the tap. If it repeats, file a bug with the label (never with a message text).
- **Status:** investigating

### `digest for org <id> user <id> failed: <label>`

- **First seen:** 2026-11-06 (S2 code; not seen live in the stage 21 dev run or the stage 23 pilot run, 2026-11-07)
- **Source:** `apps/server/src/modules/channels/digest-job.ts` (`[channels]`, level `error`).
- **Cause:** Building or saving the digest of one member failed (for example a database error or a missing organization). The other members continue. The slot stays open, so the next minute tries again.
- **Fix:** Read the label. If it repeats every minute, check the DB and the member's `digest_times` (`bun run digest:times`). A late slot older than 6 hours is skipped.
- **Status:** investigating

### `notices for org <id> failed: <label>`

- **First seen:** 2026-11-06 (S2 code; not seen live in the stage 21 dev run or the stage 23 pilot run, 2026-11-07)
- **Source:** `apps/server/src/modules/channels/notices.ts` (`[channels]`, level `error`).
- **Cause:** Notice detection for one organization failed (database error or missing organization). The other organizations continue. The next tick (15 s) tries again.
- **Fix:** Read the label. If it repeats, check the DB and the organization row.
- **Status:** investigating

### `outbox <id>: lost the claim after the send`

- **First seen:** 2026-11-06 (S2 code; not seen live in the stage 21 dev run or the stage 23 pilot run, 2026-11-07)
- **Source:** `apps/server/src/modules/channels/sender.ts` (`[channels]`, level `warn`).
- **Cause:** The message was sent, but the row was no longer `sending` with the same lock when the sender marked it `sent`. Another run reclaimed the row (stale claim) or the row was deleted (cascade).
- **Fix:** Check the outbox row `<id>` and the other log lines for the same id. A duplicate message is possible (delivery is at least once). No action if it is rare.
- **Status:** won't fix (expected behaviour, rare)

### `outbox <id>: sent again after a stale send (a duplicate is possible)`

- **First seen:** 2026-11-06 (S2 code; not seen live in the stage 21 dev run or the stage 23 pilot run, 2026-11-07)
- **Source:** `apps/server/src/modules/channels/sender.ts` (`[channels]`, level `warn`).
- **Cause:** A row stayed `sending` for more than 5 minutes (the process died, or the DB commit after the send failed), so the next claim sends it again. The user can get the message twice.
- **Fix:** No action. If it repeats, look for crashes or DB errors around the first send of the row.
- **Status:** won't fix (expected behaviour)

### `outbox <id>: Telegram refused the message (<code>)`

- **First seen:** 2026-11-06 (S2 code; not seen live in the stage 21 dev run or the stage 23 pilot run, 2026-11-07)
- **Source:** `apps/server/src/modules/channels/sender.ts` (`[channels]`, level `error`). Code: `telegram_400`, `message_too_long` or `button_data_too_long`.
- **Cause:** Telegram or the adapter guard refused the text or the buttons (400). The row becomes `failed` / `bad_request` and is never sent again.
- **Fix:** Read the row (`text` length, `buttons`). A `message_too_long` or `button_data_too_long` code is a bug in the text builder: file it with the row id.
- **Status:** investigating

### `outbox <id>: the user blocked the bot (403)`

- **First seen:** 2026-11-06 (S2 code; not seen live in the stage 21 dev run or the stage 23 pilot run, 2026-11-07)
- **Source:** `apps/server/src/modules/channels/sender.ts` (`[channels]`, level `warn`).
- **Cause:** The member blocked the bot or deleted the chat. The row becomes `failed` / `blocked`.
- **Fix:** Ask the member to unblock the bot and send `/start`. If the chat is gone, make a new link (`bun run telegram:link`).
- **Status:** won't fix (expected behaviour)

### `outbox <id>: <code>; sending paused for <s> s` (also `outbox <id>: rate limited; sending paused for <s> s`)

- **First seen:** 2026-11-06 (S2 code; not seen live in the stage 21 dev run or the stage 23 pilot run, 2026-11-07)
- **Source:** `apps/server/src/modules/channels/sender.ts` (`[channels]`, level `warn`). The text `outbox <id>: rate limited; sending paused for <s> s` is the 429 case (waits `retry_after`). The codes `telegram_network` and `telegram_500` (and other 5xx) are soft errors (backoff 30 s doubling to 15 min).
- **Cause:** Telegram limited the bot (429) or was not reachable (network error, HTTP 5xx). The sender pauses and tries the same rows later. After 5 other errors a row becomes `failed` / `too_many_errors`.
- **Fix:** No action for short pauses. For a long one, check the network of the host and https://core.telegram.org reachability. Rows older than 24 hours become `failed` / `expired`.
- **Status:** won't fix (expected behaviour)

### `telegram token rejected (401): check TELEGRAM_BOT_TOKEN; sending paused for 10 min`

- **First seen:** 2026-11-06 (S2 code; not seen live in the stage 21 dev run or the stage 23 pilot run, 2026-11-07)
- **Source:** `apps/server/src/modules/channels/sender.ts` (`[channels]`, level `error`).
- **Cause:** Telegram answered 401 to a send: the token in `.env` is wrong, revoked or from another bot. The sender pauses for 10 minutes and tries again.
- **Fix:** Check the token with `bun run telegram:check`. Fix `TELEGRAM_BOT_TOKEN` in `.env` (the user edits it) and restart the server.
- **Status:** fix pending (user action when it fires)

### `telegram: setMyCommands failed: <label>`

- **First seen:** 2026-11-06 (S2 code; not seen live in the stage 21 dev run or the stage 23 pilot run, 2026-11-07)
- **Source:** `apps/server/src/modules/channels/telegram/polling.ts` (`[telegram]`, level `warn`).
- **Cause:** The server could not set the command list at the start (network error or Telegram error). Polling goes on; only the `/` menu in the app is missing or old.
- **Fix:** No action. The next start sets the list again. If it repeats with the label `GrammyError setMyCommands 401`, fix the token.
- **Status:** won't fix (expected behaviour)

### `telegram: polling failed: <label>; next try in <n> min`

- **First seen:** 2026-11-06 (S2 code; not seen live in the stage 21 dev run or the stage 23 pilot run, 2026-11-07)
- **Source:** `apps/server/src/modules/channels/telegram/polling.ts` (`[telegram]`, level `error`).
- **Cause:** `bot.start` failed with an error other than 401 or 409 (network down, Telegram 5xx). The server tries again after 1, 2, 4 … at most 30 minutes. The count resets after a good `getUpdates`.
- **Fix:** Check the network of the host. No action if the next try works. Mail sync and the DB are not affected.
- **Status:** won't fix (expected behaviour)

### `telegram: another process polls this bot token (409); dev and pilot must use different bots (ADR 0005); next try in <n> min`

- **First seen:** 2026-11-06 (S2 code; not seen live in the stage 21 dev run or the stage 23 pilot run, 2026-11-07)
- **Source:** `apps/server/src/modules/channels/telegram/polling.ts` (`[telegram]`, level `error`).
- **Cause:** Telegram allows one update consumer per token. A second process (for example the Mac with the pilot token, or a second server container) polls the same bot (409). The server tries again after 1, 2, 4 … at most 30 minutes.
- **Fix:** Find and stop the other process. Use the dev bot on the Mac and the pilot bot on the VPS. The server takes over by itself at the next try.
- **Status:** workaround (stop the other poller)

### `telegram: the bot token was rejected (401): check TELEGRAM_BOT_TOKEN; polling stopped`

- **First seen:** 2026-11-06 (S2 code; not seen live in the stage 21 dev run or the stage 23 pilot run, 2026-11-07)
- **Source:** `apps/server/src/modules/channels/telegram/polling.ts` (`[telegram]`, level `error`).
- **Cause:** Telegram answered 401 to `getMe` or `getUpdates`: the token is wrong, revoked or empty-looking. Polling stops and does not retry.
- **Fix:** Check the token with `bun run telegram:check`. Fix `TELEGRAM_BOT_TOKEN` in `.env` (the user edits it) and restart the server. Never print the token.
- **Status:** fix pending (user action when it fires)

### `[mailbox-audit] inbox=<n> stored=<m> missing=0 duplicates=<k> cross=<c>` (exit 2)

- **First seen:** 2026-11-05 (S1a 48-hour test, `~/ea-logs/audit.log` on the VPS)
- **Source:** `bun run mailbox:audit` (`apps/server/src/modules/mail/tools.ts`, `auditMailbox`).
- **Cause:** "duplicates" counts stored INBOX rows whose `(Message-ID, content hash)` key is not in the IMAP INBOX now. The sync never deletes rows, so a mail that the user deletes or moves out of INBOX after the sync stored it counts as a duplicate. On 2026-11-05 both rows were real mails deleted from the mailbox (not found in any folder).
- **Fix:** Check for a real double store first: `SELECT message_id_header, content_hash, count(*) FROM emails WHERE mailbox_id = '<MB>' AND folder = 'INBOX' AND received_at >= '<since>' GROUP BY 1, 2 HAVING count(*) > 1;`. 0 rows and `missing=0` = no problem. To name the rows, compare the `fetchSince` keys with `listFolderEmailKeys` in a one-off read-only script. Since the sort-folder sync the tool also prints one `folder=<key> …` line per enabled synced folder. A `cross` count is no problem: it counts mail that has a row in another synced folder (the mail is not lost; independent review m10, `tasks/active/sync-sort-folders.md`).
- **Status:** won't fix (audit limit; expected after a delete)

### `daily LLM cap reached for mailbox <mailboxId>: <cap> calls since <dayStart> (America/Los_Angeles day); mail waits until <time>`

- **First seen:** 2026-11-05
- **Source:** `apps/server/src/modules/triage/jobs.ts`, `[triage]` worker. One warning per mailbox and quota day, per process (a restart logs it again).
- **Cause:** The mailbox used `LLM_DAILY_CAP` LLM call attempts (`audit_log` event `llm.call`, failed calls too) since the start of the Pacific day.
- **Fix:** No action needed. The mail goes back to `pending` and waits until the next quota day. If it fires too early, check failed `llm.call` rows (503 retries count) and read `notes/2026-11-05-gemini-free-tier-triage.md`. Change `LLM_DAILY_CAP` only with the real RPD.
- **Status:** won't fix (expected behaviour)

### `LLM soft error <code>: triage paused for <n> min, until <time>`

- **First seen:** 2026-11-05
- **Source:** `apps/server/src/modules/triage/pause.ts` (`[triage]`). Codes: `http_429`, `http_500`, `http_502`, `http_503`, `http_504`, `timeout`, `network`.
- **Cause:** Google quota or overload, or no network connection to Google (code `network`: refused, reset or DNS failure). Not the mail. The LLM client of the process pauses with a backoff of 5 → 60 min, in memory.
- **Fix:** Wait. The mail goes back to `pending` with `next_attempt_at` = the pause end and no try count. A restart clears the pause. Often seen with `gemini-3.8-flash` (503) and on Flash-Lite at busy times (`notes/2026-11-05-gemini-free-tier-triage.md`).
- **Status:** workaround

### `LLM config error <code>: check GEMINI_API_KEY, GEMINI_MODEL_CLASSIFIER and the Google project (billing, region); triage paused for <n> min, until <time>`

- **First seen:** 2026-11-05
- **Source:** `apps/server/src/modules/triage/pause.ts` (`[triage]`). Codes: `http_401`, `http_402`, `http_403`, `http_404`, `http_400_key`, `http_400_precondition`.
- **Cause:** A bad or missing key, no access or billing, a wrong region, or an unknown model name. Retrying the mail does not help.
- **Fix:** Check `GEMINI_API_KEY`, `GEMINI_MODEL_CLASSIFIER` and the Google project. Then restart the server. The pause uses the same backoff as a soft error and the mail gets no try count.
- **Status:** investigating (per case)

### `triage <mailboxId>: no mailbox_settings row, mailbox skipped`

- **First seen:** 2026-11-05
- **Source:** `apps/server/src/modules/triage/jobs.ts`, `[triage]` worker. One warning per mailbox and process.
- **Cause:** The mailbox has no `mailbox_settings` row, so the worker has no mode, tool switches or category policy for it.
- **Fix:** Create the settings row for the mailbox (default settings). Restart to log the line again. The worker skips the mailbox until the row exists.
- **Status:** workaround

### `triage <mailboxId> failed: <Class> <code>`

- **First seen:** 2026-11-05
- **Source:** `apps/server/src/modules/triage/jobs.ts`, error handler of one mailbox. `<Class> <code>` comes from `describeError`: the class name, then the `code` if the error has one (no brackets), never the message text.
- **Cause:** An error outside the LLM call: thread read, save, DB or a bug. It stopped this mailbox for this run.
- **Fix:** The mail in work counts one try and waits 5 minutes. At 3 tries it ends as `unsure` / `triage_error`. Later claimed mail goes back with no count. Look at the class and code, then at the DB and server logs.
- **Status:** investigating (per case)

### `triage failed: <Class> <code>`

- **First seen:** 2026-11-05
- **Source:** `apps/server/src/modules/triage/jobs.ts`, outer handler of the run (for example the mailbox list failed).
- **Cause:** An error outside the per-mailbox handler, for example in `listSyncTargets` or the DB connection.
- **Fix:** The next run tries again. If it repeats, check the DB connection and the server log.
- **Status:** investigating (per case)

### `triage <emailId>: lost the claim`

- **First seen:** 2026-11-05
- **Source:** `apps/server/src/modules/triage/service.ts`, `[triage]`, on save of a triaged or skipped (`too_old`) mail. Warning.
- **Cause:** The `locked_at` of the mail changed during the work: a stale take-back by a later run (claim older than 5 min), or a slow LLM call. The save did nothing.
- **Fix:** No action. The run that holds the claim triages the mail. If it repeats often, check for two servers on one DB or very slow LLM calls.
- **Status:** won't fix (expected behaviour)

### `triage <mailboxId>: release failed: <Class> <code>`

- **First seen:** 2026-11-05
- **Source:** `apps/server/src/modules/triage/jobs.ts`, when it puts claimed mail back to `pending`.
- **Cause:** The DB update failed (connection or lock). The mail stays `processing` with its claim.
- **Fix:** The mail becomes claimable after 5 minutes (stale claim). That take-back counts one attempt. Check the DB.
- **Status:** investigating (per case)

### `triage <mailboxId>: triage_error save failed: <Class> <code>`

- **First seen:** 2026-11-05
- **Source:** `apps/server/src/modules/triage/jobs.ts`, when the third hard error should save `unsure` / `triage_error`.
- **Cause:** The DB write of the `triage_error` result failed.
- **Fix:** The code releases the mail with a 5-minute wait and a count. It tries again later. Check the DB.
- **Status:** investigating (per case)

### `triage <emailId>: llm.call audit write failed: <Class> <code>`

- **First seen:** 2026-11-05
- **Source:** `apps/server/src/modules/triage/service.ts`, after a failed LLM call. Warning.
- **Cause:** The `audit_log` row for the failed call could not be written. The error rules still run, but the call is missing from the daily cap count.
- **Fix:** Check the DB. The cap may count too few calls until it works.
- **Status:** investigating (per case)

### `Failed to copyto: failed to HEAD for download: Unknown 401`

- **First seen:** 2026-11-03
- **Source:** `deploy/backup.sh` on the VPS, `rclone copyto` to the B2 bucket.
- **Cause:** the B2 key can only write. Before the upload, rclone sends a HEAD request to check the target file, and B2 refuses it.
  The apt rclone (1.53) fails earlier; the VPS uses rclone 1.75.2 at `~/bin/rclone`.
- **Fix:** `rclone copyto --no-check-dest` in `deploy/backup.sh`. Cron `PATH` starts with `/home/serwer/bin` (`notes/2026-11-03-pilot-vps.md`).
- **Status:** fixed

### `sync <mailbox id> failed: invalid input syntax for type bigint: "NaN"`

- **First seen:** 2026-11-03
- **Source:** `[mail]` sync job, first sync of the Interia mailbox.
- **Cause:** Interia sends no `UIDNEXT` in the SELECT reply. The old `inboxStatus()` returned `NaN`, and the cursor update failed in Postgres. (Later finding, 2026-11-08: STATUS gives `UIDNEXT 1` for every folder, which is wrong too.)
- **Fix:** the status call (`folderStatus()` in `apps/server/src/modules/mail/imap/client.ts`; the sort-folder sync removed `inboxStatus`, `searchInboxSince` and `fetchByUids`) asks `STATUS (UIDNEXT)`, then uses the highest UID + 1, then 1. With STATUS at 1, the fix is D4 of `tasks/active/sync-sort-folders.md` (cursor from the highest UID + 1, per folder).
  A missing `UIDVALIDITY` now gives `IMAP INBOX gave no valid UIDVALIDITY`.
- **Status:** fixed

### `This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.`

- **First seen:** 2026-11-02
- **Source:** Gemini API, `cd backend && bun run gemini:test` (model `gemini-3.8-flash`, free tier). HTTP 503, status `UNAVAILABLE`.
- **Cause:** Google-side overload of the model. Not a key or config error (the key was accepted). One call hung for more than 90 s before the error.
- **Fix:** retry later. In the app: `platform/llm.ts` treats 503 as a soft error (wait with backoff, no count toward the 3 tries) and uses a 30 s timeout (ADR 0012). Optional fallback model in config.
- **Status:** workaround
- **Update 2026-11-05:** the script is now `apps/server/src/scripts/gemini-check.ts`. Run `bun run gemini:test` from the repo root. It prints `Request failed: LlmSoftError http_503` (no raw body). In the worker, a 503 pauses the LLM client 5 → 60 min (architecture §4.1 rule 7).
