import { feedbackBodySchema, undoBodySchema, type FeedbackResult, type UndoWebResult } from "@ea/core";
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
    const answer: FeedbackResult = { saved: result.saved, verdict: result.verdict, aiCategory: result.aiCategory };
    return c.json(answer);
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
    const answer: UndoWebResult =
      result.kind === "started" ? { kind: "started", created: result.created } : { kind: result.kind };
    return c.json(answer);
  });

  return app;
}
