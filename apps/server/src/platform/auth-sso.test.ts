import { randomUUID } from "node:crypto";

import { HOUR_MS } from "@ea/core";
import { describe, expect, spyOn, test } from "bun:test";

import { isAllowedAuthPath } from "./auth";
import {
  buildOidcConfig,
  checkPublicHosts,
  discoverProviderConfig,
  isAllowedDiscoveryUrl,
  isAllowedSsoPath,
  isSsoCallbackPath,
  rejectUnknownSsoBodyKeys,
  ssoSessionData,
  SSO_SESSION_SECONDS,
  withoutIdpTokens,
} from "./auth-sso";

// The paths of `@better-auth/sso` 1.7.18 and the other Better Auth paths that our server keeps closed.
const CLOSED_PATHS = [
  "/sso/register",
  "/sso/providers",
  "/sso/get-provider",
  "/sso/update-provider",
  "/sso/delete-provider",
  "/sso/request-domain-verification",
  "/sso/verify-domain",
  "/sso/callback",
  "/sso/callback/",
  "/sso/saml2/callback/x",
  "/sso/saml2/sp/metadata",
  "/sso/saml2/sp/slo/p1",
  "/sso/saml2/logout/p1",
  "/sign-up/email",
  "/sign-in/social",
  "/sign-in/oauth2",
  "/list-sessions",
  "/update-user",
  "/delete-user",
  "/change-email",
  "/link-social",
  "/unlink-account",
  "/list-accounts",
  "/account-info",
  "/get-access-token",
  "/refresh-token",
  "/callback/google",
  "/oauth2/callback/x",
  "/verify-email",
  "/send-verification-email",
  "/ok",
  "/error",
];

describe("isAllowedSsoPath", () => {
  test("allows POST /sign-in/sso and GET /sso/callback/<one segment> only", () => {
    expect(isAllowedSsoPath("POST", "/sign-in/sso")).toBe(true);
    expect(isAllowedSsoPath("GET", `/sso/callback/${randomUUID()}`)).toBe(true);
    expect(isAllowedSsoPath("GET", "/sign-in/sso")).toBe(false);
    expect(isAllowedSsoPath("POST", `/sso/callback/${randomUUID()}`)).toBe(false);
    expect(isAllowedSsoPath("GET", "/sso/callback")).toBe(false);
    expect(isAllowedSsoPath("GET", "/sso/callback/")).toBe(false);
    expect(isAllowedSsoPath("GET", "/sso/callback/a/b")).toBe(false);
  });

  test.each(CLOSED_PATHS)("keeps %s closed for GET and POST", (path) => {
    for (const method of ["GET", "POST"]) {
      expect(isAllowedSsoPath(method, path)).toBe(false);
      expect(isAllowedAuthPath(method, path)).toBe(false);
    }
  });

  test("isAllowedAuthPath lets the two SSO paths through", () => {
    expect(isAllowedAuthPath("POST", "/sign-in/sso")).toBe(true);
    expect(isAllowedAuthPath("GET", "/sso/callback/some-id")).toBe(true);
    expect(isAllowedAuthPath("GET", "/sign-in/sso")).toBe(false);
  });
});

