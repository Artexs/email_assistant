// Helpers of the SSO tests: sign-in at our server, consent at the fake IdP, callback at our server.
import type { FakeOidc } from "./fake-oidc";

export const SSO_TEST_ORIGIN = "http://127.0.0.1:8080";
export const SESSION_COOKIE = "ea.session_token";

// Anything with a `fetch`: a Hono app from `createApp`, or `{ fetch: auth.handler }`.
export interface Fetchable {
  fetch(req: Request): Response | Promise<Response>;
}

let counter = 0;

// Every test request gets its own client address, so the rate limits of other tests do not count here.
export function nextIp(): string {
  counter += 1;
  return `10.${(counter >> 16) & 255}.${(counter >> 8) & 255}.${counter & 255}`;
}

// The stored `oidc_config` of a provider that points at the fake IdP (the shape `discoverOIDCConfig` makes, plus the client).
export function fakeOidcConfig(fake: FakeOidc): string {
  return JSON.stringify({
    issuer: fake.issuer,
    discoveryEndpoint: `${fake.issuer}/.well-known/openid-configuration`,
    authorizationEndpoint: `${fake.issuer}/authorize`,
    tokenEndpoint: `${fake.issuer}/token`,
    jwksEndpoint: `${fake.issuer}/jwks`,
    userInfoEndpoint: `${fake.issuer}/userinfo`,
    tokenEndpointAuthentication: "client_secret_basic",
    clientId: fake.clientId,
    clientSecret: fake.clientSecret,
    pkce: true,
    scopes: ["openid", "email", "profile"],
  });
}

class Jar {
  readonly cookies = new Map<string, string>();

  take(res: Response): void {
    for (const line of res.headers.getSetCookie()) {
      const pair = line.split(";")[0] ?? "";
      const at = pair.indexOf("=");
      const name = pair.slice(0, at);
      const value = pair.slice(at + 1);
      if (value === "" || /max-age=0/i.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  header(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

export interface SsoSignInResult {
  // Where the flow ended: our sign-in answer, the IdP, or our callback.
  stage: "sign-in" | "idp" | "callback";
  status: number;
  location: string | null;
  // The value of the session cookie when the callback set one.
  sessionCookie: string | null;
}

export async function ssoSignIn(
  app: Fetchable,
  fake: FakeOidc,
  opts: { email: string; providerId?: string; requestSignUp?: boolean }
): Promise<SsoSignInResult> {
  const jar = new Jar();
  const request = (method: string, target: string, body?: unknown): Request => {
    const headers = new Headers({ origin: SSO_TEST_ORIGIN, "x-client-ip": nextIp() });
    if (body !== undefined) headers.set("content-type", "application/json");
    if (jar.cookies.size > 0) headers.set("cookie", jar.header());
    return new Request(`${SSO_TEST_ORIGIN}${target}`, {
      method,
      headers,
      redirect: "manual",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  };
  const start = await app.fetch(
    request("POST", "/api/auth/sign-in/sso", {
      email: opts.email,
      callbackURL: "/app",
      ...(opts.providerId === undefined ? {} : { providerId: opts.providerId }),
      ...(opts.requestSignUp === undefined ? {} : { requestSignUp: opts.requestSignUp }),
    })
  );
  jar.take(start);
  const started = (await start.json().catch(() => null)) as { url?: unknown } | null;
  if (start.status !== 200 || typeof started?.url !== "string") {
    return { stage: "sign-in", status: start.status, location: start.headers.get("location"), sessionCookie: null };
  }
  if (new URL(started.url).origin !== fake.origin) {
    throw new Error("the sign-in did not point at the fake IdP");
  }
  const consent = await fetch(started.url, { redirect: "manual" });
  const back = consent.headers.get("location");
  if (back === null) return { stage: "idp", status: consent.status, location: null, sessionCookie: null };
  const callback = new URL(back);
  const done = await app.fetch(request("GET", `${callback.pathname}${callback.search}`));
  jar.take(done);
  return {
    stage: "callback",
    status: done.status,
    location: done.headers.get("location"),
    sessionCookie: jar.cookies.get(SESSION_COOKIE) ?? null,
  };
}
