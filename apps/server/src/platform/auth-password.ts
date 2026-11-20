import { HOUR_MS, TERMS_VERSION } from "@ea/core";
import { APIError, getSessionFromCtx, isAPIError } from "better-auth/api";

import type { AuthDeps, AuthEventKind } from "./auth";
import type { AuthHookCtx, AuthHookPart, AuthPartContext } from "./auth-hooks";
import { errorFields } from "./errors";
import { createLog } from "./log";

const log = createLog("auth");

export const RESET_REQUEST_PATH = "/request-password-reset";

// Better Auth's own answer for a known and an unknown address.
export const RESET_REQUEST_ANSWER = {
  status: true,
  message: "If this email exists in our system, check your email for the reset link",
} as const;

const RESET_PASSWORD_PATH = "/reset-password";
const CHANGE_PASSWORD_PATH = "/change-password";
const NEW_PASSWORD_PATHS: ReadonlySet<string> = new Set([RESET_PASSWORD_PATH, CHANGE_PASSWORD_PATH]);
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;

// The paths that end sessions, and the audit event of each.
const REVOKE_EVENTS: Readonly<Record<string, AuthEventKind | undefined>> = {
  "/revoke-sessions": "sessions_revoked",
  "/revoke-other-sessions": "other_sessions_revoked",
};

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

// Three reset requests per address and hour. One limiter per auth instance (one per request would never count).
export function createResetLimiter(now: () => Date): AddressLimiter {
  return createAddressLimiter({ max: 3, windowMs: HOUR_MS, now });
}

// No password is set without the current terms. This check runs before the leaked-password check: no outside call without the terms.
function rejectMissingTerms(ctx: AuthHookCtx): void {
  const version = (ctx.body as { termsVersion?: unknown } | undefined)?.termsVersion;
  if (version !== TERMS_VERSION) {
    throw APIError.from("BAD_REQUEST", { code: "TERMS_REQUIRED", message: "Accept the terms first." });
  }
}

// The endpoint refuses a request without a session (`/change-password`) or without a live token (`/reset-password`) anyway.
// For such a request no outside call goes out: the endpoint gives its own answer.
async function mayChangePassword(ctx: AuthHookCtx): Promise<boolean> {
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

// A leaked or unchecked password is never stored. Other lengths are refused by Better Auth itself.
// A check that is down fails closed: no password changes.
async function rejectLeakedPassword(ctx: AuthHookCtx, pwnedCheck: NonNullable<AuthDeps["pwnedCheck"]>): Promise<void> {
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

// The checks and reports of the password paths, in this order: the address limit of the reset request; the terms of a reset;
// the leaked-password check of a new password; the revoke reports (`after`).
export function hooksOf(part: AuthPartContext): AuthHookPart[] {
  const { deps, report, resetLimiter } = part;
  return [
    {
      name: "reset-limit",
      async before(ctx) {
        if (ctx.path !== RESET_REQUEST_PATH) return undefined;
        const body = ctx.body as { email?: unknown } | undefined;
        const key = String(body?.email ?? "")
          .trim()
          .toLowerCase();
        if (resetLimiter.take(key)) return undefined;
        log.info("reset_request_limited");
        return ctx.json(RESET_REQUEST_ANSWER);
      },
    },
    {
      name: "reset-terms",
      async before(ctx) {
        if (ctx.path === RESET_PASSWORD_PATH) rejectMissingTerms(ctx);
        return undefined;
      },
    },
    {
      name: "pwned-password",
      async before(ctx) {
        if (NEW_PASSWORD_PATHS.has(ctx.path) && deps.pwnedCheck) await rejectLeakedPassword(ctx, deps.pwnedCheck);
        return undefined;
      },
    },
    {
      name: "revoke-report",
      async after(ctx) {
        const revoked = REVOKE_EVENTS[ctx.path];
        const actorId = ctx.context.session?.user.id;
        if (revoked && actorId && !isAPIError(ctx.context.returned)) await report(revoked, actorId);
      },
    },
  ];
}

// After a password reset: the audit row, the end of the lock, the accepted terms. No error of a step reaches Better Auth.
export function passwordResetHook(part: AuthPartContext) {
  const { deps, now, report } = part;
  return async ({ user }: { user: { id: string } }): Promise<void> => {
    await report("password_set", user.id);
    try {
      await deps.lockout?.clear(user.id, now());
    } catch (error) {
      log.error("lockout_clear_failed", { ...errorFields(error) });
    }
    // The `before` hook proved that the request held the current version (the body is not readable here).
    try {
      await deps.onTermsAccepted(user.id, TERMS_VERSION);
    } catch (error) {
      log.error("terms_record_failed", { user_id: user.id, ...errorFields(error) });
    }
  };
}
