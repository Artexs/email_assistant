import {
  approvalDecisionBodySchema,
  approvalEditBodySchema,
  z,
  type ApprovalApproveAnswer,
  type ApprovalEditAnswer,
  type ApprovalRejectAnswer,
} from "@ea/core";
import { Hono } from "hono";

import type { Db, TenantContext } from "../../platform/db";
import { parseBody, requireOwner, ValidationError, type ApiEnv } from "../../platform/http";
import { approve, editApproval, reject, type DelegationHooks, type SendScope } from "../actions";
import { isFeatureOn } from "../tenancy";

import { approvalDocs } from "./approval-api-docs";
import { getApprovalDetail, listApprovals } from "./approvals-read";
import { cardEditHooks } from "./card-edits";
import { heldReason } from "./held-reason";

export interface ApprovalRouteDeps {
  db: Db;
  now(): Date;
  sendScope: SendScope;
  // The hooks of the delegation module and the UIDPLUS read of the mailbox: the same ones that the Telegram taps get.
  hooks: DelegationHooks;
  uidplus(ctx: TenantContext, mailboxId: string): Promise<boolean>;
}

const idSchema = z.uuid();

function idOf(raw: string): string {
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError([{ path: "id", code: "invalid_format", message: "invalid id" }]);
  return parsed.data;
}

// F102 ticket: the routes of the approvals page. Any member reads; the three writes are owner only (F102 plan, P6: owner only). The flag comes first: with it off a
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

  // The hook is the real one for every write. `approve` and `reject` read the owner check from `requireOwner`.
  const decisionDeps = () => ({
    db: deps.db,
    hooks: deps.hooks,
    approvalHooks: cardEditHooks({ sendScope: deps.sendScope }),
    uidplus: deps.uidplus,
  });

  app.post("/approvals/:id/approve", requireOwner, approvalDocs.approveApproval, async (c) => {
    const ctx = c.get("ctx");
    if (!(await isFeatureOn(deps.db, ctx, "approvals_page"))) return c.json({ error: "not_found" }, 404);
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
      // `expired` with `byThisTap`: the send timed out and this call expired it. It queues no card edit, so the Telegram cards stay
      // live (accepted in writing: the expiry job edits no card; the stage of the delegations API owns that work, F102 questions Q18). A tap on such a card answers `expired`.
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

  app.post("/approvals/:id/reject", requireOwner, approvalDocs.rejectApproval, async (c) => {
    const ctx = c.get("ctx");
    if (!(await isFeatureOn(deps.db, ctx, "approvals_page"))) return c.json({ error: "not_found" }, 404);
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
      case "already":
        return c.json({ error: "closed", state: result.status }, 409);
      case "not_found":
        return c.json({ error: "not_found" }, 404);
    }
  });

  app.post("/approvals/:id/edit", requireOwner, approvalDocs.editApproval, async (c) => {
    const ctx = c.get("ctx");
    if (!(await isFeatureOn(deps.db, ctx, "approvals_page"))) return c.json({ error: "not_found" }, 404);
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
      case "closed":
        return c.json({ error: "closed", state: result.state }, 409);
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
