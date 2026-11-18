import { newsletterListSchema, unsubscribeBodySchema, unsubscribeResultSchema, z } from "@ea/core";
import { Hono, type Context, type MiddlewareHandler } from "hono";

import type { Db } from "../../platform/db";
import { parseBody, requireOwner, type ApiEnv } from "../../platform/http";
import type { OneClickResult } from "../../platform/public-http";
import { isFeatureOn } from "../tenancy";

import { newsletterDocs } from "./api-docs";
import { unsubscribeSender } from "./newsletter-unsubscribe";
import { newsletterViewFor } from "./newsletter-view";

export interface NewsletterRouteDeps {
  db: Db;
  now(): Date;
  /** `mailTrustedAuthservIds(config)`. */
  trustedAuthservIds: readonly string[];
  /** Sends the one-click request. The composition root gives `postOneClick` with the system lookup. */
  post(url: URL): Promise<OneClickResult>;
}

const idSchema = z.uuid();

/**
 * The newsletters list (flag `bulk_unsubscribe`). The flag comes first: with it off the route is a 404 for every role
 * and for a bad id. Any member reads the list; only the owner gets the links (a member sees no actions). A mailbox of another
 * organization, or an unknown id, is the same 404 `not_found`. Every query filters `org_id`. The GET route never fetches a link.
 *
 * `POST .../unsubscribe`: the owner's tap, one request to the sender per (mailbox, sender) and never from the
 * system by itself. Flag first, then owner only. See `newsletter-unsubscribe.ts`.
 */
export function newsletterRoutes(deps: NewsletterRouteDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  const notFound = (c: Context<ApiEnv>) => c.json({ error: "not_found" }, 404);

  const flagFirst: MiddlewareHandler<ApiEnv> = async (c, next) => {
    if (!(await isFeatureOn(deps.db, c.get("ctx"), "bulk_unsubscribe"))) return notFound(c);
    await next();
  };

  app.get("/newsletters/:mailboxId", flagFirst, newsletterDocs.getNewsletters, async (c) => {
    const id = idSchema.safeParse(c.req.param("mailboxId"));
    if (!id.success) return notFound(c);
    const view = await newsletterViewFor(deps.db, c.get("ctx"), id.data, deps.now(), {
      trustedAuthservIds: deps.trustedAuthservIds,
      isOwner: c.get("role") === "owner",
    });
    return view === null ? notFound(c) : c.json(newsletterListSchema.parse(view));
  });

  app.post(
    "/newsletters/:mailboxId/unsubscribe",
    flagFirst,
    requireOwner,
    newsletterDocs.postUnsubscribe,
    async (c) => {
      const id = idSchema.safeParse(c.req.param("mailboxId"));
      if (!id.success) return notFound(c);
      const body = await parseBody(c, unsubscribeBodySchema);
      const outcome = await unsubscribeSender(
        { db: deps.db, now: deps.now, trustedAuthservIds: deps.trustedAuthservIds, post: deps.post },
        c.get("ctx"),
        { mailboxId: id.data, sender: body.sender, actor: c.get("session").userId }
      );
      switch (outcome.kind) {
        case "not_found":
          return notFound(c);
        case "not_allowed":
        case "no_one_click":
          return c.json({ error: outcome.kind }, 409);
        case "rate_limited":
          return c.json({ error: "rate_limited" }, 429);
        case "already_requested":
          return c.json(
            {
              error: "already_requested",
              request: { status: outcome.request.status, at: outcome.request.at.toISOString() },
            },
            409
          );
        case "finished":
          return c.json(
            unsubscribeResultSchema.parse({ status: outcome.status, code: outcome.code, at: outcome.at.toISOString() })
          );
      }
    }
  );

  return app;
}
