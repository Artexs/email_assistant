import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// OAuth pieces of the spike: PKCE, the authorize URL, the one-shot callback server, the token endpoint calls.
// Tokens live in memory only. Nothing here prints or returns a token to a place that writes evidence.

export type Provider = "microsoft" | "microsoft-personal" | "google";

export const REDIRECT_PORT = 8765;
export const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;

export const MS_BASE_SCOPES = ["offline_access", "openid", "email", "profile"];
export const MS_IMAP_SCOPE = "https://outlook.office.com/IMAP.AccessAsUser.All";
export const MS_GRAPH_SCOPE = "https://graph.microsoft.com/Mail.Send";
export const GOOGLE_SCOPES = ["openid", "email", "https://mail.google.com/"];

export interface Endpoints {
  authorizeUrl: string;
  tokenUrl: string;
  /** Microsoft business only. */
  adminConsentUrl?: string;
  /** Google only. */
  revokeUrl?: string;
  /** Microsoft only. `<base>/me/sendMail`. */
  graphBase?: string;
  imap: { host: string; port: number; secure: boolean };
  smtp: { host: string; port: number; secure: boolean };
}

const microsoft = (authority: string): Endpoints => ({
  authorizeUrl: `https://login.microsoftonline.com/${authority}/oauth2/v2.0/authorize`,
  tokenUrl: `https://login.microsoftonline.com/${authority}/oauth2/v2.0/token`,
  adminConsentUrl: `https://login.microsoftonline.com/${authority}/v2.0/adminconsent`,
  graphBase: "https://graph.microsoft.com/v1.0",
  imap: { host: "outlook.office365.com", port: 993, secure: true },
  smtp: { host: "smtp.office365.com", port: 587, secure: false },
});

export const ENDPOINTS: Record<Provider, Endpoints> = {
  microsoft: microsoft("organizations"),
  "microsoft-personal": microsoft("common"),
  google: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    revokeUrl: "https://oauth2.googleapis.com/revoke",
    imap: { host: "imap.gmail.com", port: 993, secure: true },
    smtp: { host: "smtp.gmail.com", port: 465, secure: true },
  },
};

const base64url = (bytes: Buffer): string => bytes.toString("base64url");

export function randomToken(byteLength = 32): string {
  return base64url(randomBytes(byteLength));
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomToken(48);
  return { verifier, challenge: base64url(createHash("sha256").update(verifier).digest()) };
}

export function authorizeUrl(
  provider: Provider,
  endpoints: Endpoints,
  params: { clientId: string; state: string; challenge: string; scopes: string[] }
): string {
  const query = new URLSearchParams({
    client_id: params.clientId,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: params.scopes.join(" "),
    state: params.state,
    code_challenge: params.challenge,
    code_challenge_method: "S256",
  });
  // Google gives a refresh token only for offline access with a consent prompt. `prompt=consent` on Microsoft makes the
  // consent screen repeatable, so row M1 can see it.
  if (provider === "google") query.set("access_type", "offline");
  query.set("prompt", "consent");
  return `${endpoints.authorizeUrl}?${query.toString()}`;
}

export type CallbackParams = Record<string, string>;

export interface CallbackServer {
  /** The URL a browser must open on this machine. Tests read the port from here. */
  readonly origin: string;
  /** Resolves with the query of the first request that carries the right `state`. */
  readonly result: Promise<CallbackParams>;
  stop(): void;
}

