import { createHash, randomBytes } from "node:crypto";
import { format, inspect } from "node:util";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test, type Mock } from "bun:test";

import { startFakeMailOAuth, type FakeMailOAuth } from "../../../../test/fake-mail-oauth";
import { HardError, SoftError } from "../../../platform/errors";
import type { AuthErrorReason } from "../port";

import { createMailOAuthClient, OAuthGrantError, OAuthSoftError, type MailOAuthClient } from "./client";
import type { MailOAuthProvider, MailOAuthProviderSpec } from "./providers";

// Stage 06: the token client against the fake token server (a test double: no production code reads its URLs).
const REDIRECT = "https://ea.x.test/api/mailboxes/oauth/microsoft/callback";
const ADDRESS = "ann@x.test";
const RT_CANARY = "rt-canary";
const CS_CANARY = "cs-canary";
const DESCRIPTION_CANARY = "desc-canary";
const HOSTS = {
  imap: { host: "127.0.0.1", port: 1993 },
  smtp: { host: "127.0.0.1", port: 1465, security: "tls" as const },
};

let fake: FakeMailOAuth;
let specs: Record<MailOAuthProvider, MailOAuthProviderSpec>;
let logLines: string[] = [];
let logSpies: Mock<(...args: unknown[]) => void>[] = [];

beforeAll(async () => {
  fake = await startFakeMailOAuth();
  specs = fake.specs(HOSTS);
});

afterAll(async () => {
  await fake.stop();
});

beforeEach(() => {
  captureLogs();
});

afterEach(() => {
  for (const spy of logSpies) spy.mockRestore();
  logSpies = [];
  fake.calls.length = 0;
  fake.revoked.length = 0;
  fake.rotate.microsoft = true;
  fake.rotate.google = false;
});

function captureLogs(): void {
  for (const spy of logSpies) spy.mockRestore();
  logSpies = [];
  logLines = [];
  for (const method of ["log", "error", "warn", "info", "debug"] as const) {
    const spy = spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logLines.push(format(...args));
    });
    logSpies.push(spy as unknown as Mock<(...args: unknown[]) => void>);
  }
}

function clientOf(
  provider: MailOAuthProvider,
  opts: { clientSecret?: string; timeoutMs?: number; fetchFn?: typeof fetch } = {}
): MailOAuthClient {
  return createMailOAuthClient(
    specs[provider],
    { clientId: fake.clientId, clientSecret: opts.clientSecret ?? fake.clientSecret, redirectUri: REDIRECT },
    {
      ...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
      ...(opts.fetchFn === undefined ? {} : { fetchFn: opts.fetchFn }),
    }
  );
}

const verifier = (): string => randomBytes(32).toString("base64url");
const challengeOf = (value: string): string => createHash("sha256").update(value).digest("base64url");

async function caught(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("did not throw");
}

/** A refresh that the fake refuses with `failure`. */
async function refreshFailure(
  provider: MailOAuthProvider,
  failure: Parameters<FakeMailOAuth["failNext"]>[0]
): Promise<unknown> {
  fake.failNext(failure);
  return caught(() => clientOf(provider, { timeoutMs: 300 }).refresh(RT_CANARY, "mail"));
}

describe("authorizeUrl", () => {
  test.each(["microsoft", "google"] as const)("%s: S256 challenge, redirect, scopes, params, no secret", (provider) => {
    const spec = specs[provider];
    const url = new URL(clientOf(provider).authorizeUrl({ state: "st-1", codeChallenge: "ch-1", loginHint: ADDRESS }));
    expect(`${url.origin}${url.pathname}`).toBe(spec.authorizeUrl);
    const query = url.searchParams;
    expect(query.get("response_type")).toBe("code");
    expect(query.get("client_id")).toBe(fake.clientId);
    expect(query.get("redirect_uri")).toBe(REDIRECT);
    expect(query.get("code_challenge")).toBe("ch-1");
    expect(query.get("code_challenge_method")).toBe("S256");
    expect(query.get("state")).toBe("st-1");
    expect(query.get("scope")).toBe(spec.authorizeScopes.join(" "));
    expect(query.get("login_hint")).toBe(ADDRESS);
    for (const [key, value] of Object.entries(spec.authorizeParams)) expect(query.get(key)).toBe(value);
    expect(url.toString()).not.toContain(fake.clientSecret);
    expect(query.has("client_secret")).toBe(false);
  });

  test("no login hint, no login_hint parameter", () => {
    const url = new URL(clientOf("google").authorizeUrl({ state: "s", codeChallenge: "c" }));
    expect(url.searchParams.has("login_hint")).toBe(false);
  });
});

