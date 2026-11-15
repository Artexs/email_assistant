import { delegateAddBodySchema, delegateListSchema, delegatePatchBodySchema, delegateSchema, z } from "@ea/core";

import { apiDoc } from "../../platform/openapi";

// The OpenAPI description of the delegate routes (ADR 0023, F102 ticket). Any member reads; only the owner writes. Every route
// answers 404 `not_found` while the flag `delegation_pages` is off.
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
