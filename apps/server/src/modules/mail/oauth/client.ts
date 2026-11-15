import { HardError, SoftError } from "../../../platform/errors";
import { createLog } from "../../../platform/log";
import type { AuthErrorReason, TokenResource } from "../port";

import type { MailOAuthProvider, MailOAuthProviderSpec } from "./providers";

// The token client of mailbox OAuth (F117 stage 06, D17, D18): authorize URL, code redeem, refresh, revoke.
// D18: no token, code, verifier, client secret, ID token or provider `error_description` reaches an error, a log line or a return value
// that is not a token answer. An error has a fixed message and no `cause`. It keeps three safe facts: the reason, the provider's
// error code (only when it looks like a code) and the AADSTS number.

const log = createLog("mail");

export const OAUTH_TIMEOUT_MS = 10_000;

export interface TokenAnswer {
  accessToken: string;
  expiresInSec: number;
  /** null when the provider kept the old refresh token (Google). */
  refreshToken: string | null;
  /** As the provider names them: a check compares resource scopes only (`missingResourceScopes`). */
  scopes: string[];
  idToken: string | null;
}

/** The provider refused the grant: the user has to sign in again or an administrator has to act. Not retried. */
export class OAuthGrantError extends HardError {
  readonly reason: AuthErrorReason;
  /** The `error` code of the answer when it looks like one (`invalid_grant`), else `unknown`. */
  readonly providerCode: string;
  readonly aadsts: number | null;

  constructor(reason: AuthErrorReason, providerCode: string, aadsts: number | null) {
    super(`oauth grant refused: ${reason}`);
    this.name = "OAuthGrantError";
    this.reason = reason;
    this.providerCode = providerCode;
    this.aadsts = aadsts;
  }
}

/** A fault of the operator or the network. The mailbox status stays as it is (D16). */
export class OAuthSoftError extends SoftError {
  readonly kind: "client_invalid" | "server" | "timeout";

  constructor(kind: OAuthSoftError["kind"]) {
    super(`oauth token endpoint: ${kind}`);
    this.name = "OAuthSoftError";
    this.kind = kind;
  }
}

/** What stages 08 and 10 call. One per configured provider (`MailOAuthClients`). */
export interface MailOAuthClient {
  authorizeUrl(input: { state: string; codeChallenge: string; loginHint?: string }): string;
  /** Asks for the `mail` resource (Microsoft gives one resource per token). */
  redeemCode(code: string, verifier: string): Promise<TokenAnswer>;
  refresh(refreshToken: string, resource: TokenResource): Promise<TokenAnswer>;
  /** A provider without a revoke URL resolves and makes no call. An already revoked token resolves too. */
  revoke(refreshToken: string): Promise<void>;
}

/** A provider is missing while its keys are not set (`mailOAuthConfigured`). */
export type MailOAuthClients = Partial<Record<MailOAuthProvider, MailOAuthClient>>;

export interface MailOAuthClientApp {
  clientId: string;
  /** Secret: never print or log it. */
  clientSecret: string;
  redirectUri: string;
}

export interface MailOAuthClientOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

// Microsoft error codes (AADSTS) by reason. The nine numbers of the three reason sets below were checked on 2026-11-15 by the
// Opus review of stage 06 against the Microsoft Entra authentication and authorization error-code reference: 70008 and 700082
// (refresh token expired from inactivity), 700084 (SPA refresh token expired), 70043 (sign-in frequency), 50173 (grant revoked,
// for example after a password change), 65001 (the user or an administrator has not consented), 65004 (the user declined consent),
// 90094 and 90095 (admin consent required). 65001 has one reason only (review N4): `admin_consent_required`, also for a refresh.
// It does not always mean an administrator: a personal account, or a user who withdrew consent, gives it too. The texts of
// stages 11 and 18 must not say only "administrator". 50000 and 90033 are from the plan review (N3); the reference page was not
// read for them: they name a fault of the Microsoft service (TokenIssuanceError, MSODS unavailable).
const EXPIRED_AADSTS: ReadonlySet<number> = new Set([70008, 700082, 700084, 70043]);
const REVOKED_AADSTS: ReadonlySet<number> = new Set([50173, 65004]);
// A fault of the Microsoft service, not of the grant: the mailbox must stay connected (review N3).
const SERVICE_FAULT_AADSTS: ReadonlySet<number> = new Set([50000, 90033]);
const CONSENT_AADSTS: ReadonlySet<number> = new Set([65001, 90094, 90095]);
const CLIENT_INVALID_CODES: ReadonlySet<string> = new Set([
  "invalid_client",
  "unauthorized_client",
  "invalid_request",
  "invalid_scope",
  "unsupported_grant_type",
]);
const SERVER_CODES: ReadonlySet<string> = new Set(["temporarily_unavailable", "server_error"]);

