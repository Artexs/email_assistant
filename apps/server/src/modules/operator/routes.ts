import {
  operatorFlagBodySchema,
  operatorNoticesQuerySchema,
  operatorPlanBodySchema,
  type OperatorFlagResult,
  type OperatorFlags,
  type OperatorNotices,
  type OperatorOrgDetail,
  type OperatorOrgList,
} from "@ea/core";
import { type Context, Hono } from "hono";
import { z } from "zod";

import type { Db } from "../../platform/db";
import { parseBody, parseQuery, type ApiEnv } from "../../platform/http";
import { createLog } from "../../platform/log";
import { featureStatesOfAll, type SetOrgPlanHooks } from "../tenancy";

import { changeOrgFlag, changeOrgPlan, getOperatorOrg, listOperatorNotices, listOperatorOrgs } from "./service";

const log = createLog("operator");

export interface OperatorRouteDeps {
  db: Db;
  now: () => Date;
  // The hooks of `org:plan` (composition.ts `orgPlanHooks`): the console suspends and resumes as the CLI does.
  planHooks: SetOrgPlanHooks;
}

// The organization id of the path; null when it is not a UUID (the route answers 404 with no database call).
function operatorOrgIdParam(c: Context<ApiEnv>): string | null {
  const id = z.uuid().safeParse(c.req.param("orgId"));
  return id.success ? id.data : null;
}

// No app.use("*") here: createApp guards the whole /api/operator prefix with requireOperator.
export function operatorRoutes(deps: OperatorRouteDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  app.get("/flags", async (c) => c.json({ rows: await featureStatesOfAll(deps.db) } satisfies OperatorFlags));
  app.get("/orgs", async (c) => c.json((await listOperatorOrgs(deps)) satisfies OperatorOrgList));
  // A path id that is not a UUID answers 404 with no database call.
  app.get("/orgs/:orgId", async (c) => {
    const id = operatorOrgIdParam(c);
    if (id === null) return c.json({ error: "not_found" }, 404);
    const detail = await getOperatorOrg(deps, id);
    if ("kind" in detail) return c.json({ error: "not_found" }, 404);
    return c.json(detail satisfies OperatorOrgDetail);
  });
  app.get("/notices", async (c) => {
    const { days } = parseQuery(c, operatorNoticesQuerySchema);
    return c.json((await listOperatorNotices(deps, days)) satisfies OperatorNotices);
  });
  // Writes: the operator's user id is the actor; the audit rows go into the target organization.
  app.post("/orgs/:orgId/plan", async (c) => {
    const id = operatorOrgIdParam(c);
    if (id === null) return c.json({ error: "not_found" }, 404);
    const body = await parseBody(c, operatorPlanBodySchema);
    const { userId } = c.get("session");
    const result = await changeOrgPlan(deps, { orgId: id, actor: userId, body });
    log.info("operator_write", { org_id: id, user_id: userId, kind: "plan", status: result.kind });
    return c.json(result.body, result.status);
  });
  app.post("/orgs/:orgId/flags", async (c) => {
    const id = operatorOrgIdParam(c);
    if (id === null) return c.json({ error: "not_found" }, 404);
    const body = await parseBody(c, operatorFlagBodySchema);
    const { userId } = c.get("session");
    const result = await changeOrgFlag(deps, { orgId: id, actor: userId, body });
    log.info("operator_write", { org_id: id, user_id: userId, kind: "flag", status: result.kind });
    switch (result.kind) {
      case "not_found":
        return c.json({ error: "not_found" }, 404);
      case "unknown_flag":
        return c.json({ error: "unknown_flag" }, 400);
      case "changed":
      case "unchanged":
        return c.json({
          result: result.kind,
          flag: result.flag,
          enabled: result.enabled,
          ...(result.warning ? { warning: result.warning } : {}),
        } satisfies OperatorFlagResult);
    }
  });
  return app;
}
