// A fake token server for the mailbox OAuth tests (F117 stage 06): `Bun.serve` on `http://127.0.0.1:<random port>`.
// A TEST DOUBLE ONLY. No production code, config or env key reads its URLs (D6): a test builds a registry with `specs()` and passes it in.
// It is as strict as the plan needs: client id and secret, single-use codes, the PKCE verifier, refresh token rotation, revoke.
import { createHash, randomBytes } from "node:crypto";

import type { SmtpSecurity } from "@ea/core";

import {
  mailOAuthProviders,
  type MailOAuthProvider,
  type MailOAuthProviderSpec,
} from "../src/modules/mail/oauth/providers";

export interface FakeMailOAuthCall {
  provider: MailOAuthProvider;
  grant: "authorization_code" | "refresh_token";
  /** The `scope` form field; null when the client sent none. */
  scope: string | null;
  codeVerifierOk: boolean;
}

export type FakeFailure = { status: number; error: string; aadsts?: number; description?: string } | "timeout";

export interface FakeMailOAuth {
  clientId: string;
  clientSecret: string;
  /** A registry whose OAuth URLs point at this server. The mail hosts are the test's own (GreenMail). */
  specs(over: {
    imap: { host: string; port: number };
    smtp: { host: string; port: number; security: SmtpSecurity };
    graphBaseUrl?: string;
  }): Record<MailOAuthProvider, MailOAuthProviderSpec>;
  /**
   * An authorization code that the next code redeem accepts once. With `codeChallenge` the redeem checks the PKCE verifier
   * (S256); without it only the shape of the verifier. `scopes` is what the token answer names as granted.
   */
  code(input: {
    provider: MailOAuthProvider;
    address: string;
    scopes?: string[];
    emailVerified?: boolean;
    tid?: string;
    codeChallenge?: string;
    /** Claims that replace or add to the ID token payload; a key with `undefined` is left out (stage 08 tests). */
    claims?: Record<string, unknown>;
  }): string;
  /** The next token or revoke request gets this answer. "timeout": no answer until `stop()`. */
  failNext(answer: FakeFailure): void;
  /** Per provider: does a refresh give a new refresh token? Microsoft true, Google false. */
  rotate: Record<MailOAuthProvider, boolean>;
  calls: FakeMailOAuthCall[];
  /** The refresh tokens that a revoke call got and accepted. */
  revoked: string[];
  /** The refresh tokens this server issued, in order (canary searches). */
  issuedRefreshTokens: string[];
  stop(): Promise<void>;
}

interface IssuedCode {
  provider: MailOAuthProvider;
  address: string;
  scopes: string[];
  emailVerified: boolean;
  tid: string;
  challenge: string | null;
  claims: Record<string, unknown>;
}

interface IssuedRefresh {
  provider: MailOAuthProvider;
  address: string;
  scopes: string[];
  tid: string;
  live: boolean;
}

// The scopes a real provider names in its answer are not known before the spike (rows M2, G1). These defaults follow the plan review:
// Google names `email` as the userinfo.email URL; Microsoft leaves `offline_access` out.
const DEFAULT_GRANTED: Record<MailOAuthProvider, string[]> = {
  microsoft: ["https://outlook.office.com/IMAP.AccessAsUser.All"],
  google: ["openid", "https://www.googleapis.com/auth/userinfo.email", "https://mail.google.com/"],
};

const base64url = (input: string): string => Buffer.from(input).toString("base64url");
const GUID = "11111111-2222-4333-8444-555555555555";

