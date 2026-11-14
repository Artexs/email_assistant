import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { sql } from "kysely";

import { createOrganizationWithOwner } from "../../src/modules/tenancy";
import { createAuth, type AuthHandle } from "../../src/platform/auth";
import type { SsoIdentity, SsoResolution } from "../../src/platform/auth-sso";
import { buildTrustedProxies, createApp, type WebDeps } from "../../src/platform/http";
import { createLog, setLogLevel } from "../../src/platform/log";
import { auditWebEvent, termsAcceptedHandler } from "../../src/web";
import { startFakeOidc, type FakeOidc } from "../fake-oidc";
import { fakeOidcConfig, nextIp, ssoSignIn, SSO_TEST_ORIGIN } from "../sso-helpers";

import { testDb } from "./helpers";
import { resetBody } from "./web-helpers";

const db = testDb();

const PASSWORD = "correct-horse-battery-staple";
const ERROR_URL = "/login?sso=failed";

let fake: FakeOidc;
const resets: { userId: string; url: string }[] = [];
const captured: string[] = [];
const orgIds: string[] = [];
const userIds: string[] = [];

// Every console method: our logger writes `info` to stdout and `warn` or `error` to stderr, and
// better-call writes a 500 by `console.error` outside our logger.
const spies: ReturnType<typeof spyOn>[] = [];

// What the resolver of the member handle answers (the stage 04 resolver does not exist yet).
const seen: SsoIdentity[] = [];
let resolveMode: "link" | "domain_mismatch" = "link";

const resolveMember = async (identity: SsoIdentity): Promise<SsoResolution> => {
  seen.push(identity);
  if (resolveMode === "domain_mismatch") return { kind: "reject", code: "domain_mismatch", orgId: null };
  const user = await db
    .selectFrom("users")
    .innerJoin("memberships", "memberships.user_id", "users.id")
    .select(["users.id as userId", "memberships.org_id as orgId"])
    .where("users.email", "=", identity.email)
    .executeTakeFirstOrThrow();
  return { kind: "link", userId: user.userId, orgId: user.orgId, firstLink: true };
};

function makeHandle(withResolver: boolean): AuthHandle {
  return createAuth({
    databaseUrl: process.env.DATABASE_URL ?? "",
    baseUrl: SSO_TEST_ORIGIN,
    secret: "x".repeat(40),
    // The fake IdP origin is trusted only here: a sign-in fetch refuses a loopback host otherwise. Production never lists it.
    trustedOrigins: [SSO_TEST_ORIGIN, fake.origin],
    onEvent: auditWebEvent(db),
    onTermsAccepted: termsAcceptedHandler(db, () => new Date()),
    resetLinkTtlSeconds: 86_400,
    sendResetPassword: async (input) => {
      resets.push(input);
    },
    ...(withResolver ? { resolveSsoMember: resolveMember } : {}),
  });
}

function appFor(handle: AuthHandle) {
  const web: WebDeps = {
    auth: { handler: (req) => handle.auth.handler(req), getSession: async () => null },
    db,
    now: () => new Date(),
    dist: "/nonexistent/dist",
    baseUrl: new URL(SSO_TEST_ORIGIN),
    trustedOrigins: new Set([SSO_TEST_ORIGIN]),
    trustedProxies: buildTrustedProxies([]),
    connInfo: (c) => c.req.header("x-client-ip"),
    listMembershipsOfUser: async () => [],
  };
  return createApp({ checkDb: async () => true, web });
}

let plain: AuthHandle;
let linking: AuthHandle;
let plainApp: ReturnType<typeof appFor>;
let linkingApp: ReturnType<typeof appFor>;

beforeAll(async () => {
  fake = await startFakeOidc();
  plain = makeHandle(false);
  linking = makeHandle(true);
  plainApp = appFor(plain);
  linkingApp = appFor(linking);
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    spies.push(
      spyOn(console, method).mockImplementation((...args: unknown[]): void => {
        captured.push(args.map(String).join(" "));
      })
    );
  }
});

afterEach(async () => {
  setLogLevel("info");
  resolveMode = "link";
  seen.length = 0;
  resets.length = 0;
  await sql`DELETE FROM auth_verifications WHERE value IN (${sql.join(userIds.length > 0 ? userIds : [""])})`.execute(
    db
  );
  for (const orgId of orgIds) await db.deleteFrom("organizations").where("id", "=", orgId).execute();
  if (userIds.length > 0) await db.deleteFrom("users").where("id", "in", userIds).execute();
  orgIds.length = 0;
  userIds.length = 0;
});

