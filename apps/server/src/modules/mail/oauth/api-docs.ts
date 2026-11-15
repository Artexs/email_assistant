import {
  mailOAuthOptionsSchema,
  mailOAuthProviderParamsSchema,
  mailOAuthStartBodySchema,
  mailOAuthStartResultSchema,
} from "@ea/core";

import { apiDoc } from "../../../platform/openapi";

// The OpenAPI description of the mailbox OAuth routes (ADR 0023). The schemas are the ones the route and the web parse with.
const tags = ["mail"];

export const mailOAuthDocs = {
  getMailOAuthOptions: apiDoc({
    operationId: "getMailOAuthOptions",
    summary: "The providers a mailbox can connect or reconnect with (any member).",
    tags,
    ok: { status: 200, schema: mailOAuthOptionsSchema },
  }),
  postMailOAuthStart: apiDoc({
    operationId: "postMailOAuthStart",
    summary:
      "Start a provider sign-in for a new mailbox, or for a Reconnect when the body names the mailbox (owner only).",
    tags,
    params: mailOAuthProviderParamsSchema,
    body: mailOAuthStartBodySchema,
    ok: { status: 200, schema: mailOAuthStartResultSchema },
    errors: [
      { status: 403, codes: ["owner_only", "feature_off"] },
      { status: 404, codes: ["not_found"] },
      { status: 409, codes: ["not_configured"] },
    ],
  }),
};
