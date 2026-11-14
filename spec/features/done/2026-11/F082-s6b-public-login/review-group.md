# F082 checkpoint B group review (stages 1–14, step 15.1)

Reviewer job: `2026-11-13-f082-review-s6b-8c7f1bb9` (Opus 5.5). Range `1fc6214..83c427c` on `master`. `git rev-parse HEAD` = `83c427cb965c70af91d44ed2eb4e2c2462d5aca5`, which matches the candidate. The worktree is clean apart from this file. I changed no code. The range also holds F079, F083, F084 and F077 commits. I read them only to look for conflicts with F082. Result: none. F084 adds host ranges to the stage 8 guard (`host-check.ts:16-31`), and `a27d8d4` adds `configureMailHosts` to `org-plan.ts` for the F079 resume hook. Both support F082.

Result: no blocker. 10 minor findings, all in docs, alerts, the board, and one open timing item. The deploy (15.2) can go ahead after the owner's go. M1–M5 should be fixed before the VPS checks, because the operator reads those docs during 15.2 and 15.3.

## Blocking findings

None.

## Unverified checks

- `test:int` and `test:e2e`: not run (the task forbids them). The stage logs of the workers are at other commits, so they are not evidence for `83c427c`. Every "Done when" line below names its test. I read each test and checked that it asserts what the line says. I did not run them here.
- The Playwright parts (the `/forgot`, `/legal/*`, setup checkbox, terms dialog and session list specs, mobile and desktop projects, CSP listeners): read only, not run.
- On the VPS: the `.env` keys (`AUTH_*`, `MAIL_ALLOW_LOCAL_HOSTS`, `WEB_MAIL_ALLOW_LOCAL`), outbound HTTPS to `api.pwnedpasswords.com`, and the TLS connect to a pinned IP with `servername` (plan "Not verified"). Step 15.2/15.3 checks them.

## Pre-mortem: which stage let it through?

