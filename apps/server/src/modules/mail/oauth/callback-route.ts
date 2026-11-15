import { mailOAuthProviderParamsSchema } from "@ea/core";
import { Hono, type Context } from "hono";

import { withTenantScope } from "../../../platform/db";
import { errorFields } from "../../../platform/errors";
import { readSession, type ApiEnv } from "../../../platform/http";
import { createLog } from "../../../platform/log";

import { applyOAuthGrant, type ApplyGrantDeps, type ApplyResult, type OAuthResultCode } from "./apply";
import { finishOAuthCallback } from "./callback";
import type { MailOAuthProvider } from "./providers";

// The redirect target of the provider sign-in (F117 stage 09). It sits before the session guard: a browser that comes back from the
// provider without a session cookie gets a redirect to the login page, not the 401 JSON of `requireSession`. So this route reads the
// session itself, resolves the organization the way `requireTenant` does, and enters the tenant scope itself.
// It always answers 303. The query holds the one-time `code` and `state`: nothing here logs it (the request log line carries the route
// pattern), and the answer never repeats it.

const log = createLog("mail");

export interface MailOAuthCallbackDeps extends ApplyGrantDeps {
  now(): Date;
}

function resultLocation(code: OAuthResultCode, extra: Record<string, string> = {}): string {
  return `/mailboxes?${new URLSearchParams({ oauth: code, ...extra }).toString()}`;
}

function redirectWith(c: Context, provider: MailOAuthProvider | null, result: ApplyResult): Response {
  c.header("cache-control", "no-store");
  const extra: Record<string, string> = {};
  if (result.ok) extra.mailbox = result.mailboxId;
  if (!result.ok && result.code === "admin_consent_required" && provider !== null) extra.provider = provider;
  return c.redirect(resultLocation(result.code, extra), 303);
}

const failed: ApplyResult = { ok: false, code: "oauth_failed" };

function refused(c: Context, provider: MailOAuthProvider): Response {
  log.info("oauth_callback_refused", { provider, code: "oauth_failed" });
  return redirectWith(c, provider, failed);
}

export function mailOAuthCallbackRoutes(deps: MailOAuthCallbackDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();

  app.get("/mailboxes/oauth/:provider/callback", async (c) => {
    const params = mailOAuthProviderParamsSchema.safeParse({ provider: c.req.param("provider") });
    const provider = params.success ? params.data.provider : null;
    try {
      // No session: the login page. The state row stays; it expires by itself.
      const session = await readSession(c);
      if (session === null) {
        c.header("cache-control", "no-store");
        return c.redirect("/login", 303);
      }
      if (provider === null) return redirectWith(c, null, failed);

      // The tenant comes from the session user's oldest membership, never from the request or the state.
      const web = c.get("web");
      const [membership] = await web.listMembershipsOfUser(session.userId);
      // The owner role is checked again: a member demoted since the start has no right to connect a mailbox.
      if (membership?.role !== "owner") return refused(c, provider);
      const ctx = { orgId: membership.org_id, userId: session.userId };

      return await withTenantScope(ctx.orgId, async () => {
        if ((await web.isOrgSuspended?.(ctx.orgId)) === true) return refused(c, provider);
        // The session user and organization bind the state: a callback URL of another user is refused there.
        const checked = await finishOAuthCallback(deps, ctx, {
          provider,
          userId: session.userId,
          query: c.req.query(),
        });
        const result = checked.ok ? await applyOAuthGrant(deps, ctx, checked.grant, session.userId) : checked;
        return redirectWith(c, provider, result);
      });
    } catch (error) {
      // Always a 303. The line holds the error name and code, never its message.
      log.error("oauth_callback_failed", { provider, ...errorFields(error) });
      return redirectWith(c, provider, failed);
    }
  });

  return app;
}
