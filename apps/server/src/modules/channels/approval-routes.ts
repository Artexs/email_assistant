import { z } from "@ea/core";
import { Hono } from "hono";

import type { Db } from "../../platform/db";
import { ValidationError, type ApiEnv } from "../../platform/http";
import type { SendScope } from "../actions";
import { isFeatureOn } from "../tenancy";

import { approvalDocs } from "./approval-api-docs";
import { getApprovalDetail, listApprovals } from "./approvals-read";

export interface ApprovalRouteDeps {
  db: Db;
  now(): Date;
  sendScope: SendScope;
}

// F102 ticket: the read routes of the approvals page. Any member reads (owner-only writes come later). The flag comes first: with it off a bad id is
// a 404, not a 400. The answers pass their strict schemas in `approvals-read.ts`.
export function approvalRoutes(deps: ApprovalRouteDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();

  app.get("/approvals", approvalDocs.listApprovals, async (c) => {
    const ctx = c.get("ctx");
    if (!(await isFeatureOn(deps.db, ctx, "approvals_page"))) return c.json({ error: "not_found" }, 404);
    return c.json(await listApprovals(deps, ctx, deps.now()));
  });

  app.get("/approvals/:id", approvalDocs.getApproval, async (c) => {
    const ctx = c.get("ctx");
    if (!(await isFeatureOn(deps.db, ctx, "approvals_page"))) return c.json({ error: "not_found" }, 404);
    const id = z.uuid().safeParse(c.req.param("id"));
    if (!id.success) throw new ValidationError([{ path: "id", code: "invalid_format", message: "invalid id" }]);
    const detail = await getApprovalDetail(deps, ctx, id.data, deps.now());
    if (detail === undefined) return c.json({ error: "not_found" }, 404);
    return c.json(detail);
  });

  return app;
}
