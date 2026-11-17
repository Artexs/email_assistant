import {
  delegateMailAnswerSchema,
  delegateMailBodySchema,
  loopActionBodySchema,
  loopFollowUpAnswerSchema,
  loopLaterAnswerSchema,
  loopListQuerySchema,
  loopListSchema,
  loopOkAnswerSchema,
  z,
} from "@ea/core";

import { apiDoc } from "../../platform/openapi";

// The OpenAPI description of the loop routes (ADR 0023). Every `/loops` route answers 404 `not_found` while the flag `open_loops`
// is off, for every role and with a bad id; `POST /emails/:id/delegate` does the same with the flag `delegate_button`. A
// suspended organization gets 403 `org_suspended` on every write.
const tags = ["loops"];
const params = z.object({ id: z.uuid() });
const ownerOnly = { status: 403, codes: ["owner_only"] } as const;
const notFound = { status: 404, codes: ["not_found"] } as const;

const COMMON_CONFLICTS = ["not_allowed"] as const;

export const loopDocs = {
  listLoops: apiDoc({
    operationId: "listLoops",
    summary:
      "One page of the open loops of one kind (`kind` is required), oldest due first. `filter`: `open` (the default), `due` (open, due by the end of the local day of the organization) or `closed`. `before` is the `next` cursor of the last page. The texts are null after the retention cleared them.",
    tags,
    query: loopListQuerySchema,
    ok: { status: 200, schema: loopListSchema },
    errors: [notFound],
  }),
  followUpLoop: apiDoc({
    operationId: "followUpLoop",
    summary:
      "Plan a follow-up of a waiting or delegated loop now (owner only). The follow-up is a draft and a send that waits for a tap in `/approvals`; nothing goes out before the tap. In shadow mode the answer is `would_draft` and nothing is planned. `waiting`: a follow-up waits for a tap or is on its way out. `closed`: the loop is closed. `limit_reached`: two follow-ups are sent. `too_soon`: the last one is less than 3 working days old. `suspicious`: the thread has a suspicious reason. `drafts_off`: the mailbox is not in assist mode with drafts on. `not_allowed`: a promised loop has no follow-up.",
    tags,
    params,
    body: loopActionBodySchema,
    ok: { status: 200, schema: loopFollowUpAnswerSchema },
    errors: [
      ownerOnly,
      notFound,
      {
        status: 409,
        codes: ["waiting", "closed", "limit_reached", "too_soon", "suspicious", "drafts_off", ...COMMON_CONFLICTS],
      },
    ],
  }),
  laterLoop: apiDoc({
    operationId: "laterLoop",
    summary:
      "Move the due date of a waiting or delegated loop 3 working days on (any member). Three times at most: `limit_reached`. `closed`: the loop is closed. `not_allowed`: a promised loop has no Later.",
    tags,
    params,
    body: loopActionBodySchema,
    ok: { status: 200, schema: loopLaterAnswerSchema },
    errors: [notFound, { status: 409, codes: ["closed", "limit_reached", ...COMMON_CONFLICTS] }],
  }),
  doneLoop: apiDoc({
    operationId: "doneLoop",
    summary: "Close an open loop as done (any member). `already`: the loop is closed.",
    tags,
    params,
    body: loopActionBodySchema,
    ok: { status: 200, schema: loopOkAnswerSchema },
    errors: [notFound, { status: 409, codes: ["already", ...COMMON_CONFLICTS] }],
  }),
  dropLoop: apiDoc({
    operationId: "dropLoop",
    summary: "Close an open loop as dropped (owner only). `already`: the loop is closed.",
    tags,
    params,
    body: loopActionBodySchema,
    ok: { status: 200, schema: loopOkAnswerSchema },
    errors: [ownerOnly, notFound, { status: 409, codes: ["already", ...COMMON_CONFLICTS] }],
  }),
  reopenLoop: apiDoc({
    operationId: "reopenLoop",
    summary:
      "Open a closed loop again (owner only). `already`: the loop is open. `not_allowed`: the loop ended with Sent tracking off, its texts are cleared, or Sent tracking is off.",
    tags,
    params,
    body: loopActionBodySchema,
    ok: { status: 200, schema: loopOkAnswerSchema },
    errors: [ownerOnly, notFound, { status: 409, codes: ["already", ...COMMON_CONFLICTS] }],
  }),
  untrackLoop: apiDoc({
    operationId: "untrackLoop",
    summary:
      "Stop following a delegated loop (owner only). `already`: the loop is closed. `not_allowed`: the loop is not a delegated one.",
    tags,
    params,
    body: loopActionBodySchema,
    ok: { status: 200, schema: loopOkAnswerSchema },
    errors: [ownerOnly, notFound, { status: 409, codes: ["already", ...COMMON_CONFLICTS] }],
  }),
  delegateMail: apiDoc({
    operationId: "delegateMail",
    summary:
      "Hand a mail to a delegate (owner only): a draft to the delegate and a send that waits for a tap in `/approvals`. The flag `delegate_button` must be on, else 404. `exists`: the mail has an open delegation. `delegate_inactive`: the delegate is off. `drafts_off`: the mailbox is not in assist mode with drafts on. `not_delegable`: the mail is spam, suspicious, from an own mailbox or not triaged yet.",
    tags: ["emails"],
    params,
    body: delegateMailBodySchema,
    ok: { status: 200, schema: delegateMailAnswerSchema },
    errors: [
      ownerOnly,
      notFound,
      { status: 409, codes: ["exists", "delegate_inactive", "drafts_off", "not_delegable"] },
    ],
  }),
};
