import type { OperatorFlags } from "@ea/core";
import { Hono } from "hono";

import type { Db } from "../../platform/db";
import type { ApiEnv } from "../../platform/http";
import { featureStatesOfAll } from "../tenancy";

export interface OperatorRouteDeps {
  db: Db;
}

// No app.use("*") here (P1): createApp guards the whole /api/operator prefix with requireOperator.
export function operatorRoutes(deps: OperatorRouteDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  app.get("/flags", async (c) => c.json({ rows: await featureStatesOfAll(deps.db) } satisfies OperatorFlags));
  return app;
}
