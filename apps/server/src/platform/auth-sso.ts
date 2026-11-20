import { isIP } from "node:net";

import { sso, discoverOIDCConfig, DiscoveryError } from "@better-auth/sso";
import type { HydratedOIDCConfig, SSOUserResolution, SSOUserResolutionInput } from "@better-auth/sso";
import { MINUTE_MS, type SsoIdentity, type SsoRefusal, type SsoResolution } from "@ea/core";
import { APIError, createAuthMiddleware } from "better-auth/api";

import type { AuthHookPart } from "./auth-hooks";
import { errorFields } from "./errors";
import { createLog } from "./log";
import { dnsLookupAll, isLocalAddress, type LookupAll } from "./net-address";

const log = createLog("auth_sso");

// The sign-in with a company identity provider. This file is the only one that imports `@better-auth/sso` (ESLint).
// Better Auth loads the plugin with a small surface: two paths, no provider endpoints, no sign-up.

export const SSO_SIGN_IN_PATH = "/sign-in/sso";
const SSO_CALLBACK_PATH = "/sso/callback";
const SSO_CALLBACK_PREFIX = `${SSO_CALLBACK_PATH}/`;

// The plugin also has the shared callback `/sso/callback` (no provider id, used with `redirectURI`). Our HTTP gate keeps it closed
// (`isAllowedSsoPath`), but every hook that must know "this is an SSO callback" matches both forms, so a gate change cannot leave
// a callback session unmarked. `path` is the route template, not the concrete path.
export function isSsoCallbackPath(path: string | undefined): boolean {
  return path === SSO_CALLBACK_PATH || path?.startsWith(SSO_CALLBACK_PREFIX) === true;
}

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

export type { SsoIdentity, SsoResolution };

export interface SsoSessionData {
  signInMethod: "sso";
  ssoStartedAt: Date;
  expiresAt: Date;
}

// The `sso_started_at` of a session row: a `Date` from the adapter, a string in a copied value. Anything else is no mark.
function startOf(value: unknown): Date | null {
  const at = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  return at !== null && !Number.isNaN(at.getTime()) ? at : null;
}

// What the session hook of `platform/auth.ts` adds to a new session row.
// `path` is the route template (`/sso/callback/:providerId`), so the match is by prefix, never by the concrete path.
// `current` is the session of the request, if the endpoint has one (TOTP turn-on, `/change-password`): a session made from an
// SSO session keeps its method and its start, because Better Auth copies the fields but sets the defaults after them.
// A sign-in path has no current session, so a password sign-in never inherits. `undefined` = a plain password session.
export function ssoSessionData(input: {
  path: string | undefined;
  current: object | null | undefined;
  now: Date;
}): SsoSessionData | undefined {
  if (isSsoCallbackPath(input.path)) {
    return {
      signInMethod: "sso",
      ssoStartedAt: input.now,
      expiresAt: new Date(input.now.getTime() + SSO_SESSION_SECONDS * 1000),
    };
  }
  const current: { signInMethod?: unknown; ssoStartedAt?: unknown } = input.current ?? {};
  if (current.signInMethod !== "sso") return undefined;
  // An SSO session without a start cannot exist (the pair CHECK); if it does, fail closed: no new session.
  const started = startOf(current.ssoStartedAt);
  if (started === null) throw new Error("sso_session_without_start");
  return {
    signInMethod: "sso",
    ssoStartedAt: started,
    expiresAt: new Date(started.getTime() + SSO_SESSION_SECONDS * 1000),
  };
}

// A row for the audit log (ADR 0026 point 8). `data` is flat: ids and codes only, never the IdP e-mail.
export interface SsoEvent {
  kind: "login" | "refused";
  orgId: string;
  // null = the person is unknown (a refusal).
  userId: string | null;
  data: Record<string, string | boolean>;
}

