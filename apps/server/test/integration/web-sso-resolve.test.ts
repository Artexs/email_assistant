import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { sql } from "kysely";

import {
  configureFeatures,
  createOrganizationWithOwner,
  resolveSsoMember,
  setOrgFeature,
} from "../../src/modules/tenancy";
import { createAuth, type AuthHandle } from "../../src/platform/auth";
import type { SsoIdentity, SsoResolution } from "../../src/platform/auth-sso";
import { buildTrustedProxies, createApp, type WebDeps } from "../../src/platform/http";
import { setLogLevel } from "../../src/platform/log";
import { auditSsoEvent, auditWebEvent, termsAcceptedHandler } from "../../src/web";
import { startFakeOidc, type FakeOidc } from "../fake-oidc";
import { fakeOidcConfig, ssoSignIn, SSO_TEST_ORIGIN } from "../sso-helpers";

import { testDb } from "./helpers";

// Who may sign in through the provider of an organization, and the SSO audit rows.
const db = testDb();

const ERROR_URL = "/login?sso=failed";

let fake: FakeOidc;
let handle: AuthHandle;
let app: ReturnType<typeof appFor>;

const captured: string[] = [];
const spies: ReturnType<typeof spyOn>[] = [];
// The `data` of every sso.* audit row of every test (the organizations are deleted after each test).
const auditSeen: string[] = [];
// The e-mail addresses that the tests used: the capture test searches for them.
const addressesSeen = new Set<string>();
const orgIds: string[] = [];
const userIds: string[] = [];

let throwNext = false;
const resolveMember = async (identity: SsoIdentity): Promise<SsoResolution> => {
  if (throwNext) throw new Error("resolver_boom");
  return resolveSsoMember(db, identity);
};

function appFor(auth: AuthHandle) {
  const web: WebDeps = {
    auth: { handler: (req) => auth.auth.handler(req), getSession: async () => null },
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
    resolveSsoMember: resolveMember,
    onSsoEvent: auditSsoEvent(db),
  });
  app = appFor(handle);
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
  throwNext = false;
  configureFeatures({ off: [] });
  for (const orgId of orgIds) {
    const rows = await db
      .selectFrom("audit_log")
      .select("data")
      .where("org_id", "=", orgId)
      .where("event", "like", "sso.%")
      .execute();
    for (const row of rows) auditSeen.push(JSON.stringify(row.data));
    await db.deleteFrom("organizations").where("id", "=", orgId).execute();
  }
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

// A domain that no committed row of another test file owns; the address still ends in `x.test`.
const freshDomain = () => `d${randomUUID().replaceAll("-", "")}.x.test`;

interface Org {
  orgId: string;
  domain: string;
  ownerId: string;
}

// An organization with an owner `<owner>@<domain>`, a proved provider row (written by SQL) and the flag `sso_sign_in`.
async function orgWithProvider(opts: {
  owner: string;
  flag?: boolean;
  issuer?: string;
  domain?: string;
}): Promise<Org> {
  const domain = opts.domain ?? freshDomain();
  const email = `${opts.owner}@${domain}`;
  addressesSeen.add(email);
  const { orgId, userId } = await createOrganizationWithOwner(db, {
    orgName: "Sso resolve org",
    timezone: "Europe/Warsaw",
    email,
    displayName: opts.owner,
  });
  orgIds.push(orgId);
  userIds.push(userId);
  await db
    .insertInto("sso_providers")
    .values({
      provider_id: orgId,
      org_id: orgId,
      issuer: opts.issuer ?? fake.issuer,
      domain,
      domain_verified: true,
      domain_proof: "dns",
      oidc_config: fakeOidcConfig(fake),
    })
    .execute();
  fake.registerRedirectUri(`${SSO_TEST_ORIGIN}/api/auth/sso/callback/${orgId}`);
  if (opts.flag !== false) {
    await setOrgFeature(db, { orgId }, { flag: "sso_sign_in", enabled: true, actor: "test", now: new Date() });
  }
  return { orgId, domain, ownerId: userId };
}

