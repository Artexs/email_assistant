import {
  operatorNoticesQuerySchema,
  type OperatorFlags,
  type OperatorNotices,
  type OperatorOrgDetail,
  type OperatorOrgList,
} from "@ea/core";
import { Hono } from "hono";
import { z } from "zod";

import type { Db } from "../../platform/db";
import { parseQuery, type ApiEnv } from "../../platform/http";
import { featureStatesOfAll } from "../tenancy";

import { getOperatorOrg, listOperatorNotices, listOperatorOrgs } from "./service";

export interface OperatorRouteDeps {
  db: Db;
  now: () => Date;
}

// No app.use("*") here (P1): createApp guards the whole /api/operator prefix with requireOperator.
export function operatorRoutes(deps: OperatorRouteDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  app.get("/flags", async (c) => c.json({ rows: await featureStatesOfAll(deps.db) } satisfies OperatorFlags));
  app.get("/orgs", async (c) => c.json((await listOperatorOrgs(deps)) satisfies OperatorOrgList));
  // A path id that is not a UUID answers 404 with no database call.
  app.get("/orgs/:orgId", async (c) => {
    const id = z.uuid().safeParse(c.req.param("orgId"));
    if (!id.success) return c.json({ error: "not_found" }, 404);
    const detail = await getOperatorOrg(deps, id.data);
    if ("kind" in detail) return c.json({ error: "not_found" }, 404);
    return c.json(detail satisfies OperatorOrgDetail);
  });
  app.get("/notices", async (c) => {
    const { days } = parseQuery(c, operatorNoticesQuerySchema);
    return c.json((await listOperatorNotices(deps, days)) satisfies OperatorNotices);
  });
  return app;
}