describe("ssoSessionData", () => {
  const now = new Date("2026-11-20T10:00:00.000Z");

  test("an SSO session lasts 12 h (43200 s)", () => {
    expect(SSO_SESSION_SECONDS).toBe(43_200);
  });

  test("a callback session starts now and ends 12 h later, whatever the database trigger does", () => {
    for (const path of ["/sso/callback/:providerId", "/sso/callback"]) {
      expect(ssoSessionData({ path, current: null, now })).toEqual({
        signInMethod: "sso",
        ssoStartedAt: now,
        expiresAt: new Date(now.getTime() + 12 * HOUR_MS),
      });
    }
  });

  test("a session made from an SSO session keeps its start and ends 12 h after it", () => {
    const started = new Date(now.getTime() - 2 * HOUR_MS);
    const data = ssoSessionData({
      path: "/two-factor/verify-totp",
      current: { signInMethod: "sso", ssoStartedAt: started },
      now,
    });
    expect(data).toEqual({
      signInMethod: "sso",
      ssoStartedAt: started,
      expiresAt: new Date(started.getTime() + 12 * HOUR_MS),
    });
  });

  test("a password sign-in and a session made from a password session are not marked", () => {
    expect(ssoSessionData({ path: "/sign-in/email", current: null, now })).toBeUndefined();
    expect(ssoSessionData({ path: "/change-password", current: { signInMethod: "password" }, now })).toBeUndefined();
  });

  test("the callback match takes both callback forms and nothing that only looks like them", () => {
    expect(isSsoCallbackPath("/sso/callback")).toBe(true);
    expect(isSsoCallbackPath("/sso/callback/:providerId")).toBe(true);
    expect(isSsoCallbackPath("/sso/callbackx")).toBe(false);
    expect(isSsoCallbackPath("/sso/register")).toBe(false);
    expect(isSsoCallbackPath(undefined)).toBe(false);
  });
});

describe("rejectUnknownSsoBodyKeys", () => {
  test("accepts the five known keys, also none", () => {
    expect(() =>
      rejectUnknownSsoBodyKeys({
        email: "a@x.test",
        providerId: "p",
        callbackURL: "/app",
        errorCallbackURL: "/login",
        requestSignUp: false,
      })
    ).not.toThrow();
    expect(() => rejectUnknownSsoBodyKeys({})).not.toThrow();
  });

  test.each(["organizationSlug", "domain", "loginHint", "scopes", "issuer"])("refuses the key %s with 400", (key) => {
    let thrown: unknown;
    try {
      rejectUnknownSsoBodyKeys({ email: "a@x.test", [key]: "x" });
    } catch (error) {
      thrown = error;
    }
    expect((thrown as { statusCode?: number }).statusCode).toBe(400);
    expect((thrown as { body?: { code?: string } }).body?.code).toBe("BAD_BODY");
  });
});

describe("withoutIdpTokens", () => {
  test("nulls the three IdP tokens of an SSO account and keeps the other fields", () => {
    const result = withoutIdpTokens({
      providerId: "p",
      accountId: "sub",
      idToken: "id",
      accessToken: "at",
      refreshToken: "rt",
      scope: "openid",
    });
    expect(result?.data).toEqual({
      providerId: "p",
      accountId: "sub",
      idToken: null,
      accessToken: null,
      refreshToken: null,
      scope: "openid",
    });
  });

  test("an update that names no token key stays as it is; a credential account is never touched", () => {
    expect(withoutIdpTokens({ providerId: "p", updatedAt: new Date() })).toBeUndefined();
    expect(withoutIdpTokens({ providerId: "credential", idToken: "x", password: "h" })).toBeUndefined();
  });

  test("an update without a provider id but with a token key is nulled (fail closed)", () => {
    expect(withoutIdpTokens({ accessToken: "at" })?.data).toMatchObject({ accessToken: null, idToken: null });
  });
});

describe("discovery URL predicate (F119 stage 07, test 7)", () => {
  test("passes the Entra and Graph hosts, and an allowed origin", () => {
    expect(isAllowedDiscoveryUrl("https://login.microsoftonline.com/t/v2.0", [])).toBe(true);
    expect(isAllowedDiscoveryUrl("https://graph.microsoft.com/oidc/userinfo", [])).toBe(true);
    expect(isAllowedDiscoveryUrl("https://accounts.google.com/.well-known/openid-configuration", [])).toBe(true);
    expect(isAllowedDiscoveryUrl("http://127.0.0.1:4000/jwks", ["http://127.0.0.1:4000"])).toBe(true);
  });

  test.each([
    "http://idp.x.test",
    "https://127.0.0.1",
    "https://10.0.0.1",
    "https://169.254.169.254",
    "https://localhost",
    "https://localhost.",
    "https://idp.internal",
    "https://idp.internal.",
    "https://printer.local",
    "https://[::1]",
    "https://127.1",
    "https://2130706433",
    "https://intranet",
    "not a url",
  ])("refuses %s", (url) => {
    expect(isAllowedDiscoveryUrl(url, [])).toBe(false);
  });

  test("an allowed origin does not open another port or scheme", () => {
    expect(isAllowedDiscoveryUrl("http://127.0.0.1:4001/jwks", ["http://127.0.0.1:4000"])).toBe(false);
  });
});

