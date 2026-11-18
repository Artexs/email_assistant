import {
  approvalEditClosedCodes,
  replyRecipientsBodySchema,
  replyRedraftBodySchema,
  replyRequestBodySchema,
  type ReplyConflict,
  type ReplyOpenAnswer,
  type ReplyQueuedAnswer,
  type ReplyRecipientsAnswer,
  type ReplyRequestStatus,
} from "@ea/core";
import { Hono, type Context, type MiddlewareHandler } from "hono";

import { parseBody, requireOwner, ValidationError, type ApiEnv } from "../../platform/http";
import { listOpenReplySendsOfThread } from "../actions";
import { redraftReply, requestReply, getUserRequest, setReplyRecipients } from "../replies";
import { isFeatureOn } from "../tenancy";

import { closedStateOf, idOf, type ApprovalRouteDeps } from "./approval-routes";
import { cardEditHooks } from "./card-edits";
import { replyApprovalDocs } from "./reply-api-docs";

type Ctx = Context<ApiEnv>;

// The line of the user failed the rules of the service (empty after cleaning, or too long). The error names the field and a code,
// never the text.
function badInstruction(): ValidationError {
  return new ValidationError([{ path: "instruction", code: "custom", message: "instruction_length" }]);
}

// The reply routes of the panel. They sit next to the approval routes and take the same deps: the two flags `approvals_page` and
// `reply_drafts` come first (with one of them off every route is a 404, for a member too, before the id or the body is read), then
// the owner check, then the body. The services check the owner, the flag and the gates of the mailbox again. Every write passes
// `via: "web"`: the audit row of a request tells the Telegram result detector that the answer belongs to the panel. No answer, log line
// or audit row of these routes holds the instruction.
export function replyApprovalRoutes(deps: ApprovalRouteDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  const notFound = (c: Ctx) => c.json({ error: "not_found" }, 404);

  const flagsFirst: MiddlewareHandler<ApiEnv> = async (c, next) => {
    const ctx = c.get("ctx");
    if (!(await isFeatureOn(deps.db, ctx, "approvals_page")) || !(await isFeatureOn(deps.db, ctx, "reply_drafts"))) {
      return notFound(c);
    }
    await next();
  };

  app.post("/replies", flagsFirst, requireOwner, replyApprovalDocs.requestReply, async (c) => {
    const ctx = c.get("ctx");
    const body = await parseBody(c, replyRequestBodySchema);
    const result = await requestReply({ db: deps.db, now: deps.now }, ctx, {
      userId: c.get("session").userId,
      via: "web",
      emailId: body.emailId,
      ...(body.instruction === undefined ? {} : { instruction: body.instruction }),
    });
    switch (result.kind) {
      case "queued":
        return c.json<ReplyQueuedAnswer>({ requestId: result.requestId }, 202);
      case "open":
        return c.json<ReplyOpenAnswer>({ sendId: result.sendId });
      case "blocked":
        return c.json<ReplyConflict>({ error: "blocked", reason: result.reason }, 409);
      case "invalid_instruction":
        throw badInstruction();
      case "forbidden":
        return c.json({ error: "owner_only" }, 403);
      case "feature_off":
      case "not_found":
        return notFound(c);
    }
  });

  app.post("/approvals/:id/redraft", flagsFirst, requireOwner, replyApprovalDocs.redraftReply, async (c) => {
    const ctx = c.get("ctx");
    const id = idOf(c.req.param("id"));
    const body = await parseBody(c, replyRedraftBodySchema);
    const result = await redraftReply({ db: deps.db, now: deps.now }, ctx, {
      userId: c.get("session").userId,
      via: "web",
      sendId: id,
      instruction: body.instruction,
    });
    switch (result.kind) {
      case "queued":
        return c.json<ReplyQueuedAnswer>({ requestId: result.requestId }, 202);
      case "blocked":
        return c.json<ReplyConflict>({ error: "blocked", reason: result.reason }, 409);
      case "changed":
        return c.json<ReplyConflict>({ error: "changed", currentId: result.currentId }, 409);
      case "redraft_limit":
        return c.json<ReplyConflict>({ error: "redraft_limit" }, 409);
      case "closed": {
        // The name that the detail route gives the send (`approved` is `held` or `sending`, `applied` is `sent`).
        const state = await closedStateOf(deps, ctx, id);
        if (state === undefined) return notFound(c);
        return c.json<ReplyConflict>({ error: "closed", state }, 409);
      }
      case "invalid_instruction":
        throw badInstruction();
      case "forbidden":
        return c.json({ error: "owner_only" }, 403);
      case "feature_off":
      case "not_found":
        return notFound(c);
    }
  });

  app.post("/approvals/:id/recipients", flagsFirst, requireOwner, replyApprovalDocs.setReplyRecipients, async (c) => {
    const ctx = c.get("ctx");
    const id = idOf(c.req.param("id"));
    const body = await parseBody(c, replyRecipientsBodySchema);
    const result = await setReplyRecipients(
      {
        db: deps.db,
        hooks: deps.hooks,
        approvalHooks: cardEditHooks({ sendScope: deps.sendScope }),
        uidplus: deps.uidplus,
      },
      ctx,
      { userId: c.get("session").userId, via: "web", sendId: id, mode: body.mode, now: deps.now() }
    );
    switch (result.kind) {
      case "edited":
        return c.json<ReplyRecipientsAnswer>({ id: result.sendId, version: result.version });
      case "changed":
        return c.json<ReplyConflict>({ error: "changed", currentId: result.currentId }, 409);
      case "closed": {
        // Its own codes stay; a raw status gets the name of the detail route. The send of another kind is no reply: 404.
        const own = approvalEditClosedCodes.find((code) => code === result.state);
        if (own !== undefined) return c.json<ReplyConflict>({ error: "closed", state: own }, 409);
        if (result.state === "not_reply") return notFound(c);
        const state = await closedStateOf(deps, ctx, id);
        if (state === undefined) return notFound(c);
        return c.json<ReplyConflict>({ error: "closed", state }, 409);
      }
      case "drafts_off":
        return c.json<ReplyConflict>({ error: "drafts_off" }, 409);
      case "too_many_recipients":
      case "no_reply_to":
      case "no_others":
      case "bad_recipient":
      case "unchanged":
      case "not_editable":
        return c.json({ error: result.kind }, 400);
      case "forbidden":
        return c.json({ error: "owner_only" }, 403);
      case "feature_off":
      case "not_found":
        return notFound(c);
    }
  });

  // Any member reads. The route reads the request row, and for a request that ended `superseded` the open reply of its thread.
  app.get("/replies/requests/:id", flagsFirst, replyApprovalDocs.getReplyRequest, async (c) => {
    const ctx = c.get("ctx");
    const request = await getUserRequest(deps.db, ctx, idOf(c.req.param("id")));
    if (request === undefined) return notFound(c);
    let sendId: string | null = null;
    if (request.status === "done") sendId = request.sendActionId;
    if (request.status === "superseded") {
      const open = await listOpenReplySendsOfThread(deps.db, ctx, request.mailboxId, request.threadKey);
      // The oldest mail first: the last one is the newest mail of the thread, the one that the request lost to.
      sendId = open.at(-1)?.sendId ?? null;
    }
    return c.json<ReplyRequestStatus>({ status: request.status, reasonCode: request.reasonCode, sendId });
  });

  return app;
}