const CODE_SHAPE = /^[a-z][a-z_]{0,47}$/;

export function aadstsOf(description: unknown, codes: unknown): number | null {
  const found = typeof description === "string" ? /AADSTS(\d{1,9})/.exec(description) : null;
  if (found?.[1] !== undefined) return Number(found[1]);
  const first = Array.isArray(codes) ? codes[0] : undefined;
  return typeof first === "number" && Number.isInteger(first) && first > 0 ? first : null;
}

/** The error map (D17). Pure: it reads the status, the `error` code and the AADSTS number, never the description. */
export function classifyTokenError(
  status: number,
  providerCode: string,
  aadsts: number | null
): { grant: AuthErrorReason } | { soft: OAuthSoftError["kind"] } {
  if (status >= 500 || status === 429) return { soft: "server" };
  if (aadsts !== null && CONSENT_AADSTS.has(aadsts)) return { grant: "admin_consent_required" };
  if (providerCode === "consent_required") return { grant: "admin_consent_required" };
  if (CLIENT_INVALID_CODES.has(providerCode)) return { soft: "client_invalid" };
  if (SERVER_CODES.has(providerCode)) return { soft: "server" };
  // Before the invalid_grant fallback: Microsoft may send these numbers with `invalid_grant`.
  if (aadsts !== null && SERVICE_FAULT_AADSTS.has(aadsts)) return { soft: "server" };
  if (aadsts !== null && REVOKED_AADSTS.has(aadsts)) return { grant: "oauth_revoked" };
  if (aadsts !== null && EXPIRED_AADSTS.has(aadsts)) return { grant: "oauth_expired" };
  // Any other invalid_grant (Google gives no detail: Q10) and interaction_required: sign in again.
  if (providerCode === "invalid_grant" || providerCode === "interaction_required") return { grant: "oauth_expired" };
  return { soft: "server" };
}

/** The largest token answer the client reads (review N1). A real answer is a few KiB. */
export const OAUTH_MAX_BODY_BYTES = 64 * 1024;

/** The body as text, or null when it is over the cap (the stream is cancelled at once). */
async function readCapped(response: Response): Promise<string | null> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > OAUTH_MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** A token or revoke URL must be https, or http on a loopback host (the fake token server of the tests). The message holds no URL. */
function assertSecureEndpoint(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new HardError("oauth endpoint is not a URL");
  }
  if (parsed.protocol === "https:") return;
  if (parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname)) return;
  throw new HardError("oauth endpoint must be https");
}

interface Answer {
  status: number;
  body: Record<string, unknown>;
}

