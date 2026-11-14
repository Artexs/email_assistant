# F082 checkpoint A review (stages 1–9)

Reviewer job: `2026-11-12-f082-checkpoint-a-2c0fb569` (Opus 5.5). Range `1fc6214..05946c3` on `master`. `git rev-parse HEAD` = `05946c3f99b14039910a753d82691150a71e4346` (matches the candidate). Worktree clean, apart from this file. No code changed.

## Answer to the pre-mortem

| Question | Answer | Evidence |
| --- | --- | --- |
| Learned whether an address has an account | **Yes, through stage 5.** A locked account answers `401 INVALID_EMAIL_OR_PASSWORD`. A free or unknown address answers `403` to the same request when the request carries CSRF signals that Better Auth refuses. Only a real account can be locked, so after 10 wrong passwords one probe tells "account" from "no account". | Finding B1 (reproduction below) |
| Signed in during a lock | No. The lock check runs for every body that the endpoint accepts. I sent 8 odd bodies (upper-case address, `rememberMe: "false"`, `callbackURL: 5`, an untrusted `callbackURL`, an extra field, a form body, `text/plain`, `password: null`): locked, free and unknown gave the same status and body for each. | `auth.ts:131-152`; scratch test "odd bodies" (all `SAME`) |
| Set a leaked password | No. `/reset-password` runs terms, then pwned (`auth.ts:334-337`); `/change-password` runs pwned. No other password write exists in `apps/server/src` (grep of `auth_accounts`, `setPassword`, `resetPassword(`, `signUpEmail`, `password.hash`). Sign-up is off and outside the allow-list. | scratch test "terms, pwned…": pwned 400, unavailable 503, change pwned 400 |
| Got a reset link from a log | No. Every new log line holds ids, codes or counts only; `describeError` gives name and code only (`errors.ts:18-25`); the Better Auth logger replaces URLs (`auth.ts:105-108`, `384-391`). The CLI prints the link to stdout by design. | grep of every added `log.*`, `throw new`, audit `data:`; scratch log sweep: 0 leaking lines |
| Made the server connect to a local address | No. Every IMAP connect (`client.ts:125`) and every SMTP connect (`smtp.ts:69-70`, used at `smtp.ts:100,115,264`, `probe-send.ts:291`) resolves through `resolveMailHost`; the default policy refuses local hosts (`host-guard.ts:24-26`); every entry point calls `configureMailHosts` (`mail-hosts-configured.test.ts` in the unit run). | See item 3 |

## Blocking finding

### B1 (blocker, proven) — The lock state, and so the existence of an account, shows through Better Auth's form-CSRF check (stage 5)

