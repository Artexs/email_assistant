> **Status 2026-11-12 — planned.** Left: the detailed stage plan (an own `plan-task` session), then the build with `run-task`.

# S6b Public login: auth mail, invite, terms, hardening

Scope: the S6 master plan `tasks/active/s6-pre-sale.md` (findings 10 and 11, P2, P8, P9, P11, D7–D11, D31 (auth mail event), "Rules for every step"). Also replaces `tasks/planned/web-public-hardening.md` and `tasks/planned/web-hashed-reset-tokens.md` (move them to `done/` with a pointer when this segment is done). Needs: S6a merged.
Git mode: worktree (`task/s6b-public-login`). Run mode: pipeline. Review model: stronger reviewer (Opus, high) for every stage; security group review at the end.

## Goal

The login holds up on the public internet, and a customer gets in only through an e-mailed invite: the server sends invite, reset and lockout mails, the reset request leaks nothing, failed sign-ins lock the account for a short time, leaked passwords are refused, and the first password set records the accepted terms.

## Done when

- With the `AUTH_SMTP_*` keys set, `org:invite` makes the organization and the owner and mails the setup link (GreenMail in tests); without the keys the server starts and works as in S5 (`request-password-reset` 404, the CLI prints the link).
- `/forgot` opens without a session (no redirect; test). `POST /api/auth/request-password-reset` gives the same status and body for a known and an unknown address, and the request does not wait for the mail send (test with a slow fake SMTP), the rate limits of D8 hold (test), and the link of a reset is valid 1 h (server) and of an invite 24 h (CLI), through an `AuthDeps` field.
- A failed auth mail is a `warn` line with the user id and the code, and an operator notice (D31).
- 10 failed sign-ins in 15 min lock the user for 15 min; the answer and about the time are the same as a wrong password (a locked attempt hashes a dummy password); one lockout mail per lock, at most 3 per user per day; a correct password during the lock fails; after 15 min it works; a password reset clears the lock (fixed-clock tests).
- A password from the Have I Been Pwned list is refused on setup, reset and change (test with a fake range API; the plugin is off in the other tests); the API down → "try again later" and no password change.
- The Account card lists the sessions (device text, address, last use) and "sign out everywhere" writes an audit row.
- `host-check.ts` also refuses `100.64.0.0/10`, `198.18.0.0/15` and `192.0.0.0/24`; every IMAP and SMTP connect (form, sync, send) uses a `lookup` that refuses a local answer, so a host name that resolves to a local address later is refused at the next sync (tests with a fake resolver).
- Reset tokens are stored hashed (a DB read in the test finds no raw token).
- `/setup` needs the terms checkbox; the same request sets the password and `users.terms_version` and `terms_accepted_at` (a request without the acceptance changes nothing; test); a newer `TERMS_VERSION` shows the blocking dialog after sign-in (Playwright). `TERMS_VERSION` is in `packages/core`; the stub pages `/legal/{pl,en}/{privacy,terms,dpa}` exist and open without a session (S6e fills them).
- `docs/architecture.md` §7 lists the controls; `deploy/README.md` lists the new env keys, the DNS records of the sender (SPF, DKIM, DMARC) and "tracking off"; ADR 0016 has the amendment of D7 and D8.

## Owns (from the master plan)

- Decisions D7 (auth mail sender, ADR 0016 amendment), D8 (`/forgot`, reset without enumeration, expiry in `AuthDeps`, the send not awaited), D9 (`org:invite`, `web:invite` mails and resends the link), D10 (terms acceptance, `TERMS_VERSION`, stub legal pages, `PUBLIC_PAGE_PATHS`), D11 (lockout, Have I Been Pwned, sessions, address check on every connect, hashed tokens), D31 (auth mail event).
- Files (expected): `apps/server/src/platform/auth.ts`, `platform/config.ts`, a new `platform/auth-mail.ts` (sender and the three mail texts in `pl` and `en`), `scripts/org-invite.ts`, `scripts/web-invite.ts`, `modules/tenancy` (terms columns), the connect service host check in `modules/mail`, `apps/web/src/components/auth/*`, `components/settings/AccountCard.tsx`, `apps/web/src/i18n/en.ts`, `packages/core` (`TERMS_VERSION`, schemas), a migration `<version>_auth_public.sql` (users: `terms_version`, `terms_accepted_at`, `locale`; the lockout store), Playwright specs.

## Stage sketch

0. **Spikes**: Better Auth 1.7.18 in `node_modules`: a per-user lockout hook (`hooks.before` on `/sign-in/email`, or a wrapper in our route), the timing of an unknown address, `verification.storeIdentifier: "hashed"`, `advanced.backgroundTasks.handler`, `hooks.before` / `after` on `/reset-password` with the body; the HIBP plugin with a fake fetch. Write the facts to `notes/`.
1. **Auth mail sender**: env keys and the all-or-none check, `nodemailer` transport with certificate checks and a timeout, the three mail texts (no link in any log), unit tests with GreenMail.
2. **Reset request** `[risky]`: allow-list, `/forgot` page in `PUBLIC_PAGE_PATHS`, the same answer, the not-awaited send, the rate limits, the expiry field in `AuthDeps`; the S5 block removed; the operator event; tests.
3. **Invite** `[risky]`: `org:invite` (one transaction; trial dates from S6a), `web:invite` mails (with `--print`), the "user exists" exit; tests.
4. **Lockout** `[risky]`: the store (migration), the counter and the lock, the lockout mail, the same answer; fixed-clock tests.
5. **Leaked passwords and hashed tokens** `[risky]`: the HIBP plugin (fail closed), `storeIdentifier: "hashed"`; old plain tokens stop working (a new invite replaces them).
6. **Terms acceptance** `[risky]`: columns, `TERMS_VERSION`, the stub legal pages, the setup checkbox and the hooks (one request), the blocking dialog, audit row; Playwright without a session for the stubs.
7. **Sessions**: the session list and the audit row of "sign out everywhere" (B13); tests.
8. **Mail host address check** `[risky]`: the new ranges in `host-check.ts`, the `lookup` for every IMAP and SMTP connect; tests with a fake resolver.
9. **Docs, staging check and group review** (checkpoint 2): architecture §7, runbook, ADR 0016 amendment, notes; a run on staging with the real sender (U2): invite, reset, lockout mail arrive; SPF, DKIM, DMARC pass in the received headers; the link in the mail is not rewritten (tracking off).

## Questions for the plan session

- The texts of the three mails (pl, en) and the sender name.
- The Account card session list layout (default: one row per session, "this device" mark, no per-session revoke in S6).
- Whether the lockout mail goes also to the other owners of the organization (default: no).

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap); related ADRs set to accepted or superseded.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log

- 2026-11-12: Created by the S6 master plan session (`tasks/active/s6-pre-sale.md`).
