import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { sql } from "kysely";

import {
  configureFeatures,
  createOrganizationWithOwner,
  isPasswordSignInRefused,
  resolveSsoMember,
  setOrgFeature,
} from "../../src/modules/tenancy";
import { createAuth, RESET_REQUEST_ANSWER, type AuthHandle } from "../../src/platform/auth";
import { createLockoutStore } from "../../src/platform/auth-lockout";
import { setLogLevel } from "../../src/platform/log";
import { auditSsoEvent, auditWebEvent, termsAcceptedHandler } from "../../src/web";
import { startFakeOidc, type FakeOidc } from "../fake-oidc";
import { fakeOidcConfig, nextIp, ssoSignIn, SSO_TEST_ORIGIN } from "../sso-helpers";
import { secretOfUri, totpCode } from "../totp";

import { testDb } from "./helpers";
import { resetBody } from "./web-helpers";

// Stage 06 of F119: "SSO required" refuses member passwords and resets like a wrong password (ADR 0026 point 6).
// The flag `organizations.sso_required` is set by SQL here; the operator CLI comes later.
const db = testDb();

const PASSWORD = "correct-horse-battery-1";
const WRONG_PASSWORD = "wrong-horse-battery-1";

let fake: FakeOidc;
let handle: AuthHandle;

const resets: { userId: string; email: string }[] = [];
const lockoutMails: { userId: string; email: string }[] = [];
const captured: string[] = [];
const spies: ReturnType<typeof spyOn>[] = [];
// The e-mail addresses, passwords and TOTP secrets of every test: the capture test searches for them.
const secretsSeen = new Set<string>();
const orgIds: string[] = [];
const userIds: string[] = [];

let refusedThrows = false;
const passwordSignInRefused = async (userId: string): Promise<boolean> => {
  if (refusedThrows) throw new Error("refused_boom");
  return isPasswordSignInRefused(db, userId);
};

beforeAll(async () => {
  fake = await startFakeOidc();
  handle = createAuth({
    databaseUrl: process.env.DATABASE_URL ?? "",
    baseUrl: SSO_TEST_ORIGIN,
    secret: "x".repeat(40),
    // The fake IdP origin is trusted only here: a sign-in fetch refuses a loopback host otherwise. Production never lists it.
    trustedOrigins: [SSO_TEST_ORIGIN, fake.origin],
    onEvent: auditWebEvent(db),
    onTermsAccepted: termsAcceptedHandler(db, () => new Date()),
    resetLinkTtlSeconds: 86_400,
    sendResetPassword: async ({ userId, email, url }) => {
      resets.push({ userId, email });
      lastResetUrl = url;
    },
    lockout: createLockoutStore(db),
    sendLockoutMail: (input) => {
      lockoutMails.push(input);
    },
    passwordSignInRefused,
    resolveSsoMember: (identity) => resolveSsoMember(db, identity),
    onSsoEvent: auditSsoEvent(db),
  });
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    spies.push(
      spyOn(console, method).mockImplementation((...args: unknown[]): void => {
        captured.push(args.map(String).join(" "));
      })
    );
  }
});

let lastResetUrl = "";

afterEach(async () => {
  setLogLevel("info");
  refusedThrows = false;
  configureFeatures({ off: [] });
  resets.length = 0;
  lockoutMails.length = 0;
  if (userIds.length > 0) {
    await sql`DELETE FROM auth_verifications WHERE value IN (${sql.join(userIds)})`.execute(db);
  }
  for (const orgId of orgIds) await db.deleteFrom("organizations").where("id", "=", orgId).execute();
  if (userIds.length > 0) await db.deleteFrom("users").where("id", "in", userIds).execute();
  orgIds.length = 0;
  userIds.length = 0;
});

afterAll(async () => {
  for (const spy of spies) spy.mockRestore();
  fake.stop();
  await handle.close();
  await db.destroy();
});

// One browser: its cookies and a request helper against the real Better Auth handler.
class Client {
  readonly jar = new Map<string, string>();

