import type { SmtpSecurity } from "@ea/core";

import type { TokenResource } from "../port";

// The mailbox OAuth providers (F117 D6): URLs, scopes and hosts are constants. No env key holds a URL; a test builds its own
// registry (see `specs` of apps/server/test/fake-mail-oauth.ts). The values are from the plan (D6); spike rows M2 and G1 may change them.

export type MailOAuthProvider = "microsoft" | "google";

export interface MailOAuthProviderSpec {
  authorizeUrl: string;
  tokenUrl: string;
  revokeUrl: string | null;
  /** Asked at the authorize step. */
  authorizeScopes: string[];
  /** The scopes of one access token. Microsoft gives one resource per token; Google has no Graph (null). */
  resourceScopes: Record<TokenResource, string[] | null>;
  authorizeParams: Record<string, string>;
  imap: { host: string; port: number };
  smtp: { host: string; port: number; security: SmtpSecurity };
  sendVia: "smtp" | "graph";
  graphBaseUrl: string | null;
  /** The `iss` of the ID token. */
  issuerOk(iss: string): boolean;
}

export const mailOAuthProviders: Readonly<Record<MailOAuthProvider, MailOAuthProviderSpec>> = {
  microsoft: {
    authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    revokeUrl: null,
    authorizeScopes: [
      "openid",
      "email",
      "profile",
      "offline_access",
      "https://outlook.office.com/IMAP.AccessAsUser.All",
      "https://graph.microsoft.com/Mail.Send",
    ],
    resourceScopes: {
      mail: ["https://outlook.office.com/IMAP.AccessAsUser.All", "offline_access"],
      graph: ["https://graph.microsoft.com/Mail.Send", "offline_access"],
    },
    authorizeParams: { prompt: "select_account" },
    imap: { host: "outlook.office365.com", port: 993 },
    // Stored, not used: every Microsoft mailbox sends through Graph (D5).
    smtp: { host: "smtp.office365.com", port: 587, security: "starttls" },
    sendVia: "graph",
    graphBaseUrl: "https://graph.microsoft.com",
    issuerOk: (iss) =>
      /^https:\/\/login\.microsoftonline\.com\/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\/v2\.0$/i.test(iss),
  },
  google: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    revokeUrl: "https://oauth2.googleapis.com/revoke",
    authorizeScopes: ["openid", "email", "https://mail.google.com/"],
    resourceScopes: { mail: ["openid", "email", "https://mail.google.com/"], graph: null },
    authorizeParams: { access_type: "offline", prompt: "consent" },
    imap: { host: "imap.gmail.com", port: 993 },
    smtp: { host: "smtp.gmail.com", port: 465, security: "tls" },
    sendVia: "smtp",
    graphBaseUrl: null,
    issuerOk: (iss) => iss === "https://accounts.google.com" || iss === "accounts.google.com",
  },
};

// Scope names that name no resource. A provider may answer them under another name (Google: `email` as
// `https://www.googleapis.com/auth/userinfo.email`) or leave them out (Microsoft: `offline_access`), so a grant check never needs them.
const IDENTITY_SCOPES: ReadonlySet<string> = new Set(["openid", "email", "profile", "offline_access"]);

/** The scopes of the resource that a grant must hold: its resource scopes without the identity names (F117 plan review N1). Empty for a resource the provider lacks. */
export function requiredResourceScopes(spec: MailOAuthProviderSpec, resource: TokenResource): string[] {
  return (spec.resourceScopes[resource] ?? []).filter((scope) => !IDENTITY_SCOPES.has(scope.toLowerCase()));
}

/** The required resource scopes that `granted` lacks. Case-insensitive; an extra or an identity scope in `granted` never counts. */
export function missingResourceScopes(
  spec: MailOAuthProviderSpec,
  resource: TokenResource,
  granted: readonly string[]
): string[] {
  const have = new Set(granted.map((scope) => scope.toLowerCase()));
  return requiredResourceScopes(spec, resource).filter((scope) => !have.has(scope.toLowerCase()));
}
