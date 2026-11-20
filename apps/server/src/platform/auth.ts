import { betterAuth } from "better-auth";
import { createAuthMiddleware, isAPIError } from "better-auth/api";
import { serialize as serializeCookie } from "hono/utils/cookie";
import type { Transaction } from "kysely";
import { Pool } from "pg";

import { databaseHooksOf } from "./auth-database-hooks";
import { authHookParts, authPlugins, runAfter, runBefore, type AuthPartContext } from "./auth-hooks";
import type { LockoutStore } from "./auth-lockout";
import { createResetLimiter, passwordResetHook, RESET_REQUEST_PATH } from "./auth-password";
import { isAllowedSsoPath, SSO_SIGN_IN_PATH, type SsoEvent, type SsoIdentity, type SsoResolution } from "./auth-sso";
import { TWO_FACTOR_ALLOWED_PATHS, type CodeApi } from "./auth-two-factor";
import type { DB, Db } from "./db";
import { errorFields } from "./errors";
import { createLog } from "./log";
import type { PwnedResult } from "./pwned";

export { createAddressLimiter, RESET_REQUEST_ANSWER, RESET_REQUEST_PATH, type AddressLimiter } from "./auth-password";

const log = createLog("auth");

export type AuthEventKind =
  | "login"
  | "password_set"
  | "password_changed"
  | "login_locked"
  | "sessions_revoked"
  | "other_sessions_revoked"
  | "two_factor_enabled"
  | "two_factor_disabled"
  | "backup_codes_generated"
  | "backup_code_used"
  | "two_factor_locked"
  | "two_factor_refused";

export interface AuthDeps {
  databaseUrl: string;
  baseUrl: string;
  secret: string;
  trustedOrigins: readonly string[];
  // The caller's audit. Never throws into Better Auth: `report` catches.
  onEvent: (kind: AuthEventKind, userId: string, data?: Record<string, string>) => Promise<void>;
  // Required: the server uses 3_600, the CLIs and the e2e seed 86_400.
  resetLinkTtlSeconds: number;
  // The clock of the address limit.
  now?: () => Date;
  sendResetPassword?: (input: { userId: string; email: string; url: string }) => Promise<void>;
  // Absent = no lockout (the CLIs and the tests that do not test it).
  lockout?: LockoutStore;
  // Never throws, never awaited.
  sendLockoutMail?: (input: { userId: string; email: string }) => void;
  // Records the accepted terms of a user after a password reset. Required; never throws into Better Auth.
  onTermsAccepted: (userId: string, version: string) => Promise<void>;
  // Absent = no check (the CLIs and the tests that do not test it). Never rejects.
  pwnedCheck?: (password: string) => Promise<PwnedResult>;
  // True = the user may not turn TOTP off (the break-glass owner). Absent = every user may.
  // Not caught: an error fails the request (500) and nothing changes (fail closed).
  keepsTwoFactor?: (userId: string) => Promise<boolean>;
  // Who may sign in with the company IdP. Absent = every identity is refused with `sso_off`.
  resolveSsoMember?: (identity: SsoIdentity) => Promise<SsoResolution>;
  // True = the user's organization requires SSO and the user is not its break-glass owner with TOTP: the password sign-in
  // and the reset request are refused like a wrong password (ADR 0026 point 6). Absent = never refused (the CLIs and old tests).
  // Not caught: an error fails the request (500) and nothing changes (fail closed).
  passwordSignInRefused?: (userId: string) => Promise<boolean>;
  // True = the user is an SSO-only member (no password account, a member of an organization with a provider): the reset
  // request gets the generic answer, no mail and no token, so the public request cannot give the member a password
  // (the company would lose its control of the access, and a person that left the company would keep it). The operator's
  // `web:invite --user-id` link still works. Absent = never refused. Not caught: an error fails the request (fail closed).
  ssoOnlyMember?: (userId: string) => Promise<boolean>;
  // The audit row of an SSO sign-in or refusal. It never throws into Better Auth.
  onSsoEvent?: (event: SsoEvent) => Promise<void>;
}

export type Auth = ReturnType<typeof createBetterAuth>;

export interface AuthHandle {
  auth: Auth;
  close(): Promise<void>;
}

