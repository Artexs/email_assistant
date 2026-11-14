import { sso } from "@better-auth/sso";
import type { SSOUserResolution, SSOUserResolutionInput } from "@better-auth/sso";
import type { SsoRefusal } from "@ea/core";
import { type BetterAuthPlugin } from "better-auth";
import { APIError } from "better-auth/api";

// The sign-in with a company identity provider (F119). This file is the only one that imports `@better-auth/sso` (ESLint).
// Better Auth loads the plugin with a small surface: two paths, no provider endpoints, no sign-up.

export const SSO_SIGN_IN_PATH = "/sign-in/sso";
const SSO_CALLBACK_PREFIX = "/sso/callback/";

// An SSO session ends this long after the IdP sign-in (the session hook and the database trigger enforce it).
export const SSO_SESSION_SECONDS = 43_200;

// The only paths of the plugin that reach Better Auth: the sign-in start and the callback of one provider.
// `/sso/register`, `/sso/providers`, `/sso/get-provider`, `/sso/update-provider`, `/sso/delete-provider`,
// the domain proof paths, `/sso/callback` without a provider and the SAML paths stay closed.
export function isAllowedSsoPath(method: string, path: string): boolean {
  if (path === SSO_SIGN_IN_PATH) return method === "POST";
  if (method !== "GET" || !path.startsWith(SSO_CALLBACK_PREFIX)) return false;
  const providerId = path.slice(SSO_CALLBACK_PREFIX.length);
  return providerId.length > 0 && !providerId.includes("/");
}

// What the IdP says about the person. `null` = the IdP sent no such claim.
export interface SsoIdentity {
  providerId: string;
  issuer: string;
  subject: string;
  email: string;
  emailVerified: boolean | null;
  hostedDomain: string | null;
}

export type SsoResolution =
  | { kind: "link"; userId: string; orgId: string; firstLink: boolean }
  | { kind: "reject"; code: SsoRefusal; orgId: string | null };

export interface SsoDeps {
  // Absent = every identity is refused with `sso_off`. It runs inside the callback transaction.
  resolveMember?: (identity: SsoIdentity) => Promise<SsoResolution>;
}

// The body keys of `POST /sign-in/sso` that we accept. Every other key reaches the plugin, which then looks for
// models and options that we do not have (`organizationSlug` ends in a 500).
const SSO_BODY_KEYS: ReadonlySet<string> = new Set([
  "email",
  "providerId",
  "callbackURL",
  "errorCallbackURL",
  "requestSignUp",
]);

// Throws `400 BAD_BODY` for a body that is not a plain object with only the accepted keys.
export function rejectUnknownSsoBodyKeys(body: unknown): void {
  const keys = typeof body === "object" && body !== null && !Array.isArray(body) ? Object.keys(body) : [];
  if (keys.some((key) => !SSO_BODY_KEYS.has(key))) {
    throw APIError.from("BAD_REQUEST", { code: "BAD_BODY", message: "Unknown body key." });
  }
}

const IDP_TOKEN_NULLS = { idToken: null, accessToken: null, refreshToken: null } as const;
const IDP_TOKEN_KEYS = Object.keys(IDP_TOKEN_NULLS);

// No IdP token is stored: an `id_token` holds the e-mail of the IdP in clear. The result of a database hook is
// `{ data }`; `undefined` leaves the row as it is. A credential account keeps its own columns.
export function withoutIdpTokens(account: Record<string, unknown>): { data: Record<string, unknown> } | undefined {
  if (account.providerId === "credential") return undefined;
  if (!IDP_TOKEN_KEYS.some((key) => key in account)) return undefined;
  return { data: { ...account, ...IDP_TOKEN_NULLS } };
}

function identityOf(input: SSOUserResolutionInput & { protocol: "oidc" }): SsoIdentity {
  const claims = input.verifiedIdTokenClaims;
  return {
    providerId: input.providerId,
    issuer: input.accountKey.issuer,
    subject: input.accountKey.accountId,
    email: input.providerUser.email,
    emailVerified: typeof claims.email_verified === "boolean" ? claims.email_verified : null,
    hostedDomain: typeof claims.hd === "string" ? claims.hd : null,
  };
}

function resolver(deps: SsoDeps) {
  return async (input: SSOUserResolutionInput): Promise<SSOUserResolution> => {
    if (!deps.resolveMember) return { action: "reject", code: "sso_off" satisfies SsoRefusal };
    // Providers hold OIDC only (the `saml_config` column is always null), so SAML never gets here.
    if (input.protocol !== "oidc") return { action: "reject", code: "no_provider" satisfies SsoRefusal };
    const resolution = await deps.resolveMember(identityOf(input));
    if (resolution.kind === "reject") return { action: "reject", code: resolution.code };
    return { action: "link", userId: resolution.userId, profile: "preserve" };
  };
}

// Plugin order in `platform/auth.ts`: `twoFactorPlugin()`, `ssoPlugin(...)`, `signInAuditPlugin(report)` last.
export function ssoPlugin(deps: SsoDeps): BetterAuthPlugin {
  return sso({
    modelName: "sso_providers",
    fields: {
      issuer: "issuer",
      oidcConfig: "oidc_config",
      samlConfig: "saml_config",
      userId: "user_id",
      providerId: "provider_id",
      organizationId: "org_id",
      domain: "domain",
    },
    // `domainVerified` maps only through the schema option.
    schema: { ssoProvider: { fields: { domainVerified: "domain_verified" } } },
    // Only the operator CLI makes a provider: the registration endpoint refuses everybody.
    providersLimit: () => 0,
    domainVerification: { enabled: true },
    disableImplicitSignUp: true,
    resolveUser: resolver(deps),
  });
}
