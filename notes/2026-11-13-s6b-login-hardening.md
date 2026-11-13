# S6b login hardening: facts for later agents (2026-11-13)

S6b is F082 (`spec/features/active/F082-s6b-public-login/`). Controls: `docs/architecture.md` §7. ADR: `docs/decisions/0016-web-panel-static-build-and-better-auth.md` (Amendment).

## Library facts (checked 2026-11-12; Better Auth 1.7.18, imapflow 1.7.8, nodemailer 10.3.1)

- **F1 Sign-in answers.** A wrong password, an unknown address and an error thrown from `hooks.before` with `APIError.from("UNAUTHORIZED", { code: "INVALID_EMAIL_OR_PASSWORD", … })` give the same 401 and about the same time. An unknown address hashes the password (`better-auth` `api/routes/sign-in.mjs`).
- **F2 Hooks.** `hooks.before` sees `ctx.path` and the parsed `ctx.body` (also extra fields such as `termsVersion`). An error thrown there skips the endpoint and `hooks.after`. `hooks.after` sees `ctx.context.returned` and, after a sign-in, `ctx.context.newSession`. `ctx.context.internalAdapter.findUserByEmail` works in a hook.
- **F3 Reset request.** `/request-password-reset` answers the same 200 for a known and an unknown address, and it awaits `sendResetPassword`. A rejected send is logged with its error text, which can hold the link: our send function never rejects. `findUserByEmail` lower-cases the address (`db/internal-adapter.mjs`).
- **F4 Reset expiry is global.** `emailAndPassword.resetPasswordTokenExpiresIn` has no per-call value (`api/routes/password.mjs`). So the server uses 3 600 s and the CLIs build their own instance with 86 400 s.
- **F5 `/reset-password` order.** Token check, length check, hash, write, then `onPasswordReset`. `onPasswordReset` has no request body. A `hooks.before` error stops the request before any write.
- **F6 Sessions.** `/list-sessions` returns tokens and answers `403 SESSION_NOT_FRESH` after one day. `internalAdapter.listSessions` (`db/internal-adapter.mjs`) has neither problem. `/revoke-sessions` and `/revoke-other-sessions` run `hooks.after` with `ctx.context.session` set.
- **F7 Leaked-password plugin.** `plugins/haveibeenpwned` uses `betterFetch` with no timeout and no injectable `fetch`. S6b has its own `platform/pwned.ts`. The range API answers `SUFFIX:COUNT` lines; with `Add-Padding: true` padding lines have count 0.
- **F8 IMAP connect.** imapflow passes `{ host, servername, port, …tls }` to `net.connect` / `tls.connect`; the option `servername` sets the TLS name (`imapflow/lib/imap-flow.js`).
- **F9 SMTP connect.** nodemailer resolves a host name itself and skips that for an IP literal. The option `servername` sets the TLS name (`nodemailer/dist/esm/smtp-connection/index.js`, `dist/cjs/…`). It has no `lookup` option, so the guard passes an IP.

## Test setup

`bunfig.toml` has `[test] preload = ["./apps/server/test/preload.ts"]`. The preload sets `MAIL_ALLOW_LOCAL_HOSTS=true` (GreenMail runs on `127.0.0.1`) and calls `configureMailHosts`. The tests of the guard itself pass an explicit policy. A new entry script that imports `../modules/mail…` or `../composition` must call `configureMailHosts` after `loadConfig` (a unit test checks the list).

## Turn the auth-mail sender on

1. Get a domain with SPF, DKIM and DMARC records, and a provider with click and open tracking off (a tracked link stores the setup link at a third party).
2. Set `AUTH_SMTP_HOST`, `AUTH_SMTP_PORT` (465 with `AUTH_SMTP_SECURITY=tls`, or 587 with `starttls`), `AUTH_SMTP_USER`, `AUTH_SMTP_PASSWORD`, `AUTH_MAIL_FROM` in `.env`. Set all or none.
3. Restart the server. The start log says `auth mail: on (reset by e-mail is open)`. `/forgot` now sends mail and `request-password-reset` opens. Detail: `deploy/README.md` "Auth mail sender".

## What the next segments must do

- **S6c (Polish UI, language):** translate the stub legal page texts and the other new `en.ts` keys. The auth-mail texts exist in Polish and English already. `users.locale` exists and `org:invite --lang` sets it; a user with no locale gets Polish mails.
- **S6e (legal texts):** fill `/legal/{pl,en}/{privacy,terms,dpa}` and change `TERMS_VERSION` (`packages/core/src/web/terms.ts`) with each text change. A new version shows the blocking dialog to every member.
- **F078 (delete expired `auth_verifications`):** can start. Reset tokens are stored hashed since F059.
- **Open follow-up:** a mailbox whose host the guard refuses is only a `sync <id> failed: host not allowed` log line on every run. A planned ticket covers a status and a notice.
