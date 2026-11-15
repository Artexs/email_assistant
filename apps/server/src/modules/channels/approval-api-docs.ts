import { approvalDetailSchema, approvalListSchema, z } from "@ea/core";

import { apiDoc } from "../../platform/openapi";

// The OpenAPI description of the approval read routes (ADR 0023, F102 ticket). Any member reads. Both routes answer 404
// `not_found` while the flag `approvals_page` is off.
const tags = ["approvals"];

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
    params: z.object({ id: z.uuid() }),
    ok: { status: 200, schema: approvalDetailSchema },
    errors: [{ status: 404, codes: ["not_found"] }],
  }),
};
