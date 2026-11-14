import {
  operatorFlagBodySchema,
  operatorNoticesQuerySchema,
  operatorPlanBodySchema,
  type OperatorFlagResult,
  type OperatorFlags,
  type OperatorNotices,
  type OperatorOrgDetail,
  type OperatorOrgList,
  type OperatorPlanResult,
} from "@ea/core";
import { Hono } from "hono";
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
  // Writes (D20): the operator's user id is the actor; the audit rows go into the target organization.
  app.post("/orgs/:orgId/plan", async (c) => {
    const id = z.uuid().safeParse(c.req.param("orgId"));
    if (!id.success) return c.json({ error: "not_found" }, 404);
    const body = await parseBody(c, operatorPlanBodySchema);
    const { userId } = c.get("session");
    const result = await changeOrgPlan(deps, { orgId: id.data, actor: userId, body });
    log.info("operator_write", { org_id: id.data, user_id: userId, kind: "plan", status: result.kind });
    switch (result.kind) {
      case "not_found":
        return c.json({ error: "not_found" }, 404);
      case "trial_days_needed":
        return c.json({ error: "trial_days_needed" }, 400);
      case "bad_input":
        return c.json({ error: result.reason }, 400);
      case "unchanged":
        return c.json({
          result: "unchanged",
          plan: result.state.plan,
          trialEndsAt: result.state.trialEndsAt?.toISOString() ?? null,
          maxMailboxes: result.state.maxMailboxes,
          resumedAt: result.state.resumedAt?.toISOString() ?? null,
          cancelledMessages: 0,
          expiredSends: 0,
        } satisfies OperatorPlanResult);
      case "changed":
        return c.json({
          result: "changed",
          plan: result.after.plan,
          trialEndsAt: result.after.trialEndsAt?.toISOString() ?? null,
          maxMailboxes: result.after.maxMailboxes,
          resumedAt: result.after.resumedAt?.toISOString() ?? null,
          cancelledMessages: result.cancelledMessages,
          expiredSends: result.expiredSends,
        } satisfies OperatorPlanResult);
    }
  });
  app.post("/orgs/:orgId/flags", async (c) => {
    const id = z.uuid().safeParse(c.req.param("orgId"));
    if (!id.success) return c.json({ error: "not_found" }, 404);
    const body = await parseBody(c, operatorFlagBodySchema);
    const { userId } = c.get("session");
    const result = await changeOrgFlag(deps, { orgId: id.data, actor: userId, body });
    log.info("operator_write", { org_id: id.data, user_id: userId, kind: "flag", status: result.kind });
    switch (result.kind) {
      case "not_found":
        return c.json({ error: "not_found" }, 404);
      case "unknown_flag":
        return c.json({ error: "unknown_flag" }, 400);
      case "changed":
      case "unchanged":
        return c.json({ result: result.kind, flag: result.flag, enabled: result.enabled } satisfies OperatorFlagResult);
    }
  });
  return app;
}
