# Two-factor sign-in (F105): what a later agent needs

Docs: `docs/capabilities/web-panel.md` rules 3, 4, 8, 9; `docs/architecture.md` §7; `docs/decisions/0026-identity-tier-1-oidc-totp.md` (amendment); `deploy/README.md` § Two-factor sign-in. The plan with all decisions: `spec/features/active/F105-e7-t6-identity-a-totp-backup-codes-break-glass/plan.md`.

## Facts of Better Auth 1.7.18 that the code relies on

- **F3, hook order.** For a sign-in with TOTP on, the plugin's after hook deletes the session it made and sets `newSession` to null. A plugin listed after `twoFactorPlugin()` sees `newSession: null`. So `signInAuditPlugin` (`platform/auth-two-factor.ts`) must stay last in `plugins` (`platform/auth.ts`). The user hooks of `auth.ts` run first and still see the new session.
- **F4, clocks.** The plugin uses `Date.now()`, not `AuthDeps.now`. A test computes the code with the real clock (`totpCode` in `apps/server/test/totp.ts`) and moves a lock into the past with SQL. No test fixes the clock for the code step. Codes match at one 30 s step either side. The same code works again inside its window (accepted).
- **F5, limits.** 5 wrong codes end one challenge. 10 failed sign-in codes lock the user for 900 s (`429`, also for a right code). Codes checked with a session (enrolment) do not count. The plugin allows 3 calls per 10 s per client address on `/two-factor/*`. A test uses a new `x-client-ip` for each call (`nextIp()`).
- **F6, trusted devices** are rows of `auth_verifications` with `value` = the user id. The identifier is hashed, so a delete goes by `value`. "Sign out everywhere" ends sessions, not these rows. Turning TOTP on and the operator reset both delete them by `value`.
- **D22, mixed states.** The plugin writes without a transaction. A crash between two writes can leave `users.two_factor_enabled` true with no verified secret (TOTP code fails, backup codes work), or the flag false with a row left (`TOTP_ALREADY_ENABLED` on the next enable). `web:two-factor-reset` repairs both.
- Two parallel `enable` calls give two 200 answers and one row; the second write wins. The Account section blocks a double submit (`two-factor-flow.ts`).

## Tests and e2e

- The e2e spec `apps/web/e2e/tests/two-factor.spec.ts` uses the address blocks 50 (mobile) and 150 (desktop) through `nextAddress`. Do not reuse these blocks in another spec.
- Server tests are in `apps/server/test/integration/` (`web-two-factor.test.ts`, `web-two-factor-status.test.ts`, `two-factor-reset.test.ts`, `break-glass.test.ts`, `auth-two-factor-schema.test.ts`, `web-two-factor-reset-cli.test.ts`) with `two-factor-helpers.ts`.

## For later tickets

- Identity B (F119): a session made by an SSO callback skips the plugin's code step. For a user with TOTP on, F119 must ask for the code after the callback, or mark SSO sessions and make `requireOperator` and the break-glass rule read that mark. The operator rule reads `users.two_factor_enabled` (not the proof of a code).
- Break-glass reads (`isBreakGlassOwner`, `listBreakGlassOrgIdsOfUser`) run only with no tenant scope: RLS limits them to one organization inside an `/api` request.
- Polish texts of the panel (`tf_*`, `sec_kind_*` in `apps/web/src/i18n/pl.ts`) use the informal "ty". Five texts were reworded at stage 11 (`tf_on_text`, `tf_required_operator`, `tf_required_break_glass`, `tf_scan_step_app`, `tf_codes_help`); the stage 11 file table holds the final wording. No capability page lists these texts.
- The VPS rollout (stage 15) ships stages 01–14 in one deploy: an operator without TOTP is refused by the console until the owner turns TOTP on (owner step U1).