// The only paths of `/api/auth/*` that reach Better Auth. The five two-factor paths come from `auth-two-factor.ts`.
export const AUTH_ALLOWED_PATHS: ReadonlySet<string> = new Set([
  "/sign-in/email",
  "/sign-out",
  "/get-session",
  "/reset-password",
  "/change-password",
  "/revoke-other-sessions",
  "/revoke-sessions",
  ...TWO_FACTOR_ALLOWED_PATHS,
]);

// The reset request is open only when the caller says so (the auth-mail sender is on).
export function isAllowedAuthPath(method: string, path: string, opts?: { resetRequest: boolean }): boolean {
  if (path === RESET_REQUEST_PATH) return method === "POST" && opts?.resetRequest === true;
  if (isAllowedSsoPath(method, path)) return true;
  return AUTH_ALLOWED_PATHS.has(path) || (method === "GET" && path.startsWith("/reset-password/"));
}

// Better Auth logs library text; only a fixed code reaches our log. Message starts from docs/known-alerts.md.
const BETTER_AUTH_REASONS: readonly (readonly [string, string])[] = [
  ["Reset Password: User not found", "reset_user_not_found"],
  ["Invalid password", "invalid_password"],
  ["User not found", "user_not_found"],
  ["Invalid callbackURL", "invalid_callback_url"],
  ["Invalid origin", "invalid_origin"],
  ["Database schema mismatch", "schema_mismatch"],
  ["Rate limiting could not determine a client IP", "rate_limit_no_ip"],
  // Every OAuth state failure (unknown, expired or changed state) has this start, so one code covers them all.
  ["Failed to parse state", "oauth_state_failed"],
];

export function betterAuthLogReason(message: unknown): string {
  if (typeof message !== "string") return "other";
  return BETTER_AUTH_REASONS.find(([start]) => message.startsWith(start))?.[1] ?? "other";
}

// The router's own log of a thrown error can hold request data, so this hook replaces it.
// A 4xx APIError is an expected answer (wrong password, bad token): no log line.
export function onAuthError(error: unknown): void {
  if (isAPIError(error) && error.statusCode < 500) {
    return;
  }
  log.error("better_auth_error", { ...errorFields(error) });
}

