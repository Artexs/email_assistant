import { actionFeedbackAnswerSchema, rejectReasonBodySchema, z } from "@ea/core";

import { apiDoc } from "../../platform/openapi";

// The OpenAPI description of the action routes (ADR 0023). The schemas are the ones the route and the web parse with.
// Both routes are for the owner, and both answer 404 `not_found` while the flag `mistake_capture` is off.
const tags = ["actions"];
const params = z.object({ id: z.uuid() });
const ownerOnly = { status: 403, codes: ["owner_only"] } as const;

export const actionDocs = {
  postActionRejectReason: apiDoc({
    operationId: "postActionRejectReason",
    summary: "Name the reason of a rejected send (owner only).",
    tags,
    params,
    body: rejectReasonBodySchema,
    ok: { status: 200, schema: actionFeedbackAnswerSchema },
    errors: [ownerOnly, { status: 404, codes: ["not_found"] }, { status: 409, codes: ["not_rejected"] }],
  }),
  postActionMistake: apiDoc({
    operationId: "postActionMistake",
    summary: "Mark a sent message as a mistake (owner only).",
    tags,
    params,
    ok: { status: 200, schema: actionFeedbackAnswerSchema },
    errors: [ownerOnly, { status: 404, codes: ["not_found"] }, { status: 409, codes: ["not_sent", "too_late"] }],
  }),
};
