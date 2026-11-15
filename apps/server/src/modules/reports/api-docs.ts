import { activityPageSchema, activityQuerySchema, statsQuerySchema, statsResponseSchema } from "@ea/core";

import { apiDoc } from "../../platform/openapi";

// The OpenAPI description of the activity and stats routes (ADR 0023). The query schemas are the ones the handlers parse.
export const reportDocs = {
  getActivity: apiDoc({
    operationId: "getActivity",
    summary: "One page of the activity list, newest first; `before` is the cursor of the next page.",
    tags: ["activity"],
    query: activityQuerySchema,
    ok: { status: 200, schema: activityPageSchema },
  }),
  getStats: apiDoc({
    operationId: "getStats",
    summary: "The numbers of the last weeks (404 while the flag `stats_page` is off).",
    tags: ["stats"],
    query: statsQuerySchema,
    ok: { status: 200, schema: statsResponseSchema },
    errors: [{ status: 404, codes: ["not_found"] }],
  }),
};
