import { TERMS_VERSION } from "@ea/core";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from "better-auth/api";
import { Pool } from "pg";
import { z } from "zod";

import type { LockoutStore } from "./auth-lockout";
import { describeError } from "./errors";
import { createLog } from "./log";
import type { PwnedResult } from "./pwned";

const log = createLog("auth");

export type AuthEventKind = "login" | "password_set" | "password_changed" | "login_locked";

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
}

export type Auth = ReturnType<typeof createBetterAuth>;

export interface AuthHandle {
  auth: Auth;
  close(): Promise<void>;
}

// D1: the only paths of `/api/auth/*` that reach Better Auth.
export const AUTH_ALLOWED_PATHS: ReadonlySet<string> = new Set([
  "/sign-in/email",
  "/sign-out",
  "/get-session",
  "/reset-password",
  "/change-password",
  "/revoke-other-sessions",
  "/revoke-sessions",
  "/list-sessions",
]);

export const RESET_REQUEST_PATH = "/request-password-reset";

// Better Auth's own answer for a known and an unknown address.
export const RESET_REQUEST_ANSWER = {
  status: true,
  message: "If this email exists in our system, check your email for the reset link",
} as const;

// L9: the reset request is open only when the caller says so (the auth-mail sender is on).
export function isAllowedAuthPath(method: string, path: string, opts?: { resetRequest: boolean }): boolean {
  if (path === RESET_REQUEST_PATH) return method === "POST" && opts?.resetRequest === true;
  return AUTH_ALLOWED_PATHS.has(path) || (method === "GET" && path.startsWith("/reset-password/"));
}

export interface AddressLimiter {
  // true = allowed; it records the request.
  take(key: string): boolean;
}

const LIMITER_SWEEP_KEYS = 10_000;

// A sliding window per key, in memory (one server process).
export function createAddressLimiter(opts: { max: number; windowMs: number; now: () => Date }): AddressLimiter {
  const seen = new Map<string, number[]>();
  return {
    take(key) {
      const at = opts.now().getTime();
      const cutoff = at - opts.windowMs;
      if (seen.size > LIMITER_SWEEP_KEYS) {
        for (const [other, times] of seen) {
          if (times.every((time) => time <= cutoff)) seen.delete(other);
        }
      }
      const recent = (seen.get(key) ?? []).filter((time) => time > cutoff);
      if (recent.length >= opts.max) {
        seen.set(key, recent);
        return false;
      }
      recent.push(at);
      seen.set(key, recent);
      return true;
    },
  };
}

// Better Auth can log raw request text (`Invalid callbackURL: <query value>`), so the log gets a cleaned copy.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;
const URL_RUN = /\b[a-z][a-z0-9+.-]*:\/\/\S*/gi;

export function cleanLogText(text: string): string {
  return text.replace(CONTROL_CHARACTERS, " ").replace(URL_RUN, "<url>").slice(0, 200);
}

// The router's own log of a thrown error can hold request data, so this hook replaces it.
// A 4xx APIError is an expected answer (wrong password, bad token): no log line.
export function onAuthError(error: unknown): void {
  if (isAPIError(error) && error.statusCode < 500) {
    return;
  }
  log.error(`better-auth: ${cleanLogText(describeError(error))}`);
}

const SIGN_IN_PATH = "/sign-in/email";
const RESET_PASSWORD_PATH = "/reset-password";
const CHANGE_PASSWORD_PATH = "/change-password";
const NEW_PASSWORD_PATHS: ReadonlySet<string> = new Set(["/reset-password", "/change-password"]);
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;
const emailSchema = z.email();

type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

// Better Auth validates the body after the hooks, so the shape check is the endpoint's own schema (`api/routes/sign-in.mjs`).
// A body the endpoint would refuse gives null: the endpoint answers its own 400 for every user.
const signInShape = z.object({
  email: emailSchema,
  password: z.string().max(MAX_PASSWORD_LENGTH),
  callbackURL: z.string().optional(),
  rememberMe: z.boolean().optional(),
});

function signInBody(ctx: HookContext): { email: string; password: string } | null {
  const parsed = signInShape.safeParse(ctx.body);
  return parsed.success ? { email: parsed.data.email, password: parsed.data.password } : null;
}

