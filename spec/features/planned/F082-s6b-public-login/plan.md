> **Status 2026-11-12 — planned.** The build starts after F077 stage 18 (the S6a VPS deploy). Left: the 15 stages, one Limen worker job each.

# S6b Login hardening: lockout, leaked-password check, terms, sessions, mail host check, auth-mail sender (off)

Ticket: [ticket.md](ticket.md). Master plan: `tasks/active/s6-pre-sale.md` (D7–D11, D31, P16–P24, "Rules for every step"). Old segment sketch: `tasks/planned/s6b-public-login.md` (history). Replaces `spec/features/planned/F056-web-public-hardening/` (stage 15 closes it). F059 (hashed reset tokens) landed on 2026-11-12 and is closed.

> **A gap is a stop.** If a stage file does not answer a question, the worker does not choose. It writes the question in its final message, and the coordinator decides from this file ("Input", B1–B7, L1–L32, the master plan D7–D11, D31) or asks the owner. A deviation is a question, not a choice.

## Planning progress

The resumed session reads this file, then continues at the first unticked item.

- [x] Collect (2026-11-12): handoff `~/.pi/agent/notes/2026-11-12-handoff-s6b-stage-plan.md`, master plan, old S6b file, F056, F059, F077 plan and stages 10 and 18, `notes/2026-11-12-s6a-customer-core.md`, F078, F081, `spec/build.md`, `spec/vision.md`, the styleguide, `docs/code-patterns.md`, `docs/architecture.md` §7, ADR 0016, `deploy/README.md`, and the code (`platform/{auth,http,config}.ts`, `web.ts`, `main.ts`, `modules/channels/operator.ts`, `modules/tenancy/{repo,service,routes}.ts`, `modules/mail/{host-check,connect-request,open,check,routes}.ts`, `modules/mail/imap/{client,smtp}.ts`, `scripts/{web-invite,org-create,e2e-seed}.ts`, the web islands `SetupPage`, `LoginPage`, `AccountCard`, `AppShell`, the e2e env and seed, the migrations).
- [x] Ticket created (`limen ticket new`, F082; folder renamed to `F082-s6b-public-login`).
- [x] Facts checked (probes in `/tmp/s6b-probe`).
- [x] Questions Q1–Q7 sent; the owner answered "Okay, approve the defaults." (B1–B7).
- [x] Decisions L1–L32.
- [x] Stage files written (15).
- [x] Committed (explicit paths).
- [ ] Cold review (Limen scout job), filed as `plan-review-1.md`, findings fixed.
- [ ] End summary; the owner's OK.

## Input

The owner's words (word for word):

- 2026-11-12 (handoff): "Looks like you can prepare an implementation plan for this public login. Prepare a handoff for it. The goal is to create a detailed plan with tasks that will be picked by the layman."
- 2026-11-12 (handoff): "there is another one that requires a technical detailed plan, implementation plan." — this is S6b.
- 2026-11-12 (this session): "Read /home/artek/.pi/agent/notes/2026-11-12-handoff-s6b-stage-plan.md and follow its "Start here" section. It looks like this is an implementation plan that we have to prepare. And tell me if there is anything more about it. For example, we will perhaps need another session for review of it, of this plan. But looks like that's all that is required here?"
- 2026-11-12 (this session, mid-turn): "Okay, I modified the skills and sub-agents and so on, so ensure you get or read the new skill for planning session. then follow its rules if that changes anything."
- 2026-11-12 (this session, answer to Q1–Q7): "Okay, approve the defaults."
- Scope change (master plan, P18): "S6b keeps the hardening (lockout, leaked-password check, hashed reset tokens, session list, terms acceptance, the mail host check); no public domain. The SMTP auth-mail sender is built with its env keys and tests, but stays off: the CLI prints the invite and reset links, as in S5."

### Owner decisions (2026-11-12, "approve the defaults")