| # | Question | Answer | Evidence |
| --- | --- | --- | --- |
| 1 | Learned whether an address has an account | **No.** Sign-in: a locked user, a free user and an unknown address give the same status and body for all 6 probes that I ran (normal, cross-site navigate, bad Referer without Origin, cross-site CORS, form body, form plus cross-site navigate). Reset request: 404 for every address on the VPS (sender off). With the sender on, all addresses get the same 200 body, the send runs in the background, and the 4th request per address gets the same body. Residual: T1 (about 1.5 ms between a known and an unknown address, see M7). | `auth.ts:163-186` (the locked user's `verify` always fails, so the endpoint runs all its own checks); `web-lockout.test.ts:306,327,348`; my probe (item A); `http.ts:313` + `auth.ts:77-79` (404); `web-reset-request.test.ts:112,126,141`; `web-http.test.ts:443` |
| 2 | Signed in during a lock, or locked out a user without limit | **Signed in: no.** The correct password during a lock gives 401, and no cookie is set, for every probe. **Without limit: yes, but accepted (B8).** Anyone who knows the address can lock the account again every 15 min. Each lock writes one `web.login_locked` row, and lock mails are at most 3 per UTC day. Better Auth's sign-in limit (3 per 10 s per client address) slows each lock to ≥ 30 s. `x-client-ip` from the client is dropped (`http.ts:111`). | `web-lockout.test.ts:183` (right password fails, no cookie), `:214` (3 mails/day); `auth-lockout.ts:70-81`; my probe `lockedRight … cookie=false` |
| 3 | Set a leaked password | **No.** `/reset-password` runs the terms check, then the pwned check. `/change-password` runs the pwned check. The guard `mayChangePassword` (`auth.ts:198-208`) reads the token exactly as the endpoint does (`better-auth/dist/api/routes/password.mjs`, `resetPassword`: `ctx.body.token \|\| ctx.query?.token`, `findVerificationValue("reset-password:"+token)`, `expiresAt < new Date()`). `findVerificationValue` hashes the identifier itself (`db/internal-adapter.mjs:768-770`), so the hashed tokens of F059 do not make the check skip a live token. An outage answers 503 and changes nothing. A 200 page without range lines counts as `unavailable` (P1). The server always sets `pwnedCheck` unless `AUTH_PWNED_CHECK=off` (`web.ts:316-318`; default `on`, `config.ts:160`). | `web-pwned.test.ts:150,163,177,206`; `pwned.test.ts` (unit, passed) |
| 4 | Found a reset or setup link in a log, an audit row, an operator notice or a test snapshot | **No.** Log lines hold ids and codes only: `auth-mail.ts:93,99,103,136`, `pwned.ts:32,47,53`, `invite-delivery.ts:58,62,74`. Audit data is `{via, locked_until}`, `{via, version}` or `{via}`. The operator notice text holds the user id, the org id and a code (`operator.ts`). The CLI prints the link to stdout by design (`invite-delivery.ts:66-73`). The only snapshot folder is `platform/llm/providers/__snapshots__` (not auth). The Hono access log uses `routePath` (a pattern, not the raw path; `http.ts:267`). The legal links on `/setup` (whose URL holds the token) use `rel="noopener noreferrer"`. My probe swept 80 log lines: 0 held a password, an address or `reset-password/`. | log sweeps in `web-lockout.test.ts:293`, `web-pwned.test.ts:246`, `web-terms.test.ts:335`, `web-sessions.test.ts:242`, `web-reset-request.test.ts:200`, `org-invite-cli`/`web-invite-cli` `expectNoLeak` |
| 5 | Set a password without the terms | **No for a password set through a link.** `rejectMissingTerms` (`auth.ts:189-194`) runs before the endpoint and refuses `400 TERMS_REQUIRED`. Nothing is written (F5). Every first password and every reset goes through `/reset-password`. By design (B10, L16), `/change-password` needs no terms: a signed-in user with old terms gets the blocking dialog (`AppShell.tsx` `me.terms.accepted`). | `web-terms.test.ts:158,171,182,191`; `auth.spec.ts` (setup checkbox, no request without the box) |
| 6 | Made the server connect to a local address through a DNS change | **No.** Every IMAP connect (`imap/client.ts:125-126`) and every SMTP connect (`smtp.ts:70`, used at `:100,:115`, `openSmtpSender` `:262`, `probe-send.ts:291`) resolves once through `resolveMailHost`. The connect then goes to the checked address, with `servername` for TLS (`host-guard.ts:45-67`). Any local address in the answer refuses the host. The default policy is frozen and refuses local hosts (`host-guard.ts:24-29`). Every entry point calls `configureMailHosts` (unit `mail-hosts-configured.test.ts`, passed). The auth-mail sender connects to the operator's `AUTH_SMTP_HOST` from config, not to user input: outside the guard by design. | `mail-host-guard.test.ts:84` ("public once, local next → refused at the next connect"); `host-guard.test.ts`, `host-check.test.ts` (unit, passed); my `bun -e` probe: `fe80::1%eth0`, `[fe80::1%25eth0]`, `::ffff:7f00:1`, `0:0:0:0:0:ffff:127.0.0.1`, `::ffff:10.0.0.1` all refused |

## A. Checkpoint A findings

| Finding | State | Evidence |
| --- | --- | --- |
| B1 (lock shows through form-CSRF) | **Closed.** | Fix `ecd114d`: `auth.ts:163-186`. The hook no longer throws. It swaps `password.verify` for one that runs the real verify and then returns `false`. Test `web-lockout.test.ts:348`. Probe re-run on master (below). |
| P1 (200 without range lines = ok) | Closed | `6bd319e`; `pwned.ts:36-49`; unit "a 200 body without a SUFFIX:COUNT line (HTML, empty) is unavailable" passed |
| N-a (429 rule and oldest membership not shown) | Closed | `51c3b45`; `web-reset-request.test.ts:166-168` (`x-retry-after` ≥ 61), `:233-245` (second, newer membership) |
| N-b (no log sweep in pwned and terms tests) | Closed | `800f1f4`; `web-pwned.test.ts:246`, `web-terms.test.ts:335` |
| N-c (pwned call without a session or a live token) | Closed | `33412df`; `auth.ts:196-208,217`; `web-pwned.test.ts:206` |
| N-d (repeat terms post writes rows) | Closed | `559ba75`; `tenancy/repo.ts:260-273` (`IS DISTINCT FROM`), `routes.ts` `/me/terms` writes the audit row only on a change; `web-terms.test.ts:308` |
| T1 (known vs unknown timing) | **Open, no recorded reason** | See M7. |
| H1 (multicast, reserved, NAT64, 6to4) | Closed by F084 | `adfbb6d`; `host-check.ts:16-31`; unit tests passed |
| D1 (board drift) | **Partly closed** | `f9f293f` fixed `build.md` NEXT and ticked stages 1–9. Still open: see M8. |

**B1 probe re-run against master** (scratch test `/tmp/f082-grp-probe/b1-probe.test.ts`, outside the repo, `bun test` against this job's own DB `email_assistant_2026_11_13_8c7f1bb9`. It imports `createAuth`, `createLockoutStore`, `originAllowed` and `auditWebEvent` from the candidate. It locks one owner with 10 wrong passwords, then sends each probe for "locked + right password", "locked + wrong password", "free + wrong password" and "unknown address"):

```
normal              all four: http-layer=true 401 INVALID_EMAIL_OR_PASSWORD cookie=false
crossSiteNavigate   all four: http-layer=true 403 CROSS_SITE_NAVIGATION_LOGIN_BLOCKED cookie=false
badRefererNoOrigin  all four: http-layer=true 403 INVALID_ORIGIN cookie=false
crossSiteCors       all four: http-layer=true 401 INVALID_EMAIL_OR_PASSWORD cookie=false
formBody            all four: http-layer=true 401 INVALID_EMAIL_OR_PASSWORD cookie=false
formCrossNavigate   all four: http-layer=true 403 CROSS_SITE_NAVIGATION_LOGIN_BLOCKED cookie=false
rows: locked failed_count 0 (no failure counted during the lock), free failed_count 3 (only the 3 probes that reached the password check)
median ms (15 samples each): locked 47.4, free wrong 47.8, unknown 46.3
log lines 80, leaking 0
```

Each probe gives byte-equal status and body for the four cases (the test asserts one distinct value per probe). B1 holds on master.

## B. "Done when" lines

| Line | Holds? | Test or check |
| --- | --- | --- |
| Sender on: `org:invite` creates the organization and the owner and mails the link (GreenMail) [4]. Without the keys: the server starts, `request-password-reset` gives 404, and both CLIs print [3, 4]. | Yes (read) | `org-invite-cli.test.ts:150` (GreenMail inbox subject), `:113`; `web-invite-cli.test.ts:115,190,200`; `web-http.test.ts:443` (off → 404 `not_found`, on → 200 same body) |
| `/forgot` opens without a session [10]. Same status and body for known and unknown [3]. Returns before a 3 s send (< 1 s) [3]. Per-address and per-client limits [3]. Server link 1 h, CLI link 24 h [3, 4]. | Yes (read) | `forgot.spec.ts` "a visitor without a session sees the forgot page", `web-http.test.ts:123`; `web-reset-request.test.ts:112,126,141,156,171`; `org-invite-cli.test.ts:142-147` (24 h) |
| A failed auth mail = one `warn` line (user id, code) and one notice per user, code and day [2, 3] | Yes (read) | `auth-mail.test.ts` (unit, passed), `auth-mail.test.ts:44` (int), `web-reset-request.test.ts:187`, `channels-operator.test.ts:275` |
| Lockout: 10 in 15 min, 15 min lock, same answer, time 0.5×–2×, one mail per lock, ≤ 3 per day, the right password fails while locked, works after 15 min, a reset clears the lock (fixed clock) [5] | Yes (read; my probe confirms the answer, the time and the count) | `web-lockout.test.ts:169,183,196,205,214,226,234,258,278` |
| Leaked password refused on setup, reset and change; API down or slow → 503 and no change [6] | Yes (read) | `web-pwned.test.ts:150,163,177`; `pwned.test.ts` timeout case (unit, passed) |
| The Account card lists the sessions (device, address, last use, "This device"); sign out everywhere writes `web.sessions_revoked` [13] | Yes (read) | `web-sessions.test.ts:108,165,200,214`; `account.spec.ts` "the account card lists the signed-in devices" |
| `host-check.ts` refuses the three ranges [8]; a name that later resolves to a local address is refused at the next sync (fake resolver) [8, 9] | Yes (unit run; int read) | `host-check.test.ts` (passed); `mail-host-guard.test.ts:58,84` |
| Reset tokens stored hashed: F059's test still passes [15] | Present, not run | `web-auth.test.ts:128` (int: not run here) |
| `/setup` needs the box; one request sets the password and the terms; without the terms nothing changes [7, 11]; old terms → blocking dialog (Playwright) [12]; `TERMS_VERSION` in `packages/core`; `/legal/*` without a session [11] | Yes (read) | `web-terms.test.ts:158,191`; `auth.spec.ts` (terms error, no request, then 1 request); `terms.spec.ts`; `packages/core/src/web/terms.ts`; `legal.spec.ts` (6 pages, CSP) |
| §7 lists the controls; `deploy/README.md` lists the keys and what a real sender needs; ADR 0016 amendment [14] | Yes, with the errors listed in C | `docs/architecture.md:633-650`; `deploy/README.md:146-188`; ADR 0016 lines 55-65 |
| VPS: `org:invite` prints, setup with the box, lock, `password1234` refused, pilot mailbox syncs [15] | Not yet (15.2/15.3) | — |

## C. Docs against the code: wrong or stale statements

- **M1 (minor, proven by reading).** `deploy/README.md:168` says "It turns on only when all six keys are set: `AUTH_SMTP_HOST`, `AUTH_SMTP_PORT`, `AUTH_SMTP_SECURITY`, …". The code turns the sender on with four keys: host, user, password and from. Port defaults to 465 and security to `tls` (`config.ts:153-154,222-234`, `authMailSettings` `config.ts:264-268`). Fix: "It turns on when `AUTH_SMTP_HOST`, `AUTH_SMTP_USER`, `AUTH_SMTP_PASSWORD` and `AUTH_MAIL_FROM` are set (all four or none). `AUTH_SMTP_PORT` (465) and `AUTH_SMTP_SECURITY` (`tls`) have defaults." The same "six keys" wording is in `deploy/README.md:125` and in `known-alerts.md` `operator notice auth_mail_failed` ("the six `AUTH_SMTP_*` and `AUTH_MAIL_FROM` keys"). Those two are only loose, not wrong.
- **M2 (minor, proven by reading).** `docs/known-alerts.md:77-83`, entry ``web: WEB_MAIL_ALLOW_LOCAL=true: the connect form accepts local hosts``, is stale. Stage 9 removed that line from `web.ts`. The new lines are `[mail] mail: MAIL_ALLOW_LOCAL_HOSTS=true: local mail hosts are allowed` (`main.ts:56`) and `WEB_MAIL_ALLOW_LOCAL is an old name: use MAIL_ALLOW_LOCAL_HOSTS` (`main.ts:54`). The key now covers sync and send too, not only the form. This is the alert that tells the operator the VPS allows local hosts. Fix: rename the entry to the `main.ts:56` text, set the source to `main.ts`, set the scope to "connect form, sync and send", and add the old-name line.
- **M3 (minor, proven by reading).** `docs/known-alerts.md:173-179`, entry ``web: reset requested for user <id>``. The conclusion still holds: the line cannot fire over HTTP. The reasons in the text are stale. (a) "It cannot happen over HTTP in S5: the allow-list answers 404": since S6b the path opens with the sender (`auth.ts:77-79`, `http.ts:313`), and then `webDeps` passes its own `sendResetPassword` (`web.ts:326-331`). So the line still cannot fire, but for a new reason. (b) Its Fix names `web-invite.ts` as the CLI instance. The CLI instance is now `scripts/invite-delivery.ts:34-45` (used by `web:invite` and `org:invite`). `scripts/e2e-seed.ts:109` is the other `createAuth` caller. Fix: rewrite the Cause ("the path answers 404 with the sender off; with the sender on, `webDeps` passes `sendResetPassword`; the CLIs pass their own callback in `invite-delivery.ts`") and the Fix file list.
- **M4 (minor, proven by reading).** `docs/modules.md:388`: "`/login`, `/setup` and the assets are public". `PUBLIC_PAGE_PATHS` also has `/forgot` and `/legal/{pl,en}/{privacy,terms,dpa}` (`http.ts:124-131`). Fix: add them.
- **M5 (minor, proven by reading).** `deploy/README.md:129-130` (Turn it on, step 4) checks the start log with `grep 'web'`. It does not name the new expected line `[web] auth mail: off (the CLI prints invite and reset links)` (`web.ts:304`). It also does not name the two lines that must NOT show on the VPS: `AUTH_PWNED_CHECK=off: leaked passwords are not refused` (`web.ts:307`) and `mail: MAIL_ALLOW_LOCAL_HOSTS=true …` (`main.ts:56`). Step 15.2 expects the first line and the absence of the second, but not the third. Fix: add the three lines to step 4 and to the 15.2 checklist.
- **M6 (minor, proven by reading).** The new operator-visible log lines have no `known-alerts.md` entry: `pwned check unavailable: <status|name>` (`pwned.ts:32,47,53`; the line the operator sees when a password set answers 503), `AUTH_PWNED_CHECK=off: …` (`web.ts:307`), `web: lockout: <label>` (`auth.ts:397`), `web: terms record failed for user <id>` (`web.ts`, `auth.ts:311`), `mail host lookup failed (<code>)` and `host not allowed` (`host-guard.ts:58,60`, `port.ts:145`). CLAUDE.md says to grep `known-alerts.md` before diagnosing an alert. Stage 14 asked only for `auth_mail_failed`, so this is a gap in the plan, not a stage deviation. Fix: one entry each. At least add `pwned check unavailable` and `host not allowed` before 15.3.
- **M10 (minor, wording).** `docs/architecture.md:647` (Terms): "Every password set needs it". `deploy/README.md:184` says the same for the pwned check: "Every password set or change asks …" (that one is correct). The terms check runs only on `/reset-password` (`auth.ts:386`). `/change-password` needs no terms (B10, L16). Fix: "Every password set through a link (`/reset-password`) needs it; a password change in the Account card does not (B10)."
- Checked and correct: §7 allow-list, reset-request limits (`auth.ts:408`, limiter `auth.ts:273-277`), lockout, leaked passwords, sessions, the audit event list (`audit/repo.ts:59-62`), the mail host check ranges (`host-check.ts`); `docs/modules.md:373-374,387` (routes, allow-list without `/list-sessions`); ADR 0016 line 22 and the amendment (D7, D8, F6, F7); `.env.example` against `config.ts`: every schema key is in `.env.example` (`comm` of both key lists: none missing). The extra keys there are tool keys (`E2E_*`, `TEST_*`, `MIGRATOR_*`, `CHROMIUM_PATH`, `POSTGRES_PASSWORD`, `APP_PASSWORD`). `deploy/README.md` Update steps: correct order (see E).

## D. New web pages

- No secret in the page source. `/forgot` (`ForgotPage.tsx`) posts only the address and shows the same text for every 200. `/legal/*` is static (`[doc].astro`). The terms dialog posts `{version}` only. The session list shows the session id (not the token), the device, the user's own address and the date (`AccountCard.tsx`, `routes.ts` `/me/sessions`). The setup token is in the `/setup?token=…` URL by S5 design. The new legal links on that page use `target="_blank" rel="noopener noreferrer"` (`SetupPage.tsx:194`, `TermsDialog.tsx:68`), so the token does not go out as a Referer. `Referrer-Policy: same-origin` stays (`http.ts:275`).
- Every `target="_blank"` in `apps/web/src` has `rel="noopener noreferrer"` (grep: 3 hits, all correct).
- CSP: unchanged in the server (`http.ts:271-279`). `forgot.spec.ts`, `legal.spec.ts` and `terms.spec.ts` assert no CSP errors (`cspErrors`). Not run here.
- Mobile layout: `playwright.config.ts` runs every spec in the projects `mobile` (Pixel 7) and `desktop`. The new specs use per-project address blocks. Not run here.

## E. Deploy safety on the home VPS

- `AUTH_*` empty → `authMailSettings` gives `null` → `resetRequestOpen` false → `POST /api/auth/request-password-reset` answers 404 for every address (`web.ts:296-305,358`, `http.ts:313`). Auth mail is off. The CLI prints the links (`invite-delivery.ts:53-75`). A half set of keys stops the start with a config error (`config.ts:222-234`).
- `AUTH_PWNED_CHECK` empty → default `on` (`config.ts:160`) → `pwnedCheck` set (`web.ts:316-318`). An outage → `503 PASSWORD_CHECK_UNAVAILABLE` and no change. **Acceptable for the pilot.** The pilot owner has a password from S5 and only needs the terms dialog (`POST /api/me/terms`, no HIBP call). The test user of 15.3 needs HIBP once, and `password1234` → 400 (not 503) proves that the VPS reaches the API. **M9 (minor):** `deploy/README.md:182-184` calls `AUTH_PWNED_CHECK=off` "for tests only" and gives no path for a long outage. Fix: add one sentence: "For a long outage only: set `AUTH_PWNED_CHECK=off`, restart (the log warns), and remove it when the API answers again."
- `MAIL_ALLOW_LOCAL_HOSTS`: `deploy/README.md:125` says leave it empty. If it is set, `main.ts:56` warns at start. I could not check the VPS `.env` (agents never read it). Step 15.2 should check that the start log has no `MAIL_ALLOW_LOCAL_HOSTS=true` line (M5).
- Migration `20261112200001_auth_public` is not on the VPS yet. The Update steps (`deploy/README.md:42-53`) run `db:migrate` in a one-off container (`$C run --build --rm server bun run db:migrate`) before `$C up -d --build --wait` starts the new server. That order is correct. dbmate applies every pending file, so the F083/F049 files that sort before it are applied too.
- Old server code next to the new migration, during the update: safe (proven by reading). The migration only adds nullable columns, whose checks pass for `NULL`, and a new table (`db/migrations/20261112200001_auth_public.sql`). The old code inserts users with named columns (`insertUser`). The Better Auth kysely adapter uses `selectAll()`, but its output mapping iterates over the schema fields only (`@better-auth/core/dist/db/adapter/factory.mjs:152-156`), so the new columns are dropped. `ALTER TABLE users` takes a short exclusive lock on a table with a few rows. Rollback to the old commit keeps the columns (15.2 says so). That is safe for the same reason.
- `deploy/compose.yaml:29` passes the whole `.env` (`env_file`), so no compose change is needed for the new keys.

## F. Open items and the deploy

- **T1 (timing, known vs unknown).** Does not block. My run: free user 47.8 ms, unknown 46.3 ms, locked 47.4 ms (medians of 15). The gap is about 3 %, below network jitter on the tailnet, and the plan sets no bound for it. It is still systematic. **M7 (minor):** checkpoint A rated it minor, and no file records a decision or a ticket for it (grep of `plan.md`, `build.md`, `notes/`, `spec/features/`). Fix: record "accepted for the tailnet pilot; revisit before a public host" in `plan.md` § Log, or open a planned ticket with the fix of review-checkpoint-a T1.
- **F085** (a refused mailbox host gets a status and a notice). Does not block. Until it lands, a refused pilot host is only a `sync <id> failed: host not allowed` log line. Step 15.3.6 (the pilot mailbox syncs, `mailbox:check` passes) is the check that covers this risk on deploy day. Do not skip it.
- **F078** (delete expired `auth_verifications`). Does not block. Tokens are hashed (F059, `auth.ts:355`). Expired rows cannot open a link. On the VPS only CLI invites write them.

## Other notes

- **M8 (minor, board drift; not repaired here).** `ticket.md:36` still says "Status 2026-11-12 — planned". In `plan.md` § Stages, stages 10–14 are unticked although they landed (`44e3904`, `27bacf2`, `3d2bafe`, `973b2a4`, `83c427c`). `plan.md` says "Checkpoint A review … round 2 PASS", but the folder holds only the round 1 file (`review-checkpoint-a.md`, `VERDICT: FAIL`). The round 2 result is not filed. Fix (coordinator): tick 10–14, remove the status line from `ticket.md` (state lives in the lane and the board), and file the round 2 review as `review-checkpoint-a-2.md` or name its job id in `plan.md`.
- Plausible, not a finding: in `lockSignIn` (`auth.ts:170-171`), a DB error in `isLocked` for a known user gives 500, while an unknown address gives 401. This needs a DB fault that the attacker cannot cause. It fails closed by design.
- `GET /api/me/sessions` puts `data-session=<session id>` in the DOM. The id is not the token, and no allowed route acts on an id (`/revoke-session` is not in the allow-list). No risk.

## Checks run (this job, HEAD `83c427c`, own DB `email_assistant_2026_11_13_8c7f1bb9`, migrations up to `20261112200001`)

- `git rev-parse HEAD` → `83c427cb965c70af91d44ed2eb4e2c2462d5aca5` (matches).
- `bun install --frozen-lockfile` → exit 0 (`/tmp/f082-grp/install.log`).
- `bun run lint` → exit 0 (`/tmp/f082-grp/lint.log`).
- `bun run typecheck` → exit 0; `@ea/server` and `@ea/web` "Exited with code 0" (`/tmp/f082-grp/typecheck.log`).
- `bun run test:unit` → exit 0, "1873 pass, 0 fail", 143 files (`/tmp/f082-grp/unit.log`).
- Scratch probe `/tmp/f082-grp-probe/b1-probe.test.ts` (one file, `bun test`, own DB; this is not `test:int`) → 1 pass. Output quoted in item A.
- `bun -e` probe of `isLocalMailHost` with zone-id and IPv4-mapped spellings → all refused, except `127.0.0.1.nip.io` (a name, so `resolveMailHost` checks its resolved address).
- Read: Better Auth 1.7.18 `password.mjs` (`resetPassword`), `internal-adapter.mjs:768-770`, `@better-auth/core` adapter factory `:152-156`.
- Not run: `test:int`, `test:e2e` (forbidden by the task).

VERDICT: PASS
