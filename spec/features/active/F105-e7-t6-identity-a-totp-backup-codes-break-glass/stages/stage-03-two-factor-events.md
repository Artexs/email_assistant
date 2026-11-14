# F105 stage 03 — 2FA audit rows, code lock row, trusted-device and session end [risky]

Part of [`../plan.md`](../plan.md). Read its D5, D7, D8, D9, D10, D24, D25, "Facts checked" F4–F8 and "Rules for every stage" first. Lane A. Needs stage 02 (`signInAuditPlugin`, `web-two-factor.test.ts`, `apps/server/test/totp.ts`).

`[risky]`: authentication and audit. A review job checks it before the land.

One step. About 280 changed lines.

- [ ] **03.1 The plugin reports every 2FA change, one row per code lock, and ends old trusted devices when TOTP turns on**
  - Goal: TOTP on, TOTP off, new backup codes, every used backup code and a code lock are audit rows with ids and codes only; turning TOTP on ends every older trusted device and every other session of the user.
  - Files:
    - change `apps/server/src/platform/auth-two-factor.ts` (more paths and rules in `signInAuditPlugin`);
    - change `apps/server/src/platform/auth.ts` (`AuthEventKind`);
    - change `apps/server/src/modules/audit/repo.ts` (`auditEvents`);
    - change `apps/server/src/web.ts` (`eventNames`; it is `satisfies Record<AuthEventKind, string>`, so the typecheck finds a missing entry);
    - change `apps/server/test/integration/web-two-factor.test.ts` (new cases).
  - Interfaces:

    ```ts
    // platform/auth.ts
    export type AuthEventKind =
      | "login" | "password_set" | "password_changed" | "login_locked" | "sessions_revoked" | "other_sessions_revoked"
      | "two_factor_enabled" | "two_factor_disabled" | "backup_codes_generated" | "backup_code_used" | "two_factor_locked";

    // modules/audit/repo.ts, auditEvents (after webOtherSessionsRevoked)
    webTwoFactorEnabled: "web.two_factor_enabled", // data: via
    webTwoFactorDisabled: "web.two_factor_disabled", // data: via
    webBackupCodesGenerated: "web.backup_codes_generated", // data: via
    webBackupCodeUsed: "web.backup_code_used", // data: via
    webTwoFactorLocked: "web.two_factor_locked", // data: via, locked_until

    // web.ts eventNames: the five new kinds → the five new auditEvents values
    ```

    `platform/auth-two-factor.ts` imports `APIError` from `better-auth/api` too.

    `SIGN_IN_AUDIT_PATHS` gets `/two-factor/disable` and `/two-factor/generate-backup-codes`. The plugin also gets one before hook (plan D7, cold review 1 N3):

    ```ts
    // signInAuditPlugin(report).hooks.before — the panel never sends disableSession; on the sign-in path it would use up a code with no session and no row.
    { matcher: (context) => context.path === "/two-factor/verify-backup-code",
      handler: createAuthMiddleware(async (ctx) => {
        if ((ctx.body as { disableSession?: unknown } | undefined)?.disableSession === true) {
          throw APIError.from("BAD_REQUEST", { code: "DISABLE_SESSION_REFUSED", message: "disableSession is not supported." });
        }
      }) }
    ```

    New after-hook rules (after the stage 02 rules; `user` of a session = `requestSession.user`):
    1. `/two-factor/verify-totp`, not an `APIError`, `requestSession` set, `twoFactorOn(requestSession.user)` false (the snapshot from before the request, Fact F4), `newSession` set → this is the enrolment (Fact F2: it replaces the session; a code check of a user who already has TOTP makes no new session, and the snapshot rule also stops a session refresh from counting). Then, in this order (D9):
       - `await ctx.context.adapter.deleteMany({ model: "verification", where: [{ field: "value", value: userId }] })` (trust rows, Fact F6);
       - `const others = (await ctx.context.internalAdapter.listSessions(userId)).filter((row) => row.id !== newSession.session.id).map((row) => row.token)`; when not empty, `await ctx.context.internalAdapter.deleteSessions(others)` (every session that never passed a second factor; cold review 1 N1);
       - `report("two_factor_enabled", userId)`.
       A failed purge is compensated (D9, fail closed): the hook sets `users.two_factor_enabled` false and deletes the `auth_two_factors` row in one transaction (`log.warn("two_factor_enrol_rollback", { user_id })`; `two_factor_enrol_rollback_failed` if that fails) and rethrows, so the answer is a 500, the user is not enrolled, old access is unchanged and a retry works. A test pins it. The purge reads the sessions first, then deletes the trust rows, then the sessions.
    2. `/two-factor/verify-backup-code`, not an `APIError` → `report("backup_code_used", userId)` on every success: `userId` = `newSession.user.id` on the sign-in path (after the `login` row of stage 02), else `requestSession.user.id` (a signed-in user who checks a code). No user id (should not happen) → no row.
    3. `/two-factor/disable`, not an `APIError`, `requestSession` set → `report("two_factor_disabled", requestSession.user.id)`.
    4. `/two-factor/generate-backup-codes`, not an `APIError`, `requestSession` set → `report("backup_codes_generated", requestSession.user.id)`.
    5. `/two-factor/verify-totp` or `/two-factor/verify-backup-code`, `returned` is an `APIError` with `statusCode === 401` and `body.code` `INVALID_CODE` or `INVALID_BACKUP_CODE`, `requestSession` null → `reportLockOnce(ctx, report)`:
       - `id = await ctx.getSignedCookie(ctx.context.createAuthCookie("two_factor").name, ctx.context.secret)`; none → return;
       - `challenge = await ctx.context.internalAdapter.findVerificationValue(id)`; none → return; `userId = challenge.value`;
       - `row = await ctx.context.adapter.findOne<{ failedVerificationCount?: number | null; lockedUntil?: Date | null }>({ model: "twoFactor", where: [{ field: "userId", value: userId }] })`;
       - report `two_factor_locked` with `{ locked_until: row.lockedUntil.toISOString() }` only when `row.failedVerificationCount === TWO_FACTOR_LOCK.maxFailedAttempts` and `row.lockedUntil > new Date()` (D8: the request whose failure reached 10).
       - Wrap this rule in `try`/`catch`: an error logs `log.error("two_factor_lock_report_failed", { ...errorFields(error) })` and never changes the answer.
    6. The data of every row is `{ via: "web" }` (added by `auditWebEvent`) plus `locked_until` for the lock. Never a code, a secret, a URI or an address.
  - Decisions: D5, D7, D8, D9, D24, D25.
  - Test (`web-two-factor.test.ts`, the helpers of stage 02; audit rows read from `audit_log` of the user's organization):
    1. Enrolment (as stage 02 case 5) writes one `web.two_factor_enabled` row (`data = { via: "web" }`, actor = the user) and no `web.login` row.
    1a. Other sessions end (N1): before the enrolment, sign the user in a second time in jar B (password only, TOTP still off); enrol in jar A; then `GET /get-session` with jar B → null, the user has exactly one `auth_sessions` row (jar A's new session), and jar A's `get-session` returns the user.
    2. A code check with a session for a user who already has TOTP (`verify-totp` with the session and a right code) → 200 and no new `web.two_factor_enabled` row.
    3. Trusted device ends: enrol, sign in with `trustDevice: true` in jar A (keep its `ea.trust_device`), then in jar B (no trust cookie: the plugin's own disable deletes only the trust row of the calling device, Fact F7) sign in with a code, turn TOTP off (`/two-factor/disable { password }`) and enrol again; before the second enrolment, assert that jar A's trust row still exists (one `auth_verifications` row with `value` = the user id and an `expires_at` about 30 days ahead); then a jar with only the old `ea.trust_device` → `/sign-in/email` answers `twoFactorRedirect: true` (no session). The user has no `auth_verifications` row from before the second enrolment.
    4. Backup-code sign-in writes `web.login` (`second_factor: "backup_code"`) and one `web.backup_code_used`.
    4a. Session path (N3): a signed-in enrolled user calls `verify-backup-code { code: <unused code> }` with the session → 200; one more `web.backup_code_used` (actor the user), no `web.login`; `auth.api.viewBackupCodes` shows one code fewer.
    4b. `verify-backup-code { code: <unused code>, disableSession: true }` on a sign-in challenge → 400 `DISABLE_SESSION_REFUSED`; the code count does not change, no session, no row; the same with a session → 400 too.
    5. `/two-factor/disable { password }` → one `web.two_factor_disabled`; with a wrong password → 400 `INVALID_PASSWORD` and no row.
    6. `/two-factor/generate-backup-codes { password }` → 10 new codes, one `web.backup_codes_generated`; an old code then fails at sign-in (401 `INVALID_BACKUP_CODE`).
    7. Code lock: 10 wrong sign-in codes over two challenges (5 + 5; the sixth try of a challenge ends it, so start a new challenge after 5) → the tenth answer is 401 `INVALID_CODE` and the row has `locked_until` in the future; exactly one `web.two_factor_locked` row with `data.locked_until` equal to the row's `locked_until` (ISO); a new challenge with the right code → 429 `ACCOUNT_TEMPORARILY_LOCKED`, and no second lock row.
    8. After test 7, set `locked_until` to one minute ago with SQL; a new challenge with the right code → 200 and a session (the plugin clears the lock); no new lock row.
    9. No captured console line holds (`holdsToken`, stage 02) a secret, `otpauth`, a backup code or a typed code (a 6-digit code as a whole token only); no audit row's `data` holds a key other than `via`, `second_factor`, `locked_until`.
  - Check: `bun test apps/server/test/integration/web-two-factor.test.ts apps/server/test/integration/web-auth.test.ts apps/server/src/platform`; `bun run typecheck`; `bun run lint`.
  - Done when: tests 1, 1a, 2–4, 4a, 4b and 5–9 pass and the stage 02 cases still pass.
  - Out of scope: the security-log kinds (stage 13); the operator rule (stage 04); break-glass and the disable refusal (stages 05, 06); the reset (stage 07).

## Done when

- Step 03.1 is done and committed by explicit paths.
- The Proof command of `plan.md` for stage 03 (`/tmp/f105-s03`) prints `PROOF_OK`.
