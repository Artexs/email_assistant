# F105 stage 02 — Plugin, allow-list, sign-in row [risky]

Part of [`../plan.md`](../plan.md). Read its D1, D3, D4, D5, D6, D22, D24, D25, "Facts checked" F1–F6, F9, F10 and "Rules for every stage" first. Lane A. Needs stage 01 (the tables).

`[risky]`: authentication. A review job checks it before the land. The reviewer tries to get a session without the code, and searches the captured logs for the secret and the codes.

One step. About 300 changed lines (half of it the integration test).

- [ ] **02.1 The two-factor plugin on the auth handle, the allow-list, and the `web.login` row after the code step**
  - Goal: a member can turn TOTP on through the Better Auth endpoints, a member with TOTP signs in only with a code, a backup code or a trusted device, and each finished sign-in writes one `web.login` row that names the second factor.
  - Files:
    - add `apps/server/src/platform/auth-two-factor.ts` and `apps/server/src/platform/auth-two-factor.test.ts`;
    - change `apps/server/src/platform/auth.ts` (imports, `AUTH_ALLOWED_PATHS`, `plugins`, remove the login database hook);
    - change `apps/server/src/platform/auth.test.ts` (the allow-list size and the new paths);
    - add `apps/server/test/totp.ts` and `apps/server/test/totp.test.ts`;
    - add `apps/server/test/integration/web-two-factor.test.ts`;
    - change `apps/server/test/integration/web-auth.test.ts` only if a `web.login` assertion compares the whole `data` (today it counts rows only).
  - Interfaces:

    ```ts
    // platform/auth-two-factor.ts
    import { type BetterAuthPlugin } from "better-auth";
    import { createAuthMiddleware, isAPIError } from "better-auth/api";
    import { twoFactor } from "better-auth/plugins";
    import type { AuthEventKind } from "./auth"; // type-only: no runtime cycle

    export const TWO_FACTOR_LOCK = { maxFailedAttempts: 10, durationSeconds: 900 } as const;
    export const TRUST_DEVICE_SECONDS = 2_592_000; // 30 days
    export const BACKUP_CODE_COUNT = 10;

    // plan D3: the only /two-factor/* paths that reach Better Auth.
    export const TWO_FACTOR_ALLOWED_PATHS = [
      "/two-factor/enable",
      "/two-factor/disable",
      "/two-factor/verify-totp",
      "/two-factor/verify-backup-code",
      "/two-factor/generate-backup-codes",
    ] as const;

    // plan D1
    export function twoFactorPlugin() {
      return twoFactor({
        issuer: "Email Assistant",
        trustDeviceMaxAge: TRUST_DEVICE_SECONDS,
        accountLockout: { enabled: true, ...TWO_FACTOR_LOCK },
        backupCodeOptions: { amount: BACKUP_CODE_COUNT, length: 10, storeBackupCodes: "encrypted" },
        schema: {
          user: { fields: { twoFactorEnabled: "two_factor_enabled" } },
          twoFactor: {
            modelName: "auth_two_factors",
            fields: {
              userId: "user_id",
              backupCodes: "backup_codes",
              failedVerificationCount: "failed_verification_count",
              lockedUntil: "locked_until",
            },
          },
        },
      });
    }

    export type AuthReport = (kind: AuthEventKind, userId: string, data?: Record<string, string>) => Promise<void>;

    // plan D5: listed AFTER twoFactorPlugin() in `plugins`, so it sees the result of the code step (Fact F3).
    export function signInAuditPlugin(report: AuthReport) {
      return {
        id: "ea-sign-in-audit",
        hooks: { after: [{ matcher: (context) => SIGN_IN_AUDIT_PATHS.has(context.path ?? ""), handler: createAuthMiddleware(async (ctx) => { /* rules below */ }) }] },
      } satisfies BetterAuthPlugin;
    }
    // SIGN_IN_AUDIT_PATHS = "/sign-in/email", "/two-factor/verify-totp", "/two-factor/verify-backup-code" (stage 03 adds more)
    ```

    Rules of the handler (D5; `returned` = `ctx.context.returned`; `newSession` = `ctx.context.newSession`; `requestSession` = `ctx.context.session`):
    1. `isAPIError(returned)` → return (no row).
    2. `/sign-in/email`, `newSession` set → `report("login", newSession.user.id, { second_factor: twoFactorOn(newSession.user) ? "trusted_device" : "none" })`. `newSession` is null when the plugin asked for a code (F3): no row.
    3. `/two-factor/verify-totp` or `/two-factor/verify-backup-code`, `requestSession` null, `newSession` set → `report("login", newSession.user.id, { second_factor: "totp" | "backup_code" })`. With `requestSession` set (the enrolment check), no login row (stage 03 adds `two_factor_enabled`).
    4. `twoFactorOn(user)` = `(user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled === true`.
    5. `report` is the `report` of `createBetterAuth` (it never throws into Better Auth).

    `platform/auth.ts` changes:
    - `AUTH_ALLOWED_PATHS = new Set([...the 7 paths, ...TWO_FACTOR_ALLOWED_PATHS])` (12 entries; the comment names plan D3).
    - `betterAuth({ …, plugins: [twoFactorPlugin(), signInAuditPlugin(report)] })`.
    - Remove `databaseHooks.session` (the `login` report on `/sign-in/email`): it fires before the code step (F3). Keep `databaseHooks.account` (`password_changed`).
    - `countSignIn` and `lockSignIn` stay as they are (D6). No change to `AuthDeps` in this stage.

    `apps/server/test/totp.ts` (RFC 6238, `node:crypto` only):

    ```ts
    export function base32Decode(input: string): Buffer; // RFC 4648 alphabet, no padding needed
    export function totpCode(secretBase32: string, atMs: number = Date.now()): string; // HMAC-SHA1, counter = floor(atMs / 30_000), 6 digits
    export function secretOfUri(uri: string): string; // new URL(uri).searchParams.get("secret"), throws when missing
    // plan § Rules, Secrets: a 6-digit code matches only as a whole token (/(^|\D)123456(\D|$)/); any other value as a substring.
    export function holdsToken(line: string, token: string): boolean;
    ```

  - Decisions: D1, D3, D4, D5, D6, D22, D24, D25.
  - Test:
    - `totp.test.ts` (runs in `test:int`, it is under `apps/server/test`):
      1. RFC 6238 vector: `totpCode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59_000)` = `"287082"`; at `1_111_111_109_000` = `"081804"`.
      2. `secretOfUri("otpauth://totp/A:b?secret=JBSWY3DP&issuer=A")` = `"JBSWY3DP"`.
      2a. `holdsToken("code 123456 sent", "123456")` and `holdsToken("123456", "123456")` are true; `holdsToken("ms=1234567", "123456")` and `holdsToken("id 91234560", "123456")` are false; `holdsToken("x abcde-12345 y", "abcde-12345")` and `holdsToken("xxotpauth://", "otpauth")` are true.
    - `auth-two-factor.test.ts` (unit):
      3. `TWO_FACTOR_ALLOWED_PATHS` has the five paths and no `get-totp-uri`, `send-otp`, `verify-otp`.
    - `auth.test.ts`: 4. `AUTH_ALLOWED_PATHS.size` is 12 (update the three old size checks); each of the five paths passes with POST; `/two-factor/get-totp-uri`, `/two-factor/send-otp`, `/two-factor/verify-otp`, `/two-factor/view-backup-codes`, `/two-factor/generate-totp` are refused with POST and GET.
    - `web-two-factor.test.ts` (integration; one `createAuth` handle as in `web-lockout.test.ts`: `onEvent: auditWebEvent(db)`, `onTermsAccepted: termsAcceptedHandler(db, …)`, `resetLinkTtlSeconds: 86_400`, `sendResetPassword` captures the link; owners from `createOrganizationWithOwner` with `@x.test` addresses and the password set through a captured reset link with `resetBody`; cleanup in `afterEach` as in `web-lockout.test.ts`, including `auth_verifications` by `value`). Drive the endpoints through `handle.auth.handler(new Request(…))` with a small cookie jar per client (store each `set-cookie` name and value; drop a cookie with `Max-Age=0`), headers `origin: BASE_URL` and a fresh `x-client-ip` per request (`nextIp()`). Capture `console.log`, `console.warn`, `console.error` for the whole file.
      5. Enrol: sign in (no 2FA) → `POST /two-factor/enable { password }` → 200 with `totpURI` and 10 `backupCodes`, each matching `/^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/`; the row has `verified = false`, `users.two_factor_enabled = false`. `POST /two-factor/verify-totp { code: totpCode(secretOfUri(uri)) }` → 200; then `verified = true`, `two_factor_enabled = true`, and the session cookie value changed (the old session row is gone).
      6. `enable` with a wrong password → 400 `INVALID_PASSWORD`, no row. `enable` with `method: "otp"` → 400 `OTP_NOT_CONFIGURED`.
      7. Sign-in of the enrolled user → 200 `{ twoFactorRedirect: true, twoFactorMethods: ["totp"] }`, the jar holds `ea.two_factor` and no `ea.session_token`, the user has no `auth_sessions` row, and the `web.login` count did not change.
      8. Then `verify-totp` with the right code → 200 and a session cookie; `GET /get-session` returns the user; exactly one new `web.login` row with `data = { via: "web", second_factor: "totp" }`.
      9. New challenge, `verify-backup-code` with code 1 → session, `web.login` with `second_factor: "backup_code"`; a further new challenge with code 1 again → 401 `INVALID_BACKUP_CODE`, no session.
      10. New challenge, `verify-totp { code: "000000" }` five times → 401 `INVALID_CODE` each (use a code that is not the current one: if `000000` happens to be current, use `111111`); the sixth → 400 `TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE`; no session; reset the row's `failed_verification_count` to 0 with SQL after this case (it counts toward the account lock of stage 03).
      11. `verify-totp` with no `ea.two_factor` cookie and no session → 401 `INVALID_TWO_FACTOR_COOKIE`.
      12. Trusted device: a challenge verified with `trustDevice: true` sets `ea.trust_device`; a new jar with only that cookie → `/sign-in/email` returns 200 with a session (no `twoFactorRedirect`) and one `web.login` with `second_factor: "trusted_device"`.
      13. A user without TOTP signs in → `web.login` with `second_factor: "none"`.
      14. Password reset of the enrolled user (captured link, `resetBody`) → 200; the next sign-in still answers `twoFactorRedirect: true` (F10).
      15. Two `enable` calls of one session at once (`Promise.all`) → exactly one `auth_two_factors` row for the user; at least one answer is 200; if one answer is 500, no captured line holds a secret (D22).
      16. A user locked by the password lockout (a second handle with `lockout: createLockoutStore(db)` and a fixed `now`, 10 wrong passwords) signs in with the right password → 401 `INVALID_EMAIL_OR_PASSWORD`, no `ea.two_factor` cookie (D6).
      17. Over the whole file: no captured console line holds (`holdsToken`) any enrolment secret, the text `otpauth`, any backup code, or any typed code of these tests (a 6-digit code as a whole token only).
  - Check: `bun test apps/server/src/platform apps/server/test/totp.test.ts apps/server/test/integration/web-two-factor.test.ts apps/server/test/integration/web-auth.test.ts apps/server/test/integration/web-lockout.test.ts apps/server/test/integration/web-auth-logs.test.ts`; `bun run typecheck`; `bun run lint`.
  - Done when: tests 1, 2, 2a and 3–17 pass; the old auth tests pass; `platform/auth.ts` has no `databaseHooks.session`.
  - Out of scope: the 2FA audit rows, the code lock row and the trusted-device end (stage 03); the operator rule (stage 04); break-glass (stages 05, 06); any web change (stages 09–11).

## Done when

- Step 02.1 is done and committed by explicit paths.
- The Proof command of `plan.md` for stage 02 (`/tmp/f105-s02`) prints `PROOF_OK`.
