import { reviewLabelBodySchema, reviewSampleQuerySchema } from "@ea/core";
import { Hono, type Context, type MiddlewareHandler } from "hono";

import type { Db } from "../../platform/db";
import { parseBody, type ApiEnv } from "../../platform/http";
import type { TestMailRule } from "../mail";
import { isFeatureOn } from "../tenancy";

import { reviewDocs } from "./api-docs";
import { labelReviewItem, reviewSampleFor } from "./review-panel";

export interface ReviewRouteDeps {
  db: Db;
  now(): Date;
  testMail: TestMailRule;
}

/**
 * The panel review routes (F110 stage 15, flag `panel_review`). The flag comes first: with it off both routes are a 404 for every role
 * and with a bad id. Any member reads a sample and labels (as the Telegram buttons). A mailbox or a mail of another organization, an
 * unknown id and a bad id are the same 404 `not_found`. Every query filters `org_id`. Nothing here logs mail text.
 */
export function reviewRoutes(deps: ReviewRouteDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  const notFound = (c: Context<ApiEnv>) => c.json({ error: "not_found" }, 404);

  const flagFirst: MiddlewareHandler<ApiEnv> = async (c, next) => {
    if (!(await isFeatureOn(deps.db, c.get("ctx"), "panel_review"))) return notFound(c);
    await next();
  };

  app.get("/review/sample", flagFirst, reviewDocs.getReviewSample, async (c) => {
    const query = reviewSampleQuerySchema.safeParse(c.req.query());
    if (!query.success) return notFound(c);
    const sample = await reviewSampleFor(deps.db, c.get("ctx"), {
      mailboxId: query.data.mailboxId,
      userId: c.get("session").userId,
      now: deps.now(),
      testMail: deps.testMail,
    });
    return sample === null ? notFound(c) : c.json(sample);
  });

  app.post("/review/label", flagFirst, reviewDocs.postReviewLabel, async (c) => {
    const body = await parseBody(c, reviewLabelBodySchema);
    const outcome = await labelReviewItem(deps.db, c.get("ctx"), { body, userId: c.get("session").userId });
    if (outcome.kind === "not_found") return notFound(c);
    if (outcome.kind === "needs_category") return c.json({ error: "needs_category" }, 409);
    if (outcome.kind === "no_delegates") return c.json({ error: "no_delegates" }, 409);
    return c.json(outcome.result);
  });

  return app;
}
