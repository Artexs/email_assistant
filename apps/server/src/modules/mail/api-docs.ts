import {
  connectMailboxBodySchema,
  connectResultSchema,
  mailboxListSchema,
  mailboxPasswordBodySchema,
  mailboxViewSchema,
  removeMailboxBodySchema,
  z,
} from "@ea/core";

import { apiDoc } from "../../platform/openapi";

// The OpenAPI description of the mail routes (ADR 0023). The schemas are the ones the route and the web parse with.
const tags = ["mail"];
const params = z.object({ id: z.uuid() });
const notFound = { status: 404, codes: ["not_found"] } as const;
const ownerOnly = { status: 403, codes: ["owner_only"] } as const;
// What `mailErrorBody` maps for a connect or a password check.
const mailErrors = [
  { status: 400, codes: ["host_not_allowed"] },
  { status: 409, codes: ["mailbox_exists", "mailbox_limit"] },
  { status: 422, codes: ["mail_login_failed"] },
  { status: 502, codes: ["mail_unreachable"] },
] as const;

export const mailDocs = {
  getMailboxes: apiDoc({
    operationId: "getMailboxes",
    summary: "The mailboxes of the organization.",
    tags,
    ok: { status: 200, schema: mailboxListSchema },
  }),
  postMailbox: apiDoc({
    operationId: "postMailbox",
    summary: "Connect a mailbox: the server checks the login first (owner only).",
    tags,
    body: connectMailboxBodySchema,
    ok: { status: 201, schema: connectResultSchema },
    errors: [ownerOnly, notFound, ...mailErrors],
  }),
  postMailboxPassword: apiDoc({
    operationId: "postMailboxPassword",
    summary: "Replace the password of a mailbox: the server checks the login first (owner only).",
    tags,
    params,
    body: mailboxPasswordBodySchema,
    ok: { status: 200, schema: mailboxViewSchema },
    errors: [ownerOnly, notFound, ...mailErrors, { status: 409, codes: ["oauth_mailbox"] }],
  }),
  postMailboxPause: apiDoc({
    operationId: "postMailboxPause",
    summary: "Pause a mailbox (owner only).",
    tags,
    params,
    ok: { status: 200, schema: mailboxViewSchema },
    errors: [ownerOnly, notFound, { status: 409, codes: ["wrong_status"] }],
  }),
  postMailboxResume: apiDoc({
    operationId: "postMailboxResume",
    summary: "Resume a paused mailbox (owner only).",
    tags,
    params,
    ok: { status: 200, schema: mailboxViewSchema },
    errors: [ownerOnly, notFound, { status: 409, codes: ["wrong_status"] }],
  }),
  deleteMailbox: apiDoc({
    operationId: "deleteMailbox",
    summary: "Remove a mailbox and its data; the body repeats the address (owner only).",
    tags,
    params,
    body: removeMailboxBodySchema,
    ok: { status: 204 },
    errors: [ownerOnly, notFound, { status: 400, codes: ["confirm_mismatch"] }],
  }),
};