afterAll(async () => {
  for (const spy of spies) spy.mockRestore();
  fake.stop();
  await plain.close();
  await linking.close();
  await db.destroy();
});

// A domain that no committed row of another test file owns.
const freshDomain = () => `d${randomUUID().replaceAll("-", "")}.x.test`;

interface Setup {
  orgId: string;
  userId: string;
  domain: string;
  email: string;
}

// An organization with one member, and a provider row written by SQL (the operator CLI does it in a later stage).
async function memberWithProvider(opts: { proved: boolean; domain?: string; hostedDomain?: string }): Promise<Setup> {
  const domain = opts.domain ?? freshDomain();
  const email = `ann@${domain}`;
  const { orgId, userId } = await createOrganizationWithOwner(db, {
    orgName: "Sso plugin org",
    timezone: "Europe/Warsaw",
    email,
    displayName: "Ann",
  });
  orgIds.push(orgId);
  userIds.push(userId);
  await db
    .insertInto("sso_providers")
    .values({
      provider_id: orgId,
      org_id: orgId,
      issuer: fake.issuer,
      domain,
      domain_verified: opts.proved,
      domain_proof: opts.proved ? "dns" : null,
      oidc_config: fakeOidcConfig(fake),
    })
    .execute();
  fake.setUser({
    sub: `sub-${randomUUID()}`,
    email,
    emailVerified: true,
    ...(opts.hostedDomain ? { hd: opts.hostedDomain } : {}),
  });
  return { orgId, userId, domain, email };
}

async function count(table: "auth_accounts" | "auth_sessions", userId: string): Promise<number> {
  const result = await sql<{
    n: string;
  }>`SELECT count(*) AS n FROM ${sql.table(table)} WHERE user_id = ${userId}`.execute(db);
  return Number(result.rows[0]?.n);
}

async function sessionCookieOf(handle: AuthHandle, email: string): Promise<string> {
  const { userId } = await db
    .selectFrom("users")
    .select("id as userId")
    .where("email", "=", email)
    .executeTakeFirstOrThrow();
  resets.length = 0;
  await handle.auth.api.requestPasswordReset({ body: { email, redirectTo: `${SSO_TEST_ORIGIN}/setup` } });
  const mail = resets.find((entry) => entry.userId === userId);
  if (!mail) throw new Error("no reset mail captured");
  const token = new URL(mail.url).pathname.split("/").pop() ?? "";
  await handle.auth.api.resetPassword({ body: resetBody(PASSWORD, token) });
  const signed = await handle.auth.api.signInEmail({ body: { email, password: PASSWORD }, returnHeaders: true });
  const line = signed.headers.getSetCookie().find((entry) => entry.startsWith("ea.session_token="));
  if (!line) throw new Error("no session cookie");
  return line.split(";")[0] ?? "";
}