- **B1 Mail language.** A user without `users.locale` gets Polish mails. `org:invite --lang` defaults to `pl`. Why: the product targets Polish users; the server cannot see the browser language.
- **B2 Mail texts.** The plan writes the three mails (invite, reset, lockout) in Polish and English (stage 2). Sender name "Email Assistant".
- **B3 Session list.** One row per session, a "This device" mark, no button that ends one session. "Sign out everywhere" stays.
- **B4 Lockout mail** goes only to the locked user.
- **B5 Terms checkbox** on every password set: the invite link and the reset link open the same `/setup` page.
- **B6 Lane and stops.** The plan stays in `planned/`; the build starts after F077 stage 18. Checkpoint A (review) after the server stages 1–9; checkpoint B (review, VPS deploy with the owner's go) at stage 15.
- **B7 Publish.** The plan is committed on `master`; the owner's auto-push hook publishes it. It holds no secret.

## Differences found at collect (2026-11-12)

1. The handoff says S6a stage 11 runs and stages 12–18 are left. `master` has stages 1–17 landed (`117e268`). Only F077 stage 18 (group review, VPS deploy, owner) is left. The stage files cite the real code.
2. F080 landed after the handoff. No effect on S6b.
3. F059 landed and is closed: `verification.storeIdentifier: "hashed"` is in `platform/auth.ts`, test in `web-auth.test.ts`. The old sketch's stage 5 keeps only the leaked-password check; the "hashed tokens" done-when line is proven by F059's test (stage 15 runs it again).
4. `master` moved during the session to `60014d1` (Limen transition; the old `run-task` flow is removed; an auto-push hook on `master`).
5. `nodemailer` is already a dependency; the leaked-password check uses `fetch` (L14). No S6b stage changes `bun.lock`.
6. `docs/code-patterns.md` says "Only `mail/imap/` imports … `nodemailer`" and lists the repository functions without a `TenantContext`. Stages 1, 2 and 5 amend these lines.
7. `spec/vision.md` "Current direction" still names hosted EU production and Vertex AI (before the scope change). Not this plan's file; noted for the owner.
8. `notes/decision-docs/` (untracked) holds one HTML file from 2026-11-09. Not related.
9. The S6 master plan's review model says "stronger reviewer (Opus, high)" for S6b; the board's standing reviewer is Sonnet. This plan keeps the master plan's choice for the review jobs of the `[risky]` stages ("Review").

## Facts checked (2026-11-12; Better Auth 1.7.18, imapflow 1.7.8, nodemailer 10.3.1 from `node_modules`; probes in `/tmp/s6b-probe` with the memory adapter)

- **F1 Sign-in answers.** A wrong password, an unknown address and an error thrown from `hooks.before` with `APIError.from("UNAUTHORIZED", { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" })` give the same answer: `401 {"message":"Invalid email or password","code":"INVALID_EMAIL_OR_PASSWORD"}`, no cookie. Times in the probe: 53, 48 and 46 ms (the locked case called `ctx.context.password.hash(password)` first). An unknown address hashes the password (`api/routes/sign-in.mjs`), so its time matches a wrong password.
- **F2 Hooks.** `hooks.before` (`createAuthMiddleware` from `better-auth/api`) gets `ctx.path` and the parsed `ctx.body` (on `/reset-password` also extra fields such as `termsVersion`; the endpoint's Zod schema strips them later). `hooks.after` gets `ctx.context.returned`: the `APIError` (with `statusCode` and `body.code`) of a failed call, or the result of a successful one; on a successful sign-in `ctx.context.newSession.user.id` is set. An error thrown in `hooks.before` skips the endpoint and `hooks.after`. A value returned from `hooks.before` (`return ctx.json({...})`) becomes the answer (status 200) and skips the endpoint. `ctx.context.internalAdapter.findUserByEmail(email)` works in a hook.
- **F3 Reset request.** `/request-password-reset` answers `200 {"status":true,"message":"If this email exists in our system, check your email for the reset link"}` for a known and an unknown address; for an unknown one it writes no row and sends nothing. It awaits `sendResetPassword` (probe: 1 504 ms with a 1.5 s send). A rejected send is logged by Better Auth with the error text, and the probe's error text held the reset URL: our send function never rejects (L8). This route does not lower-case the address (sign-in does); `users.email` is lower-case (`users_email_lower_check`).
- **F4 Reset expiry is global**: `emailAndPassword.resetPasswordTokenExpiresIn` (default 3 600 s), no per-call value (`api/routes/password.mjs:73`).
- **F5 `/reset-password`.** Order: token check → length check → `ctx.context.password.hash(newPassword)` → write → `onPasswordReset({ user })`. Inside `onPasswordReset`, `getCurrentAuthEndpointContext()` has `path` but no `body`. A `hooks.before` error (probe: `TERMS_REQUIRED`, 400) stops the request before anything is written.
- **F6 Sessions.** `/list-sessions` answers `403 SESSION_NOT_FRESH` when the session is older than `session.freshAge` (default 1 day), and it returns each session's `token`. `ctx.context.internalAdapter.listSessions(userId)` reads the sessions without that check (`db/internal-adapter.mjs:190`). `/revoke-sessions` and `/revoke-other-sessions` run `hooks.after` with `ctx.context.session.user.id` set (probe).
- **F7 Leaked-password plugin.** `plugins/haveibeenpwned` uses `betterFetch` with no timeout and no way to inject `fetch`. The real range API (2026-11-12, header `Add-Padding: true`): `200`, about 79 kB of lines `SUFFIX:COUNT` (35 hex, upper-case, CRLF); padding lines have count `0`. `password1234` (SHA-1 `E6B6A…`) is listed (count 443 397); `correct-horse-battery-staple` (SHA-1 `DD606…`) is not listed.
- **F8 IMAP connect.** imapflow passes `{ host, servername, port, ...options.tls }` to `net.connect` / `tls.connect`; the option `servername` sets the TLS name; without it the name is `host` when `host` is not an IP literal (`lib/imap-flow.js:455`, `:2366`).
- **F9 SMTP connect.** nodemailer resolves a host name itself (`shared/index.js` `resolveHostname`, a process-wide cache) and skips that for an IP literal. The option `servername` sets the TLS name (`smtp-connection/index.js:138`, `:280`). nodemailer has no `lookup` option, so the only way to control the address is to pass an IP.
- **F10 Repo.** `request-password-reset` is not in `AUTH_ALLOWED_PATHS` (404, the S5 block). `PUBLIC_PAGE_PATHS` holds `/login`, `/setup`, `/404.html`, assets. `host-check.ts` lacks `100.64.0.0/10`, `198.18.0.0/15`, `192.0.0.0/24`; only the web connect form calls `isLocalMailHost`. Every IMAP connect goes through `connectImapClient`; every SMTP connect builds its options with `smtpTransportOptions` (`verifySmtpLogin`, `sendProbeToSelf`, `openSmtpSender`, `imap/probe-send.ts`). `createOperatorNotices` is built in `main.ts` before `webDeps`. GreenMail gives plain SMTP on `127.0.0.1:3025` and IMAP on `3143`. Callers of `resetPassword`: `scripts/e2e-seed.ts`, `platform/auth.test.ts`, `web-auth.test.ts`, `web-auth-logs.test.ts`, `web-invite-cli.test.ts`, `web-schema.test.ts`, `web-http.test.ts`, `islands/SetupPage.tsx`. Scripts that open mail connections and call `loadConfig`: `job-run`, `mailbox-audit`, `mailbox-backfill`, `mailbox-check`, `mailbox-connect`, `mailbox-password`, `mailbox-probe-move`, `mailbox-probe-send`, `mailbox-rescan`, `mailbox-seed`, `mailbox-settings`, `testmail-target`, and `main.ts`.

## Not verified (the stage that checks it)

- A TLS connect to a pinned IP with `servername` against a real public server (Interia): stages 8–9 test the built options only. Checked at stage 15.3: the pilot mailbox syncs after the deploy, and `mailbox:check` passes.
- Better Auth's log level for an `APIError` thrown in `hooks.before` (the probe's default logger printed `ERROR terms required`): stages 5–7 assert that no log line holds a password, a token or a link.

## Design decisions (L1–L32; why in each)

**Data (stage 1)**

- **L1 Migration `<YYYYMMDD>100001_auth_public.sql`** (the build day; the name must sort after the newest file in `db/migrations/`). `users`: `locale text CHECK (locale IN ('pl','en'))`, `terms_version text`, `terms_accepted_at timestamptz`, check `users_terms_pair_check CHECK ((terms_version IS NULL) = (terms_accepted_at IS NULL))`. New table `auth_lockouts` (L11). No `org_id`: lockout rows belong to a user and go by cascade with the user (S6c D13). Exact SQL in stage 1. Why: D10, D11, D12.
- **L2 Tenancy reads and writes of the new user columns** (user-scoped, no `TenantContext`, listed in `docs/code-patterns.md`): `getUserAuthProfile(db, userId)`, `setUserTerms(db, userId, version, at)`, `insertUser` with an optional `locale`. `createOrganizationWithOwner` takes an optional `locale`. Why: one owner of `users` (tenancy).

**Auth mail (stages 2–4)**

- **L3 Config.** Keys `AUTH_SMTP_HOST`, `AUTH_SMTP_PORT` (default 465), `AUTH_SMTP_SECURITY` (`tls` default, or `starttls`), `AUTH_SMTP_USER`, `AUTH_SMTP_PASSWORD`, `AUTH_MAIL_FROM`. Host, user, password and from: all four set or none (config error otherwise). `authMailSettings(config)` returns the settings or `null` (sender off). Why: D7; F049 added STARTTLS for mailboxes, the same two modes here.
- **L4 Sender in `platform/auth-mail.ts`.** It imports `nodemailer` (amend `docs/code-patterns.md`: "and `platform/auth-mail.ts`, the auth-mail sender"). Certificates are always checked (no `tls.rejectUnauthorized`). A loopback host (`127.0.0.1`, `localhost`, `::1`) connects without TLS (tests, GreenMail); any other host needs TLS (implicit or STARTTLS with `requireTLS`). Timeouts: nodemailer `connectionTimeout`, `greetingTimeout`, `socketTimeout` 15 000 ms, and an outer 15 000 ms race. `send(mail)` returns `{ ok: true } | { ok: false; code: string }` and never rejects. No outbox row (the link is a secret). Why: D7; `platform` may not import `modules/mail`.
- **L5 Texts** in `platform/auth-mail-texts.ts`, Polish and English, exact text in stage 2. Plain text only (no HTML, so no tracking pixel). The link appears once. From: `"Email Assistant" <AUTH_MAIL_FROM>`. Why: B2, D7.
- **L6 Error code of a failed send:** the nodemailer `code` when it matches `^[A-Z][A-Z_]{1,19}$`, `TIMEOUT` for the outer race, else `UNKNOWN`. A failed send logs `warn` `auth mail <kind> to user <userId> failed: <code>`. Never the address, the link or the error text. Why: D7, rules.
- **L7 Operator event (D31).** `OperatorNoticeKind` gets `auth_mail_failed`; `OperatorNotices.authMailFailed(ctx, userId, kind, code, now)`: never throws, never blocks. Key `auth_mail_failed:<userId>:<code>:<YYYY-MM-DD UTC>`. Text `Auth mail <kind> to user <userId> of org <orgId> failed (<code>).` The organization is the user's oldest membership (`listMembershipsOfUser`); no membership → only the `warn` line. Why: D31 (one notice per user, code and day).
- **L8 The server never waits for the mail.** The server's `sendResetPassword` starts the send in a tracked background set (`createAuthMailTasks`) and returns at once; the task reads the locale, sends, and on failure logs and calls the operator event. It never rejects (F3). Rejected: `advanced.backgroundTasks.handler` (it changes every Better Auth background task, and its error log can hold the URL). Why: D8.
- **L9 Reset request open only with the sender on.** `isAllowedAuthPath(method, path, { resetRequest })`: `/request-password-reset` (POST) passes only when `resetRequest` is true. `WebDeps.resetRequestOpen` (absent = false). `web.ts` sets it to `authMailSettings(config) !== null`. Without the sender: 404 as in S5. Why: D7, P18.
- **L10 Reset request limits and answer.** Better Auth `customRules["/request-password-reset"] = { window: 900, max: 3 }` (per client address). Per address: an in-memory map in `createBetterAuth`, key = trimmed lower-case address, at most 3 requests in a sliding hour; the 4th returns the same 200 body from `hooks.before` (`RESET_REQUEST_ANSWER`, F2, F3) and sends nothing. The map is per process (one server). Link expiry: `AuthDeps.resetLinkTtlSeconds` (required): 3 600 in the server, 86 400 in the CLIs and the e2e seed. The `/forgot` form lower-cases the address. Why: D8, F3, F4.

**Lockout (stage 5)**

- **L11 Store `auth_lockouts`**: `user_id uuid PRIMARY KEY REFERENCES users ON DELETE CASCADE`, `window_started_at timestamptz NOT NULL`, `failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0)`, `locked_until timestamptz`, `mail_day date`, `mail_count integer NOT NULL DEFAULT 0 CHECK (mail_count >= 0)`, `updated_at timestamptz NOT NULL DEFAULT now()`. Functions in `platform/auth-lockout.ts` (user-scoped; amend `docs/code-patterns.md`). Why: D11; the table belongs to the auth platform code.
- **L12 Rule.** Fixed window: the first failure starts a 15-minute window; the 10th failure inside it sets `locked_until = now + 15 min` and starts a new window at `now`. Failures during a lock are not counted (the request never reaches the endpoint, F2). A successful sign-in sets `failed_count = 0`. A successful password reset sets `failed_count = 0, locked_until = NULL`. Each step is one SQL statement (exact SQL in stage 5); the lock itself is a conditional update, so two parallel 10th failures lock once. Rejected: a sliding log of failure times (more rows, same protection for this use). Why: D11.
- **L13 Same answer and time.** `hooks.before` on `/sign-in/email`: `findUserByEmail(lower(email))`; if the user is locked, `await ctx.context.password.hash(password)` and throw the exact 401 of F1. Every sign-in does the same user lookup and lock read, so the extra time is equal for all. `hooks.after`: a 401 `INVALID_EMAIL_OR_PASSWORD` for a known user counts a failure; a success clears the count. When a failure locks the user: audit `web.login_locked` (data `{ via: "web", locked_until }`), and a lockout mail when the sender is on and the user had fewer than 3 lockout mails this UTC day (conditional update). The clock is `AuthDeps.now` (tests pass a fixed one). Why: D11, F1.

**Leaked passwords (stage 6)**

- **L14 Own check, not the plugin.** `platform/pwned.ts` `checkPwnedPassword(password, { fetch, timeoutMs })` → `"ok" | "pwned" | "unavailable"`: SHA-1 (`node:crypto`), `GET https://api.pwnedpasswords.com/range/<5 hex>` with `Add-Padding: true`, `User-Agent: email-assistant`, `AbortSignal.timeout(timeoutMs)`; a line with the suffix and a count above 0 = `pwned`; any other status, a timeout or an error = `unavailable`. Called from `hooks.before` on `/reset-password` and `/change-password` with `body.newPassword`, only when its length is 12–128 (Better Auth refuses the rest). `pwned` → `400 PASSWORD_COMPROMISED`; `unavailable` → `503 PASSWORD_CHECK_UNAVAILABLE`, nothing changes (fail closed). Timeout 5 000 ms. Config `AUTH_PWNED_CHECK` `on` (default) or `off`; `off` logs a `warn` at start; the e2e server sets `off`. `AuthDeps.pwnedCheck` absent = off (unit and integration tests, CLIs). Why: D11 (fail closed); F7 (the plugin has no timeout and no injectable `fetch`).

**Terms (stages 7, 11, 12)**

- **L15 `TERMS_VERSION`** = `"2026-11-12"` in `packages/core/src/web/terms.ts` (S6e changes it with each text change). Why: D10, D18.
- **L16 One request sets the password and the terms.** `hooks.before` on `/reset-password` refuses `400 TERMS_REQUIRED` unless `body.termsVersion === TERMS_VERSION` (checked before L14, so no outside call without the terms). `onPasswordReset` calls `AuthDeps.onTermsAccepted(userId, TERMS_VERSION)` (required; never throws): `setUserTerms` and audit `web.terms_accepted` (`{ via: "web", version }`) in the oldest organization. Every reset needs the terms (B5); the e2e seed and the tests send `termsVersion`. A crash between the password write and the terms write leaves old terms: the dialog (L17) asks again. Why: D10, F5.
- **L17 Blocking dialog.** `/api/me` gets `terms: { accepted: boolean; current: string }` (`accepted` = `users.terms_version === TERMS_VERSION`). `POST /api/me/terms` with `{ version }`: another version → `409 terms_outdated`; else `setUserTerms` and the same audit row; `204`. It is in `SUSPENDED_WRITE_ALLOW`. The shell shows a dialog without a close button until the user accepts. Why: D10.
- **L18 Legal stub pages** `/legal/{pl,en}/{privacy,terms,dpa}` (one Astro page with `getStaticPaths`), text "Draft. The text follows." (keys in `en.ts`; S6c translates, S6e fills). In `PUBLIC_PAGE_PATHS`. The setup checkbox links the three pages in the browser language (`navigator.language` starts with `pl` → `pl`, else `en`). The checkbox is a native `<input type="checkbox">` with Tailwind classes (no new shadcn component, no dependency change). Why: D10, finding 10.

**Invite (stage 4)**

- **L19 One helper for both CLIs**: `scripts/invite-delivery.ts` `deliverInvite(input)`: it builds a `createAuth` with `resetLinkTtlSeconds: 86_400`, requests the link (`redirectTo: <base>/setup`), then mails it (sender on and no `--print`) or prints it to stdout (as `web:invite` today). Mail failure → exit 1 with `invite mail failed (<code>): run bun run web:invite --org-id <orgId> --user-id <userId> to send the link again`. Why: D9.
- **L20 `org:invite --org-name <name> --email <email> --display-name <name> [--lang pl|en] [--timezone <tz>] [--trial-days N] [--print]`**: `createOrganizationWithOwner` with `plan: { kind: "trial", endsAt: now + N days }` (default 30, 1–365) and `locale` (default `pl`, B1), then `deliverInvite`. An existing address: exit 1 `user with this email already exists`, nothing is created (the transaction rolls back). `web:invite` gets `--print`. Why: D9, A7 of S6a.

**Sessions (stage 13)**

- **L21 Own route.** `GET /api/me/sessions` (any member) returns `{ sessions: [{ id, current, device, address, lastUsedAt, createdAt }] }`, newest `lastUsedAt` first, only sessions with `expiresAt > now`, never the token. `platform/auth.ts` exports `listUserSessions(handle, userId)` through `internalAdapter.listSessions` (F6; the Better Auth rule of `docs/code-patterns.md` holds). `WebSession` gets `sessionId`. `device` = `deviceLabel(userAgent)` in `packages/core` ("Firefox on Linux"; unknown parts → "Unknown browser", "unknown system"). `lastUsedAt` = `updatedAt` (it moves once a day, `updateAge`); the card shows the date only. Why: B3, F6.
- **L22 Audit of "sign out everywhere".** `hooks.after` on `/revoke-sessions` → `web.sessions_revoked`, on `/revoke-other-sessions` → `web.other_sessions_revoked` (`{ via: "web" }`), only when the call succeeded. Why: D11, B13 of S5c.

**Mail host check (stages 8–9)**

- **L23 Ranges.** `host-check.ts` adds `100.64.0.0/10`, `198.18.0.0/15`, `192.0.0.0/24` and exports `isLocalAddress(ip)` (IPv4 or IPv6 literal). Why: finding 11.
- **L24 Resolve once, connect to the checked address.** `mail/host-guard.ts` `resolveMailHost(host, policy)` → `{ host, servername? }`: `allowLocal` → `{ host }` unchanged; an IP literal → refused when local; a name → refused when `isLocalMailHost`; else `lookup(host)` (all addresses); any local address → refused (`HostNotAllowedError`); else `{ host: <first address>, servername: <name> }`. A lookup error → `SoftError` `mail host lookup failed (<code>)`. IMAP connects to that address with `servername` (F8); SMTP the same (F9). So a DNS change after the connect form (rebinding) is caught at the next sync or send, and no second lookup happens between check and connect. Why: D11, F8, F9.
- **L25 Every connect goes through the check.** `imapFlowOptions(opts, target)` and the renamed `buildSmtpTransportOptions(opts, target)` take a required `target: MailTarget`, so the typecheck finds every caller; `connectImapClient` and the new async `smtpConnectOptions(opts)` resolve first. Why: D11 ("every IMAP and SMTP connect").
- **L26 One process-wide policy, fail closed.** `configureMailHosts({ allowLocal, lookup? })` sets it; before any call the policy refuses local hosts. `main.ts` and every script of F10 call it after `loadConfig`; a unit test checks those files. The test runs set `allowLocal: true` in a preload (`bunfig.toml` `[test] preload`), because GreenMail runs on `127.0.0.1`; the guard's own tests pass an explicit policy. Rejected: a policy field on every connect option (about 40 call sites and test builders). Why: D11.
- **L27 One config key.** `MAIL_ALLOW_LOCAL_HOSTS` (`true` / `false`, default `false`) for the form and every connect. `WEB_MAIL_ALLOW_LOCAL` stays an accepted old name: `mailAllowLocal(config)` = `MAIL_ALLOW_LOCAL_HOSTS ?? WEB_MAIL_ALLOW_LOCAL ?? "false"`; with only the old key, the server logs `warn` `WEB_MAIL_ALLOW_LOCAL is an old name: use MAIL_ALLOW_LOCAL_HOSTS`. Why: dev and the VPS keep working with no `.env` change.

**Web (stages 10–13)**

- **L28 `/forgot`.** Public page: e-mail field, send button. 200 → the same text for every address ("If this address has an account, a link is on its way. It works for 1 hour."). 404 → "Reset by e-mail is off. Ask the operator for a new link." 429 → `error_too_many`. The login page links to it. Why: D8, finding 10.
- **L29 Password-set request.** `apps/web/src/lib/auth-requests.ts` `setPasswordWithTerms({ token, newPassword })` posts `fetch("/api/auth/reset-password", …)` with `termsVersion: TERMS_VERSION` and returns `{ ok: true } | { ok: false; status; code }`. `SetupPage` uses it from stage 7. Why: the Better Auth client types have no `termsVersion`.
- **L30 Error texts.** `PASSWORD_COMPROMISED` → field text `password_pwned`; `PASSWORD_CHECK_UNAVAILABLE` (503) → `password_check_unavailable`; `TERMS_REQUIRED` → `terms_required`; in `SetupPage` and `AccountCard` (`lib/password-errors.ts`).

**Docs and close (stages 14–15)**

- **L31 Docs.** `docs/architecture.md` §7, `deploy/README.md`, ADR 0016 amendment (D7, D8), `docs/roadmap.md` state line, a note. Why: the master plan's done-when.
- **L32 Close.** Stage 15 closes F056 with an `outcome.md` and moves the old `tasks/planned/s6b-public-login.md` to `tasks/done/`. F082 closes with `limen ticket done F082`. Why: the handoff, CLAUDE.md § Work.

## Done when

Every line maps to a stage test or check (stage in brackets).

- With the `AUTH_SMTP_*` keys set, `org:invite` makes the organization and the owner and mails the setup link (GreenMail) [4]; without the keys the server starts, `request-password-reset` answers 404, and `org:invite` and `web:invite` print the link [3, 4].
- `/forgot` opens without a session (Playwright) [10]. `POST /api/auth/request-password-reset` gives the same status and body for a known and an unknown address [3]; the request returns before a slow send ends (fake sender that waits 3 s; the answer comes in under 1 s) [3]; the per-address and per-client limits hold [3]; a server reset link expires after 1 h and a CLI link after 24 h [3, 4].
- A failed auth mail is one `warn` line with the user id and the code, and one operator notice per user, code and day [2, 3].
- 10 failed sign-ins in 15 min lock the user for 15 min; the answer equals a wrong password and its time is within 0.5×–2× of it; one lockout mail per lock, at most 3 per user per day; a correct password during the lock fails; after 15 min it works; a password reset clears the lock (fixed clock) [5].
- A leaked password is refused on setup, reset and change (fake range API); the API down or slow → 503 "try again later" and no change [6].
- The Account card lists the sessions (device, address, last use, "This device"); "sign out everywhere" writes `web.sessions_revoked` [13].
- `host-check.ts` refuses `100.64.0.0/10`, `198.18.0.0/15`, `192.0.0.0/24` [8]; every IMAP and SMTP connect resolves once through the checked lookup, so a name that resolves to a local address later is refused at the next sync (fake resolver) [8, 9].
- Reset tokens are stored hashed: F059's test `web-auth.test.ts` still passes [15 runs it].
- `/setup` needs the terms checkbox; one request sets the password and `users.terms_version` / `terms_accepted_at`; a request without the terms changes nothing [7, 11]; an old `terms_version` shows the blocking dialog after sign-in (Playwright) [12]. `TERMS_VERSION` is in `packages/core`; `/legal/{pl,en}/{privacy,terms,dpa}` open without a session [11].
- `docs/architecture.md` §7 lists the controls; `deploy/README.md` lists the new keys (empty on the VPS) and what a real sender needs (SPF, DKIM, DMARC, tracking off); ADR 0016 has the amendment [14].
- On the VPS (owner's go): `org:invite` prints a link, setup with the checkbox works, 10 wrong passwords lock the test user, `password1234` is refused, the pilot mailbox still syncs [15].

## Rules for every stage

- Read `CLAUDE.md`, `.agents/limen/styleguide.md`, `docs/code-patterns.md`, the ticket, this file and your stage file first. Build only your stage.
- Format only the files of your stage: `bunx prettier --write <files>`. Never the whole repo (S2 incident).
- No secret, password, token, reset or setup link, mailbox address, user e-mail address or mail text in a log line, an error text, an audit row, an operator notice or a test snapshot. Logs hold ids, codes, counts and times; errors go through `describeError`. Tests that touch auth capture the log (`spyOn` on the logger, as `web-auth-logs.test.ts` does) and assert that no line holds the test password, the token or `reset-password/`.
- The repo is public: no tailnet name, IP of the VPS, real name or address in a file. Test addresses end in `@x.test`.
- Template literals for strings with variables; `const` / `let` only.
- A test with a time passes a fixed `now` (`AuthDeps.now`, `deps.now`), never `Date.now()` in an assertion.
- A stage that changes a type or a required field fixes every caller and test in the same stage, so all checks pass at its commit.
- Stage files by explicit path (`git add <paths>`), never `git add -A`.
- Only stage 1 adds a migration. No stage changes `bun.lock` or `package.json` dependencies. If you think you need one, stop and ask.
- Playwright (stages 9–13): this machine has no Playwright browser; run `CHROMIUM_PATH=/usr/bin/chromium bun run test:e2e -- <spec>`. Before the first e2e run, give the job its own e2e database: first remove the copied lines with `sed -i -E '/^E2E_(MIGRATOR_)?DATABASE_URL=/d' .env`, then `bun run db:worktree f082_sNN_e2e | grep -E '^(DATABASE_URL|MIGRATOR_DATABASE_URL)=' | sed 's/^/E2E_/' >> .env` (NN = your stage; the name must end in `_e2e`). Never point e2e at the shared `email_assistant_e2e`.
- A gap or a deviation is a question in your final message, not a choice.

## Proof

Run after the last commit, as one bash call with nothing after it; read the logs in a separate call. In the final message list as proven only what a saved log shows.

Server stages (1–9, 14):

```
mkdir -p /tmp/f082-sNN && bun run lint > /tmp/f082-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f082-sNN/typecheck.log 2>&1 && bun run test:unit > /tmp/f082-sNN/unit.log 2>&1 && bun run test:int > /tmp/f082-sNN/int.log 2>&1 && echo PROOF_OK
```

Web stages (10–13) add the build and the stage's Playwright specs (named in the stage file) to the same chain:

```
mkdir -p /tmp/f082-sNN && bun run lint > /tmp/f082-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f082-sNN/typecheck.log 2>&1 && bun run test:unit > /tmp/f082-sNN/unit.log 2>&1 && bun run test:int > /tmp/f082-sNN/int.log 2>&1 && bun run web:build > /tmp/f082-sNN/build.log 2>&1 && CHROMIUM_PATH=/usr/bin/chromium bun run test:e2e -- <specs> > /tmp/f082-sNN/e2e.log 2>&1 && echo PROOF_OK
```

## User checkpoints

- **Checkpoint A (after stage 9 lands):** the coordinator stops. A review job (Opus, high) reads the commit range of stages 1–9 with this pre-mortem: "a person on the tailnet learned whether an address has an account, signed in during a lock, set a leaked password, got a reset link from a log, or made the server connect to a local address: which stage let it through?". Findings become `limen continue` jobs or new stages. The owner says go before stage 10.
- **Checkpoint B (stage 15):** the review of stages 10–14 and the whole segment, the VPS deploy and the VPS checks. Each VPS action needs the owner's fresh yes.

## User steps

| #      | Step                                                                                                                                                                                     | When                |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| S6b-U1 | Run `bun run db:migrate` on the shared dev database (main checkout, no `test:int` running).                                                                                              | after stage 1 lands |
| S6b-U2 | If the dev server syncs GreenMail mailboxes: keep `WEB_MAIL_ALLOW_LOCAL=true` or add `MAIL_ALLOW_LOCAL_HOSTS=true` in the dev `.env` (never on the VPS). The agent does not read `.env`. | after stage 9 lands |
| S6b-U3 | Say go at checkpoint A.                                                                                                                                                                  | after stage 9       |
| S6b-U4 | Say go for each VPS action of stage 15 (backup, deploy, test organization, lock test).                                                                                                   | stage 15            |
| S6b-U5 | At the first panel sign-in after the deploy, accept the terms in the dialog (pilot owner).                                                                                               | stage 15            |

## Review

- A review job before the land for every `[risky]` stage: 1, 3, 4, 5, 6, 7, 8, 9, and stage 13 (audit rows of the session routes). Model: Opus, high (master plan "Review model"; difference 9). Other stages land on the worker's proof.
- Review spawn (after the worker job is done; `<B>` = the job's branch):

```
limen spawn --engine pi --provider claude-bridge --model claude-opus-5-5 --thinking high \
  --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
  --review --detached --branch <B> --label "review s<NN> · F082" \
  "Review F082 stage NN on <B> against spec/features/active/F082-s6b-public-login/plan.md and stages/stage-NN-<slug>.md. Check every numbered test exists and asserts what the stage says, the log and secret rules, the same-answer rules, and every decision the stage cites. Quote file and line for each finding."
```

## Stages

`[risky]` = one step per stage.

- [ ] Stage 1 — Migration `auth_public`, `db:types`, tenancy user columns `[risky]` — [`stage-01-migration.md`](stages/stage-01-migration.md)
- [ ] Stage 2 — Auth-mail config, sender, texts, operator event `auth_mail_failed` — [`stage-02-auth-mail.md`](stages/stage-02-auth-mail.md)
- [ ] Stage 3 — Reset request: open with the sender, same answer, limits, not awaited, 1 h `[risky]` — [`stage-03-reset-request.md`](stages/stage-03-reset-request.md)
- [ ] Stage 4 — `org:invite`, `web:invite` mails or prints, 24 h `[risky]` — [`stage-04-invite.md`](stages/stage-04-invite.md)
- [ ] Stage 5 — Lockout `[risky]` — [`stage-05-lockout.md`](stages/stage-05-lockout.md)
- [ ] Stage 6 — Leaked-password check `[risky]` — [`stage-06-pwned.md`](stages/stage-06-pwned.md)
- [ ] Stage 7 — Terms on the server: `TERMS_VERSION`, the reset hook, `/api/me` terms, `POST /api/me/terms` `[risky]` — [`stage-07-terms-server.md`](stages/stage-07-terms-server.md)
- [ ] Stage 8 — Mail host guard: ranges, `resolveMailHost`, policy `[risky]` — [`stage-08-host-guard.md`](stages/stage-08-host-guard.md)
- [ ] Stage 9 — Mail host guard on every IMAP and SMTP connect, config key, scripts `[risky]` — [`stage-09-host-guard-wiring.md`](stages/stage-09-host-guard-wiring.md)
- [ ] Checkpoint A (coordinator, owner)
- [ ] Stage 10 — `/forgot` page and the login link — [`stage-10-forgot-page.md`](stages/stage-10-forgot-page.md)
- [ ] Stage 11 — Setup terms checkbox and legal stub pages — [`stage-11-setup-terms.md`](stages/stage-11-setup-terms.md)
- [ ] Stage 12 — Terms dialog after sign-in — [`stage-12-terms-dialog.md`](stages/stage-12-terms-dialog.md)
- [ ] Stage 13 — Session list and the sign-out audit rows — [`stage-13-sessions.md`](stages/stage-13-sessions.md)
- [ ] Stage 14 — Docs, ADR 0016 amendment, note — [`stage-14-docs.md`](stages/stage-14-docs.md)
- [ ] Stage 15 — Checkpoint B: review, VPS deploy and checks, close (coordinator, owner) — [`stage-15-checkpoint.md`](stages/stage-15-checkpoint.md)

Order: strictly 1 → 15. Dependencies: 2 needs 1 (locale); 3 needs 2; 4 needs 2, 3; 5 needs 1, 3; 6 needs 3; 7 needs 1, 6; 9 needs 8; 10 needs 3; 11 needs 7; 12 needs 7, 11; 13 needs 3; 14 after 13; 15 last. No stage runs in parallel with another S6b stage (they share `platform/auth.ts`). Stage 1 must not run next to another job that adds a migration.

## How to run (coordinator)

1. Before the first spawn: F077 stage 18 is done (the S6a VPS deploy). Move the ticket: `git mv spec/features/planned/F082-s6b-public-login spec/features/active/`, commit (the worktrees see only committed files).
2. Spawn one stage (NN = two digits, `<slug>` from the stage list):

   ```
   limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
     --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
     --prepare 'bash scripts/limen-prepare.sh' --label "S6b-sNN · F082" \
     "Implement F082 stage NN. Read spec/features/active/F082-s6b-public-login/ticket.md, plan.md and stages/stage-NN-<slug>.md; build every step of that stage. Final proof: the Proof command of plan.md for your stage (server or web form, /tmp/f082-sNN), one bash call with nothing after it, run after the last commit; read the logs in a separate call. In the final message, list as proven only what a saved log shows."
   ```

3. When the job finishes: read its final message and `/tmp/f082-sNN/*.log`. For a stage in "Review", spawn the review job and wait for it; a finding → `limen continue <job-id> "<fix>"` with the same engine flags (use the full job id), then review again (at most 2 rounds, then the owner decides).
4. Land: `limen land <job-id> --yes --keep-open`. Drop the job DB from the main checkout: `bun run db:worktree <YYYY-MM-DD>-<hash> --drop`; for stages 9–13 also `bun run db:worktree f082_sNN_e2e --drop`.
5. Only after the land, spawn the next stage. Stop after stage 1 (S6b-U1), after stage 9 (checkpoint A, S6b-U2, S6b-U3), and at stage 15.
6. Workers often break the one-`&&` proof form. Accept a check when its saved log shows the pass. A check with no proof at all → `limen continue`.

## Cold review

Not run yet.

## Log

- 2026-11-12: Planned with the `plan-task` skill (handoff `~/.pi/agent/notes/2026-11-12-handoff-s6b-stage-plan.md`). Collect, probes, Q1–Q7 (owner: "Okay, approve the defaults."), L1–L32, 15 stage files.
