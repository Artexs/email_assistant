import type { createAuthMiddleware } from "better-auth/api";

import type { AddressLimiter, AuthDeps, AuthEventKind } from "./auth";
import { hooksOf as lockoutHooks } from "./auth-lockout";
import { hooksOf as passwordHooks } from "./auth-password";
import { hooksOf as ssoHooks, ssoPlugins } from "./auth-sso";
import { hooksOf as ssoRequiredHooks } from "./auth-sso-required";
import { hooksOf as twoFactorHooks, signInAuditPlugin, twoFactorPlugin, type CodeApi } from "./auth-two-factor";

// The context that `createAuthMiddleware` gives its handler.
export type AuthHookCtx = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

// One check of the auth wiring. A part handles only its own paths and returns at once for every other path.
export interface AuthHookPart {
  name: string;
  /** Before Better Auth handles the request. A value other than undefined is the answer and ends the chain; a throw refuses. */
  before?(ctx: AuthHookCtx): Promise<unknown>;
  /** After Better Auth handled the request. A throw is logged by the part itself. */
  after?(ctx: AuthHookCtx): Promise<void>;
}

// What every part may use. One per auth instance: the reset limiter is created once (a limiter per request fails open),
// and `getCodeApi()` reads the verify API that is set after the instance exists (a value read at build time is null).
export interface AuthPartContext {
  deps: AuthDeps;
  now: () => Date;
  report: (kind: AuthEventKind, userId: string, data?: Record<string, string>) => Promise<void>;
  resetLimiter: AddressLimiter;
  getCodeApi(): CodeApi | null;
}

export async function runBefore(parts: readonly AuthHookPart[], ctx: AuthHookCtx): Promise<unknown> {
  for (const part of parts) {
    const answer = await part.before?.(ctx);
    if (answer !== undefined) return answer;
  }
  return undefined;
}

export async function runAfter(parts: readonly AuthHookPart[], ctx: AuthHookCtx): Promise<void> {
  for (const part of parts) await part.after?.(ctx);
}

// The order of the checks. Within one path: the reset request (address limit, then "SSO required"); the sign-in
// (lock, then "SSO required": a locked user gets the lock answer first); a new password (terms, then the leaked-password check).
// The `after` steps: the lock count (sign-in), the revoke reports.
export function authHookParts(part: AuthPartContext): AuthHookPart[] {
  return [
    ...ssoHooks(),
    ...passwordHooks(part),
    ...lockoutHooks(part),
    ...ssoRequiredHooks(part),
    ...twoFactorHooks(part),
  ];
}

// Order matters: the audit plugin comes last, after `twoFactorPlugin()` and `ssoPlugins()` (it reads the result of the code step).
export function authPlugins(part: AuthPartContext) {
  const { deps, report } = part;
  return tupleOf(
    twoFactorPlugin(),
    ...ssoPlugins({ resolveMember: deps.resolveSsoMember, onSsoEvent: deps.onSsoEvent }),
    signInAuditPlugin(report)
  );
}

// A tuple keeps the type of each plugin, and Better Auth reads the user fields and the endpoints from those types.
function tupleOf<T extends unknown[]>(...items: T): T {
  return items;
}
