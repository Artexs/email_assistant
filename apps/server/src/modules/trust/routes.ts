import { z, type TrustHistoryCheckAnswer, type TrustRecommendedAnswer } from "@ea/core";
import { Hono, type Context, type MiddlewareHandler } from "hono";

import { requireOwner, type ApiEnv } from "../../platform/http";
import { getMailbox } from "../mail";
import { isFeatureOn } from "../tenancy";

import { trustDocs } from "./api-docs";
import { turnOnRecommended } from "./recommended";
import { latestHistoryCheck, queueHistoryCheck } from "./repo";
import { checkViewOf, trustViewFor, type TrustViewDeps } from "./view";

export type TrustRouteDeps = TrustViewDeps;

type Ctx = Context<ApiEnv>;

const idSchema = z.uuid();

// null: not a UUID. The route answers 404 with no database call.
function mailboxIdOf(c: Ctx): string | null {
  const parsed = idSchema.safeParse(c.req.param("mailboxId"));
  return parsed.success ? parsed.data : null;
}

/**
 * The trust routes (ADR 0028). The flag `trust_ladder` comes first: with it off every route is a 404, for every role and with a bad
 * id. Any member reads the view; "Turn on recommended" and the history check are owner only (403 before any mailbox read). A mailbox
 * of another organization, or an unknown id, is a 404 `not_found`: the same answer for both. Every query filters `org_id`.
 */
export function trustRoutes(deps: TrustRouteDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  const { db } = deps.settings;
  const notFound = (c: Ctx) => c.json({ error: "not_found" }, 404);

  const flagFirst: MiddlewareHandler<ApiEnv> = async (c, next) => {
    if (!(await isFeatureOn(db, c.get("ctx"), "trust_ladder"))) return notFound(c);
    await next();
  };

  app.get("/trust/:mailboxId", flagFirst, trustDocs.getTrust, async (c) => {
    const id = mailboxIdOf(c);
    if (id === null) return notFound(c);
    const view = await trustViewFor(deps, c.get("ctx"), id);
    return view === null ? notFound(c) : c.json(view);
  });

  app.post("/trust/:mailboxId/recommended", flagFirst, requireOwner, trustDocs.postTrustRecommended, async (c) => {
    const id = mailboxIdOf(c);
    if (id === null) return notFound(c);
    const ctx = c.get("ctx");
    const result = await turnOnRecommended(deps, ctx, id, { actor: c.get("session").userId });
    if (result.kind === "not_found") return notFound(c);
    if (result.kind === "nothing_recommended") return c.json({ error: "nothing_recommended" }, 409);
    const view = await trustViewFor(deps, ctx, id);
    if (view === null) return notFound(c);
    const body: TrustRecommendedAnswer = { turnedOn: result.turnedOn, mode: result.mode, view };
    return c.json(body);
  });

  app.post("/trust/:mailboxId/history-check", flagFirst, requireOwner, trustDocs.postTrustHistoryCheck, async (c) => {
    const id = mailboxIdOf(c);
    if (id === null) return notFound(c);
    const ctx = c.get("ctx");
    if ((await getMailbox(db, ctx, id)) === undefined) return notFound(c);
    if ((await queueHistoryCheck(db, ctx, id, "web")) === null) return c.json({ error: "check_running" }, 409);
    const row = await latestHistoryCheck(db, ctx, id);
    if (row === null) throw new Error("history check not found after queue");
    const body: TrustHistoryCheckAnswer = { check: await checkViewOf(db, ctx, row) };
    return c.json(body, 202);
  });

  return app;
}
