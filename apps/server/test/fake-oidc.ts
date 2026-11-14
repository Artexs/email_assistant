// A small OpenID Connect provider for the SSO tests (F119): `Bun.serve` on `http://127.0.0.1:<random port>`,
// RS256 keys from `node:crypto`. It needs no package. It signs in the user that `setUser` names, with no consent screen.
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";

export interface FakeOidcUser {
  sub: string;
  email: string;
  emailVerified?: boolean;
  hd?: string;
}

export interface FakeOidc {
  issuer: string;
  origin: string;
  clientId: string;
  clientSecret: string;
  setUser(user: FakeOidcUser): void;
  // Every request the IdP got, as `METHOD /path`.
  requests: string[];
  // Every authorization code and id_token the IdP issued: the log tests search the output for them.
  issuedCodes: string[];
  issuedIdTokens: string[];
  stop(): void;
}

export interface FakeOidcOptions {
  // false = the id_token and the userinfo answer carry no `email` claim (an IdP user without a mail address).
  emailClaim?: boolean;
}

interface IssuedCode {
  nonce: string | undefined;
  challenge: string | undefined;
  redirectUri: string;
  user: FakeOidcUser;
}

const base64url = (input: Buffer | string): string => Buffer.from(input).toString("base64url");

function clientCredentials(req: Request, form: URLSearchParams): [string | null, string | null] {
  const basic = req.headers.get("authorization");
  if (basic?.startsWith("Basic ")) {
    const [id, secret] = Buffer.from(basic.slice(6), "base64").toString().split(":").map(decodeURIComponent);
    return [id ?? null, secret ?? null];
  }
  return [form.get("client_id"), form.get("client_secret")];
}

export async function startFakeOidc(opts: FakeOidcOptions = {}): Promise<FakeOidc> {
  const emailClaim = opts.emailClaim ?? true;
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...(publicKey.export({ format: "jwk" }) as object), kid: "k1", alg: "RS256", use: "sig" };
  const clientId = `fake-client-${randomBytes(4).toString("hex")}`;
  const clientSecret = randomBytes(16).toString("hex");
  let user: FakeOidcUser = { sub: "fake-sub-1", email: "ann@x.test", emailVerified: true };
  const codes = new Map<string, IssuedCode>();
  const requests: string[] = [];
  const issuedCodes: string[] = [];
  const issuedIdTokens: string[] = [];

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      requests.push(`${req.method} ${url.pathname}`);
      const issuer = `http://127.0.0.1:${server.port}`;
      if (url.pathname === "/.well-known/openid-configuration") {
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
          userinfo_endpoint: `${issuer}/userinfo`,
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
          token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
          scopes_supported: ["openid", "email", "profile"],
        });
      }
      if (url.pathname === "/jwks") return Response.json({ keys: [jwk] });
      if (url.pathname === "/authorize") {
        const query = url.searchParams;
        if (query.get("client_id") !== clientId) return new Response("bad client", { status: 400 });
        if (query.get("code_challenge") !== null && query.get("code_challenge_method") !== "S256") {
          return new Response("bad pkce method", { status: 400 });
        }
        const redirectUri = query.get("redirect_uri");
        if (redirectUri === null) return new Response("no redirect_uri", { status: 400 });
        const code = randomBytes(12).toString("hex");
        issuedCodes.push(code);
        codes.set(code, {
          nonce: query.get("nonce") ?? undefined,
          challenge: query.get("code_challenge") ?? undefined,
          redirectUri,
          user,
        });
        const back = new URL(redirectUri);
        back.searchParams.set("code", code);
        back.searchParams.set("state", query.get("state") ?? "");
        return Response.redirect(back.toString(), 302);
      }
      if (url.pathname === "/token" && req.method === "POST") {
        const form = new URLSearchParams(await req.text());
        const [id, secret] = clientCredentials(req, form);
        if (id !== clientId || secret !== clientSecret) {
          return Response.json({ error: "invalid_client" }, { status: 401 });
        }
        const code = form.get("code") ?? "";
        const entry = codes.get(code);
        codes.delete(code); // one-time code
        if (!entry || entry.redirectUri !== form.get("redirect_uri")) {
          return Response.json({ error: "invalid_grant" }, { status: 400 });
        }
        if (entry.challenge !== undefined) {
          const verifier = form.get("code_verifier") ?? "";
          if (base64url(createHash("sha256").update(verifier).digest()) !== entry.challenge) {
            return Response.json({ error: "invalid_grant", error_description: "pkce" }, { status: 400 });
          }
        }
        const now = Math.floor(Date.now() / 1000);
        const claims: Record<string, unknown> = {
          iss: issuer,
          aud: clientId,
          sub: entry.user.sub,
          iat: now,
          exp: now + 300,
          ...(emailClaim ? { email: entry.user.email, email_verified: entry.user.emailVerified ?? true } : {}),
          ...(entry.nonce ? { nonce: entry.nonce } : {}),
          ...(entry.user.hd ? { hd: entry.user.hd } : {}),
        };
        const head = base64url(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" }));
        const body = base64url(JSON.stringify(claims));
        const signature = base64url(sign("sha256", Buffer.from(`${head}.${body}`), privateKey));
        const idToken = `${head}.${body}.${signature}`;
        issuedIdTokens.push(idToken);
        return Response.json({
          access_token: `fake-access-${randomBytes(8).toString("hex")}`,
          refresh_token: `fake-refresh-${randomBytes(8).toString("hex")}`,
          token_type: "Bearer",
          expires_in: 300,
          id_token: idToken,
          scope: "openid email profile",
        });
      }
      if (url.pathname === "/userinfo") {
        return Response.json({
          sub: user.sub,
          ...(emailClaim ? { email: user.email, email_verified: user.emailVerified ?? true } : {}),
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  const origin = `http://127.0.0.1:${server.port}`;
  return {
    issuer: origin,
    origin,
    clientId,
    clientSecret,
    requests,
    issuedCodes,
    issuedIdTokens,
    setUser(next) {
      user = next;
    },
    stop() {
      void server.stop(true);
    },
  };
}
