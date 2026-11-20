import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TERMS_VERSION, HOUR_MS, DAY_MS, MINUTE_MS } from "@ea/core";
import { hashPassword } from "better-auth/crypto";
import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { sql } from "kysely";

import { configureFeatures, createOrganizationWithOwner, setOrgFeature } from "../../src/modules/tenancy";
import { loadConfig } from "../../src/platform/config";
import { createSecretBox } from "../../src/platform/crypto";
import { createApp } from "../../src/platform/http";
import { setLogLevel } from "../../src/platform/log";
import { webDeps } from "../../src/web";
import { startFakeOidc, type FakeOidc } from "../fake-oidc";
import { fakeOidcConfig, nextIp, SESSION_COOKIE, ssoSignIn, SSO_TEST_ORIGIN } from "../sso-helpers";
import { secretOfUri, totpCode } from "../totp";

import { testDb } from "./helpers";

// The SSO session is marked, ends 12 h after the IdP sign-in, and an operator needs a password session.
// The app is the production wiring (`webDeps`), so `getSession` reads the real Better Auth session.
const db = testDb();

const PASSWORD = "correct-horse-battery-staple";
const NEW_PASSWORD = "another-long-passphrase-42";
const SSO_MS = 12 * HOUR_MS;

type App = ReturnType<typeof createApp>;

let fake: FakeOidc;
let dist = "";
const closers: (() => Promise<void>)[] = [];
const orgIds: string[] = [];
const userIds: string[] = [];
const warnLines: string[] = [];
const spies: ReturnType<typeof spyOn>[] = [];

beforeAll(async () => {
  fake = await startFakeOidc();
  dist = mkdtempSync(join(tmpdir(), "ea-sso-session-dist-"));
  writeFileSync(join(dist, "404.html"), "not found page");
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    spies.push(
      spyOn(console, method).mockImplementation((...args: unknown[]): void => {
        warnLines.push(args.map(String).join(" "));
      })
    );
  }
});

afterEach(async () => {
  setLogLevel("info");
  configureFeatures({ off: [] });
  for (const close of closers.splice(0)) await close();
  for (const orgId of orgIds) await db.deleteFrom("organizations").where("id", "=", orgId).execute();
  if (userIds.length > 0) await db.deleteFrom("users").where("id", "in", userIds).execute();
  orgIds.length = 0;
  userIds.length = 0;
  warnLines.length = 0;
});

afterAll(async () => {
  for (const spy of spies) spy.mockRestore();
  fake.stop();
  rmSync(dist, { recursive: true, force: true });
  await db.destroy();
});

// The production web wiring (only the peer address comes from a header); the fake IdP origin is trusted only here (a sign-in fetch refuses a loopback host otherwise).
function openApp(operatorIds: readonly string[] = []): App {
  const web = webDeps(
    loadConfig({
      ...process.env,
      WEB_BASE_URL: SSO_TEST_ORIGIN,
      WEB_AUTH_SECRET: "x".repeat(40),
      WEB_DIST: dist,
      WEB_TRUSTED_ORIGINS: fake.origin,
      OPERATOR_USER_IDS: operatorIds.join(","),
      AUTH_PWNED_CHECK: "off",
    }),
    db,
    {
      secrets: createSecretBox(randomBytes(32).toString("base64"), 1),
      actionsScope: { kind: "off" },
      sendScope: { kind: "off" },
      botUsername: null,
    }
  );
  if (web === null) throw new Error("webDeps returned null");
  closers.push(() => web.close());
  // The test sends a fresh address with each request, so the sign-in rate limit of Better Auth never answers.
  return createApp({ checkDb: async () => true, web: { ...web, connInfo: (c) => c.req.header("x-client-ip") } });
}

// One browser: it keeps the cookies of the answers.
class Browser {
  readonly jar = new Map<string, string>();

  constructor(private readonly app: App) {}