export async function startFakeMailOAuth(): Promise<FakeMailOAuth> {
  const clientId = `fake-mail-client-${randomBytes(4).toString("hex")}`;
  const clientSecret = randomBytes(16).toString("hex");
  const codes = new Map<string, IssuedCode>();
  const refreshTokens = new Map<string, IssuedRefresh>();
  const calls: FakeMailOAuthCall[] = [];
  const revoked: string[] = [];
  const issuedRefreshTokens: string[] = [];
  const rotate: Record<MailOAuthProvider, boolean> = { microsoft: true, google: false };
  const failures: FakeFailure[] = [];
  let origin = "";
  let counter = 0;
  let release: () => void = () => undefined;
  const stopped = new Promise<void>((resolve) => {
    release = resolve;
  });

  const next = (prefix: string): string => {
    counter += 1;
    return `${prefix}-${counter}-${randomBytes(6).toString("hex")}`;
  };

  const issuerOf = (provider: MailOAuthProvider, tid: string): string =>
    provider === "microsoft" ? `https://login.microsoftonline.com/${tid}/v2.0` : "https://accounts.google.com";

  function idToken(
    provider: MailOAuthProvider,
    entry: { address: string; tid: string; emailVerified: boolean; claims: Record<string, unknown> }
  ): string {
    const now = Math.floor(Date.now() / 1000);
    const claims: Record<string, unknown> = {
      iss: issuerOf(provider, entry.tid),
      aud: clientId,
      sub: `sub-${entry.address}`,
      iat: now,
      exp: now + 300,
      email: entry.address,
      ...(provider === "google"
        ? { email_verified: entry.emailVerified }
        : { tid: entry.tid, preferred_username: entry.address }),
      ...entry.claims,
    };
    return `${base64url(JSON.stringify({ alg: "none", typ: "JWT" }))}.${base64url(JSON.stringify(claims))}.`;
  }

  function errorAnswer(failure: Exclude<FakeFailure, "timeout">): Response {
    const description =
      failure.description ??
      (failure.aadsts === undefined
        ? "simulated refusal for user a@x.test"
        : `AADSTS${failure.aadsts}: simulated refusal for user a@x.test. Trace ID: t Correlation ID: c`);
    return Response.json(
      {
        error: failure.error,
        error_description: description,
        ...(failure.aadsts === undefined ? {} : { error_codes: [failure.aadsts] }),
      },
      { status: failure.status }
    );
  }

  const invalidGrant = (provider: MailOAuthProvider): Response =>
    errorAnswer({ status: 400, error: "invalid_grant", ...(provider === "microsoft" ? { aadsts: 70008 } : {}) });

  async function token(provider: MailOAuthProvider, form: URLSearchParams): Promise<Response> {
    if (form.get("client_id") !== clientId || form.get("client_secret") !== clientSecret) {
      return Response.json({ error: "invalid_client", error_description: "bad client" }, { status: 401 });
    }
    const grant = form.get("grant_type");
    const scope = form.get("scope");
    if (grant === "authorization_code") {
      const code = form.get("code") ?? "";
      const entry = codes.get(code);
      codes.delete(code);
      const verifier = form.get("code_verifier") ?? "";
      const verifierOk =
        entry !== undefined &&
        (entry.challenge === null
          ? /^[A-Za-z0-9_.~-]{43,128}$/.test(verifier)
          : createHash("sha256").update(verifier).digest("base64url") === entry.challenge);
      calls.push({ provider, grant, scope, codeVerifierOk: verifierOk });
      if (entry === undefined || entry.provider !== provider || form.get("redirect_uri") === null || !verifierOk) {
        return invalidGrant(provider);
      }
      const refresh = next("rt");
      refreshTokens.set(refresh, {
        provider,
        address: entry.address,
        scopes: entry.scopes,
        tid: entry.tid,
        live: true,
      });
      issuedRefreshTokens.push(refresh);
      return Response.json({
        token_type: "Bearer",
        access_token: next("at"),
        expires_in: 3599,
        refresh_token: refresh,
        scope: entry.scopes.join(" "),
        id_token: idToken(provider, entry),
      });
    }
    if (grant === "refresh_token") {
      calls.push({ provider, grant, scope, codeVerifierOk: false });
      const old = form.get("refresh_token") ?? "";
      const entry = refreshTokens.get(old);
      if (entry === undefined || !entry.live || entry.provider !== provider) return invalidGrant(provider);
      const granted = scope === null ? entry.scopes : scope.split(" ").filter((item) => item !== "offline_access");
      let fresh: string | null = null;
      if (rotate[provider]) {
        entry.live = false;
        fresh = next("rt");
        refreshTokens.set(fresh, { ...entry, live: true });
        issuedRefreshTokens.push(fresh);
      }
      return Response.json({
        token_type: "Bearer",
        access_token: next("at"),
        expires_in: 3599,
        ...(fresh === null ? {} : { refresh_token: fresh }),
        scope: granted.join(" "),
      });
    }
    return Response.json({ error: "unsupported_grant_type" }, { status: 400 });
  }

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      const [, providerPart, action] = url.pathname.split("/");
      const provider = providerPart === "microsoft" || providerPart === "google" ? providerPart : null;
      if (req.method !== "POST" || provider === null || (action !== "token" && action !== "revoke")) {
        return new Response("not found", { status: 404 });
      }
      // A real endpoint takes the secret in the body only; a query on a token request is a client bug (review T1).
      if (url.search !== "") return Response.json({ error: "invalid_request" }, { status: 400 });
      const form = new URLSearchParams(await req.text());
      const failure = failures.shift();
      if (failure === "timeout") {
        await stopped;
        return new Response("stopped", { status: 503 });
      }
      if (failure !== undefined) return errorAnswer(failure);
      if (action === "token") return token(provider, form);
      const entry = refreshTokens.get(form.get("token") ?? "");
      if (entry === undefined || !entry.live || entry.provider !== provider) {
        return Response.json({ error: "invalid_token" }, { status: 400 });
      }
      entry.live = false;
      revoked.push(form.get("token") ?? "");
      return new Response(null, { status: 200 });
    },
  });
  origin = `http://127.0.0.1:${server.port}`;

  return {
    clientId,
    clientSecret,
    specs(over) {
      const make = (provider: MailOAuthProvider): MailOAuthProviderSpec => {
        const real = mailOAuthProviders[provider];
        return {
          ...real,
          authorizeUrl: `${origin}/${provider}/authorize`,
          tokenUrl: `${origin}/${provider}/token`,
          revokeUrl: real.revokeUrl === null ? null : `${origin}/${provider}/revoke`,
          imap: over.imap,
          smtp: over.smtp,
          graphBaseUrl: real.graphBaseUrl === null ? null : (over.graphBaseUrl ?? null),
        };
      };
      return { microsoft: make("microsoft"), google: make("google") };
    },
    code(input) {
      const code = next("code");
      codes.set(code, {
        provider: input.provider,
        address: input.address,
        scopes: input.scopes ?? DEFAULT_GRANTED[input.provider],
        emailVerified: input.emailVerified ?? true,
        tid: input.tid ?? GUID,
        challenge: input.codeChallenge ?? null,
        claims: input.claims ?? {},
      });
      return code;
    },
    failNext(answer) {
      failures.push(answer);
    },
    rotate,
    calls,
    revoked,
    issuedRefreshTokens,
    async stop() {
      release();
      await server.stop(true);
    },
  };
}