export function createMailOAuthClient(
  spec: MailOAuthProviderSpec,
  app: MailOAuthClientApp,
  opts: MailOAuthClientOptions = {}
): MailOAuthClient {
  for (const url of [spec.tokenUrl, spec.revokeUrl]) {
    if (url !== null) assertSecureEndpoint(url);
  }
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? OAUTH_TIMEOUT_MS;
  // Microsoft gives one resource per token and picks it by `scope`; the Google token endpoint takes no scope at a code redeem.
  const scopedByResource = spec.resourceScopes.graph !== null;

  async function post(url: string, form: URLSearchParams): Promise<Answer> {
    let status: number;
    let text: string | null;
    try {
      // `redirect: "error"`: a redirect would send the form again (client secret, refresh token) to another URL.
      const response = await fetchFn(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: form,
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
      status = response.status;
      text = await readCapped(response);
    } catch (error) {
      // The thrown value is dropped on purpose: it may name the URL or echo the request.
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      log.warn("oauth_token_failed", { kind: timedOut ? "timeout" : "server" });
      throw new OAuthSoftError(timedOut ? "timeout" : "server");
    }
    if (text === null) {
      log.warn("oauth_token_failed", { kind: "server", status });
      throw new OAuthSoftError("server");
    }
    let body: Record<string, unknown> = {};
    try {
      const parsed: unknown = text === "" ? {} : JSON.parse(text);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        body = parsed as Record<string, unknown>;
      }
    } catch {
      // A body that is not JSON (an HTML error page): the status decides.
    }
    return { status, body };
  }

  function fail(answer: Answer): never {
    const rawCode = answer.body.error;
    const providerCode = typeof rawCode === "string" && CODE_SHAPE.test(rawCode) ? rawCode : "unknown";
    const aadsts = aadstsOf(answer.body.error_description, answer.body.error_codes);
    const verdict = classifyTokenError(answer.status, providerCode, aadsts);
    if ("grant" in verdict) {
      log.warn("oauth_grant_refused", {
        reason: verdict.grant,
        status: answer.status,
        code: providerCode,
        error_code: aadsts,
      });
      throw new OAuthGrantError(verdict.grant, providerCode, aadsts);
    }
    log.warn("oauth_token_failed", {
      kind: verdict.soft,
      status: answer.status,
      code: providerCode,
      error_code: aadsts,
    });
    throw new OAuthSoftError(verdict.soft);
  }

  function parseAnswer(answer: Answer): TokenAnswer {
    if (answer.status < 200 || answer.status >= 300) fail(answer);
    const {
      access_token: accessToken,
      expires_in: expiresIn,
      refresh_token: refreshToken,
      scope,
      id_token: idToken,
    } = answer.body;
    const expiresInSec = Number(expiresIn);
    if (typeof accessToken !== "string" || accessToken === "" || !Number.isFinite(expiresInSec) || expiresInSec <= 0) {
      log.warn("oauth_token_failed", { kind: "server", status: answer.status });
      throw new OAuthSoftError("server");
    }
    return {
      accessToken,
      expiresInSec,
      refreshToken: typeof refreshToken === "string" && refreshToken !== "" ? refreshToken : null,
      scopes: typeof scope === "string" ? scope.split(/\s+/).filter((item) => item !== "") : [],
      idToken: typeof idToken === "string" && idToken !== "" ? idToken : null,
    };
  }

  function clientForm(grant: Record<string, string>): URLSearchParams {
    return new URLSearchParams({ ...grant, client_id: app.clientId, client_secret: app.clientSecret });
  }

  return {
    authorizeUrl({ state, codeChallenge, loginHint }) {
      const url = new URL(spec.authorizeUrl);
      const query = url.searchParams;
      query.set("response_type", "code");
      query.set("client_id", app.clientId);
      query.set("redirect_uri", app.redirectUri);
      query.set("scope", spec.authorizeScopes.join(" "));
      query.set("state", state);
      query.set("code_challenge", codeChallenge);
      query.set("code_challenge_method", "S256");
      for (const [key, value] of Object.entries(spec.authorizeParams)) query.set(key, value);
      if (loginHint !== undefined && loginHint !== "") query.set("login_hint", loginHint);
      return url.toString();
    },

    async redeemCode(code, verifier) {
      const grant: Record<string, string> = {
        grant_type: "authorization_code",
        code,
        redirect_uri: app.redirectUri,
        code_verifier: verifier,
      };
      if (scopedByResource) grant.scope = (spec.resourceScopes.mail ?? []).join(" ");
      return parseAnswer(await post(spec.tokenUrl, clientForm(grant)));
    },

    async refresh(refreshToken, resource) {
      const scopes = spec.resourceScopes[resource];
      if (scopes === null) throw new HardError(`provider has no ${resource} resource`);
      const grant: Record<string, string> = { grant_type: "refresh_token", refresh_token: refreshToken };
      if (scopedByResource) grant.scope = scopes.join(" ");
      return parseAnswer(await post(spec.tokenUrl, clientForm(grant)));
    },

    async revoke(refreshToken) {
      if (spec.revokeUrl === null) return;
      const answer = await post(spec.revokeUrl, new URLSearchParams({ token: refreshToken }));
      if (answer.status >= 200 && answer.status < 300) return;
      // A token that is already gone is revoked.
      if (answer.body.error === "invalid_token") return;
      log.warn("oauth_token_failed", {
        kind: answer.status >= 500 ? "server" : "client_invalid",
        status: answer.status,
      });
      throw new OAuthSoftError(answer.status >= 500 ? "server" : "client_invalid");
    },
  };
}