describe("checkPublicHosts (test 8)", () => {
  const answering = (address: string) => async () => [{ address, family: address.includes(":") ? 6 : 4 }];

  test.each(["127.0.0.1", "::ffff:169.254.169.254", "64:ff9b::a00:1", "10.0.0.1"])("%s is refused", async (address) => {
    expect(await checkPublicHosts(["idp.x.test"], answering(address))).toBe("discovery_private_host");
  });

  test("one private answer among public ones refuses the host", async () => {
    const lookup = async () => [
      { address: "93.184.215.14", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ];
    expect(await checkPublicHosts(["idp.x.test"], lookup)).toBe("discovery_private_host");
  });

  test("a public answer is ok, and each host is checked", async () => {
    expect(await checkPublicHosts(["idp.x.test"], answering("93.184.215.14"))).toBe("ok");
    const lookup = async (host: string) => [{ address: host === "b.x.test" ? "10.0.0.1" : "93.184.215.14", family: 4 }];
    expect(await checkPublicHosts(["a.x.test", "b.x.test"], lookup)).toBe("discovery_private_host");
  });

  test("a lookup error or an empty answer is discovery_dns_failed", async () => {
    const failing = async (): Promise<{ address: string; family: number }[]> => {
      throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
    };
    expect(await checkPublicHosts(["idp.x.test"], failing)).toBe("discovery_dns_failed");
    expect(await checkPublicHosts(["idp.x.test"], async () => [])).toBe("discovery_dns_failed");
  });

  test("discoverProviderConfig stops at a private issuer host before any fetch", async () => {
    const fetched: string[] = [];
    const spy = spyOn(globalThis, "fetch").mockImplementation(((input: unknown) => {
      fetched.push(String(input));
      return Promise.reject(new Error("no fetch expected"));
    }) as unknown as typeof fetch);
    try {
      const result = await discoverProviderConfig("https://idp.x.test", {
        allowOrigins: [],
        timeoutMs: 1000,
        lookup: answering("10.0.0.1"),
      });
      expect(result).toEqual({ kind: "failed", code: "discovery_private_host" });
      expect(fetched).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  test("a refused issuer gets the plugin code and no lookup", async () => {
    let looked = 0;
    const lookup = async () => {
      looked += 1;
      return [{ address: "93.184.215.14", family: 4 }];
    };
    const result = await discoverProviderConfig("http://idp.x.test", { allowOrigins: [], timeoutMs: 1000, lookup });
    expect(result).toEqual({ kind: "failed", code: "discovery_untrusted_origin" });
    expect(looked).toBe(0);
  });
});

describe("buildOidcConfig", () => {
  test("is the plugin JSON with the client, PKCE and no IdP-initiated sign-in", () => {
    const json = buildOidcConfig(
      {
        issuer: "https://idp.x.test",
        discoveryEndpoint: "https://idp.x.test/.well-known/openid-configuration",
        authorizationEndpoint: "https://idp.x.test/authorize",
        tokenEndpoint: "https://idp.x.test/token",
        jwksEndpoint: "https://idp.x.test/jwks",
        tokenEndpointAuthentication: "client_secret_basic",
      },
      { clientId: "cid", clientSecret: "csecret" }
    );
    expect(JSON.parse(json)).toEqual({
      issuer: "https://idp.x.test",
      discoveryEndpoint: "https://idp.x.test/.well-known/openid-configuration",
      authorizationEndpoint: "https://idp.x.test/authorize",
      tokenEndpoint: "https://idp.x.test/token",
      jwksEndpoint: "https://idp.x.test/jwks",
      tokenEndpointAuthentication: "client_secret_basic",
      clientId: "cid",
      clientSecret: "csecret",
      pkce: true,
      scopes: ["openid", "email", "profile"],
      allowIdpInitiated: false,
    });
  });
});
