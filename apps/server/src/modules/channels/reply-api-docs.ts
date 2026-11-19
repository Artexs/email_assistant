import {
  replyConflictSchema,
  replyOpenAnswerSchema,
  replyQueuedAnswerSchema,
  replyRecipientsAnswerSchema,
  replyRecipientsBodySchema,
  replyRedraftBodySchema,
  replyRequestBodySchema,
  replyRequestStatusSchema,
  replyRecipientsRefusals,
  z,
} from "@ea/core";

import { apiDoc } from "../../platform/openapi";

// The OpenAPI description of the reply routes of the panel (ADR 0023). Any member reads the status of a request; the three writes
// are owner only. Every route answers 404 `not_found` while the flag `approvals_page` or the flag `reply_drafts` is off (the same
// answer as for an unknown id or the id of another organization). No answer repeats the instruction of the user.
const tags = ["replies"];
const params = z.object({ id: z.uuid() });
const ownerOnly = { status: 403, codes: ["owner_only"] } as const;
const notFound = { status: 404, codes: ["not_found"] } as const;

export const replyApprovalDocs = {
  requestReply: apiDoc({
    operationId: "requestReply",
    summary:
      "Ask for a draft reply to one mail (owner only), with an optional line of instruction (1 to 300 characters after cleaning). 202 with the `requestId`: poll `GET /api/replies/requests/:id` every 2 seconds for at most one minute. 200 with the `sendId` when a draft of this mail is open or on its way out. 409 `blocked` names the `reason` (for example `suspicious`, `answered`, `own_mailbox`) and nothing is queued. A line that fails answers 400 `validation`.",
    tags,
    body: replyRequestBodySchema,
    ok: { status: 202, schema: replyQueuedAnswerSchema },
    alsoOk: { status: 200, schema: replyOpenAnswerSchema },
    errors: [ownerOnly, notFound, { status: 409, codes: ["blocked"], schema: replyConflictSchema }],
  }),
  redraftReply: apiDoc({
    operationId: "redraftReply",
    summary:
      "Ask for a new version of a waiting reply from one line of instruction (owner only; 1 to 300 characters after cleaning). 202 with the `requestId`. At most 5 redrafts for one mail: then 409 `redraft_limit`. 409 `changed` names the newest version (`currentId`); 409 `closed` names the `state` of a send that no longer waits; 409 `blocked` names the `reason`.",
    tags,
    params,
    body: replyRedraftBodySchema,
    ok: { status: 202, schema: replyQueuedAnswerSchema },
    errors: [
      ownerOnly,
      notFound,
      { status: 409, codes: ["blocked", "changed", "closed", "redraft_limit"], schema: replyConflictSchema },
    ],
  }),
  setReplyRecipients: apiDoc({
    operationId: "setReplyRecipients",
    summary:
      "Replace a waiting reply by a new version with other recipients and no model call (owner only). `all`: To is the sender, Cc is every other recipient of the mail without an own mailbox (also its `+tag` variants), at most 10; the Reply-To of the mail is never used. `reply_to`: To is the first Reply-To address of the mail that is not the sender. `from`: the sender only. The addresses come from the stored mail, never from the request. The new version needs a new approval: an old Send for the earlier version answers 409 `changed`.",
    tags,
    params,
    body: replyRecipientsBodySchema,
    ok: { status: 200, schema: replyRecipientsAnswerSchema },
    errors: [
      ownerOnly,
      notFound,
      { status: 400, codes: replyRecipientsRefusals },
      { status: 409, codes: ["changed", "closed", "drafts_off"], schema: replyConflictSchema },
    ],
  }),
  getReplyRequest: apiDoc({
    operationId: "getReplyRequest",
    summary:
      "The state of a request for a draft: `pending` or `drafting` (poll again), `done` (`sendId` is the new version), `superseded` (`sendId` is the draft of the thread that waits now), `no_draft`, `failed` or `cancelled` (`reasonCode` names the cause). Reads only the request row. A request of another organization or one that was not made by a tap or a redraft answers 404.",
    tags,
    params,
    ok: { status: 200, schema: replyRequestStatusSchema },
    errors: [notFound],
  }),
};