  async call(method: "GET" | "POST", path: string, body?: Record<string, unknown>) {
    const cookie = [...this.jar].map(([name, value]) => `${name}=${value}`).join("; ");
    const response = await this.app.request(path, {
      method,
      headers: {
        origin: SSO_TEST_ORIGIN,
        "x-client-ip": nextIp(),
        ...(body ? { "content-type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    for (const line of response.headers.getSetCookie()) {
      const [pair = "", ...attributes] = line.split(";");
      const at = pair.indexOf("=");
      const name = pair.slice(0, at).trim();
      const value = pair.slice(at + 1).trim();
      const gone = attributes.some((attribute) => attribute.trim().toLowerCase() === "max-age=0") || value === "";
      if (gone) this.jar.delete(name);
      else this.jar.set(name, value);
    }
    const text = await response.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      json = null;
    }
    return { status: response.status, json, text };
  }

  get(path: string) {
    return this.call("GET", path);
  }

  post(path: string, body: Record<string, unknown>) {
    return this.call("POST", path, body);
  }

  signInWithPassword(email: string, password = PASSWORD) {
    return this.post("/api/auth/sign-in/email", { email, password });
  }

  // The IdP signs in the user and the callback of the provider sets the session cookie.
  async signInWithSso(org: SsoOrg, email: string): Promise<void> {
    fake.setUser({ sub: `sub-${email}`, email, emailVerified: true });
    const result = await ssoSignIn(this.app, fake, { email, providerId: org.orgId });
    expect(result.location).toBe("/app");
    if (result.sessionCookie === null) throw new Error("the SSO callback set no session cookie");
    this.jar.set(SESSION_COOKIE, result.sessionCookie);
  }

  // Turns TOTP on for the signed-in user (a session with a password); returns the secret.
  async enrolTotp(): Promise<string> {
    const enabled = await this.post("/api/auth/two-factor/enable", { password: PASSWORD });
    expect(enabled.status).toBe(200);
    const secret = secretOfUri(String(enabled.json?.totpURI));
    expect((await this.post("/api/auth/two-factor/verify-totp", { code: totpCode(secret) })).status).toBe(200);
    return secret;
  }
}

interface SsoOrg {
  orgId: string;
  domain: string;
  email: string;
  userId: string;
}

// An organization with an owner who has a password, a proved provider row at the fake IdP and the flag `sso_sign_in`.
async function ssoOrg(name: string): Promise<SsoOrg> {
  const domain = `d${randomUUID().replaceAll("-", "")}.x.test`;
  const email = `${name}@${domain}`;
  const { orgId, userId } = await createOrganizationWithOwner(db, {
    orgName: "Sso session org",
    timezone: "Europe/Warsaw",
    email,
    displayName: name,
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
      domain_verified: true,
      domain_proof: "dns",
      oidc_config: fakeOidcConfig(fake),
    })
    .execute();
  fake.registerRedirectUri(`${SSO_TEST_ORIGIN}/api/auth/sso/callback/${orgId}`);
  await setOrgFeature(db, { orgId }, { flag: "sso_sign_in", enabled: true, actor: "test", now: new Date() });
  await db
    .insertInto("auth_accounts")
    .values({
      account_id: userId,
      provider_id: "credential",
      user_id: userId,
      password: await hashPassword(PASSWORD),
      access_token: null,
      access_token_expires_at: null,
      id_token: null,
      refresh_token: null,
      refresh_token_expires_at: null,
      scope: null,
    })
    .execute();
  return { orgId, domain, email, userId };
}

interface SessionRow {
  id: string;
  method: string;
  started: Date | null;
  expires: Date;
  created: Date;
}

async function sessionsOf(userId: string): Promise<SessionRow[]> {
  const result = await sql<{
    id: string;
    method: string;
    started: Date | null;
    expires: Date;
    created: Date;
  }>`SELECT id, sign_in_method AS method, sso_started_at AS started, expires_at AS expires, created_at AS created
    FROM auth_sessions WHERE user_id = ${userId}::uuid ORDER BY created_at, id`.execute(db);
  return result.rows;
}

async function onlySession(userId: string): Promise<SessionRow> {
  const rows = await sessionsOf(userId);
  expect(rows).toHaveLength(1);
  const [row] = rows;
  if (!row) throw new Error("no session row");
  return row;
}

async function moveStart(userId: string, interval: string): Promise<void> {
  await sql`UPDATE auth_sessions SET sso_started_at = now() - ${interval}::interval, updated_at = now() - interval '3 hours'
    WHERE user_id = ${userId}::uuid`.execute(db);
}

async function countAudit(orgId: string, event: string): Promise<number> {
  const result = await sql<{ n: string }>`
    SELECT count(*) AS n FROM audit_log WHERE org_id = ${orgId}::uuid AND event = ${event}`.execute(db);
  return Number(result.rows[0]?.n);
}

const within = (a: Date, b: Date, ms: number): boolean => Math.abs(a.getTime() - b.getTime()) <= ms;

// An SSO session that started `interval` ago, for a user who has a password (and TOTP when `totp`).
async function ssoSessionOf(name: string, interval: string, totp = false) {
  const org = await ssoOrg(name);
  const app = openApp();
  let secret = "";
  if (totp) {
    const first = new Browser(app);
    expect((await first.signInWithPassword(org.email)).status).toBe(200);
    secret = await first.enrolTotp();
    await sql`DELETE FROM auth_sessions WHERE user_id = ${org.userId}::uuid`.execute(db);
  }
  const browser = new Browser(app);
  await browser.signInWithSso(org, org.email);
  await moveStart(org.userId, interval);
  const [old] = await sessionsOf(org.userId);
  if (!old?.started) throw new Error("the SSO session has no start");
  return { org, browser, app, old, started: old.started, secret };
}

// Every session row of the user is an SSO session with the start of `started`; at least one is not the old session.
async function expectInherited(userId: string, started: Date, oldId: string): Promise<void> {
  const rows = await sessionsOf(userId);
  expect(rows.some((row) => row.id !== oldId)).toBe(true);
  for (const row of rows) {
    expect(row.method).toBe("sso");
    expect(row.started?.getTime()).toBe(started.getTime());
    expect(row.expires.getTime()).toBe(started.getTime() + SSO_MS);
  }
}

describe("the SSO session", () => {
  test("1: an SSO sign-in marks the session and ends it 12 h after the IdP sign-in", async () => {
    const org = await ssoOrg("ann");
    const browser = new Browser(openApp());
    await browser.signInWithSso(org, org.email);
    const row = await onlySession(org.userId);
    expect(row.method).toBe("sso");
    expect(row.started).not.toBeNull();
    if (!row.started) return;
    expect(within(row.started, new Date(), 10_000)).toBe(true);
    expect(within(row.expires, new Date(row.started.getTime() + SSO_MS), 5_000)).toBe(true);
  });

  test("2: a password sign-in is a password session of 30 days", async () => {
    const org = await ssoOrg("ann");
    const browser = new Browser(openApp());
    expect((await browser.signInWithPassword(org.email)).status).toBe(200);
    const row = await onlySession(org.userId);
    expect(row.method).toBe("password");
    expect(row.started).toBeNull();
    expect(within(row.expires, new Date(Date.now() + 30 * DAY_MS), MINUTE_MS)).toBe(true);
  });

  test("3: a refresh keeps the end at sso_started_at + 12 h, not 30 days", async () => {
    const { org, browser, old, started } = await ssoSessionOf("ann", "2 hours");
    expect(old.expires.getTime()).toBe(started.getTime() + SSO_MS);
    const answer = await browser.get("/api/auth/get-session");
    expect(answer.status).toBe(200);
    expect(answer.json).not.toBeNull();
    const row = await onlySession(org.userId);
    // Better Auth wrote the refresh (updated_at was moved 3 h back), and the trigger kept the cap.
    expect(Date.now() - (await updatedAt(org.userId)).getTime()).toBeLessThan(MINUTE_MS);
    expect(row.method).toBe("sso");
    expect(row.expires.getTime()).toBe(started.getTime() + SSO_MS);
  });

  test("4: the API answers up to 12 h after the IdP sign-in and 401 after it", async () => {
    const inside = await ssoSessionOf("ann", "11 hours 59 minutes");
    expect((await inside.browser.get("/api/me")).status).toBe(200);
    const outside = await ssoSessionOf("bob", "12 hours 1 minute");
    expect((await outside.browser.get("/api/me")).status).toBe(401);
  });

  test("5a: TOTP turn-on from an SSO session makes an SSO session with the same start and end", async () => {
    const { org, browser, old, started } = await ssoSessionOf("ann", "2 hours");
    await browser.enrolTotp();
    await expectInherited(org.userId, started, old.id);
  });

  test("5b: a password change with revokeOtherSessions makes an SSO session with the same start and end", async () => {
    const { org, browser, old, started } = await ssoSessionOf("ann", "2 hours");
    const changed = await browser.post("/api/auth/change-password", {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
      revokeOtherSessions: true,
      termsVersion: TERMS_VERSION,
    });
    expect(changed.status).toBe(200);
    await expectInherited(org.userId, started, old.id);
  });

  test("5c: TOTP turn-off from an SSO session makes an SSO session with the same start and end", async () => {
    const { org, browser, old, started, secret } = await ssoSessionOf("ann", "2 hours", true);
    const off = await browser.post("/api/auth/two-factor/disable", { password: PASSWORD, code: totpCode(secret) });
    expect(off.status).toBe(200);
    await expectInherited(org.userId, started, old.id);
  });

  // An SSO session skips the code step at sign-in, but turning TOTP off asks it for a code like any session.
  test("5d: an SSO session of a user with TOTP on needs a code to turn it off", async () => {
    const { org, browser, secret } = await ssoSessionOf("ann", "2 hours", true);
    const refused = await browser.post("/api/auth/two-factor/disable", { password: PASSWORD });
    expect(refused.status).toBe(400);
    expect(refused.json?.code).toBe("TWO_FACTOR_CODE_REQUIRED");
    const flag = await sql<{ two_factor_enabled: boolean }>`
      SELECT two_factor_enabled FROM users WHERE id = ${org.userId}::uuid`.execute(db);
    expect(flag.rows[0]?.two_factor_enabled).toBe(true);
    const rows = await sql<{ data: Record<string, unknown> }>`
      SELECT data FROM audit_log WHERE org_id = ${org.orgId}::uuid AND event = 'web.two_factor_refused'`.execute(db);
    expect(rows.rows.map((row) => row.data)).toEqual([{ via: "web", action: "disable", reason: "missing" }]);

    const off = await browser.post("/api/auth/two-factor/disable", { password: PASSWORD, code: totpCode(secret) });
    expect(off.status).toBe(200);
    const after = await sql<{ two_factor_enabled: boolean }>`
      SELECT two_factor_enabled FROM users WHERE id = ${org.userId}::uuid`.execute(db);
    expect(after.rows[0]?.two_factor_enabled).toBe(false);
  });

  test("6: a password session of 13 h is still valid", async () => {
    const org = await ssoOrg("ann");
    const browser = new Browser(openApp());
    expect((await browser.signInWithPassword(org.email)).status).toBe(200);
    await sql`UPDATE auth_sessions SET created_at = now() - interval '13 hours' WHERE user_id = ${org.userId}::uuid`.execute(
      db
    );
    expect((await browser.get("/api/me")).status).toBe(200);
  });

  describe("the operator console", () => {
    // Olga: operator, member of the organization, a password and TOTP on; her SSO session is a second browser.
    async function olga() {
      const org = await ssoOrg("olga");
      const app = openApp([org.userId]);
      const passwordBrowser = new Browser(app);
      expect((await passwordBrowser.signInWithPassword(org.email)).status).toBe(200);
      const secret = await passwordBrowser.enrolTotp();
      const ssoBrowser = new Browser(app);
      await ssoBrowser.signInWithSso(org, org.email);
      return { org, app, secret, ssoBrowser };
    }

    const refusals = (userId: string): number =>
      warnLines.filter((line) => line.includes("operator_sso_session_refused") && line.includes(`user_id=${userId}`))
        .length;

    test("7: an operator with an SSO session gets 403 password_sign_in_required and the 404 page", async () => {
      const { org, ssoBrowser } = await olga();
      expect((await sessionsOf(org.userId)).some((row) => row.method === "sso")).toBe(true);
      const api = await ssoBrowser.get("/api/operator/orgs");
      expect(api.status).toBe(403);
      expect(api.json).toEqual({ error: "password_sign_in_required" });
      expect(refusals(org.userId)).toBe(1);
      const page = await ssoBrowser.get("/operator");
      expect(page.status).toBe(404);
      expect(page.text).toBe("not found page");
      expect(refusals(org.userId)).toBe(2);
    });

    test("8: the same operator with a password and a TOTP code gets the console", async () => {
      const { org, app, secret } = await olga();
      const browser = new Browser(app);
      const first = await browser.signInWithPassword(org.email);
      expect(first.json?.twoFactorRedirect).toBe(true);
      expect((await browser.post("/api/auth/two-factor/verify-totp", { code: totpCode(secret) })).status).toBe(200);
      expect((await browser.get("/api/operator/orgs")).status).toBe(200);
      expect(refusals(org.userId)).toBe(0);
    });

    test("9: a user who is not an operator gets 404 first, also with an SSO session", async () => {
      const org = await ssoOrg("ann");
      const browser = new Browser(openApp());
      await browser.signInWithSso(org, org.email);
      expect((await browser.get("/api/operator/orgs")).status).toBe(404);
      expect(refusals(org.userId)).toBe(0);
    });
  });

  test("11: the shared callback without a provider id stays closed: 404 and no session", async () => {
    const org = await ssoOrg("ann");
    const browser = new Browser(openApp());
    for (const path of ["/api/auth/sso/callback", "/api/auth/sso/callback?code=x&state=y"]) {
      expect((await browser.get(path)).status).toBe(404);
    }
    expect(await sessionsOf(org.userId)).toHaveLength(0);
    expect(browser.jar.size).toBe(0);
  });

  test("10: a user with TOTP on signs in by SSO without a code: one session, one sso.login, no web.login", async () => {
    const org = await ssoOrg("ann");
    const app = openApp();
    const first = new Browser(app);
    expect((await first.signInWithPassword(org.email)).status).toBe(200);
    await first.enrolTotp();
    await sql`DELETE FROM auth_sessions WHERE user_id = ${org.userId}::uuid`.execute(db);
    const loginsBefore = await countAudit(org.orgId, "web.login");
    const browser = new Browser(app);
    await browser.signInWithSso(org, org.email);
    const row = await onlySession(org.userId);
    expect(row.method).toBe("sso");
    expect((await browser.get("/api/me")).status).toBe(200);
    expect(await countAudit(org.orgId, "web.login")).toBe(loginsBefore);
    expect(await countAudit(org.orgId, "sso.login")).toBe(1);
  });
});

async function updatedAt(userId: string): Promise<Date> {
  const result = await sql<{ updated_at: Date }>`
    SELECT updated_at FROM auth_sessions WHERE user_id = ${userId}::uuid`.execute(db);
  const row = result.rows[0];
  if (!row) throw new Error("no session row");
  return row.updated_at;
}
