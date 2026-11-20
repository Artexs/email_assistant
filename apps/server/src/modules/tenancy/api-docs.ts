import {
  digestTimesBodySchema,
  digestTimesSchema,
  localeBodySchema,
  meSchema,
  organizationPatchSchema,
  organizationSettingsSchema,
  organizationViewSchema,
  securityLogSchema,
  sessionsSchema,
  termsAcceptBodySchema,
  twoFactorStatusSchema,
} from "@ea/core";

import { apiDoc } from "../../platform/openapi";

// The OpenAPI description of the tenancy routes (ADR 0023). Each body and answer schema is the one that the route
// parses with and that the web parses with: never a second copy.
const tags = ["tenancy"];
const notFound = { status: 404, codes: ["not_found"] } as const;
const ownerOnly = { status: 403, codes: ["owner_only"] } as const;

export const tenancyDocs = {
  getTwoFactor: apiDoc({
    operationId: "getTwoFactor",
    summary: "The own TOTP state: on or off, the backup codes left and who requires it.",
    tags,
    ok: { status: 200, schema: twoFactorStatusSchema },
  }),
  getMe: apiDoc({
    operationId: "getMe",
    summary: "The signed-in user, the organization, the role, the scopes and the features that are on.",
    tags,
    ok: { status: 200, schema: meSchema },
    errors: [notFound],
  }),
  getOrganization: apiDoc({
    operationId: "getOrganization",
    summary: "The organization settings and the list of time zones.",
    tags,
    ok: { status: 200, schema: organizationSettingsSchema },
    errors: [notFound],
  }),
  getSecurityLog: apiDoc({
    operationId: "getSecurityLog",
    summary: "The security log of the organization (owner only, behind a flag).",
    tags,
    ok: { status: 200, schema: securityLogSchema },
    errors: [ownerOnly, notFound],
  }),
  patchOrganization: apiDoc({
    operationId: "patchOrganization",
    summary: "Change the time zone of the organization (owner only).",
    tags,
    body: organizationPatchSchema,
    ok: { status: 200, schema: organizationViewSchema },
    errors: [ownerOnly, notFound],
  }),
  patchDigestTimes: apiDoc({
    operationId: "patchDigestTimes",
    summary: "Set the own digest times.",
    tags,
    body: digestTimesBodySchema,
    ok: { status: 200, schema: digestTimesSchema },
    errors: [notFound],
  }),
  patchLocale: apiDoc({
    operationId: "patchLocale",
    summary: "Set the own language of the panel, Telegram and the account e-mails.",
    tags,
    body: localeBodySchema,
    ok: { status: 204 },
    errors: [notFound],
  }),
  postTerms: apiDoc({
    operationId: "postTerms",
    summary: "Accept the current terms. An old version answers 409 so the dialog reloads.",
    tags,
    body: termsAcceptBodySchema,
    ok: { status: 204 },
    errors: [{ status: 409, codes: ["terms_outdated"] }],
  }),
  getSessions: apiDoc({
    operationId: "getSessions",
    summary: "The own live sessions, newest first.",
    tags,
    ok: { status: 200, schema: sessionsSchema },
  }),
  postKeepMode: apiDoc({
    operationId: "postKeepMode",
    summary: "Keep shadow mode at the end of onboarding (owner only). A repeat call changes nothing.",
    tags,
    ok: { status: 204 },
    errors: [ownerOnly],
  }),
};
