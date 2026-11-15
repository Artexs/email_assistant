import {
  delegateAddBodySchema,
  delegateListSchema,
  delegatePatchBodySchema,
  delegateSchema,
  delegationActionBodySchema,
  delegationCancelAnswerSchema,
  delegationDoneAnswerSchema,
  delegationListQuerySchema,
  delegationListSchema,
  z,
} from "@ea/core";

import { apiDoc } from "../../platform/openapi";

// The OpenAPI description of the delegate and delegation routes (ADR 0023, F102 ticket). Any member reads; the delegate writes and
// the cancel are owner only; any member marks a delegation done. Every route answers 404 `not_found` while the flag
// `delegation_pages` is off.
const tags = ["delegates"];
const params = z.object({ id: z.uuid() });
const ownerOnly = { status: 403, codes: ["owner_only"] } as const;
const notFound = { status: 404, codes: ["not_found"] } as const;

export const delegateDocs = {
  listDelegates: apiDoc({
    operationId: "listDelegates",
    summary: "The delegates of the organization, active ones first, then by name, at most 200.",
    tags,
    ok: { status: 200, schema: delegateListSchema },
    errors: [notFound],
  }),
  addDelegate: apiDoc({
    operationId: "addDelegate",
    summary:
      "Add a delegate (owner only). The address is trimmed and lower case. `mailbox_address`: it is a mailbox of the organization.",
    tags,
    body: delegateAddBodySchema,
    ok: { status: 201, schema: delegateSchema },
    errors: [ownerOnly, notFound, { status: 400, codes: ["mailbox_address"] }, { status: 409, codes: ["exists"] }],
  }),
  updateDelegate: apiDoc({
    operationId: "updateDelegate",
    summary:
      "Change the name, the tags or the active state of a delegate (owner only; at least one field). The address never changes.",
    tags,
    params,
    body: delegatePatchBodySchema,
    ok: { status: 200, schema: delegateSchema },
    errors: [ownerOnly, notFound],
  }),
};

const delegationTags = ["delegations"];

export const delegationDocs = {
  listDelegations: apiDoc({
    operationId: "listDelegations",
    summary:
      "One page of the delegations of the organization, newest first. `filter`: `open` (drafted, sent; the default), `overdue`, `answered` or `closed` (done, cancelled). `before` is the `next` cursor of the last page.",
    tags: delegationTags,
    query: delegationListQuerySchema,
    ok: { status: 200, schema: delegationListSchema },
    errors: [notFound],
  }),
  markDelegationDone: apiDoc({
    operationId: "markDelegationDone",
    summary:
      "Mark an answered or overdue delegation done (any member). `already`: it is done. `not_closable`: it is in another state.",
    tags: delegationTags,
    params,
    body: delegationActionBodySchema,
    ok: { status: 200, schema: delegationDoneAnswerSchema },
    errors: [notFound, { status: 409, codes: ["already", "not_closable"] }],
  }),
  cancelDelegation: apiDoc({
    operationId: "cancelDelegation",
    summary:
      "Cancel an open delegation (owner only). A drafted one rejects its waiting send; a sent or overdue one expires its waiting reminders. `sending`: its send is on its way out. `not_open`: it is answered, done or cancelled.",
    tags: delegationTags,
    params,
    body: delegationActionBodySchema,
    ok: { status: 200, schema: delegationCancelAnswerSchema },
    errors: [ownerOnly, notFound, { status: 409, codes: ["not_open", "sending"] }],
  }),
};
