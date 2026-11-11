import { feedbackBodySchema, undoBodySchema } from "@ea/core";
import { Hono } from "hono";

import type { Db } from "../../platform/db";
import { parseBody, type ApiEnv } from "../../platform/http";
import { createLog } from "../../platform/log";
import type { ActionsScope } from "../actions";

import { recordWebFeedback } from "./feedback";
import { undoWithFeedback } from "./undo";

const log = createLog("triage");

export interface TriageRouteDeps {
  db: Db;
  now(): Date;
  actionsScope: ActionsScope;
}

export function triageRoutes(deps: TriageRouteDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();

  app.post("/feedback", async (c) => {
    const body = await parseBody(c, feedbackBodySchema);
    const result = await recordWebFeedback(deps.db, c.get("ctx"), {
      emailId: body.emailId,
      trueCategory: body.trueCategory,
      userId: c.get("session").userId,
    });
    if (result.kind === "not_found") {
      return c.json({ error: "not_found" }, 404);
    }
    return c.json({ saved: result.saved, verdict: result.verdict, aiCategory: result.aiCategory });
  });

  app.post("/actions/undo", async (c) => {
    const body = await parseBody(c, undoBodySchema);
    const userId = c.get("session").userId;
    const result = await undoWithFeedback(deps.db, c.get("ctx"), body.emailId, {
      now: deps.now(),
      userId,
      scope: deps.actionsScope,
    });
    if (result.kind === "not_found") {
      return c.json({ error: "not_found" }, 404);
    }
    log.info(`web undo ${result.kind} mail ${body.emailId} by user ${userId}`);
    return result.kind === "started"
      ? c.json({ kind: "started", created: result.created })
      : c.json({ kind: result.kind });
  });

  return app;
}