function sameText(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * One-shot server for the redirect. A request with a missing or wrong `state` gets 400 and changes nothing. The first
 * request with the right `state` resolves `result`, gets 200 and stops the server.
 */
export function startCallbackServer(options: { port: number; state: string; timeoutMs: number }): CallbackServer {
  let settled = false;
  let resolveResult: (params: CallbackParams) => void = () => undefined;
  let rejectResult: (error: Error) => void = () => undefined;
  const result = new Promise<CallbackParams>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const handle = (request: Request): Response => {
    const url = new URL(request.url);
    if (url.pathname !== "/callback") return new Response("not found", { status: 404 });
    if (settled) return new Response("already used", { status: 410 });
    const state = url.searchParams.get("state");
    if (state === null || !sameText(state, options.state)) return new Response("state mismatch", { status: 400 });
    settled = true;
    clearTimeout(timer);
    resolveResult(Object.fromEntries(url.searchParams.entries()));
    queueMicrotask(stopAll);
    return new Response("You can close this tab and go back to the terminal.", { status: 200 });
  };

  // Bun's `localhost` listens on one family only, so another local process could take the other one. Listen on both
  // loopback addresses. A taken address is an error. A machine without IPv6 gives no `::1` listener, which is fine.
  const servers: ReturnType<typeof Bun.serve>[] = [];
  const stopAll = (): void => {
    for (const server of servers) void server.stop();
  };
  const first = Bun.serve({ port: options.port, hostname: "127.0.0.1", fetch: handle });
  servers.push(first);
  try {
    servers.push(Bun.serve({ port: first.port, hostname: "::1", fetch: handle }));
  } catch (error) {
    if ((error as { code?: unknown }).code === "EADDRINUSE") {
      stopAll();
      throw error;
    }
  }
  const server = first;

  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    stopAll();
    rejectResult(new Error("callback timeout"));
  }, options.timeoutMs);

  return {
    origin: `http://localhost:${server.port}`,
    result,
    stop: () => {
      clearTimeout(timer);
      settled = true;
      stopAll();
    },
  };
}

export interface TokenAnswer {
  status: number;
  body: Record<string, unknown>;
}

export async function tokenRequest(
  fetchFn: typeof fetch,
  url: string,
  form: Record<string, string>
): Promise<TokenAnswer> {
  const response = await fetchFn(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(form).toString(),
  });
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await response.json();
    if (typeof parsed === "object" && parsed !== null) body = parsed as Record<string, unknown>;
  } catch {
    // A body that is not JSON gives an empty body; the status still counts.
  }
  return { status: response.status, body };
}

export const text = (body: Record<string, unknown>, key: string): string | undefined => {
  const value = body[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

/** The granted `scope` string as the token endpoint gave it, each item checked for a plain scope shape. */
export function scopeText(body: Record<string, unknown>): string {
  const scope = text(body, "scope");
  if (scope === undefined) return "absent";
  return scope
    .split(/\s+/)
    .map((item) => (/^[A-Za-z0-9_.:/-]{1,120}$/.test(item) ? item : "<odd>"))
    .join(" ");
}

/** Codes only: the `error` word, numeric `error_codes` and AADSTS codes. Never the `error_description` text. */
export function errorCodes(answer: TokenAnswer): string {
  const parts = [`http ${answer.status}`];
  const error = text(answer.body, "error");
  if (error !== undefined) parts.push(`error ${/^[a-z_]{1,40}$/.test(error) ? error : "<odd>"}`);
  const codes = answer.body["error_codes"];
  if (Array.isArray(codes)) {
    const numbers = codes.filter((code): code is number => typeof code === "number").slice(0, 5);
    if (numbers.length > 0) parts.push(`error_codes ${numbers.join(",")}`);
  }
  const description = text(answer.body, "error_description");
  const aadsts = description === undefined ? null : description.match(/AADSTS\d{3,7}/);
  if (aadsts !== null) parts.push(aadsts[0]);
  return parts.join(", ");
}

export interface IdClaims {
  email?: string;
  preferred_username?: string;
}

/** Claims of an ID token from the token endpoint over TLS. No signature check (the spike reads two claims only). */
export function idClaims(idToken: string | undefined): IdClaims {
  if (idToken === undefined) return {};
  const payload = idToken.split(".")[1];
  if (payload === undefined) return {};
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) return {};
    const record = parsed as Record<string, unknown>;
    const claims: IdClaims = {};
    if (typeof record["email"] === "string") claims.email = record["email"];
    if (typeof record["preferred_username"] === "string") claims.preferred_username = record["preferred_username"];
    return claims;
  } catch {
    return {};
  }
}