export interface SsoDeps {
  // Absent = every identity is refused with `sso_off`. It runs inside the callback transaction.
  resolveMember?: (identity: SsoIdentity) => Promise<SsoResolution>;
  // It never throws into Better Auth: a failure is logged as `sso_audit_failed`.
  onSsoEvent?: (event: SsoEvent) => Promise<void>;
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

async function reportSsoEvent(deps: SsoDeps, event: SsoEvent): Promise<void> {
  if (event.kind === "login") log.info("sso_sign_in", { org_id: event.orgId, user_id: event.userId });
  else log.warn("sso_refused", { org_id: event.orgId, code: String(event.data.code) });
  if (!deps.onSsoEvent) return;
  try {
    await deps.onSsoEvent(event);
  } catch (error) {
    log.error("sso_audit_failed", { kind: event.kind, ...errorFields(error) });
  }
}

// A resolution that no callback session followed (the plugin rolled back) is dropped after this time.
const PENDING_LOGIN_MAX_AGE_MS = MINUTE_MS;

function resolver(deps: SsoDeps, pending: Map<string, PendingLogin>) {
  return async (input: SSOUserResolutionInput): Promise<SSOUserResolution> => {
    if (!deps.resolveMember) return { action: "reject", code: "sso_off" satisfies SsoRefusal };
    // Providers hold OIDC only (the `saml_config` column is always null), so SAML never gets here.
    if (input.protocol !== "oidc") return { action: "reject", code: "no_provider" satisfies SsoRefusal };
    const resolution = await deps.resolveMember(identityOf(input));
    if (resolution.kind === "reject") {
      // Only a refusal of our own resolver that names an organization gets a row; each one needs a real IdP sign-in.
      if (resolution.orgId !== null) {
        await reportSsoEvent(deps, {
          kind: "refused",
          orgId: resolution.orgId,
          userId: null,
          data: { provider_id: input.providerId, code: resolution.code },
        });
      }
      return { action: "reject", code: resolution.code };
    }
    pending.set(resolution.userId, {
      orgId: resolution.orgId,
      providerId: input.providerId,
      firstLink: resolution.firstLink,
      at: Date.now(),
    });
    return { action: "link", userId: resolution.userId, profile: "preserve" };
  };
}

interface PendingLogin {
  orgId: string;
  providerId: string;
  firstLink: boolean;
  at: number;
}

// `sso.login` is written once per callback session, after the plugin transaction has committed (`spike.md`: a reject rolls the transaction back).
// The resolver notes the login in `pending`; the after-hook of the callback writes it.
function ssoAuditPlugin(deps: SsoDeps, pending: Map<string, PendingLogin>) {
  return {
    id: "ea-sso-audit",
    hooks: {
      after: [
        {
          // `ctx.path` is the route template `/sso/callback/:providerId` (`spike.md`, finding on `ctx.path`).
          matcher: (context: { path?: string }) => isSsoCallbackPath(context.path),
          handler: createAuthMiddleware(async (ctx) => {
            const userId = ctx.context.newSession?.user.id;
            if (userId === undefined) return;
            const login = pending.get(userId);
            pending.delete(userId);
            if (!login || Date.now() - login.at > PENDING_LOGIN_MAX_AGE_MS) return;
            await reportSsoEvent(deps, {
              kind: "login",
              orgId: login.orgId,
              userId,
              data: { provider_id: login.providerId, first_link: login.firstLink },
            });
          }),
        },
      ],
    },
  };
}

// Plugin order in `platform/auth.ts`: `twoFactorPlugin()`, `...ssoPlugins(...)`, `signInAuditPlugin(report)` last.
export function ssoPlugins(deps: SsoDeps) {
  const pending = new Map<string, PendingLogin>();
  return [ssoPlugin(deps, pending), ssoAuditPlugin(deps, pending)] as const;
}

function ssoPlugin(deps: SsoDeps, pending: Map<string, PendingLogin>) {
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
    resolveUser: resolver(deps, pending),
  });
}

// Discovery of a provider, for the operator CLI. The plugin trusts a discovery URL only inside Better Auth's
// `trustedOrigins`; that list stays the panel list. Discovery gets our own predicate instead, and a DNS check for the
// hosts it accepts by name (the plugin skips its own DNS check for a trusted URL).

const PRIVATE_SUFFIXES = [".local", ".internal", ".localhost"] as const;

