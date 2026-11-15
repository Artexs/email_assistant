import { orgDeleteRequestSchema, orgDeleteResponseSchema } from "@ea/core";

import { apiDoc } from "../../platform/openapi";

// The OpenAPI description of the privacy routes (ADR 0023). The schemas are the ones the route and the web parse with.
export const privacyDocs = {
  deleteOrganization: apiDoc({
    operationId: "deleteOrganization",
    summary: "Delete the organization and all its data (owner only, behind a flag). Needs the password and the name.",
    tags: ["privacy"],
    body: orgDeleteRequestSchema,
    ok: { status: 200, schema: orgDeleteResponseSchema },
    errors: [
      { status: 400, codes: ["wrong_name", "wrong_password"] },
      { status: 403, codes: ["owner_only"] },
      { status: 404, codes: ["not_found"] },
      { status: 429, codes: ["locked"] },
      { status: 503, codes: ["internal"] },
    ],
  }),
};