describe("error map (D17)", () => {
  const grantCases: [string, MailOAuthProvider, Parameters<FakeMailOAuth["failNext"]>[0], AuthErrorReason][] = [
    ["invalid_grant 70008", "microsoft", { status: 400, error: "invalid_grant", aadsts: 70008 }, "oauth_expired"],
    ["invalid_grant 700082", "microsoft", { status: 400, error: "invalid_grant", aadsts: 700082 }, "oauth_expired"],
    ["invalid_grant 700084", "microsoft", { status: 400, error: "invalid_grant", aadsts: 700084 }, "oauth_expired"],
    ["invalid_grant 70043", "microsoft", { status: 400, error: "invalid_grant", aadsts: 70043 }, "oauth_expired"],
    ["Google invalid_grant, no detail (Q10)", "google", { status: 400, error: "invalid_grant" }, "oauth_expired"],
    ["another invalid_grant", "microsoft", { status: 400, error: "invalid_grant", aadsts: 70000 }, "oauth_expired"],
    [
      "interaction_required",
      "microsoft",
      { status: 400, error: "interaction_required", aadsts: 50079 },
      "oauth_expired",
    ],
    ["invalid_grant 50173", "microsoft", { status: 400, error: "invalid_grant", aadsts: 50173 }, "oauth_revoked"],
    ["invalid_grant 65004", "microsoft", { status: 400, error: "invalid_grant", aadsts: 65004 }, "oauth_revoked"],
    [
      "invalid_grant 65001: one reason (N4)",
      "microsoft",
      { status: 400, error: "invalid_grant", aadsts: 65001 },
      "admin_consent_required",
    ],
    [
      "interaction_required 65001",
      "microsoft",
      { status: 400, error: "interaction_required", aadsts: 65001 },
      "admin_consent_required",
    ],
    ["90094", "microsoft", { status: 400, error: "invalid_grant", aadsts: 90094 }, "admin_consent_required"],
    ["90095", "microsoft", { status: 400, error: "invalid_grant", aadsts: 90095 }, "admin_consent_required"],
    ["consent_required", "microsoft", { status: 400, error: "consent_required" }, "admin_consent_required"],
  ];
  for (const [name, provider, failure, reason] of grantCases) {
    test(`${name} → OAuthGrantError ${reason}`, async () => {
      const error = await refreshFailure(provider, failure);
      expect(error).toBeInstanceOf(OAuthGrantError);
      expect(error).toBeInstanceOf(HardError);
      expect((error as OAuthGrantError).reason).toBe(reason);
    });
  }

  const softCases: [string, Parameters<FakeMailOAuth["failNext"]>[0], OAuthSoftError["kind"]][] = [
    ["invalid_client", { status: 401, error: "invalid_client" }, "client_invalid"],
    ["invalid_client with AADSTS 7000215", { status: 401, error: "invalid_client", aadsts: 7000215 }, "client_invalid"],
    ["unauthorized_client", { status: 400, error: "unauthorized_client" }, "client_invalid"],
    ["503", { status: 503, error: "server_error" }, "server"],
    ["429", { status: 429, error: "too_many_requests" }, "server"],
    ["temporarily_unavailable", { status: 400, error: "temporarily_unavailable" }, "server"],
    ["an unknown error code", { status: 400, error: "something_new" }, "server"],
    ["timeout", "timeout", "timeout"],
  ];
  for (const [name, failure, kind] of softCases) {
    test(`${name} → OAuthSoftError ${kind}`, async () => {
      const error = await refreshFailure("microsoft", failure);
      expect(error).toBeInstanceOf(OAuthSoftError);
      expect(error).toBeInstanceOf(SoftError);
      expect((error as OAuthSoftError).kind).toBe(kind);
    });
  }

  test("a network error is a soft server error", async () => {
    const down = (() =>
      Promise.reject(new TypeError(`connect failed ${fake.clientSecret}`))) as unknown as typeof fetch;
    const error = await caught(() => clientOf("google", { fetchFn: down }).refresh(RT_CANARY, "mail"));
    expect((error as OAuthSoftError).kind).toBe("server");
  });

  test("the AADSTS number is kept, the description is not", async () => {
    const error = (await refreshFailure("microsoft", {
      status: 400,
      error: "invalid_grant",
      aadsts: 70008,
    })) as OAuthGrantError;
    expect(error.aadsts).toBe(70008);
    expect(error.providerCode).toBe("invalid_grant");
    expect(error.message).toBe("oauth grant refused: oauth_expired");
  });

  test("a wrong client secret is client_invalid", async () => {
    const error = await caught(() => clientOf("google", { clientSecret: "wrong" }).refresh(RT_CANARY, "mail"));
    expect((error as OAuthSoftError).kind).toBe("client_invalid");
  });

  test("a 200 answer without an access token is a soft server error", async () => {
    const empty = (() => Promise.resolve(Response.json({ token_type: "Bearer" }))) as unknown as typeof fetch;
    const error = await caught(() => clientOf("google", { fetchFn: empty }).refresh(RT_CANARY, "mail"));
    expect((error as OAuthSoftError).kind).toBe("server");
  });
});