// A user with one membership per entry, in the order given: the first entry is the oldest (explicit `created_at`).
async function userIn(email: string, orgs: readonly string[]): Promise<string> {
  addressesSeen.add(email);
  const user = await db
    .insertInto("users")
    .values({ email, display_name: email.split("@")[0] ?? "user" })
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
        created_at: new Date(Date.UTC(2026, 0, 1 + index)),
      })
      .execute();
  }
  return user.id;
}

interface IdpUser {
  sub: string;
  email: string;
  emailVerified?: boolean;
  hd?: string;
  requestSignUp?: boolean;
}

// The IdP signs in `user` and the browser goes through our callback of the provider of `org`.
async function signInTo(org: { orgId: string }, user: IdpUser) {
  addressesSeen.add(user.email.toLowerCase());
  fake.setUser({
    sub: user.sub,
    email: user.email,
    emailVerified: user.emailVerified ?? true,
    ...(user.hd === undefined ? {} : { hd: user.hd }),
  });
  return ssoSignIn(app, fake, {
    email: user.email,
    providerId: org.orgId,
    ...(user.requestSignUp === undefined ? {} : { requestSignUp: user.requestSignUp }),
  });
}

async function auditRows(orgId: string, event: string) {
  return db
    .selectFrom("audit_log")
    .select(["actor", "data", "reason_code"])
    .where("org_id", "=", orgId)
    .where("event", "=", event)
    .orderBy("created_at")
    .orderBy("id")
    .execute();
}

async function accountsOf(orgId: string) {
  return db
    .selectFrom("auth_accounts")
    .select(["id", "user_id", "account_id", "id_token", "access_token", "refresh_token"])
    .where("provider_id", "=", orgId)
    .execute();
}

async function sessionsOf(userId: string): Promise<number> {
  const result = await sql<{ n: string }>`SELECT count(*) AS n FROM auth_sessions WHERE user_id = ${userId}`.execute(
    db
  );
  return Number(result.rows[0]?.n);
}

async function userCount(email: string): Promise<number> {
  const rows = await db.selectFrom("users").select("id").where("email", "=", email).execute();
  return rows.length;
}

const flat = (data: unknown): boolean =>
  typeof data === "object" &&
  data !== null &&
  Object.values(data).every((value) => value === null || typeof value !== "object");

const identityOf = (org: Org, over: Partial<SsoIdentity>): SsoIdentity => ({
  providerId: org.orgId,
  issuer: fake.issuer,
  subject: "s-any",
  email: `ann@${org.domain}`,
  emailVerified: true,
  hostedDomain: null,
  ...over,
});

