import { createAuthMiddleware } from "better-auth/api";
import { z } from "zod";

import type { AuthDeps } from "./auth";
import type { AuthHookPart, AuthPartContext } from "./auth-hooks";
import { RESET_REQUEST_ANSWER, RESET_REQUEST_PATH } from "./auth-password";
import { createLog } from "./log";

const log = createLog("auth");

export type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];
type PasswordApi = HookContext["context"]["password"];

// What a `before` hook returns to replace parts of the request context.
export interface SignInOverride {
  context: { context: { password: PasswordApi; ssoRequiredRefused?: true } };
}

export const SIGN_IN_PATH = "/sign-in/email";

const emailSchema = z.email();
const MAX_PASSWORD_LENGTH = 128;

// Better Auth validates the body after the hooks, so the shape check is the endpoint's own schema (`api/routes/sign-in.mjs`).
// A body the endpoint would refuse gives null: the endpoint answers its own 400 for every user.
const signInShape = z.object({
  email: emailSchema,
  password: z.string().max(MAX_PASSWORD_LENGTH),
  callbackURL: z.string().optional(),
  rememberMe: z.boolean().optional(),
});

export function signInBody(ctx: HookContext): { email: string; password: string } | null {
  const parsed = signInShape.safeParse(ctx.body);
  return parsed.success ? { email: parsed.data.email, password: parsed.data.password } : null;
}

// The endpoint runs the real password check (the same time as for a wrong password), then the check answers false:
// Better Auth gives its own `401 INVALID_EMAIL_OR_PASSWORD`.
export function failingPasswordVerify(ctx: HookContext): SignInOverride {
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

// The mark of a refusal rides in the context that the `before` hook returns: Better Auth merges that override into
// a new context object for the endpoint and the `after` hook, so a WeakMap or WeakSet keyed by the hook's own context object
// does not see it there (a test showed that the lockout counted the refused tries).
interface MarkedContext {
  ssoRequiredRefused?: true;
}

// True when the `before` hook refused this sign-in because its organization requires SSO (the failure is not a wrong password).
export function wasSsoRequiredRefusal(ctx: HookContext): boolean {
  return (ctx.context as MarkedContext).ssoRequiredRefused === true;
}

// "SSO required" (ADR 0026 point 6): a refused member gets the answer of a wrong password, and the request is marked so
// the lockout counts no failure. A locked user never reaches this function (the lockout answer comes first).
// No audit row (a flood of tries must not fill the security log); one log line. An error of `isRefused` is not caught (fail closed).
export async function refuseSsoRequiredSignIn(
  ctx: HookContext,
  isRefused: (userId: string) => Promise<boolean>
): Promise<SignInOverride | undefined> {
  const body = signInBody(ctx);
  if (body === null) return undefined;
  const found = await ctx.context.internalAdapter.findUserByEmail(body.email.toLowerCase());
  if (!found || !(await isRefused(found.user.id))) return undefined;
  log.info("password_sign_in_refused_sso", { user_id: found.user.id });
  const override = failingPasswordVerify(ctx);
  return { context: { context: { ...override.context.context, ssoRequiredRefused: true } } };
}

// A reset request of a refused member ("SSO required", or an SSO-only member) sends no mail and writes no token; the caller answers the generic answer.
// Better Auth checks the body after the hooks, so an address that its own schema (`z.email()`) refuses must not match
// here: the endpoint answers 400 for it, and a 200 would show that the address is a refused member. No trim.
// An error of `isRefused` is not caught (fail closed).
export async function isSsoRequiredResetRequest(
  ctx: HookContext,
  isRefused: (userId: string) => Promise<boolean>
): Promise<boolean> {
  const email = (ctx.body as { email?: unknown } | undefined)?.email;
  if (!emailSchema.safeParse(email).success) return false;
  const found = await ctx.context.internalAdapter.findUserByEmail((email as string).toLowerCase());
  if (!found || !(await isRefused(found.user.id))) return false;
  log.info("reset_request_refused_sso", { user_id: found.user.id });
  return true;
}

// The reset request is refused for a member that "SSO required" refuses and for an SSO-only member.
function resetRefusal(deps: AuthDeps): ((userId: string) => Promise<boolean>) | undefined {
  const { passwordSignInRefused, ssoOnlyMember } = deps;
  if (!passwordSignInRefused && !ssoOnlyMember) return undefined;
  return async (userId) => (await passwordSignInRefused?.(userId)) === true || (await ssoOnlyMember?.(userId)) === true;
}

// The refusals of the reset request and of the password sign-in. Both run after the part that comes before them for the
// same path: the address limit of the reset request, the lock of the sign-in (a locked user gets the lock answer first).
export function hooksOf(part: AuthPartContext): AuthHookPart[] {
  const { deps } = part;
  const resetRefused = resetRefusal(deps);
  return [
    {
      name: "sso-required",
      async before(ctx) {
        if (ctx.path === RESET_REQUEST_PATH) {
          if (resetRefused && (await isSsoRequiredResetRequest(ctx, resetRefused)))
            return ctx.json(RESET_REQUEST_ANSWER);
          return undefined;
        }
        if (ctx.path === SIGN_IN_PATH && deps.passwordSignInRefused) {
          return refuseSsoRequiredSignIn(ctx, deps.passwordSignInRefused);
        }
        return undefined;
      },
    },
  ];
}