describe("redeemCode and refresh", () => {
  test("the right verifier gives the tokens and the id token; the code works once", async () => {
    const v = verifier();
    const code = fake.code({ provider: "google", address: ADDRESS, codeChallenge: challengeOf(v) });
    const answer = await clientOf("google").redeemCode(code, v);
    expect(answer.accessToken).not.toBe("");
    expect(answer.refreshToken).not.toBeNull();
    expect(answer.expiresInSec).toBe(3599);
    expect(answer.idToken).not.toBeNull();
    expect(fake.calls.at(-1)).toMatchObject({ grant: "authorization_code", codeVerifierOk: true });
    const again = await caught(() => clientOf("google").redeemCode(code, v));
    expect(again).toBeInstanceOf(OAuthGrantError);
  });

  test("a wrong verifier is an OAuthGrantError", async () => {
    const code = fake.code({ provider: "google", address: ADDRESS, codeChallenge: challengeOf(verifier()) });
    const error = await caught(() => clientOf("google").redeemCode(code, verifier()));
    expect(error).toBeInstanceOf(OAuthGrantError);
    expect(fake.calls.at(-1)?.codeVerifierOk).toBe(false);
  });

  test("Microsoft asks for the mail resource at the redeem; Google sends no scope", async () => {
    const v = verifier();
    await clientOf("microsoft").redeemCode(fake.code({ provider: "microsoft", address: ADDRESS }), v.repeat(2));
    expect(fake.calls.at(-1)?.scope).toBe(specs.microsoft.resourceScopes.mail?.join(" "));
    await clientOf("google").redeemCode(fake.code({ provider: "google", address: ADDRESS }), v.repeat(2));
    expect(fake.calls.at(-1)?.scope).toBeNull();
  });

  test("a Microsoft refresh returns a new refresh token; the old one stops working", async () => {
    const client = clientOf("microsoft");
    const first = await client.redeemCode(fake.code({ provider: "microsoft", address: ADDRESS }), verifier());
    const second = await client.refresh(first.refreshToken ?? "", "graph");
    expect(second.refreshToken).not.toBeNull();
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(fake.calls.at(-1)?.scope).toBe(specs.microsoft.resourceScopes.graph?.join(" "));
    const old = await caught(() => client.refresh(first.refreshToken ?? "", "mail"));
    expect(old).toBeInstanceOf(OAuthGrantError);
  });

  test("a Google refresh returns refreshToken null and the old token stays valid", async () => {
    const client = clientOf("google");
    const first = await client.redeemCode(fake.code({ provider: "google", address: ADDRESS }), verifier());
    const second = await client.refresh(first.refreshToken ?? "", "mail");
    expect(second.refreshToken).toBeNull();
    expect((await client.refresh(first.refreshToken ?? "", "mail")).accessToken).not.toBe("");
  });

  test("scopes are the names the provider answered, split on spaces", async () => {
    const answer = await clientOf("google").redeemCode(fake.code({ provider: "google", address: ADDRESS }), verifier());
    expect(answer.scopes).toEqual([
      "openid",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://mail.google.com/",
    ]);
  });

  test("a provider without a Graph resource refuses a graph refresh before any call", async () => {
    const error = await caught(() => clientOf("google").refresh("rt", "graph"));
    expect(error).toBeInstanceOf(HardError);
    expect(fake.calls).toEqual([]);
  });
});

