import { describe, expect, test } from "bun:test";

import { checkSsoEmail, isSafeSsoUrl, loginSections, readSignInOptions, startSsoSignIn } from "./sso-sign-in";

const ORIGIN = "https://app.x.test";

function answer(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe("isSafeSsoUrl", () => {
  test("an https address and an address of this origin pass", () => {
    expect(isSafeSsoUrl("https://login.microsoftonline.com/x", ORIGIN)).toBe(true);
    expect(isSafeSsoUrl("/api/auth/x", ORIGIN)).toBe(true);
    expect(isSafeSsoUrl(`${ORIGIN}/api/auth/x`, ORIGIN)).toBe(true);
    expect(isSafeSsoUrl("http://localhost:8081/api/auth/x", "http://localhost:8081")).toBe(true);
  });

  test("javascript:, http: of another host, a user name, a non-string and an empty value fail", () => {
    expect(isSafeSsoUrl("javascript:alert(1)", ORIGIN)).toBe(false);
    expect(isSafeSsoUrl("http://evil.test", ORIGIN)).toBe(false);
    expect(isSafeSsoUrl("data:text/html,x", ORIGIN)).toBe(false);
    expect(isSafeSsoUrl("https://user:pw@evil.test/x", ORIGIN)).toBe(false);
    expect(isSafeSsoUrl("https://user@evil.test/x", ORIGIN)).toBe(false);
    expect(isSafeSsoUrl("", ORIGIN)).toBe(false);
    expect(isSafeSsoUrl(undefined, ORIGIN)).toBe(false);
    expect(isSafeSsoUrl({ href: "https://a.test" }, ORIGIN)).toBe(false);
  });
});

describe("loginSections and readSignInOptions", () => {
  test("only { sso: true } shows the company sign-in", () => {
    expect(loginSections({ sso: true })).toEqual({ sso: true });
    expect(loginSections({ sso: false })).toEqual({ sso: false });
    expect(loginSections(null)).toEqual({ sso: false });
  });

  test("a good answer is read as it is", async () => {
    expect(await readSignInOptions(answer(200, { sso: true }))).toEqual({ sso: true });
    expect(await readSignInOptions(answer(200, { sso: false }))).toEqual({ sso: false });
  });

  test("an error status, a bad body or a network failure hide the button", async () => {
    expect(await readSignInOptions(answer(500, { sso: true }))).toEqual({ sso: false });
    expect(await readSignInOptions(answer(200, { sso: "yes" }))).toEqual({ sso: false });
    expect(await readSignInOptions(answer(200, { sso: true, orgs: 2 }))).toEqual({ sso: false });
    expect(await readSignInOptions(answer(200, "<html>"))).toEqual({ sso: false });
    const failing = (async () => {
      throw new TypeError("network");
    }) as unknown as typeof fetch;
    expect(await readSignInOptions(failing)).toEqual({ sso: false });
  });
});

describe("startSsoSignIn", () => {
  test("it posts the address, the next path and the error return; a safe url is returned", async () => {
    let seen: { url: string; init: RequestInit | undefined } | null = null;
    const fake = (async (url: string, init?: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ url: "https://idp.x.test/auth", redirect: true }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await startSsoSignIn("a@x.test", "/activity", ORIGIN, fake)).toEqual({
      ok: true,
      url: "https://idp.x.test/auth",
    });
    const call = seen as unknown as { url: string; init: RequestInit };
    expect(call.url).toBe("/api/auth/sign-in/sso");
    expect(call.init.method).toBe("POST");
    expect(JSON.parse(String(call.init.body))).toEqual({
      email: "a@x.test",
      callbackURL: "/activity",
      errorCallbackURL: "/login?sso=failed",
    });
  });

  test("an unsafe url is the generic error", async () => {
    for (const url of ["javascript:alert(1)", "http://evil.test/x", undefined]) {
      expect(await startSsoSignIn("a@x.test", "/", ORIGIN, answer(200, { url }))).toEqual({
        ok: false,
        key: "login_sso_error_generic",
      });
    }
  });

  test("429, a missing provider and a server error give their texts", async () => {
    expect(await startSsoSignIn("a@x.test", "/", ORIGIN, answer(429, {}))).toEqual({
      ok: false,
      key: "login_sso_error_rate",
    });
    expect(await startSsoSignIn("a@x.test", "/", ORIGIN, answer(404, {}))).toEqual({
      ok: false,
      key: "login_sso_error_no_provider",
    });
    expect(await startSsoSignIn("a@x.test", "/", ORIGIN, answer(401, {}))).toEqual({
      ok: false,
      key: "login_sso_error_no_provider",
    });
    expect(await startSsoSignIn("a@x.test", "/", ORIGIN, answer(500, {}))).toEqual({
      ok: false,
      key: "login_sso_error_generic",
    });
  });

  test("a network failure and a bad JSON body are the generic error", async () => {
    const failing = (async () => {
      throw new TypeError("network");
    }) as unknown as typeof fetch;
    expect(await startSsoSignIn("a@x.test", "/", ORIGIN, failing)).toEqual({
      ok: false,
      key: "login_sso_error_generic",
    });
    expect(await startSsoSignIn("a@x.test", "/", ORIGIN, answer(200, "<html>"))).toEqual({
      ok: false,
      key: "login_sso_error_generic",
    });
  });
});

describe("checkSsoEmail", () => {
  test("it trims and lower-cases a good address; a bad one gets the e-mail text", () => {
    expect(checkSsoEmail("  Ann@X.test ")).toEqual({ ok: true, email: "ann@x.test" });
    expect(checkSsoEmail("")).toEqual({ ok: false, key: "email_invalid" });
    expect(checkSsoEmail("not-an-address")).toEqual({ ok: false, key: "email_invalid" });
  });
});
