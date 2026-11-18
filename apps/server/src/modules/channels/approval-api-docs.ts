import {
  approvalApproveAnswerSchema,
  approvalConflictSchema,
  approvalDecisionBodySchema,
  approvalDetailSchema,
  approvalEditAnswerSchema,
  approvalEditBodySchema,
  approvalListSchema,
  approvalRejectAnswerSchema,
  z,
} from "@ea/core";

import { apiDoc } from "../../platform/openapi";

// The OpenAPI description of the approval routes (ADR 0023). Any member reads; only the owner writes. Every
// route answers 404 `not_found` while the flag `approvals_page` is off.
const tags = ["approvals"];
const params = z.object({ id: z.uuid() });
const ownerOnly = { status: 403, codes: ["owner_only"] } as const;
const notFound = { status: 404, codes: ["not_found"] } as const;

export const approvalDocs = {
  listApprovals: apiDoc({
    operationId: "listApprovals",
    summary: "The sends that wait for approval or are held after it, newest first, at most 100.",
    tags,
    ok: { status: 200, schema: approvalListSchema },
    errors: [{ status: 404, codes: ["not_found"] }],
  }),
  getApproval: apiDoc({
    operationId: "getApproval",
    summary: "One send in any state, with the text that the committer would send.",
    tags,
    params,
    ok: { status: 200, schema: approvalDetailSchema },
    errors: [{ status: 404, codes: ["not_found"] }],
  }),
  approveApproval: apiDoc({
    operationId: "approveApproval",
    summary:
      "Approve a waiting send (owner only). `approved_held` means the send waits for the committer; `heldBy` names the cause.",
    tags,
    params,
    body: approvalDecisionBodySchema,
    ok: { status: 200, schema: approvalApproveAnswerSchema },
    errors: [
      ownerOnly,
      notFound,
      {
        status: 409,
        codes: ["changed", "draft_not_ready", "has_gaps", "feature_off", "closed"],
        schema: approvalConflictSchema,
      },
    ],
  }),
  rejectApproval: apiDoc({
    operationId: "rejectApproval",
    summary: "Reject a waiting or held send (owner only). The reason is the route postActionRejectReason.",
    tags,
    params,
    body: approvalDecisionBodySchema,
    ok: { status: 200, schema: approvalRejectAnswerSchema },
    errors: [ownerOnly, notFound, { status: 409, codes: ["changed", "closed"], schema: approvalConflictSchema }],
  }),
  editApproval: apiDoc({
    operationId: "editApproval",
    summary:
      "Replace a waiting send by a new version with a new text or delegate (owner only). The new version needs a new approval.",
    tags,
    params,
    body: approvalEditBodySchema,
    ok: { status: 200, schema: approvalEditAnswerSchema },
    errors: [
      ownerOnly,
      notFound,
      { status: 400, codes: ["not_editable", "unchanged", "delegate_inactive"] },
      { status: 409, codes: ["changed", "closed", "drafts_off"], schema: approvalConflictSchema },
    ],
  }),
};
