import {
  feedbackBodySchema,
  feedbackResultSchema,
  newsletterListSchema,
  reviewLabelBodySchema,
  reviewLabelResultSchema,
  reviewSampleQuerySchema,
  reviewSampleSchema,
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

// F110 stage 15 (flag `panel_review`): with the flag off both routes answer 404 `not_found` for every role. A mailbox or a mail of
// another organization looks like an unknown one: the same 404.
export const reviewDocs = {
  getReviewSample: apiDoc({
    operationId: "getReviewSample",
    summary:
      "A random sample of up to 10 unlabelled decisions of one mailbox, for every member (the sample rules of the Telegram /review page: real mail of 30 days, no feedback row, no test mail). Each item holds the category, the confidence, the stored AI summary, the sender's display name, the subject and the date. A new request gives a new sample. `delegation` says whether the organization has an active delegate.",
    tags: ["review"],
    query: reviewSampleQuerySchema,
    ok: { status: 200, schema: reviewSampleSchema },
    errors: [notFound],
  }),
  postReviewLabel: apiDoc({
    operationId: "postReviewLabel",
    summary:
      "Label one decision with the source `review`, for every member: `verdict: right` agrees with the category, `category` names the true one (`delegation` only when the organization has an active delegate). The same answer twice gives `saved: false`. The label unlocks nothing: it feeds the tripwire and the real-label block only. `needs_category`: `right` on a mail the assistant could not place.",
    tags: ["review"],
    body: reviewLabelBodySchema,
    ok: { status: 200, schema: reviewLabelResultSchema },
    errors: [notFound, { status: 409, codes: ["needs_category", "no_delegates"] }],
  }),
};