describe("SSO member resolution and audit rows", () => {
  test("1: a member signs in: a session, one account with no tokens, one sso.login (first_link true, actor the user)", async () => {
    const a = await orgWithProvider({ owner: "ann" });
    const result = await signInTo(a, { sub: "s-ann", email: `ann@${a.domain}` });
    expect(result.location).toBe("/app");
    expect(result.sessionCookie).not.toBeNull();
    expect(await sessionsOf(a.ownerId)).toBe(1);
    expect(await accountsOf(a.orgId)).toEqual([
      expect.objectContaining({
        user_id: a.ownerId,
        account_id: "s-ann",
        id_token: null,
        access_token: null,
        refresh_token: null,
      }),
    ]);
    const logins = await auditRows(a.orgId, "sso.login");
    expect(logins).toHaveLength(1);
    expect(logins[0]?.actor).toBe(a.ownerId);
    expect(logins[0]?.data).toEqual({ provider_id: a.orgId, first_link: true });
    expect(flat(logins[0]?.data)).toBe(true);
    expect(await auditRows(a.orgId, "sso.refused")).toHaveLength(0);
  });

  test("2: the same member signs in again: the same account row, sso.login with first_link false", async () => {
    const a = await orgWithProvider({ owner: "ann" });
    await signInTo(a, { sub: "s-ann", email: `ann@${a.domain}` });
    const before = await accountsOf(a.orgId);
    const again = await signInTo(a, { sub: "s-ann", email: `ann@${a.domain}` });
    expect(again.sessionCookie).not.toBeNull();
    const after = await accountsOf(a.orgId);
    expect(after).toHaveLength(1);
    expect(after[0]?.id).toBe(before[0]?.id);
    const logins = await auditRows(a.orgId, "sso.login");
    expect(logins.map((row) => row.data)).toEqual([
      { provider_id: a.orgId, first_link: true },
      { provider_id: a.orgId, first_link: false },
    ]);
  });

  test("3: the IdP changes the e-mail of the member (same sub): the link and the sign-in work", async () => {
    const a = await orgWithProvider({ owner: "ann" });
    await signInTo(a, { sub: "s-ann", email: `ann@${a.domain}` });
    const changed = await signInTo(a, { sub: "s-ann", email: `ann.new@${a.domain}` });
    expect(changed.location).toBe("/app");
    expect(changed.sessionCookie).not.toBeNull();
    expect(await accountsOf(a.orgId)).toHaveLength(1);
    expect(await userCount(`ann.new@${a.domain}`)).toBe(0);
    expect(await sessionsOf(a.ownerId)).toBe(2);
  });

  test("4: a person who is no user: no user, no account, no session; not_a_member and one sso.refused (actor system)", async () => {
    const a = await orgWithProvider({ owner: "ann" });
    const zed = `zed@${a.domain}`;
    const result = await signInTo(a, { sub: "s-zed", email: zed });
    expect(result.location).toBe(`${ERROR_URL}&error=not_a_member`);
    expect(result.sessionCookie).toBeNull();
    expect(await userCount(zed)).toBe(0);
    expect(await accountsOf(a.orgId)).toHaveLength(0);
    const refused = await auditRows(a.orgId, "sso.refused");
    expect(refused).toHaveLength(1);
    expect(refused[0]?.actor).toBe("system");
    expect(refused[0]?.data).toEqual({ provider_id: a.orgId, code: "not_a_member" });
    expect(await auditRows(a.orgId, "sso.login")).toHaveLength(0);
  });

  test("5: the same with requestSignUp true: the resolver never answers continue, so no user is made", async () => {
    const a = await orgWithProvider({ owner: "ann" });
    const zed = `zed@${a.domain}`;
    const result = await signInTo(a, { sub: "s-zed", email: zed, requestSignUp: true });
    expect(result.location).toBe(`${ERROR_URL}&error=not_a_member`);
    expect(result.sessionCookie).toBeNull();
    expect(await userCount(zed)).toBe(0);
    expect(await accountsOf(a.orgId)).toHaveLength(0);
    expect((await auditRows(a.orgId, "sso.refused")).map((row) => row.data)).toEqual([
      { provider_id: a.orgId, code: "not_a_member" },
    ]);
  });

  test("6: another domain, a subdomain and an unverified e-mail are refused", async () => {
    const a = await orgWithProvider({ owner: "ann" });
    await userIn("bob@y.test", [a.orgId]);
    await userIn(`bob@sub.${a.domain}`, [a.orgId]);
    const other = await signInTo(a, { sub: "s-bob", email: "bob@y.test" });
    expect(other.location).toBe(`${ERROR_URL}&error=domain_mismatch`);
    const sub = await signInTo(a, { sub: "s-bob-2", email: `bob@sub.${a.domain}` });
    expect(sub.location).toBe(`${ERROR_URL}&error=domain_mismatch`);
    const unverified = await signInTo(a, { sub: "s-ann", email: `ann@${a.domain}`, emailVerified: false });
    expect(unverified.location).toBe(`${ERROR_URL}&error=email_unverified`);
    for (const result of [other, sub, unverified]) expect(result.sessionCookie).toBeNull();
    expect(await accountsOf(a.orgId)).toHaveLength(0);
    expect((await auditRows(a.orgId, "sso.refused")).map((row) => row.data)).toEqual([
      { provider_id: a.orgId, code: "domain_mismatch" },
      { provider_id: a.orgId, code: "domain_mismatch" },
      { provider_id: a.orgId, code: "email_unverified" },
    ]);
  });

  test("6a: a Google issuer needs hd equal to the domain (resolver only)", async () => {
    const a = await orgWithProvider({ owner: "ann", issuer: "https://accounts.google.com" });
    const ann = (hostedDomain: string | null) => identityOf(a, { subject: "s-ann", hostedDomain });
    expect(await resolveSsoMember(db, ann(a.domain))).toEqual({
      kind: "link",
      userId: a.ownerId,
      orgId: a.orgId,
      firstLink: true,
    });
    expect(await resolveSsoMember(db, ann(null))).toEqual({ kind: "reject", code: "domain_mismatch", orgId: a.orgId });
    expect(await resolveSsoMember(db, ann("y.test"))).toEqual({
      kind: "reject",
      code: "domain_mismatch",
      orgId: a.orgId,
    });
  });

  test("7: the provider's organization must be the oldest membership (3 organizations)", async () => {
    const a = await orgWithProvider({ owner: "ann" });
    const b = await orgWithProvider({ owner: "bea" });
    const c = await orgWithProvider({ owner: "cyd" });
    // Cara: a member of B only. Dan: B first, then A. Eve: A first, then B. Fay: A first, then C.
    await userIn(`cara@${a.domain}`, [b.orgId]);
    await userIn(`dan@${a.domain}`, [b.orgId, a.orgId]);
    const eve = await userIn(`eve@${b.domain}`, [a.orgId, b.orgId]);
    const fay = await userIn(`fay@${a.domain}`, [a.orgId, c.orgId]);

    const cara = await signInTo(a, { sub: "s-cara", email: `cara@${a.domain}` });
    expect(cara.location).toBe(`${ERROR_URL}&error=not_a_member`);
    const dan = await signInTo(a, { sub: "s-dan", email: `dan@${a.domain}` });
    expect(dan.location).toBe(`${ERROR_URL}&error=not_a_member`);
    // Eve is a member of B, but her tenant is A: the IdP of B does not open it.
    const eveViaB = await signInTo(b, { sub: "s-eve", email: `eve@${b.domain}` });
    expect(eveViaB.location).toBe(`${ERROR_URL}&error=not_a_member`);
    expect(await sessionsOf(eve)).toBe(0);
    // Eve through the IdP of A (her oldest organization) works.
    const eveViaA = await signInTo(a, { sub: "s-eve-a", email: `eve@${b.domain}` });
    expect(eveViaA.location).toBe(`${ERROR_URL}&error=domain_mismatch`);

    // Fay links through A, then C becomes her oldest membership: the link no longer opens A.
    const first = await signInTo(a, { sub: "s-fay", email: `fay@${a.domain}` });
    expect(first.location).toBe("/app");
    await db
      .updateTable("memberships")
      .set({ created_at: new Date(Date.UTC(2025, 0, 1)) })
      .where("user_id", "=", fay)
      .where("org_id", "=", c.orgId)
      .execute();
    const second = await signInTo(a, { sub: "s-fay", email: `fay@${a.domain}` });
    expect(second.location).toBe(`${ERROR_URL}&error=not_a_member`);
    expect(await sessionsOf(fay)).toBe(1);
    expect((await auditRows(a.orgId, "sso.refused")).map((row) => row.data)).toEqual([
      { provider_id: a.orgId, code: "not_a_member" },
      { provider_id: a.orgId, code: "not_a_member" },
      { provider_id: a.orgId, code: "domain_mismatch" },
      { provider_id: a.orgId, code: "not_a_member" },
    ]);
    expect((await auditRows(b.orgId, "sso.refused")).map((row) => row.data)).toEqual([
      { provider_id: b.orgId, code: "not_a_member" },
    ]);
    expect(await auditRows(c.orgId, "sso.refused")).toHaveLength(0);
  });

  test("8: the e-mail is linked to another IdP account: identity_mismatch, no second account", async () => {
    const a = await orgWithProvider({ owner: "ann" });
    await signInTo(a, { sub: "s-ann", email: `ann@${a.domain}` });
    const result = await signInTo(a, { sub: "s-ann-2", email: `ann@${a.domain}` });
    expect(result.location).toBe(`${ERROR_URL}&error=identity_mismatch`);
    expect(result.sessionCookie).toBeNull();
    expect(await accountsOf(a.orgId)).toHaveLength(1);
    expect((await auditRows(a.orgId, "sso.refused")).map((row) => row.data)).toEqual([
      { provider_id: a.orgId, code: "identity_mismatch" },
    ]);
  });

  test("9: the flag off (no row, an off row, FEATURES_OFF) refuses with sso_off", async () => {
    const noRow = await orgWithProvider({ owner: "ann", flag: false });
    const none = await signInTo(noRow, { sub: "s-ann", email: `ann@${noRow.domain}` });
    expect(none.location).toBe(`${ERROR_URL}&error=sso_off`);

    const off = await orgWithProvider({ owner: "ann" });
    await setOrgFeature(
      db,
      { orgId: off.orgId },
      { flag: "sso_sign_in", enabled: false, actor: "test", now: new Date() }
    );
    const row = await signInTo(off, { sub: "s-ann", email: `ann@${off.domain}` });
    expect(row.location).toBe(`${ERROR_URL}&error=sso_off`);

    const on = await orgWithProvider({ owner: "ann" });
    configureFeatures({ off: ["sso_sign_in"] });
    const killed = await signInTo(on, { sub: "s-ann", email: `ann@${on.domain}` });
    expect(killed.location).toBe(`${ERROR_URL}&error=sso_off`);
    configureFeatures({ off: [] });
    const back = await signInTo(on, { sub: "s-ann", email: `ann@${on.domain}` });
    expect(back.location).toBe("/app");

    for (const org of [noRow, off, on]) expect(await auditRows(org.orgId, "sso.refused")).toHaveLength(1);
    expect(await accountsOf(noRow.orgId)).toHaveLength(0);
    expect(await accountsOf(off.orgId)).toHaveLength(0);
  });

  test("10: an address in upper case resolves to the same user", async () => {
    const a = await orgWithProvider({ owner: "ann" });
    const upper = identityOf(a, { email: `ANN@${a.domain.toUpperCase()}`, subject: "s-ann" });
    expect(await resolveSsoMember(db, upper)).toEqual({
      kind: "link",
      userId: a.ownerId,
      orgId: a.orgId,
      firstLink: true,
    });
    // No provider: no organization, so no audit row would follow.
    expect(await resolveSsoMember(db, identityOf(a, { providerId: randomUUID() }))).toEqual({
      kind: "reject",
      code: "no_provider",
      orgId: null,
    });
  });

  test("11: a resolver that throws: no session, no account, an error redirect, and a log line without the e-mail", async () => {
    const a = await orgWithProvider({ owner: "ann" });
    throwNext = true;
    const from = captured.length;
    const result = await signInTo(a, { sub: "s-ann", email: `ann@${a.domain}` });
    expect(result.sessionCookie).toBeNull();
    expect(result.location?.startsWith(ERROR_URL)).toBe(true);
    expect(await sessionsOf(a.ownerId)).toBe(0);
    expect(await accountsOf(a.orgId)).toHaveLength(0);
    expect(await auditRows(a.orgId, "sso.login")).toHaveLength(0);
    const lines = captured.slice(from).join("\n");
    expect(lines).toContain("better_auth_log");
    expect(lines).not.toContain(`ann@${a.domain}`);
    expect(lines).not.toContain("resolver_boom");
  });

  test("12: log and audit capture over 1 to 11: no client secret, id_token, code or IdP e-mail", async () => {
    expect(fake.issuedIdTokens.length).toBeGreaterThan(0);
    expect(auditSeen.length).toBeGreaterThan(0);
    const output = captured.join("\n");
    const audit = auditSeen.join("\n");
    expect(output).toContain("sso_sign_in");
    expect(output).toContain("sso_refused");
    for (const text of [output, audit]) {
      expect(text).not.toContain(fake.clientSecret);
      for (const code of fake.issuedCodes) expect(text).not.toContain(code);
      for (const token of fake.issuedIdTokens) expect(text).not.toContain(token);
      expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
      for (const address of addressesSeen) expect(text.toLowerCase()).not.toContain(address.toLowerCase());
      expect(text).not.toContain(".x.test");
    }
    for (const row of auditSeen) expect(flat(JSON.parse(row))).toBe(true);
  });
});
