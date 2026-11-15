import { feedbackBodySchema, feedbackResultSchema, undoBodySchema, undoResultSchema } from "@ea/core";

import { apiDoc } from "../../platform/openapi";

// The OpenAPI description of the triage routes (ADR 0023). The schemas are the ones the route and the web parse with.
const tags = ["triage"];
const notFound = { status: 404, codes: ["not_found"] } as const;

export const triageDocs = {
  postFeedback: apiDoc({
    operationId: "postFeedback",
    summary: "Rate the category of one mail.",
    tags,
    body: feedbackBodySchema,
    ok: { status: 200, schema: feedbackResultSchema },
    errors: [notFound],
  }),
  postActionsUndo: apiDoc({
    operationId: "postActionsUndo",
    summary: "Undo the actions on one mail.",
    tags,
    body: undoBodySchema,
    ok: { status: 200, schema: undoResultSchema },
    errors: [notFound],
  }),
};
