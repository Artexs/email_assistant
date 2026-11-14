import { activityQuerySchema, statsQuerySchema } from "@ea/core";
import { Hono } from "hono";

import type { Db } from "../../platform/db";
import { parseQuery, ValidationError, type ApiEnv } from "../../platform/http";
import { isFeatureOn } from "../tenancy";

import { decodeActivityCursor, listActivity } from "./activity";
import { recentWeekStats, type WeekStatsDeps } from "./metrics";

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

export interface StatsRouteDeps extends WeekStatsDeps {
  db: Db;
  now(): Date;
}

// Both roles read it. The flag is checked here, so the answer with the flag off is the same as for an unknown path.
export function statsRoutes(deps: StatsRouteDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();

  app.get("/stats", async (c) => {
    const ctx = c.get("ctx");
    if (!(await isFeatureOn(deps.db, ctx, "stats_page"))) return c.json({ error: "not_found" }, 404);
    const q = parseQuery(c, statsQuerySchema);
    const weeks = await recentWeekStats(
      deps.db,
      ctx,
      { weeks: q.weeks, mailboxId: q.mailboxId ?? null, now: deps.now() },
      deps
    );
    if (weeks === "not_found") return c.json({ error: "not_found" }, 404);
    return c.json({ weeks });
  });

  return app;
}
