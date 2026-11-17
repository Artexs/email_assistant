import {
  delegateMailBodySchema,
  LOOP_DEFAULT_FILTER,
  LOOP_PAGE_SIZE,
  loopActionBodySchema,
  loopListQuerySchema,
  z,
  type DelegateMailAnswer,
  type LoopFollowUpAnswer,
  type LoopLaterAnswer,
  type LoopList,
  type LoopOkAnswer,
} from "@ea/core";
import { Hono, type Context, type MiddlewareHandler } from "hono";

import type { Db } from "../../platform/db";
import { parseBody, parseQuery, requireOwner, ValidationError, type ApiEnv } from "../../platform/http";
import { getOrganization, isFeatureOn } from "../tenancy";

import { loopDocs } from "./api-docs";
import { delegateMail } from "./delegate";
import { draftFollowUp } from "./follow-up-draft";
import { loopItemsOf } from "./items";
import { decodeLoopCursor, endOfLocalDay, listLoops } from "./list";
import { doneLoop, dropLoop, laterLoop, reopenLoop, untrackLoop, type LoopCommandInput } from "./loop-commands";

export interface LoopRouteDeps {
  db: Db;
  now(): Date;
}

const idSchema = z.uuid();

function idOf(raw: string): string {
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError([{ path: "id", code: "invalid_format", message: "invalid id" }]);
  return parsed.data;
}

type Ctx = Context<ApiEnv>;

// A command kind that is no success: an unknown loop (or a flag turned off meanwhile) is 404, every other kind is a 409 with
// the kind as the code.
function refused(c: Ctx, kind: string): Response {
  if (kind === "not_found" || kind === "feature_off") return c.json({ error: "not_found" }, 404);
  return c.json({ error: kind }, 409);
}

// The routes of the open loops (ADR 0023). Any member reads, marks a loop done and moves its due date (Later); the follow-up, Drop,
// Reopen and Untrack are owner only, so a member gets 403 before any query. The flag `open_loops` comes first: with it off every
// route is a 404, for every role and with a bad id. Every write is one call of a loop command with `via: "web"` and the
// user of the session. A suspended organization is refused by the guard of every write route.
export function loopRoutes(deps: LoopRouteDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();

  const flagFirst: MiddlewareHandler<ApiEnv> = async (c, next) => {
    if (!(await isFeatureOn(deps.db, c.get("ctx"), "open_loops"))) return c.json({ error: "not_found" }, 404);
    await next();
  };

  const inputOf = async (c: Ctx): Promise<LoopCommandInput> => {
    const loopId = idOf(c.req.param("id") ?? "");
    await parseBody(c, loopActionBodySchema);
    return { loopId, userId: c.get("session").userId, via: "web" };
  };
  const commandDeps = { db: deps.db, now: deps.now };

  app.get("/loops", flagFirst, loopDocs.listLoops, async (c) => {
    const ctx = c.get("ctx");
    const q = parseQuery(c, loopListQuerySchema);
    const cursor = q.before === undefined ? undefined : decodeLoopCursor(q.before);
    if (cursor === null) {
      throw new ValidationError([{ path: "before", code: "invalid_cursor", message: "invalid cursor" }]);
    }
    // "Due" means due by the end of the local day of the organization: the reader compares `due_at <= now`.
    const organization = await getOrganization(deps.db, ctx);
    const page = await listLoops(deps.db, ctx, {
      kind: q.kind,
      filter: q.filter ?? LOOP_DEFAULT_FILTER,
      now: endOfLocalDay(deps.now(), organization?.timezone ?? "UTC"),
      ...(cursor === undefined ? {} : { before: cursor }),
      limit: q.limit ?? LOOP_PAGE_SIZE,
    });
    return c.json<LoopList>({ items: await loopItemsOf(deps.db, ctx, page.items), next: page.next });
  });

  app.post("/loops/:id/follow-up", flagFirst, requireOwner, loopDocs.followUpLoop, async (c) => {
    const result = await draftFollowUp(commandDeps, c.get("ctx"), await inputOf(c));
    if (result.kind === "planned") return c.json<LoopFollowUpAnswer>({ status: "planned", sendId: result.sendId });
    if (result.kind === "would_draft") return c.json<LoopFollowUpAnswer>({ status: "would_draft" });
    return refused(c, result.kind);
  });

  app.post("/loops/:id/later", flagFirst, loopDocs.laterLoop, async (c) => {
    const result = await laterLoop(commandDeps, c.get("ctx"), await inputOf(c));
    if (result.kind === "ok") return c.json<LoopLaterAnswer>({ status: "ok", dueAt: result.dueAt.toISOString() });
    return refused(c, result.kind);
  });

  const simple = (
    path: string,
    docs: (typeof loopDocs)[keyof typeof loopDocs],
    command: typeof doneLoop,
    ownerOnly: boolean
  ): void => {
    const handler = async (c: Ctx): Promise<Response> => {
      const result = await command(commandDeps, c.get("ctx"), await inputOf(c));
      return result.kind === "ok" ? c.json<LoopOkAnswer>({ status: "ok" }) : refused(c, result.kind);
    };
    if (ownerOnly) app.post(path, flagFirst, requireOwner, docs, handler);
    else app.post(path, flagFirst, docs, handler);
  };
  simple("/loops/:id/done", loopDocs.doneLoop, doneLoop, false);
  simple("/loops/:id/drop", loopDocs.dropLoop, dropLoop, true);
  simple("/loops/:id/reopen", loopDocs.reopenLoop, reopenLoop, true);
  simple("/loops/:id/untrack", loopDocs.untrackLoop, untrackLoop, true);

  // The flag `delegate_button` decides here, not `open_loops`: the button hands a mail to a delegate and opens no loop by itself.
  const delegateFlagFirst: MiddlewareHandler<ApiEnv> = async (c, next) => {
    if (!(await isFeatureOn(deps.db, c.get("ctx"), "delegate_button"))) return c.json({ error: "not_found" }, 404);
    await next();
  };
  app.post("/emails/:id/delegate", delegateFlagFirst, requireOwner, loopDocs.delegateMail, async (c) => {
    const emailId = idOf(c.req.param("id"));
    const body = await parseBody(c, delegateMailBodySchema);
    const result = await delegateMail(commandDeps, c.get("ctx"), {
      emailId,
      delegateId: body.delegateId,
      userId: c.get("session").userId,
      via: "web",
    });
    if (result.kind === "planned") {
      return c.json<DelegateMailAnswer>({ sendId: result.sendId, delegationId: result.delegationId });
    }
    if (result.kind === "not_allowed") return c.json({ error: "owner_only" }, 403);
    return refused(c, result.kind);
  });

  return app;
}
