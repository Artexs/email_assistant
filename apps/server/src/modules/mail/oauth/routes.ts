import { mailOAuthProviderParamsSchema, mailOAuthStartBodySchema } from "@ea/core";
import { Hono } from "hono";

import { parseBody, requireOwner, type ApiEnv } from "../../../platform/http";

import { mailOAuthDocs } from "./api-docs";
import { mailOAuthOptions, startMailOAuth, type MailOAuthStartDeps } from "./start";

// The mailbox OAuth routes. The callback route is in `callback-route.ts`.
// The answer of the start holds the one-time `state`. Nothing here logs it, and the answer is not cached.

export interface MailOAuthRouteDeps extends MailOAuthStartDeps {
  now(): Date;
}

export function mailOAuthRoutes(deps: MailOAuthRouteDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();

  app.get("/mailboxes/oauth/options", mailOAuthDocs.getMailOAuthOptions, async (c) =>
    c.json(await mailOAuthOptions(deps, c.get("ctx")))
  );

  app.post("/mailboxes/oauth/:provider/start", requireOwner, mailOAuthDocs.postMailOAuthStart, async (c) => {
    // An unknown provider is a missing page, and a not configured one is refused before the body is read.
    const params = mailOAuthProviderParamsSchema.safeParse({ provider: c.req.param("provider") });
    if (!params.success) return c.json({ error: "not_found" }, 404);
    if (deps.clients[params.data.provider] === undefined) return c.json({ error: "not_configured" }, 409);
    const { mailboxId } = await parseBody(c, mailOAuthStartBodySchema);
    const result = await startMailOAuth(
      deps,
      c.get("ctx"),
      { provider: params.data.provider, userId: c.get("session").userId, mailboxId: mailboxId ?? null },
      deps.now()
    );
    if (result.kind === "not_found") return c.json({ error: "not_found" }, 404);
    if (result.kind === "not_configured") return c.json({ error: "not_configured" }, 409);
    if (result.kind === "feature_off") return c.json({ error: "feature_off" }, 403);
    c.header("cache-control", "no-store");
    return c.json({ url: result.url });
  });

  return app;
}