describe("revoke", () => {
  test("Google: the token is revoked; a second revoke resolves", async () => {
    const client = clientOf("google");
    const answer = await client.redeemCode(fake.code({ provider: "google", address: ADDRESS }), verifier());
    await client.revoke(answer.refreshToken ?? "");
    expect(fake.revoked).toEqual([answer.refreshToken ?? ""]);
    await client.revoke(answer.refreshToken ?? "");
    expect(fake.revoked).toHaveLength(1);
    expect(await caught(() => client.refresh(answer.refreshToken ?? "", "mail"))).toBeInstanceOf(OAuthGrantError);
  });

  test("Microsoft has no revoke URL: it resolves and makes no call", async () => {
    let calls = 0;
    const counting = (() => {
      calls += 1;
      return Promise.resolve(new Response(null, { status: 200 }));
    }) as unknown as typeof fetch;
    await clientOf("microsoft", { fetchFn: counting }).revoke("rt");
    expect(calls).toBe(0);
  });

  test("a server fault on revoke is a soft error", async () => {
    fake.failNext({ status: 503, error: "server_error" });
    const error = await caught(() => clientOf("google").revoke("rt"));
    expect((error as OAuthSoftError).kind).toBe("server");
  });
});

// D18: no secret in an error message, String(error), a property dump or a log line. Each guard has a mutation (see the job notes).
describe("secrets stay out of errors and logs", () => {
  function assertClean(error: unknown, lines: string[]): void {
    const shown = [
      String(error),
      (error as Error).message,
      inspect(error, { depth: 6, showHidden: true }),
      JSON.stringify(error),
      ...lines,
    ];
    for (const text of shown) {
      for (const secret of [RT_CANARY, fake.clientSecret, CS_CANARY, DESCRIPTION_CANARY, ADDRESS, "a@x.test"]) {
        expect(text).not.toContain(secret);
      }
    }
    expect((error as Error).cause).toBeUndefined();
  }

  test("a refused grant with a canary description holds none of it", async () => {
    captureLogs();
    const error = await refreshFailure("microsoft", {
      status: 400,
      error: "invalid_grant",
      aadsts: 70008,
      description: `AADSTS70008: ${DESCRIPTION_CANARY} ${RT_CANARY} ${CS_CANARY} for ${ADDRESS}`,
    });
    expect(error).toBeInstanceOf(OAuthGrantError);
    expect((error as OAuthGrantError).aadsts).toBe(70008);
    expect(logLines.length).toBeGreaterThan(0);
    assertClean(error, logLines);
  });

  test("a provider error code that is not a code is replaced", async () => {
    captureLogs();
    const error = await refreshFailure("google", {
      status: 400,
      error: `invalid_grant ${DESCRIPTION_CANARY} ${ADDRESS}`,
      description: DESCRIPTION_CANARY,
    });
    expect((error as OAuthSoftError).kind).toBe("server");
    assertClean(error, logLines);
    const grant = await refreshFailure("microsoft", { status: 400, error: `Bad ${DESCRIPTION_CANARY}`, aadsts: 70008 });
    expect((grant as OAuthGrantError).providerCode).toBe("unknown");
    assertClean(grant, logLines);
  });

  test("a thrown network error that echoes the secret does not leak", async () => {
    captureLogs();
    const down = (() =>
      Promise.reject(
        new TypeError(`POST failed: ${fake.clientSecret} ${RT_CANARY} ${ADDRESS}`)
      )) as unknown as typeof fetch;
    const error = await caught(() => clientOf("google", { fetchFn: down }).refresh(RT_CANARY, "mail"));
    expect((error as OAuthSoftError).kind).toBe("server");
    assertClean(error, logLines);
  });

  test("a timeout and an unusable 200 answer leak nothing", async () => {
    captureLogs();
    const timeout = await refreshFailure("microsoft", "timeout");
    assertClean(timeout, logLines);
    const odd = (() =>
      Promise.resolve(
        new Response(`<html>${DESCRIPTION_CANARY} ${RT_CANARY}</html>`, { status: 200 })
      )) as unknown as typeof fetch;
    const error = await caught(() => clientOf("google", { fetchFn: odd }).refresh(RT_CANARY, "mail"));
    assertClean(error, logLines);
  });

  test("the client secret leaves the process only in the token request body", async () => {
    captureLogs();
    const seen: string[] = [];
    const spy = ((url: string, init: RequestInit) => {
      seen.push(`${url} ${String(init.body)}`);
      return Promise.resolve(Response.json({ error: "invalid_grant" }, { status: 400 }));
    }) as unknown as typeof fetch;
    const client = clientOf("google", { fetchFn: spy });
    expect(client.authorizeUrl({ state: "s", codeChallenge: "c" })).not.toContain(fake.clientSecret);
    const error = await caught(() => client.redeemCode("code-1", verifier()));
    expect(seen[0]).toContain(`client_secret=${fake.clientSecret}`);
    expect(seen[0]).not.toContain(`${fake.clientSecret}?`);
    assertClean(error, logLines);
  });
});
