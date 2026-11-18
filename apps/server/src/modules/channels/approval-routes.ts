import {
  approvalClosedStates,
  approvalDecisionBodySchema,
  approvalEditBodySchema,
  approvalEditClosedCodes,
  z,
  type ApprovalApproveAnswer,
  type ApprovalClosedState,
  type ApprovalEditAnswer,
  type ApprovalRejectAnswer,
} from "@ea/core";
import { Hono, type MiddlewareHandler } from "hono";

import type { Db, TenantContext } from "../../platform/db";
import { HardError } from "../../platform/errors";
import { parseBody, requireOwner, ValidationError, type ApiEnv } from "../../platform/http";
import { approve, editApproval, getSend, reject, type DelegationHooks, type SendScope } from "../actions";
import type { SenderLineDeps } from "../contacts";
import { loopHooks } from "../loops";
import { isFeatureOn } from "../tenancy";

import { approvalDocs } from "./approval-api-docs";
import { getApprovalDetail, listApprovals, stateOf } from "./approvals-read";
import { cardEditHooks } from "./card-edits";
import { heldReason } from "./held-reason";

export interface ApprovalRouteDeps {
  db: Db;
  now(): Date;
  sendScope: SendScope;
  // The hooks of the delegation module and the UIDPLUS read of the mailbox: the same ones that the Telegram taps get.
  hooks: DelegationHooks;
  uidplus(ctx: TenantContext, mailboxId: string): Promise<boolean>;
  // The sender line (flag `sender_context`). Absent: no line, as with the flag off.
  sender?: SenderLineDeps;
}

const idSchema = z.uuid();

// The name of a closed send for the page: the one that `stateOf` gives the detail route, so one send has one name in approve,
// reject, edit and the detail (`applied` is `sent`, `applying` is `sending`, `approved` is `held` or `sending` by the lock). The services
// answer with the raw status; the read names it. A send that is not a send state for the page (`logged`, `ready`, `undone`: a plan
// that never reached approval) has no name: undefined, and the route answers 404 as the detail route and approve do. A send that is
// still waiting or was replaced is no closed send: HardError, never a made-up name.
export async function closedStateOf(
  deps: Pick<ApprovalRouteDeps, "db" | "now">,
  ctx: TenantContext,
  sendId: string
): Promise<ApprovalClosedState | undefined> {
  const send = await getSend(deps.db, ctx, sendId);
  const state = send === undefined ? undefined : stateOf(send, deps.now());
  if (state === undefined) return undefined;
  if (!approvalClosedStates.includes(state as ApprovalClosedState)) {
    throw new HardError("a closed send has no closed state");
  }
  return state as ApprovalClosedState;
}

export function idOf(raw: string): string {
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError([{ path: "id", code: "invalid_format", message: "invalid id" }]);
  return parsed.data;
}