- Evidence:
  - `apps/server/src/platform/auth.ts:144-152` throws the locked 401 in `hooks.before`.
  - Better Auth runs the endpoint's `use` middlewares after the before hooks: `node_modules/better-auth/dist/api/dispatch.mjs:212` (before hooks), then `:236` (endpoint); inside the endpoint, `node_modules/better-call/dist/context.mjs:10` (Zod) and `:83` (the `use` middlewares). `/sign-in/email` has `use: [formCsrfMiddleware]` (`better-auth/dist/api/routes/sign-in.mjs:243`).
  - `formCsrfMiddleware` refuses `Sec-Fetch-Site: cross-site` with `Sec-Fetch-Mode: navigate` (403 `CROSS_SITE_NAVIGATION_LOGIN_BLOCKED`). It also refuses an untrusted `Referer` when no `Origin` is present (403 `INVALID_ORIGIN`) (`api/middlewares/origin-check.mjs:131-150`).
  - Our HTTP layer lets both requests through: `apps/server/src/platform/http.ts:100-106` accepts a trusted `Origin` whatever the `Sec-Fetch-*` headers say, and accepts a missing `Origin` with `Sec-Fetch-Site: same-origin` whatever the `Referer` says. The scratch test asserts `originAllowed(req) === true` for each probe.
  - Reproduction (scratch test `/tmp/f082-cpa-repro/lock-leak.test.ts`, run with `bun test` against this job's own DB; it imports `createAuth`, `createLockoutStore`, `originAllowed` from the candidate). It locks one owner with 10 wrong passwords, then sends a wrong password with each probe:

    ```
    sec-fetch cross-site navigate | locked: 401 {"message":"Invalid email or password","code":"INVALID_EMAIL_OR_PASSWORD"}
    sec-fetch cross-site navigate | free: 403 {"message":"Cross-site navigation login blocked. ...","code":"CROSS_SITE_NAVIGATION_LOGIN_BLOCKED"}
    sec-fetch cross-site navigate | unknown: 403 (same as free)
    bad referer, no origin | locked: 401 INVALID_EMAIL_OR_PASSWORD
    bad referer, no origin | free: 403 {"message":"Invalid origin","code":"INVALID_ORIGIN"}
    bad referer, no origin | unknown: 403 (same as free)
    ```

  - Attack on the tailnet: send 10 wrong passwords for an address (curl, about 40 s at the default 3 per 10 s), then one probe. `401` = the address has an account (and is locked); `403` = no account. This breaks the stage 5 goal ("the answer and its time do not show the lock") and the "Done when" line "the answer equals a wrong password". It is the same class as cold-review finding 1, but test 13 (`web-lockout.test.ts`) covers only the Zod and length checks, not the `use` middleware.
- Fix (choose the design, then test it):
  1. Preferred: decide the lock after every check that the endpoint can refuse. In `hooks.before`, for a locked user, do not throw. Instead, give the endpoint a password check that always fails: return `{ context: { context: { password: { ...ctx.context.password, verify: async (input) => { await ctx.context.password.verify(input); return false; } } } } }` (the before-hook context is merged with `defuReplaceArrays`, `dispatch.mjs:213-222`). The endpoint then runs Zod, `formCsrfMiddleware`, the e-mail and length checks, and answers its own wrong-password 401. Timing equals a wrong password by construction. `countSignIn` must then skip `recordFailure` while the user is locked, to keep L12 ("failures during a lock are not counted"). Unverified: that `defuReplaceArrays` keeps the function override; prove it with the test below.
  2. Smaller: at the top of `rejectLockedSignIn`, run Better Auth's exported `formCsrfMiddleware` (`better-auth/api`) on the hook context, so that a request it refuses gets its 403 for every user. This still keeps a list of endpoint checks in sync by hand.
  - Test: extend `web-lockout.test.ts` test 13. For a locked user, a free user and an unknown address, each probe must give the same status and body: (a) `Sec-Fetch-Site: cross-site` and `Sec-Fetch-Mode: navigate` with a trusted `Origin`; (b) no `Origin`, `Sec-Fetch-Site: same-origin`, `Referer: http://evil.x.test/`. No probe counts as a failure.

## Unverified checks

- `test:int` and `test:e2e`: not run (the task forbids them). The stage logs of the workers were not re-read; their evidence is at other commits.
- Fix 1 of B1 is a proposal; it is not tried.

## Item 1 — Same answer and similar timing, known and unknown address

- Sign-in, answers: same for every odd body that I tried (table above), except the B1 probes.
- Sign-in, timing (scratch test, local Postgres, interleaved, two runs): median wrong password of a known user 49.3 / 48.6 ms; unknown address 47.7 / 46.6 ms; locked user 45.4 / 45.3 ms against unknown 46.1 / 46.1 ms and known 47.9 / 47.6 ms. So the difference is about 1.5–2.5 ms (3–5 %) and it goes the same way in each run.
- **T1 (minor, proven by measurement) — the stage 5 note.** A known user costs more DB round trips than an unknown address. The before hook calls `isLocked` only for a found user (`auth.ts:147-148`). The after hook does the user lookup for both, but only a known user also gets `recordFailure` (1 statement, 2 at the 10th failure) (`auth.ts:198-205`). A locked user skips the endpoint, so it is faster than both. Over the tailnet the jitter is larger than 2 ms. But the gap is systematic, so many samples can show it, and each sample of a known user also counts toward its lock. Rating: minor. It is below the plan's 0.5×–2× bound, and the plan sets no bound for known against unknown. Fix:
  - Make the lock read one statement for every address: `SELECT l.locked_until FROM users u JOIN auth_lockouts l ON l.user_id = u.id WHERE u.email = lower($1)`. It runs whether or not the user exists, and it replaces `findUserByEmail` + `isLocked` in the before hook.
  - Move the after-hook bookkeeping off the answer path: start `recordFailure` / `recordSuccess` / `claimMail` / the audit row as a tracked background task (the `createAuthMailTasks` pattern), with `idle()` for tests and shutdown. Each statement is atomic, so the parallel-lock rule (test 10) still holds. A request that arrives within a few ms of the 10th failure can still be counted before the lock row exists; that is accepted.
  - With fix 1 of B1, the locked path also has the same cost as a wrong password.
- Reset request: the limiter path and Better Auth both answer `RESET_REQUEST_ANSWER` (`auth.ts:321-329`; test 1 and 3 of `web-reset-request.test.ts`). The send is not awaited (`web.ts` `sendResetPassword` → `mailTasks.start`). The rest of the timing gap is Better Auth's own: an `INSERT` for a known address and a dummy `SELECT` for an unknown one (`better-auth/dist/api/routes/password.mjs`, `requestPasswordReset`). On the VPS the sender is off, so the route answers 404 for every address (`http.ts:310`, `isAllowedAuthPath`). No finding.
- Lockout: an unknown address never gets a row (test 8). The locked answer is byte-equal to a wrong password for a normal request (tests 1, 2). The B1 probes are the exception.

## Item 2 — Open notes from the stage reviews

- **N-a (minor, proven by reading).** `web-reset-request.test.ts:156-165` expects `[200, 200, 200, 429]`. Better Auth's default rule for `/request-password-reset` is also 3 requests (`better-auth/dist/api/rate-limiter/index.mjs:312-317`, window 60 s), so the test passes without the 900 s custom rule. Fix: assert that the 429 has `X-Retry-After` ≥ 61 (for example 890–900; the header is set at `rate-limiter/index.mjs:70`). Membership test `web-reset-request.test.ts:225-232`: the user has one membership, so "oldest" is not tested. Fix: add a second, newer membership (`insertMembership`) and assert that `notify` gets the first organization.
- **N-b (minor, proven by reading; no leak found).** `web-pwned.test.ts:58-60` and `web-terms.test.ts:58-62` mock the console and never sweep it. Only `web-terms` test 5 checks one error line (`web-terms.test.ts:218-219`). The plan's "Rules for every stage" asks for a sweep of the password, the token and `reset-password/`. My scratch sweep (`/tmp/f082-cpa-repro/pwned-terms.test.ts`, log level debug, all console methods) ran no terms, pwned, unavailable, a good reset, change-password pwned, an anonymous change and an invalid token. Result: 0 lines with the passwords, the address, the token or `reset-password/`. Fix: add the sweep to both files, as in `web-reset-request.test.ts:195-222`.
- **N-c (minor, proven).** The pwned check runs before Better Auth checks the session (`/change-password`, `use: [sensitiveSessionMiddleware]`) and the token (`/reset-password`). Scratch test: an anonymous `/change-password` gives `401` after 1 `pwnedCheck` call. A `/reset-password` with `token: "not-a-token"` gives `400` after 1 call. The cost is low: 5 per minute per client address on each path (`auth.ts:354-355`). Only 5 hex characters go out, and the result does not depend on any account. Fix: in `rejectLeakedPassword`, return without a call when `/change-password` has no session (`getSessionFromCtx(ctx)` from `better-auth/api`), or when `/reset-password` has no live token (`ctx.context.internalAdapter.findVerificationValue(\`reset-password:${token}\`)`; check that it applies the hashed identifier). Let the endpoint give its own answer.
- **N-d (minor, proven by reading).** `apps/server/src/modules/tenancy/routes.ts:103-118` writes a `web.terms_accepted` row on every `POST /api/me/terms`, also when the version is already stored. A signed-in member can add rows without limit. Fix: make `setUserTerms` (`tenancy/repo.ts:260-270`) conditional (`WHERE id = $1 AND terms_version IS DISTINCT FROM $2`), and write the audit row only when it returns `true`. Still answer 204. Test: two calls give one row.

## Item 3 — Order of checks, and the host guard on every connect

- `/reset-password`: terms (`auth.ts:334`, `rejectMissingTerms`), then pwned (`auth.ts:335-337`). Same dispatcher, in that order. `web-terms` test 4 proves that no pwned call happens without the terms.
- `/change-password`: pwned only. This follows the plan: L16 and B5 put the terms check on the password set through `/setup`; a signed-in user gets the dialog (L17, stage 12). I do not count it as a finding. If "every path" must hold literally, add `rejectMissingTerms` to `/change-password` as well, and send `termsVersion` from `AccountCard`.
- No other path sets a password (grep above).
- Host guard: `connectImapClient` (`imap/client.ts:124-126`); `smtpConnectOptions` (`imap/smtp.ts:69-70`) used by `verifySmtpLogin`, `sendProbeToSelf` (`smtp.ts:100,115`), `openSmtpSender` (`smtp.ts:264`), `probe-send.ts:291`. `imapFlowOptions` and `buildSmtpTransportOptions` require a `MailTarget`, so the typecheck finds every caller. `grep -rn "new ImapFlow\|createTransport\|SMTPConnection(" apps/server/src` finds only these and `platform/auth-mail.ts:69`. That last one is the auth-mail sender, which connects to the operator's `AUTH_SMTP_HOST` from config, not to user input: outside the guard by design.
- **H1 (minor, plausible).** `host-check.ts:6-28` does not refuse `224.0.0.0/4`, `240.0.0.0/4`, IPv6 multicast `ff00::/8`, NAT64 `64:ff9b::/96` or 6to4 `2002::/16`. TCP to multicast or reserved addresses fails anyway. NAT64 and 6to4 reach an embedded IPv4 address only with a gateway, and the home VPS has none. IPv4 is chosen first (`host-guard.ts:118`). Fix: add the five ranges, with a `host-check.test.ts` case each.
- **P1 (minor, plausible).** `pwned.ts:33-40` answers `ok` for a 200 body that holds no `SUFFIX:COUNT` line, for example a captive-portal HTML page. With `Add-Padding: true`, a real answer always has hundreds of lines. Fix: count the valid lines (`^[0-9A-F]{35}:\d+$`); none → `unavailable` (fail closed). Test: a 200 HTML body → `unavailable`.

## Item 4 — Secrets and links

Grep of every added line with `log.*`, `console.*`, `throw new`, `stdout`, operator notice text and audit `data:` in `apps/server/src`, `apps/web/src`, `packages`:

- Log lines hold user ids, org ids, kinds, codes, statuses and counts only. Examples: `auth-mail.ts` (`auth mail <kind> to user <id> failed: <code>`), `pwned.ts:30,43` (status or error name), `invite-delivery.ts` (user id, org id, code), `org-invite.ts` (org id, user id, date).
- Errors: `host-guard.ts` texts hold no host and no address. `describeError` returns name and code only.
- Audit rows: `web.login_locked` `{ via, locked_until }`; `web.terms_accepted` `{ via, version }`.
- Operator notice: `Auth mail <kind> to user <id> of org <org> failed (<code>).` (`operator.ts`).
- Better Auth's own lines go through `cleanLogText` (URLs → `<url>`). Its "User not found" lines pass `{ email }` as a second argument, and the logger drops it (`auth.ts:386-389`).
- The printed CLI link block is the only place that holds a link (`invite-delivery.ts:63-71`), as designed.
- No finding.

## Item 5 — Migration `20261112200001_auth_public`

- Up: three nullable columns with checks that a `NULL` row passes, one paired check (both `NULL` on the live rows), and a new table. Existing pilot rows stay valid. Their `terms_version` stays `NULL`, so the pilot owner sees the dialog (S6b-U5). `ALTER TABLE users` takes a short exclusive lock on a table with a few rows.
- Down: `DROP TABLE auth_lockouts`, then drop the paired check and the three columns. The inline `users_locale_check` goes with its column.
- Run on this job's own DB: `dbmate rollback` → "Rolled back: 20261112200001_auth_public.sql"; after that, 0 of the 3 columns, no `auth_lockouts`, constraints `users_email_lower_check`, `users_pkey`. `dbmate migrate` → "Applied"; constraints back: `users_email_lower_check`, `users_locale_check`, `users_pkey`, `users_terms_pair_check`; `has_table_privilege('app','auth_lockouts','INSERT,SELECT,UPDATE,DELETE')` = `t`. `users`, `auth_sessions` and `auth_lockouts` all have RLS off (the same model as the other auth tables).
- No finding.

## Other notes

- **D1 (minor, board drift; not repaired here).** `spec/build.md:18` lists F082 under NOW and `spec/build.md:25` still lists it under NEXT as PLANNED. In `plan.md` § Stages, all stage boxes are unticked although stages 1–9 landed. `ticket.md` still says "Status 2026-11-12 — planned". The coordinator should fix these.
- Out of the F082 range: the range also holds F083 and F079 commits (retention, delegation, triage). I did not review them.

## Checks run (this job, HEAD `05946c3`, own DB `email_assistant_2026_11_12_2c0fb569`)

- `bun install --frozen-lockfile` → "no changes".
- `bun run lint` → exit 0 (`/tmp/f082-cpa/lint.log`).
- `bun run typecheck` → exit 0; `@ea/server` and `@ea/web` "Exited with code 0" (`/tmp/f082-cpa/typecheck.log`).
- `bun run test:unit` → exit 0, "1834 pass, 0 fail", 140 files (`/tmp/f082-cpa/unit.log`).
- `dbmate rollback` + `dbmate migrate` on the own DB (item 5).
- Scratch tests outside the repo, against the own DB: `/tmp/f082-cpa-repro/lock-leak.test.ts` (B1 probes, odd bodies, timing, run twice) and `/tmp/f082-cpa-repro/pwned-terms.test.ts` (N-b sweep, N-c calls). All passed as tests; they print the results quoted above.
- Not run: `test:int`, `test:e2e` (forbidden by the task).

VERDICT: FAIL
