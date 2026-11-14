import { randomUUID } from "node:crypto";

import { describe, expect, test } from "bun:test";

import { isAllowedAuthPath } from "./auth";
import {
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
  const HOUR_MS = 3_600_000;

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
