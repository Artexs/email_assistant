import { activityQuerySchema } from "@ea/core";
import { Hono } from "hono";

import type { Db } from "../../platform/db";
import { parseQuery, ValidationError, type ApiEnv } from "../../platform/http";

import { decodeActivityCursor, listActivity } from "./activity";

export interface ActivityRouteDeps {
  db: Db;
  now(): Date;
}

export function activityRoutes(deps: ActivityRouteDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();

  // A foreign or unknown mailboxId matches no row: the answer is a page with no items.
  app.get("/activity", async (c) => {
    const q = parseQuery(c, activityQuerySchema);
    const cursor = q.before === undefined ? undefined : decodeActivityCursor(q.before);
    if (cursor === null) {
      throw new ValidationError([{ path: "before", code: "invalid_cursor", message: "invalid cursor" }]);
    }
    const page = await listActivity(
      deps.db,
      c.get("ctx"),
      {
        mailboxId: q.mailboxId,
        categories: q.categories,
        notRated: q.notRated === "true",
        since: q.since === undefined ? undefined : new Date(q.since),
        cursor,
        limit: q.limit,
      },
      deps.now()
    );
    return c.json(page);
  });

  return app;
}