const post = (
  app: { fetch(req: Request): Response | Promise<Response> },
  path: string,
  body: unknown,
  cookie?: string
) =>
  app.fetch(
    new Request(`${SSO_TEST_ORIGIN}/api/auth${path}`, {
      method: "POST",
      headers: {
        origin: SSO_TEST_ORIGIN,
        "content-type": "application/json",
        "x-client-ip": nextIp(),
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    })
  );

const get = (app: { fetch(req: Request): Response | Promise<Response> }, path: string, cookie?: string) =>
  app.fetch(
    new Request(`${SSO_TEST_ORIGIN}/api/auth${path}`, {
      headers: { origin: SSO_TEST_ORIGIN, "x-client-ip": nextIp(), ...(cookie ? { cookie } : {}) },
    })
  );

describe("the SSO plugin surface", () => {
  test("2: every plugin path outside the two allowed ones answers 404, with and without a session", async () => {
    const setup = await memberWithProvider({ proved: true });
    const cookie = await sessionCookieOf(plain, setup.email);
    const closed = [
      "/sso/register",
      "/sso/providers",
      "/sso/get-provider",
      "/sso/update-provider",
      "/sso/delete-provider",
      "/sso/request-domain-verification",
      "/sso/verify-domain",
      "/sso/callback",
      "/sso/callback/a/b",
      "/sso/saml2/callback/x",
      "/sso/saml2/sp/metadata",
      "/sso/saml2/sp/acs/x",
    ];
    for (const path of closed) {
      for (const withCookie of [undefined, cookie]) {
        const asGet = await get(plainApp, path, withCookie);
        expect([path, withCookie !== undefined, asGet.status]).toEqual([path, withCookie !== undefined, 404]);
        const asPost = await post(plainApp, path, {}, withCookie);
        expect([path, withCookie !== undefined, asPost.status]).toEqual([path, withCookie !== undefined, 404]);
      }
    }
    // The two allowed paths are not 404 with the wrong method either way: GET /sign-in/sso stays closed.
    expect((await get(plainApp, "/sign-in/sso")).status).toBe(404);
  });

  test("3: a signed-in user cannot register a provider (no row)", async () => {
    const setup = await memberWithProvider({ proved: true });
    const cookie = await sessionCookieOf(plain, setup.email);
    const evilDomain = freshDomain();
    let status: number | undefined;
    try {
      await plain.auth.api.registerSSOProvider({
        body: {
          providerId: "evil",
          issuer: fake.issuer,
          domain: evilDomain,
          oidcConfig: {
            clientId: "c",
            clientSecret: "s",
            skipDiscovery: true,
            authorizationEndpoint: `${fake.issuer}/authorize`,
            tokenEndpoint: `${fake.issuer}/token`,
            jwksEndpoint: `${fake.issuer}/jwks`,
          },
        },
        headers: new Headers({ cookie, origin: SSO_TEST_ORIGIN }),
      });
    } catch (error) {
      status = (error as { statusCode?: number }).statusCode;
    }
    expect(status).toBe(403);
    const rows = await db.selectFrom("sso_providers").select("id").where("domain", "=", evilDomain).execute();
    expect(rows).toHaveLength(0);
    const evilById = await db.selectFrom("sso_providers").select("id").where("provider_id", "=", "evil").execute();
    expect(evilById).toHaveLength(0);
  });

  test("4: a proved provider and a member: the callback ends at the error URL with sso_off, no account, no session", async () => {
    const setup = await memberWithProvider({ proved: true });
    const result = await ssoSignIn(plainApp, fake, { email: setup.email });
    expect(result.stage).toBe("callback");
    expect(result.location).toBe(`${ERROR_URL}&error=sso_off`);
    expect(result.sessionCookie).toBeNull();
    expect(await count("auth_accounts", setup.userId)).toBe(0);
    expect(await count("auth_sessions", setup.userId)).toBe(0);
  });

  test("5: an unproved provider: the sign-in refuses and sends no one to the IdP", async () => {
    const setup = await memberWithProvider({ proved: false });
    const before = fake.requests.length;
    const result = await ssoSignIn(plainApp, fake, { email: setup.email });
    expect(result.stage).toBe("sign-in");
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.status).toBeLessThan(500);
    expect(fake.requests.length).toBe(before);
    expect(await count("auth_sessions", setup.userId)).toBe(0);
  });

  test("6: an e-mail with no provider: an error and no redirect", async () => {
    const result = await ssoSignIn(plainApp, fake, { email: `bob@${freshDomain()}` });
    expect(result.stage).toBe("sign-in");
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.status).toBeLessThan(500);
    expect(result.location).toBeNull();
    expect(result.sessionCookie).toBeNull();
  });

  test("7: the 11th sign-in start from one address in 60 s answers 429", async () => {
    const ip = nextIp();
    const start = () =>
      plainApp.fetch(
        new Request(`${SSO_TEST_ORIGIN}/api/auth/sign-in/sso`, {
          method: "POST",
          headers: { origin: SSO_TEST_ORIGIN, "content-type": "application/json", "x-client-ip": ip },
          body: JSON.stringify({ email: `nobody@${freshDomain()}` }),
        })
      );
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      expect((await start()).status).not.toBe(429);
    }
    expect((await start()).status).toBe(429);
  });

  test("8: the output of tests 4 to 7 holds no client secret, code, id_token or e-mail (stdout and stderr)", async () => {
    // The capture works: a line from each stream reaches it.
    const probe = createLog("sso_plugin_test");
    probe.info("capture_probe_stdout");
    probe.error("capture_probe_stderr");
    expect(captured.some((line) => line.includes("capture_probe_stdout"))).toBe(true);
    expect(captured.some((line) => line.includes("capture_probe_stderr"))).toBe(true);
    expect(fake.issuedCodes.length).toBeGreaterThan(0);
    expect(fake.requests.some((request) => request.startsWith("GET /authorize"))).toBe(true);
    const output = captured.join("\n");
    expect(output).not.toContain(fake.clientSecret);
    for (const code of fake.issuedCodes) expect(output).not.toContain(code);
    for (const token of fake.issuedIdTokens) expect(output).not.toContain(token);
    expect(output).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    expect(output).not.toMatch(/ann@/);
    expect(output).not.toMatch(/bob@/);
    expect(output).not.toMatch(/nobody@/);
  });

  test("9: a body key outside the allow-list answers 400, not 500, and writes no better_auth_error line", async () => {
    const from = captured.length;
    for (const extra of [
      { organizationSlug: "a" },
      { domain: "x.test" },
      { loginHint: "a@x.test" },
      { scopes: ["x"] },
    ]) {
      const response = await post(plainApp, "/sign-in/sso", { email: `a@${freshDomain()}`, ...extra });
      expect([Object.keys(extra)[0], response.status]).toEqual([Object.keys(extra)[0], 400]);
      expect(((await response.json()) as { code?: string }).code).toBe("BAD_BODY");
    }
    const lines = captured.slice(from).join("\n");
    expect(lines).not.toContain("better_auth_error");
    expect(lines).not.toContain("SERVER_ERROR");
  });

  test("10: a callback with an unknown state redirects to the error URL and logs oauth_state_failed", async () => {
    const setup = await memberWithProvider({ proved: true });
    const from = captured.length;
    const response = await get(plainApp, `/sso/callback/${setup.orgId}?code=${randomUUID()}&state=${randomUUID()}`);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`${ERROR_URL}&error=state_mismatch`);
    const lines = captured.slice(from).join("\n");
    expect(lines).toMatch(/better_auth_log .*reason=oauth_state_failed/);
    expect(lines).not.toContain("SERVER_ERROR");
  });
});

