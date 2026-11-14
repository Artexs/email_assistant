> **Status 2026-11-14 — Done: built as Limen ticket F082 and deployed to the home VPS (d117cd6).** Earlier: planned as Limen ticket F082 (`spec/features/planned/F082-s6b-public-login/`: ticket, plan, 15 stage files). This file is history; the F082 plan wins where they differ. Stage 15 of F082 moves this file to `tasks/done/`.

# S6b Login hardening: auth mail (off), invite, terms, lockout

> **Scope change 2026-11-12:** local production on the home VPS, no outside customers (master plan § "Scope change", P16–P24). This file is updated for it; the plan session reads that section first.

Scope: the S6 master plan `tasks/active/s6-pre-sale.md` (findings 10 and 11, P2, P8, P9, P11, D7–D11, D31 (auth mail event), "Rules for every step"). Also replaces the Limen tickets `spec/features/planned/F056-web-public-hardening/` and `F059-web-hashed-reset-tokens/` (close them with an `outcome.md` when this segment is done). The scope change keeps P18: hardening yes, public domain no, the sender built but off. Needs: S6a merged.
Git mode: worktree (`task/s6b-public-login`). Run mode: pipeline. Review model: stronger reviewer (Opus, high) for every stage; security group review at the end.

## Goal

The login has the production shape, although the panel stays behind Tailscale: a user gets in only through an invite link, the reset request leaks nothing, failed sign-ins lock the account for a short time, leaked passwords are refused, and the first password set records the accepted terms. The auth-mail sender exists and is tested, but stays off on the VPS: the CLI prints the invite and reset links (P18).

## Done when

- With the `AUTH_SMTP_*` keys set, `org:invite` makes the organization and the owner and mails the setup link (GreenMail in tests); without the keys (the VPS) the server starts and works as in S5 (`request-password-reset` 404, `org:invite` and `web:invite` print the link).
- `/forgot` opens without a session (no redirect; test). `POST /api/auth/request-password-reset` gives the same status and body for a known and an unknown address, and the request does not wait for the mail send (test with a slow fake SMTP), the rate limits of D8 hold (test), and the link of a reset is valid 1 h (server) and of an invite 24 h (CLI), through an `AuthDeps` field.
- A failed auth mail is a `warn` line with the user id and the code, and an operator notice (D31).
  The notice goes through `createOperatorNotices` (`apps/server/src/modules/channels/operator.ts`, built in S6a): add a kind `auth_mail_failed` to `OperatorNoticeKind` and one public method like `capReached` (never throws, never blocks the request). The key holds the user id, the code and the day, so the dedup by audit key (`operator.notice`, `hasAuditKey`) gives one notice per user and day. The text holds ids and codes only.
- 10 failed sign-ins in 15 min lock the user for 15 min; the answer and about the time are the same as a wrong password (a locked attempt hashes a dummy password); one lockout mail per lock, at most 3 per user per day; a correct password during the lock fails; after 15 min it works; a password reset clears the lock (fixed-clock tests).
- A password from the Have I Been Pwned list is refused on setup, reset and change (test with a fake range API; the plugin is off in the other tests); the API down → "try again later" and no password change.
- The Account card lists the sessions (device text, address, last use) and "sign out everywhere" writes an audit row.
- `host-check.ts` also refuses `100.64.0.0/10`, `198.18.0.0/15` and `192.0.0.0/24`; every IMAP and SMTP connect (form, sync, send) uses a `lookup` that refuses a local answer, so a host name that resolves to a local address later is refused at the next sync (tests with a fake resolver).
- Reset tokens are stored hashed (a DB read in the test finds no raw token).
- `/setup` needs the terms checkbox; the same request sets the password and `users.terms_version` and `terms_accepted_at` (a request without the acceptance changes nothing; test); a newer `TERMS_VERSION` shows the blocking dialog after sign-in (Playwright). `TERMS_VERSION` is in `packages/core`; the stub pages `/legal/{pl,en}/{privacy,terms,dpa}` exist and open without a session (S6e fills them).
- `docs/architecture.md` §7 lists the controls; `deploy/README.md` lists the new env keys (empty on the VPS) and says what a real sender would need (SPF, DKIM, DMARC, tracking off) without a provider account; ADR 0016 has the amendment of D7 and D8.

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
9. **Docs, VPS check and group review** (checkpoint 2): architecture §7, runbook, ADR 0016 amendment, notes; the deploy to the home VPS with the user's go; on the VPS: `org:invite` prints a link, the setup with the terms checkbox works, 10 wrong passwords lock the test user, a leaked password is refused. No real mail provider (P18).

## Questions for the plan session

- The texts of the three mails (pl, en) and the sender name (used only in tests and when someone turns the sender on).
- The Account card session list layout (default: one row per session, "this device" mark, no per-session revoke in S6).
- Whether the lockout mail goes also to the other owners of the organization (default: no).

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap); related ADRs set to accepted or superseded.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log

- 2026-11-12: Created by the S6 master plan session (`tasks/active/s6-pre-sale.md`).
