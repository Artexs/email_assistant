import { suggestionActionBodySchema, suggestionListSchema, suggestionResultSchema, z } from "@ea/core";

import { apiDoc } from "../../platform/openapi";

// The OpenAPI description of the suggestion routes (ADR 0023). The schemas are the ones the route and the web parse with.
// Flag `sender_suggestions` (with `sender_context`): with either off every route answers 404 `not_found` for every role.
const tags = ["suggestions"];
const notFound = { status: 404, codes: ["not_found"] } as const;
const ownerOnly = { status: 403, codes: ["owner_only"] } as const;

export const suggestionDocs = {
  getSuggestions: apiDoc({
    operationId: "getSuggestions",
    summary:
      "The open rule suggestions of one mailbox, newest first, for every member: kind, scope, the address or `@domain`, the reason as counts, and the date. A mailbox that is not active has none. A mailbox of another organization looks like an unknown one: 404.",
    tags,
    params: z.object({ mailboxId: z.uuid() }),
    ok: { status: 200, schema: suggestionListSchema },
    errors: [notFound],
  }),
  postSuggestionAccept: apiDoc({
    operationId: "postSuggestionAccept",
    summary:
      "Accept one suggestion (owner only): the server adds the sender rule through the same validated writer as the Rules page and ends the suggestion. A second accept answers 409 `already` and adds no rule; a full rule list answers 409 `rule_limit` and the suggestion stays open.",
    tags,
    params: z.object({ id: z.uuid() }),
    body: suggestionActionBodySchema,
    ok: { status: 200, schema: suggestionResultSchema },
    errors: [ownerOnly, notFound, { status: 409, codes: ["already", "rule_limit"] }],
  }),
  postSuggestionDismiss: apiDoc({
    operationId: "postSuggestionDismiss",
    summary:
      "Dismiss one suggestion (owner only): the sender and kind stay hidden for 90 days. A second dismiss answers 409 `already`.",
    tags,
    params: z.object({ id: z.uuid() }),
    body: suggestionActionBodySchema,
    ok: { status: 200, schema: suggestionResultSchema },
    errors: [ownerOnly, notFound, { status: 409, codes: ["already"] }],
  }),
};