// `https:` with a DNS name: no IP literal (`URL` also turns `127.1` and `2130706433` into dotted form), no `localhost`,
// no private suffix, no single label. One trailing dot is removed. An origin in `allowOrigins` passes as it is (tests).
export function isAllowedDiscoveryUrl(url: string, allowOrigins: readonly string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (allowOrigins.includes(parsed.origin)) return true;
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (host === "" || isIP(host.replace(/^\[/, "").replace(/\]$/, "")) !== 0) return false;
  if (!host.includes(".") || host === "localhost") return false;
  return !PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export type HostsCheck = "ok" | "discovery_private_host" | "discovery_dns_failed";

// One answer in a refused range refuses the host. A lookup error or an empty answer is `discovery_dns_failed`.
export async function checkPublicHosts(hosts: readonly string[], lookup: LookupAll): Promise<HostsCheck> {
  for (const host of hosts) {
    let answers: { address: string }[];
    try {
      answers = await lookup(host.replace(/\.$/, ""));
    } catch {
      return "discovery_dns_failed";
    }
    if (answers.length === 0) return "discovery_dns_failed";
    if (answers.some((answer) => isLocalAddress(answer.address))) return "discovery_private_host";
  }
  return "ok";
}

export type ProviderDiscovery = { kind: "ok"; discovered: HydratedOIDCConfig } | { kind: "failed"; code: string };

export interface DiscoveryOptions {
  allowOrigins: readonly string[];
  timeoutMs: number;
  lookup?: LookupAll;
}

// The names that need a DNS check: hosts outside `allowOrigins`, once each.
function hostsToResolve(urls: readonly (string | undefined)[], allowOrigins: readonly string[]): string[] {
  const hosts = new Set<string>();
  for (const url of urls) {
    if (url === undefined) continue;
    const parsed = new URL(url);
    if (!allowOrigins.includes(parsed.origin)) hosts.add(parsed.hostname);
  }
  return [...hosts];
}

// The result holds a code, never the plugin's message (it names URLs).
export async function discoverProviderConfig(issuer: string, options: DiscoveryOptions): Promise<ProviderDiscovery> {
  const lookup = options.lookup ?? dnsLookupAll;
  const isTrustedOrigin = (url: string): boolean => isAllowedDiscoveryUrl(url, options.allowOrigins);
  try {
    // A URL that the predicate refuses gets its code from the plugin (`discovery_untrusted_origin`), so no lookup runs for it.
    if (isAllowedDiscoveryUrl(issuer, options.allowOrigins)) {
      const issuerCheck = await checkPublicHosts(hostsToResolve([issuer], options.allowOrigins), lookup);
      if (issuerCheck !== "ok") return { kind: "failed", code: issuerCheck };
    }
    const discovered = await discoverOIDCConfig({ issuer, timeout: options.timeoutMs, isTrustedOrigin });
    const endpoints = [
      discovered.authorizationEndpoint,
      discovered.tokenEndpoint,
      discovered.jwksEndpoint,
      discovered.userInfoEndpoint,
    ];
    const endpointCheck = await checkPublicHosts(hostsToResolve(endpoints, options.allowOrigins), lookup);
    if (endpointCheck !== "ok") return { kind: "failed", code: endpointCheck };
    return { kind: "ok", discovered };
  } catch (error) {
    if (error instanceof DiscoveryError) return { kind: "failed", code: error.code };
    log.warn("sso_discovery_failed", errorFields(error));
    return { kind: "failed", code: "discovery_unexpected_error" };
  }
}

// The plugin JSON of a provider: the discovered endpoints plus the client. The plugin reads this string
// from `sso_providers.oidc_config`. Tenancy stores the string and never imports Better Auth.
export function buildOidcConfig(
  discovered: HydratedOIDCConfig,
  client: { clientId: string; clientSecret: string }
): string {
  return JSON.stringify({
    issuer: discovered.issuer,
    discoveryEndpoint: discovered.discoveryEndpoint,
    authorizationEndpoint: discovered.authorizationEndpoint,
    tokenEndpoint: discovered.tokenEndpoint,
    jwksEndpoint: discovered.jwksEndpoint,
    ...(discovered.userInfoEndpoint === undefined ? {} : { userInfoEndpoint: discovered.userInfoEndpoint }),
    tokenEndpointAuthentication: discovered.tokenEndpointAuthentication,
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    pkce: true,
    scopes: ["openid", "email", "profile"],
    allowIdpInitiated: false,
  });
}

// The check of the SSO sign-in body (`before`).
export function hooksOf(): AuthHookPart[] {
  return [
    {
      name: "sso-body",
      async before(ctx) {
        if (ctx.path === SSO_SIGN_IN_PATH) rejectUnknownSsoBodyKeys(ctx.body);
        return undefined;
      },
    },
  ];
}
