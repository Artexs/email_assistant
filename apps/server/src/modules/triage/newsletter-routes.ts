import { newsletterListSchema, z } from "@ea/core";
import { Hono, type Context, type MiddlewareHandler } from "hono";

import type { Db } from "../../platform/db";
import type { ApiEnv } from "../../platform/http";
import { isFeatureOn } from "../tenancy";

import { newsletterDocs } from "./api-docs";
import { newsletterViewFor } from "./newsletter-view";

export interface NewsletterRouteDeps {
  db: Db;
  now(): Date;
  /** `mailTrustedAuthservIds(config)`. */
  trustedAuthservIds: readonly string[];
}

const idSchema = z.uuid();

/**
 * The newsletters list (F110 stage 23, flag `bulk_unsubscribe`). The flag comes first: with it off the route is a 404 for every role
 * and for a bad id. Any member reads the list; only the owner gets the links (a member sees no actions). A mailbox of another
 * organization, or an unknown id, is the same 404 `not_found`. Every query filters `org_id`. The route never fetches a link.
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

  return app;
}