  async call(
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>
  ): Promise<{ status: number; text: string; json: Record<string, unknown> | null; setCookie: string[] }> {
    const cookie = [...this.jar].map(([name, value]) => `${name}=${value}`).join("; ");
    const response = await handle.auth.handler(
      new Request(`${SSO_TEST_ORIGIN}/api/auth${path}`, {
        method,
        headers: {
          origin: SSO_TEST_ORIGIN,
          "x-client-ip": nextIp(),
          ...(body ? { "content-type": "application/json" } : {}),
          ...(cookie ? { cookie } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    );
    const setCookie = response.headers.getSetCookie();
    for (const line of setCookie) {
      const [pair = ""] = line.split(";");
      const at = pair.indexOf("=");
      const name = pair.slice(0, at).trim();
      const value = pair.slice(at + 1).trim();
      if (value === "" || /max-age=0/i.test(line)) this.jar.delete(name);
      else this.jar.set(name, value);
    }
    const text = await response.text();
    return {
      status: response.status,
      text,
      json: text ? (JSON.parse(text) as Record<string, unknown>) : null,
      setCookie,
    };
  }

  signIn(email: string, password = PASSWORD) {
    return this.call("POST", "/sign-in/email", { email, password });
  }
}

const signIn = (email: string, password = PASSWORD) => new Client().signIn(email, password);

const freshDomain = () => `d${randomUUID().replaceAll("-", "")}.x.test`;

interface Person {
  id: string;
  email: string;
}

interface Org {
  orgId: string;
  domain: string;
  owner: Person;
}

async function makeOrg(ownerLocal: string): Promise<Org> {
  const domain = freshDomain();
  const email = `${ownerLocal}@${domain}`;
  const { orgId, userId } = await createOrganizationWithOwner(db, {
    orgName: "Sso required org",
    timezone: "Europe/Warsaw",
    email,
    displayName: ownerLocal,
  });
  orgIds.push(orgId);
  userIds.push(userId);
  secretsSeen.add(email);
  return { orgId, domain, owner: { id: userId, email } };
}

// A member of every given organization (the first is the oldest) with a password. An org with `sso_required` already
// on refuses the reset request: call it before `setRequired`.
async function makeMember(
  local: string,
  domain: string,
  orgs: readonly string[],
  opts: { breakGlass?: boolean } = {}
): Promise<Person> {
  const email = `${local}@${domain}`;
  secretsSeen.add(email);
  const user = await db
    .insertInto("users")
    .values({ email, display_name: local })
    .returning("id")
    .executeTakeFirstOrThrow();
  userIds.push(user.id);
  for (const [index, orgId] of orgs.entries()) {
    await db
      .insertInto("memberships")
      .values({
        org_id: orgId,
        user_id: user.id,
        role: "owner",
        break_glass: index === 0 && opts.breakGlass === true,
        created_at: new Date(Date.UTC(2026, 0, 1 + index)),
      })
      .execute();
  }
  await setPassword(email);
  return { id: user.id, email };
}

async function setPassword(email: string): Promise<void> {
  resets.length = 0;
  await handle.auth.api.requestPasswordReset({ body: { email, redirectTo: `${SSO_TEST_ORIGIN}/setup` } });
  if (resets.length !== 1) throw new Error("no reset mail captured");
  const token = new URL(lastResetUrl).pathname.split("/").pop() ?? "";
  secretsSeen.add(token);
  await handle.auth.api.resetPassword({ body: resetBody(PASSWORD, token) });
  resets.length = 0;
}

// The owner of an organization gets a password too.
async function ownerWithPassword(org: Org): Promise<Person> {
  await setPassword(org.owner.email);
  return org.owner;
}

// Turn TOTP on for a user who can still sign in with the password. Returns the secret.
async function enrol(email: string): Promise<string> {
  const client = new Client();
  expect((await client.signIn(email)).status).toBe(200);
  const enabled = await client.call("POST", "/two-factor/enable", { password: PASSWORD });
  expect(enabled.status).toBe(200);
  const uri = String(enabled.json?.totpURI);
  const secret = secretOfUri(uri);
  secretsSeen.add(secret);
  secretsSeen.add(uri);
  for (const code of enabled.json?.backupCodes as string[]) secretsSeen.add(code);
  expect((await client.call("POST", "/two-factor/verify-totp", { code: totpCode(secret) })).status).toBe(200);
  return secret;
}

async function setRequired(orgId: string, on: boolean): Promise<void> {
  await db.updateTable("organizations").set({ sso_required: on }).where("id", "=", orgId).execute();
}

async function sessionCount(userId: string): Promise<number> {
  const result = await sql<{ n: string }>`SELECT count(*) AS n FROM auth_sessions WHERE user_id = ${userId}`.execute(
    db
  );
  return Number(result.rows[0]?.n);
}

async function lockoutRow(userId: string) {
  return db.selectFrom("auth_lockouts").selectAll().where("user_id", "=", userId).executeTakeFirst();
}

async function verificationCount(userId: string): Promise<number> {
  const result = await sql<{ n: string }>`SELECT count(*) AS n FROM auth_verifications WHERE value = ${userId}`.execute(
    db
  );
  return Number(result.rows[0]?.n);
}

const refusedLines = (from: number, event: string, userId: string): string[] =>
  captured.slice(from).filter((line) => line.includes(event) && line.includes(userId));

// The answer of Better Auth to a wrong password of a member of an org that does not require SSO.
const WRONG_ANSWER = { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" };

describe("SSO required refuses passwords", () => {
  test("1: a member with the right password gets the answer of a wrong password, no session, one log line", async () => {
    const a = await makeOrg("pia");
    const ann = await makeMember("ann", a.domain, [a.orgId]);
    await setRequired(a.orgId, true);
    const from = captured.length;
    const result = await signIn(ann.email);
    expect(result.status).toBe(401);
    expect(result.json).toEqual(WRONG_ANSWER);
    expect(result.setCookie).toEqual([]);
    expect(await sessionCount(ann.id)).toBe(0);
    expect(refusedLines(from, "password_sign_in_refused_sso", ann.id)).toHaveLength(1);
  });

  test("2: a wrong password of the same member gives the same status and body", async () => {
    const a = await makeOrg("pia");
    const ann = await makeMember("ann", a.domain, [a.orgId]);
    await setRequired(a.orgId, true);
    const right = await signIn(ann.email);
    const wrong = await signIn(ann.email, WRONG_PASSWORD);
    expect(wrong.status).toBe(401);
    expect(wrong.text).toBe(right.text);
    // An address that does not exist answers the same, too.
    const unknown = await signIn(`nobody-${randomUUID()}@${a.domain}`);
    expect(unknown.status).toBe(401);
    expect(unknown.text).toBe(right.text);
  });

  test("3: 12 refused tries make no lockout count and no lock mail; the 12th answer is still 401", async () => {
    const a = await makeOrg("pia");
    const ann = await makeMember("ann", a.domain, [a.orgId]);
    await setRequired(a.orgId, true);
    let last = 0;
    for (let i = 0; i < 12; i += 1) last = (await signIn(ann.email)).status;
    expect(last).toBe(401);
    expect(await lockoutRow(ann.id)).toBeUndefined();
    expect(lockoutMails).toEqual([]);
  });

  test("4: the break-glass owner with TOTP on: the password asks the code, the code opens a session", async () => {
    const a = await makeOrg("pia");
    const olaf = await makeMember("olaf", a.domain, [a.orgId], { breakGlass: true });
    const secret = await enrol(olaf.email);
    await setRequired(a.orgId, true);
    const client = new Client();
    const first = await client.signIn(olaf.email);
    expect(first.status).toBe(200);
    expect(first.json?.twoFactorRedirect).toBe(true);
    expect(await sessionCount(olaf.id)).toBe(1); // the one session of the enrolment; the sign-in made none
    const second = await client.call("POST", "/two-factor/verify-totp", { code: totpCode(secret) });
    expect(second.status).toBe(200);
    expect(await sessionCount(olaf.id)).toBe(2);
    expect(client.jar.has("ea.session_token")).toBe(true);
  });

  test("5: the break-glass owner with TOTP off is refused like a member", async () => {
    const a = await makeOrg("pia");
    const olaf = await makeMember("olaf", a.domain, [a.orgId], { breakGlass: true });
    await enrol(olaf.email);
    await db.updateTable("users").set({ two_factor_enabled: false }).where("id", "=", olaf.id).execute();
    await setRequired(a.orgId, true);
    const before = await sessionCount(olaf.id);
    const result = await signIn(olaf.email);
    expect(result.status).toBe(401);
    expect(result.json).toEqual(WRONG_ANSWER);
    expect(await sessionCount(olaf.id)).toBe(before);
  });

  test("6: an owner without the break-glass mark is refused, also with TOTP on", async () => {
    const a = await makeOrg("pia");
    const pia = await ownerWithPassword(a);
    await enrol(pia.email);
    await setRequired(a.orgId, true);
    const before = await sessionCount(pia.id);
    const result = await signIn(pia.email);
    expect(result.status).toBe(401);
    expect(result.json).toEqual(WRONG_ANSWER);
    expect(await sessionCount(pia.id)).toBe(before);
  });

  test("7: an organization with sso_required false: the member signs in with the password", async () => {
    const a = await makeOrg("pia");
    const ann = await makeMember("ann", a.domain, [a.orgId]);
    const result = await signIn(ann.email);
    expect(result.status).toBe(200);
    expect(result.json?.twoFactorRedirect).toBeUndefined();
    expect(await sessionCount(ann.id)).toBe(1);
  });

  test("8: a member of an organization without the rule signs in; a user of both organizations is refused", async () => {
    const a = await makeOrg("pia");
    const b = await makeOrg("bob");
    const cara = await makeMember("cara", b.domain, [b.orgId]);
    const dan = await makeMember("dan", a.domain, [a.orgId, b.orgId]);
    await setRequired(a.orgId, true);
    expect((await signIn(cara.email)).status).toBe(200);
    expect((await signIn(dan.email)).status).toBe(401);
    expect(await sessionCount(dan.id)).toBe(0);
    // The rule of B alone refuses Dan as well (any organization is enough), and A alone no longer does.
    await setRequired(a.orgId, false);
    expect((await signIn(dan.email)).status).toBe(200);
    await setRequired(b.orgId, true);
    expect((await signIn(dan.email)).status).toBe(401);
  });

  test("9: the flag sso_sign_in off does not reopen passwords", async () => {
    const a = await makeOrg("pia");
    const ann = await makeMember("ann", a.domain, [a.orgId]);
    await setOrgFeature(
      db,
      { orgId: a.orgId },
      { flag: "sso_sign_in", enabled: false, actor: "test", now: new Date() }
    );
    await setRequired(a.orgId, true);
    expect((await signIn(ann.email)).status).toBe(401);
    expect(await sessionCount(ann.id)).toBe(0);
  });

  test("10: a reset request of a refused member gets the generic answer, no mail, no token; the break-glass owner gets the flow", async () => {
    const a = await makeOrg("pia");
    const ann = await makeMember("ann", a.domain, [a.orgId]);
    const olaf = await makeMember("olaf", a.domain, [a.orgId], { breakGlass: true });
    await enrol(olaf.email);
    await setRequired(a.orgId, true);
    resets.length = 0;
    const from = captured.length;
    const refused = await new Client().call("POST", "/request-password-reset", {
      email: ann.email,
      redirectTo: `${SSO_TEST_ORIGIN}/setup`,
    });
    expect(refused.status).toBe(200);
    expect(refused.json).toEqual(RESET_REQUEST_ANSWER);
    expect(resets).toEqual([]);
    expect(await verificationCount(ann.id)).toBe(0);
    expect(refusedLines(from, "reset_request_refused_sso", ann.id)).toHaveLength(1);
    const open = await new Client().call("POST", "/request-password-reset", {
      email: olaf.email,
      redirectTo: `${SSO_TEST_ORIGIN}/setup`,
    });
    expect(open.status).toBe(200);
    expect(open.json).toEqual(RESET_REQUEST_ANSWER);
    expect(resets).toEqual([{ userId: olaf.id, email: olaf.email }]);
    expect(await verificationCount(olaf.id)).toBe(1);
  });

  test("11: a refused member still signs in by SSO", async () => {
    const a = await makeOrg("pia");
    const ann = await makeMember("ann", a.domain, [a.orgId]);
    await db
      .insertInto("sso_providers")
      .values({
        provider_id: a.orgId,
        org_id: a.orgId,
        issuer: fake.issuer,
        domain: a.domain,
        domain_verified: true,
        domain_proof: "dns",
        oidc_config: fakeOidcConfig(fake),
      })
      .execute();
    fake.registerRedirectUri(`${SSO_TEST_ORIGIN}/api/auth/sso/callback/${a.orgId}`);
    await setOrgFeature(db, { orgId: a.orgId }, { flag: "sso_sign_in", enabled: true, actor: "test", now: new Date() });
    await setRequired(a.orgId, true);
    expect((await signIn(ann.email)).status).toBe(401);
    fake.setUser({ sub: "s-ann", email: ann.email, emailVerified: true });
    const result = await ssoSignIn({ fetch: (req) => handle.auth.handler(req) }, fake, {
      email: ann.email,
      providerId: a.orgId,
    });
    expect(result.location).toBe("/app");
    expect(result.sessionCookie).not.toBeNull();
    expect(await sessionCount(ann.id)).toBe(1);
  });

  test("12: an error of the check fails the sign-in with 500 and makes no session", async () => {
    const a = await makeOrg("pia");
    const ann = await makeMember("ann", a.domain, [a.orgId]);
    refusedThrows = true;
    const result = await signIn(ann.email);
    expect(result.status).toBe(500);
    expect(result.setCookie).toEqual([]);
    expect(await sessionCount(ann.id)).toBe(0);
    // The reset request fails closed, too: no mail.
    const reset = await new Client().call("POST", "/request-password-reset", {
      email: ann.email,
      redirectTo: `${SSO_TEST_ORIGIN}/setup`,
    });
    expect(reset.status).toBe(500);
    expect(resets).toEqual([]);
  });

  test("13: no log line holds a password, a TOTP secret or an e-mail address", () => {
    const lines = captured.filter((line) => line.length > 0);
    expect(lines.some((line) => line.includes("password_sign_in_refused_sso"))).toBe(true);
    expect(secretsSeen.size).toBeGreaterThan(0);
    for (const line of lines) {
      for (const secret of [PASSWORD, WRONG_PASSWORD, ...secretsSeen]) expect(line).not.toContain(secret);
    }
  });
});