describe("the SSO callback with a resolver (stage 04 builds the real one)", () => {
  test("11: no IdP token is stored on the first link or on a later sign-in", async () => {
    const setup = await memberWithProvider({ proved: true });
    const first = await ssoSignIn(linkingApp, fake, { email: setup.email });
    expect(first.location).toBe("/app");
    expect(first.sessionCookie).not.toBeNull();
    const tokens = () =>
      db
        .selectFrom("auth_accounts")
        .select(["provider_id", "id_token", "access_token", "refresh_token"])
        .where("user_id", "=", setup.userId)
        .execute();
    expect(await tokens()).toEqual([
      { provider_id: setup.orgId, id_token: null, access_token: null, refresh_token: null },
    ]);
    const second = await ssoSignIn(linkingApp, fake, { email: setup.email });
    expect(second.location).toBe("/app");
    expect(await tokens()).toEqual([
      { provider_id: setup.orgId, id_token: null, access_token: null, refresh_token: null },
    ]);
    expect(await count("auth_accounts", setup.userId)).toBe(1);
  });

  test("12: the resolver gets the identity of the IdP, and a refusal code reaches the error URL", async () => {
    const setup = await memberWithProvider({ proved: true, hostedDomain: "x.test" });
    const sub = `sub-${randomUUID()}`;
    fake.setUser({ sub, email: setup.email, emailVerified: false, hd: "x.test" });
    resolveMode = "domain_mismatch";
    const refused = await ssoSignIn(linkingApp, fake, { email: setup.email });
    expect(refused.location).toBe(`${ERROR_URL}&error=domain_mismatch`);
    expect(refused.sessionCookie).toBeNull();
    expect(await count("auth_accounts", setup.userId)).toBe(0);
    expect(seen).toEqual([
      {
        providerId: setup.orgId,
        issuer: fake.issuer,
        subject: sub,
        email: setup.email,
        emailVerified: false,
        hostedDomain: "x.test",
      },
    ]);
  });

  test("13: requestSignUp does not make a user for an e-mail that is not a member", async () => {
    const setup = await memberWithProvider({ proved: true });
    const stranger = `zed@${setup.domain}`;
    fake.setUser({ sub: `sub-${randomUUID()}`, email: stranger, emailVerified: true });
    const result = await ssoSignIn(plainApp, fake, { email: stranger, requestSignUp: true });
    expect(result.sessionCookie).toBeNull();
    expect(result.location).toBe(`${ERROR_URL}&error=sso_off`);
    const rows = await db.selectFrom("users").select("id").where("email", "=", stranger).execute();
    expect(rows).toHaveLength(0);
  });
});