// L13: a locked user gets the answer and the time of a wrong password, also for a request that the endpoint refuses before it checks the password
// (the form-CSRF middleware, the e-mail and length checks). The hook does not throw: the endpoint runs all its own checks,
// and its password check always fails. An error of `isLocked` is not caught (fail closed).
type PasswordApi = HookContext["context"]["password"];
interface SignInOverride {
  context: { context: { password: PasswordApi } };
}

async function lockSignIn(
  ctx: HookContext,
  lockout: LockoutStore,
  now: () => Date
): Promise<SignInOverride | undefined> {
  const body = signInBody(ctx);
  if (body === null) return undefined;
  const found = await ctx.context.internalAdapter.findUserByEmail(body.email.toLowerCase());
  if (!found || !(await lockout.isLocked(found.user.id, now()))) return undefined;
  const password = ctx.context.password;
  return {
    context: {
      context: {
        password: {
          ...password,
          verify: async (input) => {
            await password.verify(input);
            return false;
          },
        },
      },
    },
  };
}

// L16: no password is set without the current terms. This check runs before the leaked-password check: no outside call without the terms.
function rejectMissingTerms(ctx: HookContext): void {
  const version = (ctx.body as { termsVersion?: unknown } | undefined)?.termsVersion;
  if (version !== TERMS_VERSION) {
    throw APIError.from("BAD_REQUEST", { code: "TERMS_REQUIRED", message: "Accept the terms first." });
  }
}

// The endpoint refuses a request without a session (`/change-password`) or without a live token (`/reset-password`) anyway.
// For such a request no outside call goes out: the endpoint gives its own answer.
async function mayChangePassword(ctx: HookContext): Promise<boolean> {
  if (ctx.path === CHANGE_PASSWORD_PATH) {
    return (await getSessionFromCtx(ctx)) !== null;
  }
  const body = ctx.body as { token?: unknown } | undefined;
  const query = ctx.query as { token?: unknown } | undefined;
  const token = body?.token || query?.token;
  if (typeof token !== "string") return false;
  const verification = await ctx.context.internalAdapter.findVerificationValue(`reset-password:${token}`);
  return verification !== null && verification.expiresAt >= new Date();
}

// L14: a leaked or unchecked password is never stored. Other lengths are refused by Better Auth itself.
// A check that is down fails closed: no password changes.
async function rejectLeakedPassword(ctx: HookContext, pwnedCheck: NonNullable<AuthDeps["pwnedCheck"]>): Promise<void> {
  const password = (ctx.body as { newPassword?: unknown } | undefined)?.newPassword;
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return;
  }
  if (!(await mayChangePassword(ctx))) return;
  const result = await pwnedCheck(password);
  if (result === "pwned") {
    throw APIError.from("BAD_REQUEST", {
      code: "PASSWORD_COMPROMISED",
      message: "This password is in a list of leaked passwords. Choose another one.",
    });
  }
  if (result === "unavailable") {
    throw APIError.from("SERVICE_UNAVAILABLE", {
      code: "PASSWORD_CHECK_UNAVAILABLE",
      message: "The password check is not available. Try again later.",
    });
  }
}

async function countSignIn(
  ctx: HookContext,
  deps: AuthDeps,
  now: () => Date,
  report: (kind: AuthEventKind, userId: string, data?: Record<string, string>) => Promise<void>
): Promise<void> {
  const lockout = deps.lockout;
  if (!lockout) return;
  const returned = ctx.context.returned;
  if (isAPIError(returned)) {
    const body = returned.body as { code?: unknown } | undefined;
    if (returned.statusCode !== 401 || body?.code !== "INVALID_EMAIL_OR_PASSWORD") return;
    const email = (ctx.body as { email?: unknown } | undefined)?.email;
    if (typeof email !== "string") return;
    const found = await ctx.context.internalAdapter.findUserByEmail(email.toLowerCase());
    if (!found) return;
    // Stage 5: a failure during a lock is not counted.
    if (await lockout.isLocked(found.user.id, now())) return;
    const lock = await lockout.recordFailure(found.user.id, now());
    if (lock === null) return;
    await report("login_locked", found.user.id, { locked_until: lock.lockedUntil.toISOString() });
    if (deps.sendLockoutMail && (await lockout.claimMail(found.user.id, now()))) {
      deps.sendLockoutMail({ userId: found.user.id, email: found.user.email });
    }
    return;
  }
  const userId = ctx.context.newSession?.user.id;
  if (userId) await lockout.recordSuccess(userId, now());
}

