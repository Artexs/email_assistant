# s5a-web-foundation — Stage 3

Part of [`../plan.md`](../plan.md). Read that file's "Done when", "Owns", S1–S13, "Facts checked", W1–W20, "User steps" and the master plan's "Rules for every step" (`spec/features/done/2026-11/F007-s5-web-panel/plan.md`) first. Decisions named D<n> are in the master plan, W<n> and S<n> in the segment file, "fact <n>" in the segment file's "Facts checked".

## Stage 3 — `platform/auth.ts`: `createAuth(deps)` with the D1 options, the W2 hooks through an injected `onEvent`, the W9 rate limits; `auditWebEvent` in the composition root; the auth integration tests [risky]

- [x] **3.1 `createAuth`, `auditWebEvent`, the tests**
  - Goal: one function builds the Better Auth instance on our tables for three callers (the server, `web:invite`, the e2e seed); it reports the three auth events through a dependency, and the composition root turns them into audit rows, so the platform imports no module (`docs/modules.md` §2) and an audit miss never fails a login.
  - Files: create `apps/server/src/platform/auth.ts`, `apps/server/src/platform/auth.test.ts` (unit: the allow-list helper), `apps/server/src/web.ts` (this stage: `auditWebEvent` only; stage 8 adds `webDeps`), `apps/server/test/integration/web-auth.test.ts`; change `apps/server/package.json` (`"better-auth": "1.7.18"` exact, `"@hono/bun": "1.0.1"` exact — stage 6 uses it; adding both here keeps the server's `bun.lock` change in one stage), the root `bun.lock`, `docs/code-patterns.md` ("Real platform paths" gets `platform/auth.ts`).
  - Interfaces:

    ```ts
    // platform/auth.ts
    export type AuthEventKind = "login" | "password_set" | "password_changed";
    export interface AuthDeps {
      databaseUrl: string; // the app role URL (config.DATABASE_URL)
      baseUrl: string; // config.WEB_BASE_URL
      secret: string; // config.WEB_AUTH_SECRET
      trustedOrigins: readonly string[]; // [baseUrl, ...webTrustedOrigins(config)]
      onEvent: (kind: AuthEventKind, userId: string) => Promise<void>; // the caller's audit; never throws into Better Auth (see below)
      sendResetPassword?: (input: { userId: string; url: string }) => Promise<void>; // default: log `web: reset requested for user <id>` at info
    }
    export type Auth = ReturnType<typeof betterAuth>;
    export interface AuthHandle {
      auth: Auth;
      close(): Promise<void>;
    } // close ends the pg Pool
    export function createAuth(deps: AuthDeps): AuthHandle;
    export const AUTH_ALLOWED_PATHS: ReadonlySet<string>; // "/sign-in/email", "/sign-out", "/get-session", "/reset-password", "/change-password", "/revoke-other-sessions", "/revoke-sessions", "/list-sessions" (D1); stage 6 uses it
    export function isAllowedAuthPath(method: string, path: string): boolean; // AUTH_ALLOWED_PATHS.has(path) || (method === "GET" && path.startsWith("/reset-password/"))
    export function cleanLogText(text: string): string; // control characters → space, URLs → <url>, at most 200 characters

    // web.ts (composition root; it may import modules)
    export function auditWebEvent(db: Db): AuthDeps["onEvent"];
    // kind → auditEvents.webLogin | webPasswordSet | webPasswordChanged; listMembershipsOfUser(db, userId) → the oldest row →
    // recordAudit(db, { orgId }, { event, actor: userId, data: { via: "web" } }); no membership → log.warn(`web: no organization for user <id>`) and no row;
    // any error → log.error(`web: audit <kind> failed: <describeError(error)>`) and no throw.
    ```

    The `betterAuth({...})` options, exactly: `appName: "Email Assistant"`, `baseURL: deps.baseUrl`, `basePath: "/api/auth"` (the default, written out), `secret: deps.secret`, `database: new Pool({ connectionString: deps.databaseUrl, max: 3, connectionTimeoutMillis: 5000 })`, `trustedOrigins: [...deps.trustedOrigins]`, `emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12, maxPasswordLength: 128, resetPasswordTokenExpiresIn: 60 * 60 * 24, revokeSessionsOnPasswordReset: true, sendResetPassword, onPasswordReset }` where `sendResetPassword` calls `deps.sendResetPassword({ userId: user.id, url })` when given, else logs `web: reset requested for user <id>` at `info`, and `onPasswordReset` calls `report("password_set", user.id)`; `user: { modelName: "users", fields: { name: "display_name", emailVerified: "email_verified", createdAt: "created_at", updatedAt: "updated_at" } }`; `session: { modelName: "auth_sessions", fields: { userId: "user_id", expiresAt: "expires_at", ipAddress: "ip_address", userAgent: "user_agent", createdAt: "created_at", updatedAt: "updated_at" }, expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 }`; `account: { modelName: "auth_accounts", fields: { userId: "user_id", accountId: "account_id", providerId: "provider_id", accessToken: "access_token", refreshToken: "refresh_token", idToken: "id_token", accessTokenExpiresAt: "access_token_expires_at", refreshTokenExpiresAt: "refresh_token_expires_at", createdAt: "created_at", updatedAt: "updated_at" } }`; `verification: { modelName: "auth_verifications", fields: { expiresAt: "expires_at", createdAt: "created_at", updatedAt: "updated_at" } }`; `advanced: { cookiePrefix: "ea", database: { generateId: "uuid" }, ipAddress: { ipAddressHeaders: ["x-client-ip"] } }`; `rateLimit: { enabled: true, customRules: { "/reset-password": { window: 60, max: 5 }, "/change-password": { window: 60, max: 5 } } }`; `databaseHooks: { session: { create: { after } }, account: { update: { after } } }` where the session hook calls `report("login", session.userId)` only when `ctx?.path === "/sign-in/email"`, and the account hook calls `report("password_changed", account.userId)` only when `ctx?.path === "/change-password"` and `account` is an object with `providerId === "credential"`; `logger: { level: "warn", log }` where `log(level, message)` writes through our `createLog("auth")` as `warn` or `error` (`error` → `error`, everything else → `warn`) the text `better-auth: <text>` with `text = cleanLogText(typeof message === "string" ? message : describeError(message))` (Better Auth passes an `Error` object on some paths; its message can hold database text). `cleanLogText(text)` (exported, pure): every character in U+0000–U+001F and U+007F becomes a space, every `scheme://…` run up to the next space becomes `<url>` (regex `/\b[a-z][a-z0-9+.-]*:\/\/\S*/gi`), and the result is cut to 200 characters. Why: Better Auth logs `Invalid callbackURL: <raw query value>` at `error` on the public `GET /reset-password/:token` (`api/middlewares/origin-check.mjs:78`, `api/routes/password.mjs:96`), so any visitor could write text into our log (second cold review, finding 4; stage 8.2 test 2 proves it over HTTP).

  - Decisions:
    - `report(kind, userId)` (private) wraps `deps.onEvent` in a `try`/`catch` that logs `web: onEvent <kind> failed: <describeError(error)>` and never throws into Better Auth (W2). The caller's `auditWebEvent` has its own handling (above), so a failure is logged once at the inner level.
    - Why an injected `onEvent` (cold review of this plan, finding 1): `platform/*` imports no module; the tenancy lookup and the audit write belong to the composition root (`web.ts`), the CLI (stage 4) and the seed (stage 12) pass `auditWebEvent(db)` too, so every entry writes the same rows.
    - Why the `ctx.path` checks: fact 5 (a password change re-creates the session; the reset path's update hook has no account). Why `onPasswordReset` for `password_set`: fact 5. Why the `typeof account === "object"` guard: on `/reset-password` the hook gets a number.
    - `generateId: "uuid"` keeps ids as UUID strings (fact 3 shows UUID account ids). `close()` calls `pool.end()`; `main.ts` calls it in `shutdown` (stage 8); the CLI and the seed call it in `finally`.
    - The package pins are exact (`1.7.18`, `1.0.1`): `cd apps/server && bun add --exact better-auth@1.7.18 @hono/bun@1.0.1`; `git diff --stat bun.lock` shows only these two and their dependencies.
    - `docs/code-patterns.md` "Real platform paths" gets `platform/auth.ts` in this commit.
  - Test (`web-auth.test.ts`; the auth pool commits, so no `withRollback`: each test creates its own organization with `createOrganizationWithOwner(db, …)` on the committed `db`, uses unique e-mails `web-auth-<uuid>@x.test`, and an `afterEach` deletes the organization as `app` (`DELETE FROM organizations WHERE id = …`: the cascades remove the memberships and the audit rows — a cascade runs as the table owner, so `app` may trigger it, as `actions-close.test.ts` and `tenancy.test.ts` already do), then `DELETE FROM users WHERE id IN (…)` (cascades `auth_sessions`, `auth_accounts`) and `DELETE FROM auth_verifications WHERE value IN (…)` for a leftover token; `createAuth({ databaseUrl: process.env.DATABASE_URL, baseUrl: "http://127.0.0.1:8080", secret: "x".repeat(40), trustedOrigins: [], onEvent: auditWebEvent(db), sendResetPassword: capture })`; `afterAll` closes the handle):
    1. **First password (D2, fact 4):** `auth.api.requestPasswordReset({ body: { email: EMAIL.toUpperCase(), redirectTo: "http://127.0.0.1:8080/setup" } })` → `capture` got `{ userId, url }` with `url` starting `http://127.0.0.1:8080/api/auth/reset-password/`; `auth.api.resetPassword({ body: { newPassword: "correct-horse-battery-staple", token } })` → `auth_accounts` has one row `provider_id = 'credential'` with a hash; `audit_log` has exactly one `web.password_set` row for the org with `actor = userId`, `data = { via: "web" }`; the same token again → throws with `body.code === "INVALID_TOKEN"`.
    2. **Sign-in and `web.login`:** `auth.api.signInEmail({ body: { email: EMAIL.toUpperCase(), password }, returnHeaders: true })` → `response.user.id === userId`, the `set-cookie` header holds `ea.session_token=`, `HttpOnly`, `SameSite=Lax`, `Path=/`, no `Secure`; `audit_log` has one `web.login`; a wrong password throws `INVALID_EMAIL_OR_PASSWORD` and writes no row; an unknown e-mail throws the same code.
    3. **Change password (fact 5):** sign in twice (two sessions); `auth.api.changePassword({ body: { currentPassword, newPassword: "another-long-passphrase-42", revokeOtherSessions: true }, headers: new Headers({ cookie }) })` → `auth_sessions` count 2 → 1; `audit_log` has one `web.password_changed` and **still one** `web.login` (the re-created session wrote none).
    4. **Later reset revokes (D1):** `requestPasswordReset` + `resetPassword` again → `auth_sessions` count 0; `web.password_set` count 2; `auth_accounts` still 1 row.
    5. **Sign-up closed (D1):** `auth.api.signUpEmail({ body: { email: "nope-<uuid>@x.test", password, name: "N" } })` throws `EMAIL_PASSWORD_SIGN_UP_DISABLED`; `users` has no such row.
    6. **No organization:** a user inserted with `insertUser` and no membership: the reset flow works (Better Auth does not care), the log has `web: no organization for user <id>` (capture `console.error` like `actions-logs.test.ts`), `audit_log` has no row for that user.
    7. **Password length (D1):** `resetPassword` with `"short"` throws `PASSWORD_TOO_SHORT`; with 129 characters `PASSWORD_TOO_LONG`.
    8. **`onEvent` failure is contained:** a `createAuth` with `onEvent: async () => { throw new Error("boom") }` still signs in (no throw), and the log has `web: onEvent login failed: Error`.
    9. **`isAllowedAuthPath`** (unit, `platform/auth.test.ts`): true for the eight paths with `POST` or `GET`, true for `GET /reset-password/abc`, false for `POST /reset-password/abc`, false for `/request-password-reset`, `/sign-up/email`, `/update-user`, `/sign-in/social`, `/ok`, `/list-accounts`, `/`, `""`.
    10. **`cleanLogText`** (unit, `platform/auth.test.ts`): `"Invalid callbackURL: https://evil.test/a?b=c"` → `"Invalid callbackURL: <url>"`; `"a\nb\tc"` → `"a b c"`; a 300-character text → 200 characters; `"Invalid password"` unchanged.
  - Check: the database guard (segment file, user step 0; it must print `/email_assistant_s5a /email_assistant_s5a`, else stop), then `bun run lint && bun run typecheck && bun run test:unit && bun run test:int && bunx prettier --check docs/code-patterns.md`; `git diff --stat bun.lock apps/server/package.json` shows the two packages.
  - Done when: the ten tests pass and the whole suite stays green; `grep -n "modules/" apps/server/src/platform/auth.ts` finds nothing.
  - Out of scope: HTTP routes (stages 5–6), the CLI (stage 4), `webDeps` (stage 8).
