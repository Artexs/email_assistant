import { rejectReasonBodySchema, type ActionFeedbackAnswer } from "@ea/core";
import { Hono } from "hono";
import { z } from "zod";

import type { Db } from "../../platform/db";
import { parseBody, requireOwner, ValidationError, type ApiEnv } from "../../platform/http";
import { isFeatureOn } from "../tenancy";

import { markSentMistake, recordRejectReason } from "./feedback";

export interface ActionRouteDeps {
  db: Db;
  now(): Date;
}

const idSchema = z.uuid();

// Plan D21: the web twin of the two Telegram taps. Owner only; every call checks the flag `mistake_capture` itself.
export function actionRoutes(deps: ActionRouteDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();

  app.post("/actions/:id/reject-reason", requireOwner, async (c) => {
    const ctx = c.get("ctx");
    if (!(await isFeatureOn(deps.db, ctx, "mistake_capture"))) return c.json({ error: "not_found" }, 404);
    const id = actionIdOf(c.req.param("id"));
    const body = await parseBody(c, rejectReasonBodySchema);
    const userId = c.get("session").userId;
    const result = await recordRejectReason(deps.db, ctx, {
      actionId: id,
      reason: body.reason,
      userId,
      via: "web",
      now: deps.now(),
    });
    if (result.kind === "not_found") return c.json({ error: "not_found" }, 404);
    if (result.kind === "not_rejected") return c.json({ error: "not_rejected" }, 409);
    return c.json<ActionFeedbackAnswer>({ status: "saved" });
  });

  app.post("/actions/:id/mistake", requireOwner, async (c) => {
    const ctx = c.get("ctx");
    if (!(await isFeatureOn(deps.db, ctx, "mistake_capture"))) return c.json({ error: "not_found" }, 404);
    const id = actionIdOf(c.req.param("id"));
    const userId = c.get("session").userId;
    const result = await markSentMistake(deps.db, ctx, { actionId: id, userId, via: "web", now: deps.now() });
    if (result.kind === "not_found") return c.json({ error: "not_found" }, 404);
    if (result.kind === "not_sent") return c.json({ error: "not_sent" }, 409);
    if (result.kind === "too_late") return c.json({ error: "too_late" }, 409);
    return c.json<ActionFeedbackAnswer>({ status: result.kind });
  });

  return app;
}

function actionIdOf(raw: string): string {
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError([{ path: "id", code: "invalid_format", message: "invalid id" }]);
  return parsed.data;
}
