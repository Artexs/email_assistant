# F119 stage 06 — "SSO required" refuses passwords

Part of [`../plan.md`](../plan.md). `[risky]` (auth). Needs stage 05. No switch exists yet: tests set `organizations.sso_required` by SQL; stage 08 adds the CLI.

## Step 06.1 — The refusal rule

**Goal.** ADR 0026 point 6: members of an "SSO required" organization cannot use a password, except the break-glass owner with password and TOTP.

**Files.** Tenancy repo `repo/sso.ts`, `platform/auth.ts` (the `before` and `after` hooks of `/sign-in/email` and `/request-password-reset`), `web.ts`.

**Interfaces.**
- `isPasswordSignInRefused(db: Db, userId: string): Promise<boolean>` — true when the user has a membership in an organization with `sso_required = true` and not (`memberships.break_glass` in that organization and `users.two_factor_enabled`). Any such organization is enough (a user in two organizations; D16). No tenant scope (inside `/api/auth/*`, as `isBreakGlassOwner`). The flag `sso_sign_in` does not change the answer (D8, Q5).
- `AuthDeps.passwordSignInRefused?: (userId: string) => Promise<boolean>` — absent = never refused (CLIs, old tests). Not caught: an error fails the request with 500 (fail closed, as `keepsTwoFactor`).

**Decisions.** D8, D16.

- **Sign-in.** In the `before` hook of `/sign-in/email`, after the lockout check: find the user by the lower-cased e-mail; if refused, override `password.verify` as `lockSignIn` does (run the real verify, then answer false). The answer is Better Auth's own `401 INVALID_EMAIL_OR_PASSWORD`, same status and body as a wrong password. Mark the request (a `WeakMap` on the context, as F105 does) so `countSignIn` records no failure: no lockout count, no lock mail. One `log.info("password_sign_in_refused_sso", { user_id })`. No audit row (a flood of tries must not fill the security log).
- **Order with the lockout.** A locked user gets the lockout answer first (unchanged); both look like a wrong password.
- **Reset request.** In the `before` hook of `/request-password-reset`, after the address limit: if the address belongs to a refused user, answer `RESET_REQUEST_ANSWER` at once; no mail, no token row. `log.info("reset_request_refused_sso", { user_id })`.
- **Not changed.** `/reset-password` with a token (the operator's `web:invite` link) still sets a password; the sign-in stays refused. `/change-password`, `/two-factor/*`: unchanged. SSO sign-in: unchanged.
- **The break-glass owner with TOTP off** (F105 D12 race): refused like any member.

**Test** (`apps/server/test/integration/web-sso-required.test.ts`, new; org A with `sso_required = true`; every user has a password `correct-horse-battery-1`):

1. Member Ann, right password: `401` with `code: INVALID_EMAIL_OR_PASSWORD`, the same JSON body as test 2; no session; one `password_sign_in_refused_sso` line with Ann's id.
2. Ann, wrong password: the same `401` and body.
3. Ann, right password 12 times (fresh `x-client-ip` each): no `auth_lockouts` row with a count, no lock mail (fake `sendLockoutMail` not called), the 12th answer is still `401`.
4. Break-glass owner Olaf (`break_glass = true`, TOTP on): right password → `twoFactorRedirect`; with the TOTP code → a session.
5. Olaf with `break_glass = true` and TOTP off (SQL): refused as in 1.
6. Owner Pia without `break_glass`, TOTP on: refused.
7. Org A with `sso_required = false`: Ann signs in with the password.
8. Cara in org B (no SSO required): signs in. Dan in A and B: refused.
9. Flag `sso_sign_in` off for A: Ann is still refused.
10. Reset request for `ann@x.test`: `RESET_REQUEST_ANSWER`, no `auth_verifications` row, the fake reset sender not called. For `olaf@x.test` (break-glass, TOTP on): the normal flow (sender called).
11. Ann signs in by SSO (stage 04 setup): works.
12. `passwordSignInRefused` throws: `/sign-in/email` answers 500, no session.
13. Log capture over 1–12: no password, no e-mail address.

**Check.** The Proof of `plan.md` (`/tmp/f119-s06`).

**Done when.** The thirteen tests pass; the F082 lockout tests and the F105 two-factor tests still pass; Proof prints `PROOF_OK`.

**Out of scope.** The CLI switch and its prerequisites (stage 08), texts on the login page (stage 11).
