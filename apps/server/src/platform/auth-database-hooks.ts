import type { BetterAuthOptions } from "better-auth";

import type { AuthPartContext } from "./auth-hooks";
import { ssoSessionData, withoutIdpTokens } from "./auth-sso";
import { createLog } from "./log";

const log = createLog("auth");

// The `databaseHooks` of Better Auth: how a new session is made (the SSO fields, the refusal of a password session of an
// "SSO required" member), that no IdP token is stored, and the audit row of a password change.
export function databaseHooksOf(part: AuthPartContext) {
  const { deps, now, report } = part;
  return {
    session: {
      create: {
        // `ctx.context.session` is the session of the request: set only for an endpoint that needs one.
        before: async (session, ctx) => {
          const extra = ssoSessionData({
            path: ctx?.path,
            current: ctx?.context.session?.session ?? null,
            now: now(),
          });
          if (extra !== undefined) return { data: { ...session, ...extra } };
          // A password session of a member that "SSO required" refuses: no session. The before hook of the sign-in checks
          // this too, but outside the transaction of the operator's switch, so a sign-in that passed it just before the
          // commit would still get a session here, or a two-factor challenge that `/two-factor/verify-totp` turns into one.
          // This hook covers `/sign-in/email` and `/two-factor/verify-totp` in one place. An error of the check fails closed.
          if (deps.passwordSignInRefused && (await deps.passwordSignInRefused(session.userId))) {
            log.info("password_session_refused_sso", { user_id: session.userId });
            return false;
          }
          return undefined;
        },
      },
    },
    account: {
      // No IdP token is stored (an `id_token` holds the IdP e-mail in clear).
      create: { before: async (account) => withoutIdpTokens(account) },
      update: {
        before: async (account) => withoutIdpTokens(account),
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
  } satisfies NonNullable<BetterAuthOptions["databaseHooks"]>;
}
