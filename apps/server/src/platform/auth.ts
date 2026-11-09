import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { Pool } from "pg";

import { describeError } from "./errors";
import { createLog } from "./log";

const log = createLog("auth");

export type AuthEventKind = "login" | "password_set" | "password_changed";

export interface AuthDeps {
  databaseUrl: string;
  baseUrl: string;
  secret: string;
  trustedOrigins: readonly string[];
  // The caller's audit. Never throws into Better Auth: `report` catches.
  onEvent: (kind: AuthEventKind, userId: string) => Promise<void>;
  sendResetPassword?: (input: { userId: string; url: string }) => Promise<void>;
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

export function isAllowedAuthPath(method: string, path: string): boolean {
  return AUTH_ALLOWED_PATHS.has(path) || (method === "GET" && path.startsWith("/reset-password/"));
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
  if (isApiError(error) && error.status !== "INTERNAL_SERVER_ERROR") {
    return;
  }
  log.error(`better-auth: ${cleanLogText(describeError(error))}`);
}

function isApiError(error: unknown): error is { status: string } {
  return error instanceof APIError;
}

function createBetterAuth(deps: AuthDeps, pool: Pool) {
  const report = async (kind: AuthEventKind, userId: string): Promise<void> => {
    try {
      await deps.onEvent(kind, userId);
    } catch (error) {
      log.error(`web: onEvent ${kind} failed: ${describeError(error)}`);
    }
  };

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
      resetPasswordTokenExpiresIn: 60 * 60 * 24,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        if (deps.sendResetPassword) {
          await deps.sendResetPassword({ userId: user.id, url });
          return;
        }
        log.info(`web: reset requested for user ${user.id}`);
      },
      onPasswordReset: async ({ user }) => {
        await report("password_set", user.id);
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
      fields: {
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    advanced: {
      cookiePrefix: "ea",
      database: { generateId: "uuid" },
      ipAddress: { ipAddressHeaders: ["x-client-ip"] },
    },
    rateLimit: {
      enabled: true,
      customRules: {
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