function createBetterAuth(deps: AuthDeps, pool: Pool) {
  const now = deps.now ?? (() => new Date());
  const report = async (kind: AuthEventKind, userId: string, data?: Record<string, string>): Promise<void> => {
    try {
      await deps.onEvent(kind, userId, data);
    } catch (error) {
      log.error("auth_event_failed", { kind, ...errorFields(error) });
    }
  };

  // The plugin's verify endpoints, for the second-factor check. Set below; a request cannot arrive before it.
  let codeApi: CodeApi | null = null;
  const part: AuthPartContext = {
    deps,
    now,
    report,
    resetLimiter: createResetLimiter(now),
    getCodeApi: () => codeApi,
  };
  const parts = authHookParts(part);

  const instance = betterAuth({
    appName: "Email Assistant",
    baseURL: deps.baseUrl,
    basePath: "/api/auth",
    secret: deps.secret,
    database: pool,
    trustedOrigins: [...deps.trustedOrigins],
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: deps.resetLinkTtlSeconds,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        if (deps.sendResetPassword) {
          await deps.sendResetPassword({ userId: user.id, email: user.email, url });
          return;
        }
        log.info("password_reset_requested", { user_id: user.id });
      },
      onPasswordReset: passwordResetHook(part),
    },
    user: {
      modelName: "users",
      fields: {
        name: "display_name",
        emailVerified: "email_verified",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    session: {
      modelName: "auth_sessions",
      fields: {
        userId: "user_id",
        expiresAt: "expires_at",
        ipAddress: "ip_address",
        userAgent: "user_agent",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      // How the session was made, and when the IdP sign-in was. The trigger `auth_sessions_sso_cap` ends an SSO session
      // 12 h after `sso_started_at`, also at each refresh. A client never sets either field.
      additionalFields: {
        signInMethod: {
          type: "string",
          fieldName: "sign_in_method",
          input: false,
          required: false,
          defaultValue: "password",
        },
        ssoStartedAt: { type: "date", fieldName: "sso_started_at", input: false, required: false },
      },
    },
    account: {
      modelName: "auth_accounts",
      fields: {
        userId: "user_id",
        accountId: "account_id",
        providerId: "provider_id",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        idToken: "id_token",
        accessTokenExpiresAt: "access_token_expires_at",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    verification: {
      modelName: "auth_verifications",
      // The stored identifier is a SHA-256 hash, so a database reader cannot rebuild the reset link.
      storeIdentifier: "hashed",
      fields: {
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    advanced: {
      // Tests run the same origin and callbackURL checks as production (bun test sets NODE_ENV=test).
      disableOriginCheck: false,
      cookiePrefix: "ea",
      database: { generateId: "uuid" },
      ipAddress: { ipAddressHeaders: ["x-client-ip"] },
    },
    hooks: {
      before: createAuthMiddleware((ctx) => runBefore(parts, ctx)),
      after: createAuthMiddleware((ctx) => runAfter(parts, ctx)),
    },
    rateLimit: {
      enabled: true,
      customRules: {
        [RESET_REQUEST_PATH]: { window: 900, max: 3 },
        "/reset-password": { window: 60, max: 5 },
        "/change-password": { window: 60, max: 5 },
        [SSO_SIGN_IN_PATH]: { window: 60, max: 10 },
      },
    },
    plugins: authPlugins(part),
    databaseHooks: databaseHooksOf(part),
    // An OAuth state error redirects here (the default is a Better Auth error page that our server does not serve).
    onAPIError: { onError: onAuthError, errorURL: "/login?sso=failed" },
    logger: {
      level: "warn",
      log: (level, message, ...args) => {
        const fields = {
          reason: betterAuthLogReason(message),
          ...(args[0] instanceof Error ? errorFields(args[0]) : {}),
        };
        if (level === "error") log.error("better_auth_log", { ...fields });
        else log.warn("better_auth_log", { ...fields });
      },
    },
  });
  codeApi = instance.api;
  return instance;
}

// F6: one row of a user's live sessions. The session token is never copied.
export interface AuthSessionRow {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

// F6: `/list-sessions` returns the tokens and needs a fresh session, so the panel reads through the internal adapter.
export async function listUserSessions(handle: AuthHandle, userId: string): Promise<AuthSessionRow[]> {
  const context = await handle.auth.$context;
  const rows = await context.internalAdapter.listSessions(userId);
  return rows.map((row) => ({
    id: row.id,
    userAgent: row.userAgent || null,
    ipAddress: row.ipAddress || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    expiresAt: row.expiresAt,
  }));
}

// Is `password` the password of the signed-in user of `headers`? Wrong password: false. Any other error
// (no session, no database) is thrown, so the route fails closed (500). The password is never logged.
export async function verifyOwnPassword(handle: AuthHandle, headers: Headers, password: string): Promise<boolean> {
  try {
    await handle.auth.api.verifyPassword({ body: { password }, headers });
    return true;
  } catch (error) {
    const body = isAPIError(error) ? (error.body as { code?: unknown } | undefined) : undefined;
    if (body?.code === "INVALID_PASSWORD") return false;
    throw error;
  }
}

// The `Set-Cookie` line that ends the session cookie. Better Auth gives the name (`ea.session_token`,
// with `__Secure-` on https) and the attributes (path, SameSite, HttpOnly, Secure), as `deleteSessionCookie` uses them.
export async function expiredSessionCookie(handle: AuthHandle): Promise<string> {
  const { sessionToken } = (await handle.auth.$context).authCookies;
  return serializeCookie(sessionToken.name, "", { ...sessionToken.attributes, maxAge: 0 });
}

export function createAuth(deps: AuthDeps): AuthHandle {
  const pool = new Pool({ connectionString: deps.databaseUrl, max: 3, connectionTimeoutMillis: 5000 });
  return {
    auth: createBetterAuth(deps, pool),
    close: () => pool.end(),
  };
}

// Retention: deletes the `auth_verifications` rows (reset-password and invite tokens) that expired before `before`.
// Better Auth deletes expired rows only when it reads one, so rows of tokens nobody uses stay. The only SQL of ours on this table.
// The caller logs the count; the rows hold a user id (`value`) and a token hash (`identifier`), and neither goes to a log.
export async function deleteExpiredVerifications(db: Db | Transaction<DB>, opts: { before: Date }): Promise<number> {
  const result = await db.deleteFrom("auth_verifications").where("expires_at", "<", opts.before).executeTakeFirst();
  return Number(result.numDeletedRows);
}
