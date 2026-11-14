import { createHash, randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { startFakeOidc, type FakeOidc } from "./fake-oidc";

// The helper must be as strict as a real IdP, or a test would pass for a flow that a real IdP refuses.
const REDIRECT = "http://127.0.0.1:8080/api/auth/sso/callback/p1";

let fake: FakeOidc;

beforeAll(async () => {
  fake = await startFakeOidc();
  fake.registerRedirectUri(REDIRECT);
});

afterAll(() => {
  fake.stop();
});

const verifier = () => randomBytes(32).toString("base64url");
const challengeOf = (value: string) => createHash("sha256").update(value).digest("base64url");

function authorize(params: Record<string, string | null>): Promise<Response> {
  const url = new URL(`${fake.origin}/authorize`);
  const all: Record<string, string | null> = {
    response_type: "code",
    client_id: fake.clientId,
    redirect_uri: REDIRECT,
    state: "s1",
    code_challenge_method: "S256",
    ...params,
  };
  for (const [key, value] of Object.entries(all)) if (value !== null) url.searchParams.set(key, value);
  return fetch(url, { redirect: "manual" });
}

async function codeFor(value: string): Promise<string> {
  const response = await authorize({ code_challenge: challengeOf(value) });
  expect(response.status).toBe(302);
  const code = new URL(response.headers.get("location") ?? "").searchParams.get("code");
  if (code === null) throw new Error("no code");
  return code;
}

function token(fields: Record<string, string | null>, secret = fake.clientSecret): Promise<Response> {
  const form = new URLSearchParams();
  const all: Record<string, string | null> = { grant_type: "authorization_code", redirect_uri: REDIRECT, ...fields };
  for (const [key, value] of Object.entries(all)) if (value !== null) form.set(key, value);
  return fetch(`${fake.origin}/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${Buffer.from(`${fake.clientId}:${secret}`).toString("base64")}`,
    },
    body: form,
  });
}

describe("fake OIDC provider", () => {
  test("a full flow with PKCE S256 gives a signed id_token", async () => {
    const value = verifier();
    const response = await token({ code: await codeFor(value), code_verifier: value });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { id_token: string };
    expect(body.id_token.split(".")).toHaveLength(3);
  });

  test("/authorize refuses a request without code_challenge, with an empty one, or with the plain method", async () => {
    expect((await authorize({ code_challenge: null })).status).toBe(400);
    expect((await authorize({ code_challenge: "" })).status).toBe(400);
    expect((await authorize({ code_challenge: challengeOf("x"), code_challenge_method: "plain" })).status).toBe(400);
    expect((await authorize({ code_challenge: challengeOf("x"), code_challenge_method: null })).status).toBe(400);
  });

  test("/authorize refuses a redirect_uri that no provider config registered", async () => {
    const challenge = challengeOf("x");
    expect((await authorize({ code_challenge: challenge, redirect_uri: "http://127.0.0.1:8080/evil" })).status).toBe(
      400
    );
    expect((await authorize({ code_challenge: challenge, redirect_uri: `${REDIRECT}/x` })).status).toBe(400);
    expect((await authorize({ code_challenge: challenge, client_id: "other" })).status).toBe(400);
  });

  test("/token refuses a missing or wrong verifier", async () => {
    const value = verifier();
    expect((await token({ code: await codeFor(value), code_verifier: null })).status).toBe(400);
    expect((await token({ code: await codeFor(value), code_verifier: "" })).status).toBe(400);
    expect((await token({ code: await codeFor(value), code_verifier: verifier() })).status).toBe(400);
  });

  test("/token refuses another redirect_uri than the one of /authorize, a wrong secret and a reused code", async () => {
    const value = verifier();
    const first = await codeFor(value);
    expect((await token({ code: first, code_verifier: value, redirect_uri: `${REDIRECT}/x` })).status).toBe(400);
    // The failed call used the code up: a code is valid once.
    expect((await token({ code: first, code_verifier: value })).status).toBe(400);
    const second = await codeFor(value);
    expect((await token({ code: second, code_verifier: value }, "wrong")).status).toBe(401);
    const third = await codeFor(value);
    expect((await token({ code: third, code_verifier: value })).status).toBe(200);
    expect((await token({ code: third, code_verifier: value })).status).toBe(400);
  });
});
