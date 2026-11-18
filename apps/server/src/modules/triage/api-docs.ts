import {
  feedbackBodySchema,
  feedbackResultSchema,
  newsletterListSchema,
  undoBodySchema,
  undoResultSchema,
  z,
} from "@ea/core";

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

// F110 stage 23 (flag `bulk_unsubscribe`): with the flag off the route answers 404 `not_found` for every role. A mailbox of another
// organization looks like an unknown one: the same 404.
export const newsletterDocs = {
  getNewsletters: apiDoc({
    operationId: "getNewsletters",
    summary:
      "The newsletter senders of one mailbox from the last 30 days, for every member: address, display name (untrusted text), mail count, newest date, the unsubscribe method (`one_click`, `link`, `none`) and the state of an unsubscribe request. A spam or suspicious sender is left out. `linkUrl` (an `https` link) is for the owner only. The route never fetches a link.",
    tags: ["newsletters"],
    params: z.object({ mailboxId: z.uuid() }),
    ok: { status: 200, schema: newsletterListSchema },
    errors: [notFound],
  }),
};