// The routes of the approvals page. Any member reads; the three writes are owner only (owner only). The flag comes first: with it off a
// bad id is a 404, not a 400. The read answers pass their strict schemas in `approvals-read.ts`. Every write passes `via: "web"` and the
// real card hook, so the Telegram cards follow. The id in the path is the version that the page showed: no route looks for a newer one.
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
    const detail = await getApprovalDetail(deps, ctx, idOf(c.req.param("id")), deps.now());
    if (detail === undefined) return c.json({ error: "not_found" }, 404);
    return c.json(detail);
  });

  // The flag comes before the role: with the flag off every route is a 404, also for a member (the routes do not exist yet).
  const flagFirst: MiddlewareHandler<ApiEnv> = async (c, next) => {
    if (!(await isFeatureOn(deps.db, c.get("ctx"), "approvals_page"))) return c.json({ error: "not_found" }, 404);
    await next();
  };

  // The hook is the real one for every write. `approve` and `reject` read the owner check from `requireOwner`.
  const decisionDeps = () => ({
    db: deps.db,
    hooks: deps.hooks,
    approvalHooks: cardEditHooks({ sendScope: deps.sendScope }),
    // The edit of a follow-up reads its loop.
    loopHooks: loopHooks(),
    uidplus: deps.uidplus,
  });

  app.post("/approvals/:id/approve", flagFirst, requireOwner, approvalDocs.approveApproval, async (c) => {
    const ctx = c.get("ctx");
    const id = idOf(c.req.param("id"));
    await parseBody(c, approvalDecisionBodySchema);
    const result = await approve(decisionDeps(), ctx, id, {
      userId: c.get("session").userId,
      via: "web",
      now: deps.now(),
    });
    switch (result.kind) {
      case "approved": {
        // Read after the commit, as the Telegram tap does: a cause (scope, paused mailbox) turns the answer into `approved_held`.
        const heldBy = await heldReason(deps, ctx, id);
        return c.json<ApprovalApproveAnswer>(
          heldBy === undefined ? { status: "approved" } : { status: "approved_held", heldBy }
        );
      }
      case "already_approved": // a double click is not an error
        return c.json<ApprovalApproveAnswer>({ status: "approved" });
      case "superseded":
        return c.json({ error: "changed", currentId: result.currentId }, 409);
      case "draft_not_ready":
        return c.json({ error: "draft_not_ready" }, 409);
      // A reply whose text still holds a gap, or the flag of the reply drafts is off.
      case "has_gaps":
        return c.json({ error: "has_gaps" }, 409);
      case "feature_off":
        return c.json({ error: "feature_off" }, 409);
      // `expired` with `byThisTap`: the send timed out and this call expired it. `approve` queued the `expired` card edit for every
      // sent card (the panel has no card of its own), so the Telegram cards lose their buttons. The hourly expiry
      // job still edits no card: a tap on a card of such a send answers `expired`.
      case "expired":
        return c.json({ error: "closed", state: "expired" }, 409);
      case "sending":
      case "sent":
      case "rejected":
      case "failed":
        return c.json({ error: "closed", state: result.kind }, 409);
      case "not_found":
        return c.json({ error: "not_found" }, 404);
    }
  });

  app.post("/approvals/:id/reject", flagFirst, requireOwner, approvalDocs.rejectApproval, async (c) => {
    const ctx = c.get("ctx");
    const id = idOf(c.req.param("id"));
    await parseBody(c, approvalDecisionBodySchema);
    const result = await reject(decisionDeps(), ctx, id, {
      userId: c.get("session").userId,
      via: "web",
      now: deps.now(),
    });
    switch (result.kind) {
      case "rejected":
        return c.json<ApprovalRejectAnswer>({ status: "rejected" });
      case "superseded":
        return c.json({ error: "changed", currentId: result.currentId }, 409);
      case "already": {
        const state = await closedStateOf(deps, ctx, id);
        if (state === undefined) return c.json({ error: "not_found" }, 404);
        return c.json({ error: "closed", state }, 409);
      }
      case "not_found":
        return c.json({ error: "not_found" }, 404);
    }
  });

  app.post("/approvals/:id/edit", flagFirst, requireOwner, approvalDocs.editApproval, async (c) => {
    const ctx = c.get("ctx");
    const id = idOf(c.req.param("id"));
    const body = await parseBody(c, approvalEditBodySchema);
    const result = await editApproval(decisionDeps(), ctx, id, {
      userId: c.get("session").userId,
      via: "web",
      now: deps.now(),
      subject: body.subject,
      body: body.body,
      ...(body.delegateId === undefined ? {} : { delegateId: body.delegateId }),
    });
    switch (result.kind) {
      case "edited":
        return c.json<ApprovalEditAnswer>({ id: result.sendId, version: result.version });
      case "changed":
        return c.json({ error: "changed", currentId: result.currentId }, 409);
      case "closed": {
        // Its own codes stay; a raw status gets the name that `stateOf` gives (the edit read it under the lock, the name needs the lock time).
        const own = approvalEditClosedCodes.find((code) => code === result.state);
        const state = own ?? (await closedStateOf(deps, ctx, id));
        if (state === undefined) return c.json({ error: "not_found" }, 404);
        return c.json({ error: "closed", state }, 409);
      }
      case "drafts_off":
        return c.json({ error: "drafts_off" }, 409);
      case "not_editable":
      case "unchanged":
      case "delegate_inactive":
        return c.json({ error: result.kind }, 400);
      case "not_found":
        return c.json({ error: "not_found" }, 404);
    }
  });

  return app;
}