function createBetterAuth(deps: AuthDeps, pool: Pool) {
  const now = deps.now ?? (() => new Date());
  const report = async (kind: AuthEventKind, userId: string, data?: Record<string, string>): Promise<void> => {
    try {
      await deps.onEvent(kind, userId, data);
    } catch (error) {
      log.error(`web: onEvent ${kind} failed: ${describeError(error)}`);
    }
  };

  const resetLimiter = createAddressLimiter({
    max: 3,
    windowMs: 3_600_000,
    now,
  });

  return betterAuth({
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
        log.info(`web: reset requested for user ${user.id}`);
      },
      onPasswordReset: async ({ user }) => {
        await report("password_set", user.id);
        try {
          await deps.lockout?.clear(user.id, now());
        } catch (error) {
          log.error(`web: lockout clear failed: ${describeError(error)}`);
        }
        // The `before` hook proved that the request held the current version (the body is not readable here).
        try {
          await deps.onTermsAccepted(user.id, TERMS_VERSION);
        } catch (error) {
          log.error(`web: terms record failed for user ${user.id}: ${describeError(error)}`);
        }
      },
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
      // One dispatcher: later stages add their paths here.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === RESET_REQUEST_PATH) {
          const body = ctx.body as { email?: unknown } | undefined;
          const key = String(body?.email ?? "")
            .trim()
            .toLowerCase();
          if (!resetLimiter.take(key)) {
            log.info("web: reset request over the address limit");
            return ctx.json(RESET_REQUEST_ANSWER);
          }
        }
        if (ctx.path === SIGN_IN_PATH && deps.lockout) {
          const locked = await lockSignIn(ctx, deps.lockout, now);
          if (locked) return locked;
        }
        if (ctx.path === RESET_PASSWORD_PATH) rejectMissingTerms(ctx);
        if (NEW_PASSWORD_PATHS.has(ctx.path) && deps.pwnedCheck) {
          await rejectLeakedPassword(ctx, deps.pwnedCheck);
        }
        return undefined;
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path === SIGN_IN_PATH && deps.lockout) {
          try {
            await countSignIn(ctx, deps, now, report);
          } catch (error) {
            log.error(`web: lockout: ${describeError(error)}`);
          }
        }
      }),
    },
    rateLimit: {
      enabled: true,
      customRules: {
        [RESET_REQUEST_PATH]: { window: 900, max: 3 },
        "/reset-password": { window: 60, max: 5 },
        "/change-password": { window: 60, max: 5 },
      },
    },
    databaseHooks: {
      session: {
        create: {
          after: async (session, ctx) => {
            if (ctx?.path === "/sign-in/email") {
              await report("login", session.userId);
            }
          },
        },
      },
      account: {
        update: {
          after: async (account, ctx) => {
            if (
              ctx?.path === "/change-password" &&
              typeof account === "object" &&
              account !== null &&
              account.providerId === "credential"
            ) {
              await report("password_changed", account.userId);
            }
          },
        },
      },
    },
    onAPIError: { onError: onAuthError },
    logger: {
      level: "warn",
      log: (level, message, ...args) => {
        const base = typeof message === "string" ? message : describeError(message);
        const text = cleanLogText(args[0] instanceof Error ? `${base}: ${describeError(args[0])}` : base);
        (level === "error" ? log.error : log.warn)(`better-auth: ${text}`);
      },
    },
  });
}

export function createAuth(deps: AuthDeps): AuthHandle {
  const pool = new Pool({ connectionString: deps.databaseUrl, max: 3, connectionTimeoutMillis: 5000 });
  return {
    auth: createBetterAuth(deps, pool),
    close: () => pool.end(),
  };
}
