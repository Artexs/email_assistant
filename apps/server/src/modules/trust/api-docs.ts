import { trustHistoryCheckAnswerSchema, trustRecommendedAnswerSchema, trustViewSchema, z } from "@ea/core";

import { apiDoc } from "../../platform/openapi";

// The OpenAPI description of the trust routes (ADR 0028, flag `trust_ladder`). While the flag is off every route answers 404
// `not_found`, for every role. A mailbox of another organization looks like an unknown one: 404 `not_found`.
const tags = ["trust"];
const params = z.object({ mailboxId: z.uuid() });
const ownerOnly = { status: 403, codes: ["owner_only"] } as const;
const notFound = { status: 404, codes: ["not_found"] } as const;

export const trustDocs = {
  getTrust: apiDoc({
    operationId: "getTrust",
    summary:
      "The trust view of one mailbox, for every member: per category the global evidence, the history result, the trip, the real labels and the verdict (`eligible`, `recommended`, `blocks`); the newest history check; up to 3 examples per moving category (sender name and subject, null after retention). `auto` is `auto` as triage reads it now: a category that is on under another model setup shows off.",
    tags,
    params,
    ok: { status: 200, schema: trustViewSchema },
    errors: [notFound],
  }),
  postTrustRecommended: apiDoc({
    operationId: "postTrustRecommended",
    summary:
      "Turn on every recommended moving category of a mailbox in one step (owner only). A `shadow` mailbox goes to `assist` with the default switches. The grant is `recommended`. `nothing_recommended`: no moving category is recommended and off; nothing changes, the mode stays.",
    tags,
    params,
    ok: { status: 200, schema: trustRecommendedAnswerSchema },
    errors: [ownerOnly, notFound, { status: 409, codes: ["nothing_recommended"] }],
  }),
  postTrustHistoryCheck: apiDoc({
    operationId: "postTrustHistoryCheck",
    summary:
      "Queue a history check of the mailbox, reason `web` (owner only). The answer is the queued check. `check_running`: a check of this mailbox is open already.",
    tags,
    params,
    ok: { status: 202, schema: trustHistoryCheckAnswerSchema },
    errors: [ownerOnly, notFound, { status: 409, codes: ["check_running"] }],
  }),
};
