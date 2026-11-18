import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { sql } from "kysely";

import { auditEvents } from "../../src/modules/audit";
import {
  attestSsoDomain,
  configureFeatures,
  createOrganizationWithOwner,
  isPasswordSignInRefused,
  resolveSsoMember,
  setOrgFeature,
  setSsoProvider,
  setSsoRequired,
  ssoDomainRecord,
  verifySsoDomain,
} from "../../src/modules/tenancy";
import { createAuth, type AuthHandle } from "../../src/platform/auth";
import { createLockoutStore } from "../../src/platform/auth-lockout";
import { runOrgSso, type OrgSsoDeps } from "../../src/scripts/org-sso";
import { auditSsoEvent, auditWebEvent, termsAcceptedHandler } from "../../src/web";
import { startFakeOidc, type FakeOidc } from "../fake-oidc";
import { fakeOidcConfig, nextIp, ssoSignIn, SSO_TEST_ORIGIN } from "../sso-helpers";
import { secretOfUri, totpCode } from "../totp";

import { testDb } from "./helpers";
import { resetBody } from "./web-helpers";

// The domain proof (DNS TXT or attestation) and the require switch.
// The CLI runs in process (`runOrgSso`) with a fake resolver; Better Auth runs for real, so the session checks read real sessions.
const db = testDb();

const PASSWORD = "correct-horse-battery-1";
const KEY = Buffer.alloc(32, 5);
const NOW = new Date("2026-11-15T10:00:00.000Z");

let fake: FakeOidc;
let handle: AuthHandle;
let lastResetUrl = "";

const orgIds: string[] = [];
const userIds: string[] = [];
const captured: string[] = [];
// Every line the CLI printed (stdout and stderr): the secret search reads it.
const printed: string[] = [];
const spies: ReturnType<typeof spyOn>[] = [];

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
    sendResetPassword: async ({ url }) => {
      lastResetUrl = url;
    },
    lockout: createLockoutStore(db),
    sendLockoutMail: () => undefined,
    passwordSignInRefused: (userId) => isPasswordSignInRefused(db, userId),
    resolveSsoMember: (identity) => resolveSsoMember(db, identity),
    onSsoEvent: auditSsoEvent(db),
  });
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    spies.push(
      spyOn(console, method).mockImplementation(
        (...args: unknown[]): void => void captured.push(args.map(String).join(" "))
      )
    );
  }
});

afterEach(async () => {
  configureFeatures({ off: [] });
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

  async call(method: "GET" | "POST", path: string, body?: Record<string, unknown>) {
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
    for (const line of response.headers.getSetCookie()) {
      const [pair = ""] = line.split(";");
      const at = pair.indexOf("=");
      const name = pair.slice(0, at).trim();
      const value = pair.slice(at + 1).trim();
      if (value === "" || /max-age=0/i.test(line)) this.jar.delete(name);
      else this.jar.set(name, value);
    }
    const text = await response.text();
    return { status: response.status, json: text ? (JSON.parse(text) as Record<string, unknown> | null) : null };
  }

  signIn(email: string) {
    return this.call("POST", "/sign-in/email", { email, password: PASSWORD });
  }

  // True when the session cookie of this browser still opens a session.
  async hasSession(): Promise<boolean> {
    const result = await this.call("GET", "/get-session");
    return result.status === 200 && result.json !== null && result.json.user !== undefined;
  }
}

const freshDomain = () => `d${randomUUID().replaceAll("-", "")}.x.test`;

interface Person {
  id: string;
  email: string;
}

interface Org {
  orgId: string;
  domain: string;
}

async function makeOrg(): Promise<Org> {
  const domain = freshDomain();
  const { orgId, userId } = await createOrganizationWithOwner(db, {
    orgName: "Sso domain org",
    timezone: "Europe/Warsaw",
    email: `ann@${domain}`,
    displayName: "ann",
  });
  orgIds.push(orgId);
  userIds.push(userId);
  return { orgId, domain };
}

// A member with a password. `breakGlass` marks the membership.
async function makeMember(org: Org, email: string, opts: { breakGlass?: boolean } = {}): Promise<Person> {
  const user = await db
    .insertInto("users")
    .values({ email, display_name: email.split("@")[0] ?? "member" })
    .returning("id")
    .executeTakeFirstOrThrow();
  userIds.push(user.id);
  await db
    .insertInto("memberships")
    .values({
      org_id: org.orgId,
      user_id: user.id,
      role: "owner",
      break_glass: opts.breakGlass === true,
      created_at: new Date(Date.UTC(2026, 0, 1)),
    })
    .execute();
  await handle.auth.api.requestPasswordReset({ body: { email, redirectTo: `${SSO_TEST_ORIGIN}/setup` } });
  const token = new URL(lastResetUrl).pathname.split("/").pop() ?? "";
  await handle.auth.api.resetPassword({ body: resetBody(PASSWORD, token) });
  return { id: user.id, email };
}

// Turns TOTP on; the browser keeps the password session of the enrolment (one session row).
async function enrol(email: string): Promise<{ secret: string; client: Client }> {
  const client = new Client();
  expect((await client.signIn(email)).status).toBe(200);
  const enabled = await client.call("POST", "/two-factor/enable", { password: PASSWORD });
  expect(enabled.status).toBe(200);
  const secret = secretOfUri(String(enabled.json?.totpURI));
  expect((await client.call("POST", "/two-factor/verify-totp", { code: totpCode(secret) })).status).toBe(200);
  return { secret, client };
}

interface Run {
  code: number;
  out: string[];
  err: string[];
}

async function cli(
  org: Org,
  command: string[],
  over: Partial<OrgSsoDeps> = {},
  secret = `${fake.clientSecret}\n`
): Promise<Run> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runOrgSso(["--org-id", org.orgId, ...command], {
    db,
    readStdinLine: async () => secret,
    out: (line) => void out.push(line),
    err: (line) => void err.push(line),
    allowOrigins: [fake.origin],
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    now: () => NOW,
    resolveTxt: async () => {
      throw new Error("ENOTFOUND");
    },
    domainKey: KEY,
    webBaseUrl: "https://app.example.test",
    ...over,
  });
  printed.push(...out, ...err);
  return { code, out, err };
}

// A provider row that points at the fake IdP, made by the service (unproved).
async function addProvider(org: Org, domain = org.domain): Promise<void> {
  const result = await setSsoProvider(
    db,
    { orgId: org.orgId },
    {
      issuer: fake.issuer,
      domain,
      clientId: fake.clientId,
      oidcConfig: fakeOidcConfig(fake),
      actor: "test",
      now: NOW,
    }
  );
  expect(result.kind).toBe("new");
  fake.registerRedirectUri(`${SSO_TEST_ORIGIN}/api/auth/sso/callback/${org.orgId}`);
}

const flagOn = async (org: Org): Promise<void> => {
  await setOrgFeature(db, { orgId: org.orgId }, { flag: "sso_sign_in", enabled: true, actor: "test", now: NOW });
};

const providerRow = (orgId: string) =>
  db
    .selectFrom("sso_providers")
    .select(["domain", "domain_verified", "domain_proof"])
    .where("org_id", "=", orgId)
    .executeTakeFirstOrThrow();

const auditRows = (orgId: string, event: string) =>
  sql<{ actor: string; data: Record<string, unknown> }>`
    SELECT actor, data FROM audit_log WHERE org_id = ${orgId}::uuid AND event = ${event} ORDER BY created_at, id`
    .execute(db)
    .then((result) => result.rows);

async function sessionCount(userId: string): Promise<number> {
  const result = await sql<{ n: string }>`SELECT count(*) AS n FROM auth_sessions WHERE user_id = ${userId}`.execute(
    db
  );
  return Number(result.rows[0]?.n);
}

async function challengeRows(userId: string): Promise<number> {
  // Better Auth stores the identifier hashed; the challenge row is the one that holds the user id as its value.
  const result = await sql<{ n: string }>`SELECT count(*) AS n FROM auth_verifications WHERE value = ${userId}`.execute(
    db
  );
  return Number(result.rows[0]?.n);
}

const txtFor = (org: Org, domain = org.domain) => ssoDomainRecord(KEY, org.orgId, domain);

describe("domain proof by DNS", () => {
  test("2: the right TXT record proves the domain: row dns, one audit row; again: already, no new row", async () => {
    const org = await makeOrg();
    await addProvider(org);
    const record = txtFor(org);
    const asked: string[] = [];
    const resolveTxt = async (name: string): Promise<string[][]> => {
      asked.push(name);
      return [["unrelated"], ["ea-sso=", record.value.slice("ea-sso=".length)]];
    };
    const first = await cli(org, ["--verify"], { resolveTxt });
    expect(first).toEqual({ code: 0, out: ["verified"], err: [] });
    expect(asked).toEqual([record.name]);
    expect(await providerRow(org.orgId)).toMatchObject({ domain_verified: true, domain_proof: "dns" });
    const rows = await auditRows(org.orgId, auditEvents.ssoDomainVerified);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor).toBe("cli");
    expect(rows[0]?.data).toEqual({ provider_id: org.orgId, domain: org.domain });

    const second = await cli(org, ["--verify"], { resolveTxt });
    expect(second).toEqual({ code: 0, out: ["already"], err: [] });
    expect(asked).toHaveLength(1); // a proved domain makes no DNS request
    expect(await auditRows(org.orgId, auditEvents.ssoDomainVerified)).toHaveLength(1);
  });

  test("3: a wrong record, a near miss, another organization's token and a DNS error write nothing", async () => {
    const org = await makeOrg();
    const other = await makeOrg();
    await addProvider(org);
    const token = txtFor(org).value;
    const cases: (() => Promise<string[][]>)[] = [
      async () => [["ea-sso=wrong"]],
      async () => [[`${token}x`]],
      async () => [[token.slice(0, -1)]],
      async () => [[txtFor(other, org.domain).value]],
      async () => [[`ea-sso=${txtFor(org).value.slice(7).toUpperCase()}`]],
      async () => [],
      async () => {
        throw Object.assign(new Error("queryTxt ENOTFOUND"), { code: "ENOTFOUND" });
      },
      async () => {
        throw Object.assign(new Error("queryTxt ENODATA"), { code: "ENODATA" });
      },
    ];
    for (const resolveTxt of cases) {
      const run = await cli(org, ["--verify"], { resolveTxt });
      expect(run).toEqual({ code: 1, out: [], err: ["error not_found_in_dns"] });
    }
    expect(await providerRow(org.orgId)).toMatchObject({ domain_verified: false, domain_proof: null });
    expect(await auditRows(org.orgId, auditEvents.ssoDomainVerified)).toEqual([]);
  });

  test("3b: a record with spaces around it matches (trimmed); a resolver that hangs is not found after the timeout", async () => {
    const org = await makeOrg();
    await addProvider(org);
    const hanging = await verifySsoDomain(
      db,
      { orgId: org.orgId },
      { resolveTxt: () => new Promise<string[][]>(() => undefined), key: KEY, actor: "cli", now: NOW, timeoutMs: 30 }
    );
    expect(hanging).toEqual({ kind: "not_found_in_dns" });
    expect(await providerRow(org.orgId)).toMatchObject({ domain_proof: null });
    const padded = await cli(org, ["--verify"], { resolveTxt: async () => [[` ${txtFor(org).value} `]] });
    expect(padded.out).toEqual(["verified"]);
  });

  test("3c: the domain changes while the DNS read runs: the stale token proves nothing (the re-read under the lock)", async () => {
    const org = await makeOrg();
    await addProvider(org);
    const newDomain = freshDomain();
    const result = await verifySsoDomain(
      db,
      { orgId: org.orgId },
      {
        key: KEY,
        actor: "cli",
        now: NOW,
        resolveTxt: async () => {
          const changed = await setSsoProvider(
            db,
            { orgId: org.orgId },
            {
              issuer: fake.issuer,
              domain: newDomain,
              clientId: fake.clientId,
              oidcConfig: fakeOidcConfig(fake),
              actor: "test",
              now: NOW,
            }
          );
          expect(changed.kind).toBe("boundary");
          return [[txtFor(org).value]]; // the token of the old domain
        },
      }
    );
    expect(result).toEqual({ kind: "none" });
    expect(await providerRow(org.orgId)).toMatchObject({ domain: newDomain, domain_proof: null });
    expect(await auditRows(org.orgId, auditEvents.ssoDomainVerified)).toEqual([]);
  });

  test("4: attest with the right domain: row attested; a wrong domain: confirm_mismatch; again: already", async () => {
    const org = await makeOrg();
    await addProvider(org);
    const wrong = await cli(org, ["--attest", "--confirm", "y.test"]);
    expect(wrong).toEqual({ code: 1, out: [], err: ["error confirm_mismatch"] });
    expect(await providerRow(org.orgId)).toMatchObject({ domain_proof: null });
    const right = await cli(org, ["--attest", "--confirm", ` ${org.domain.toUpperCase()} `]);
    expect(right).toEqual({ code: 0, out: ["attested"], err: [] });
    expect(await providerRow(org.orgId)).toMatchObject({ domain_verified: true, domain_proof: "attested" });
    const rows = await auditRows(org.orgId, auditEvents.ssoDomainAttested);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.data).toEqual({ provider_id: org.orgId, domain: org.domain });
    expect(await cli(org, ["--attest", "--confirm", org.domain])).toEqual({ code: 0, out: ["already"], err: [] });
    expect(await auditRows(org.orgId, auditEvents.ssoDomainAttested)).toHaveLength(1);
    // A proved domain is proved: --verify does not ask the DNS.
    expect((await cli(org, ["--verify"])).out).toEqual(["already"]);
  });

  test("4b: no provider: none; an unknown organization: exit 1", async () => {
    const org = await makeOrg();
    expect(await cli(org, ["--verify"])).toEqual({ code: 0, out: ["none"], err: [] });
    expect(await cli(org, ["--attest", "--confirm", org.domain])).toEqual({ code: 0, out: ["none"], err: [] });
    const missing = { orgId: "00000000-0000-4000-8000-000000000000", domain: "x.test" };
    expect((await cli(missing, ["--verify"])).err).toEqual(["error organization_not_found"]);
    expect((await cli(missing, ["--attest", "--confirm", "x.test"])).err).toEqual(["error organization_not_found"]);
    expect((await cli(missing, ["--require", "on"])).err).toEqual(["error organization_not_found"]);
  });

  test("5: a boundary set drops the proof; show prints the txt line of the new domain, no line when proved", async () => {
    const org = await makeOrg();
    await addProvider(org);
    expect((await cli(org, ["--attest", "--confirm", org.domain])).out).toEqual(["attested"]);
    expect((await cli(org, [])).out.some((line) => line.startsWith("txt "))).toBe(false);

    const newDomain = freshDomain();
    const changed = await cli(org, [
      "--set",
      "--issuer",
      fake.issuer,
      "--domain",
      newDomain,
      "--client-id",
      fake.clientId,
      "--client-secret-stdin",
    ]);
    expect(changed.out[0]).toContain("set boundary");
    expect(await providerRow(org.orgId)).toMatchObject({
      domain: newDomain,
      domain_verified: false,
      domain_proof: null,
    });
    const record = txtFor(org, newDomain);
    expect((await cli(org, [])).out).toContain(`txt ${record.name} ${record.value}`);
    expect(record.name).toBe(`_ea-sso.${newDomain}`);
    expect(record.value).not.toBe(txtFor(org).value);
  });

  test("5b: a domain of digit labels (made by SQL) gets no proof and no audit row", async () => {
    const org = await makeOrg();
    await sql`INSERT INTO sso_providers (provider_id, org_id, issuer, domain, oidc_config)
      VALUES (${org.orgId}, ${org.orgId}::uuid, ${fake.issuer}, '1.2', ${fakeOidcConfig(fake)})`.execute(db);
    let asked = 0;
    const resolveTxt = async (): Promise<string[][]> => {
      asked += 1;
      return [[ssoDomainRecord(KEY, org.orgId, "1.2").value]];
    };
    expect(await verifySsoDomain(db, { orgId: org.orgId }, { resolveTxt, key: KEY, actor: "cli", now: NOW })).toEqual({
      kind: "none",
    });
    expect(await attestSsoDomain(db, { orgId: org.orgId }, { confirmDomain: "1.2", actor: "cli", now: NOW })).toEqual({
      kind: "none",
    });
    expect(asked).toBe(0);
    expect(await providerRow(org.orgId)).toMatchObject({ domain_verified: false, domain_proof: null });
    expect(await auditRows(org.orgId, auditEvents.ssoDomainVerified)).toEqual([]);
    expect(await auditRows(org.orgId, auditEvents.ssoDomainAttested)).toEqual([]);
  });
});

describe("--require on|off", () => {
  test("6: nothing set: refused with no_provider, flag_off and no_break_glass, exit 1, flag still off", async () => {
    const org = await makeOrg();
    const run = await cli(org, ["--require", "on"]);
    expect(run).toEqual({
      code: 1,
      out: [],
      err: ["refused no_provider", "refused flag_off", "refused no_break_glass"],
    });
    const state = await db
      .selectFrom("organizations")
      .select("sso_required")
      .where("id", "=", org.orgId)
      .executeTakeFirstOrThrow();
    expect(state.sso_required).toBe(false);
    expect(await auditRows(org.orgId, auditEvents.ssoRequiredChanged)).toEqual([]);
  });

  test("6b: a provider that is not proved: refused unproved (with the other reasons that hold)", async () => {
    const org = await makeOrg();
    await addProvider(org);
    await flagOn(org);
    await enrolBreakGlass(org);
    expect((await cli(org, ["--require", "on"])).err).toEqual(["refused unproved"]);
  });

  async function enrolBreakGlass(org: Org) {
    const olaf = await makeMember(org, `olaf@${org.domain}`, { breakGlass: true });
    const enrolled = await enrol(olaf.email);
    return { olaf, ...enrolled };
  }

  test("7: off-domain member Bob refused; Bob on the domain: changed; Bob's password session ends, the others stay", async () => {
    const org = await makeOrg();
    await addProvider(org);
    expect((await cli(org, ["--attest", "--confirm", org.domain])).out).toEqual(["attested"]);
    await flagOn(org);
    const { olaf, client: olafBrowser } = await enrolBreakGlass(org);
    const bob = await makeMember(org, `bob@${freshDomain()}`);

    const refused = await cli(org, ["--require", "on"]);
    expect(refused).toEqual({ code: 1, out: [], err: ["refused off_domain_members", `member ${bob.id}`] });
    expect(await auditRows(org.orgId, auditEvents.ssoRequiredChanged)).toEqual([]);

    // Bob's address moves onto the domain; he gets one password session and one SSO session.
    const email = `bob@${org.domain}`;
    await db.updateTable("users").set({ email }).where("id", "=", bob.id).execute();
    const bobPassword = new Client();
    expect((await bobPassword.signIn(email)).status).toBe(200);
    fake.setUser({ sub: `s-${bob.id}`, email, emailVerified: true });
    const sso = await ssoSignIn({ fetch: (req) => handle.auth.handler(req) }, fake, {
      email,
      providerId: org.orgId,
    });
    expect(sso.location).toBe("/app");
    const bobSso = new Client();
    bobSso.jar.set("ea.session_token", sso.sessionCookie ?? "");
    expect(await bobPassword.hasSession()).toBe(true);
    expect(await bobSso.hasSession()).toBe(true);
    expect(await olafBrowser.hasSession()).toBe(true);

    const changed = await cli(org, ["--require", "on"]);
    expect(changed).toEqual({ code: 0, out: ["required yes"], err: [] });
    const rows = await auditRows(org.orgId, auditEvents.ssoRequiredChanged);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.data).toEqual({ from: false, to: true, sessions_ended: 1 });
    expect(await bobPassword.hasSession()).toBe(false);
    expect(await bobSso.hasSession()).toBe(true);
    expect(await olafBrowser.hasSession()).toBe(true);
    expect(await sessionCount(olaf.id)).toBe(1);
    // Bob's password no longer opens a session.
    expect((await new Client().signIn(email)).status).toBe(401);
    // Again: unchanged, no second audit row.
    expect(await setSsoRequired(db, { orgId: org.orgId }, { required: true, actor: "cli", now: NOW })).toEqual({
      kind: "unchanged",
    });
    expect(await auditRows(org.orgId, auditEvents.ssoRequiredChanged)).toHaveLength(1);
  });

  test("8: the break-glass owner without TOTP: refused no_break_glass", async () => {
    const org = await makeOrg();
    await addProvider(org);
    await cli(org, ["--attest", "--confirm", org.domain]);
    await flagOn(org);
    const { olaf } = await enrolBreakGlass(org);
    await db.updateTable("users").set({ two_factor_enabled: false }).where("id", "=", olaf.id).execute();
    expect((await cli(org, ["--require", "on"])).err).toEqual(["refused no_break_glass"]);
  });

  test("9: FEATURES_OFF=sso_sign_in: refused flag_off although the organization row says on", async () => {
    const org = await makeOrg();
    await addProvider(org);
    await cli(org, ["--attest", "--confirm", org.domain]);
    await flagOn(org);
    await enrolBreakGlass(org);
    configureFeatures({ off: ["sso_sign_in"] });
    expect((await cli(org, ["--require", "on"])).err).toEqual(["refused flag_off"]);
    configureFeatures({ off: [] });
    expect((await cli(org, ["--require", "on"])).out).toEqual(["required yes"]);
  });

  test("10: off: changed and one audit row; again: unchanged; off on a fresh organization: unchanged", async () => {
    const org = await makeOrg();
    await addProvider(org);
    await cli(org, ["--attest", "--confirm", org.domain]);
    await flagOn(org);
    await enrolBreakGlass(org);
    expect((await cli(org, ["--require", "on"])).code).toBe(0);
    expect(await cli(org, ["--require", "off"])).toEqual({ code: 0, out: ["required no"], err: [] });
    const rows = await auditRows(org.orgId, auditEvents.ssoRequiredChanged);
    expect(rows.map((row) => row.data)).toEqual(
      expect.arrayContaining([
        { from: true, to: false, sessions_ended: 0 },
        { from: false, to: true, sessions_ended: 0 },
      ])
    );
    expect(await setSsoRequired(db, { orgId: org.orgId }, { required: false, actor: "cli", now: NOW })).toEqual({
      kind: "unchanged",
    });
    expect(await auditRows(org.orgId, auditEvents.ssoRequiredChanged)).toHaveLength(2);
    const fresh = await makeOrg();
    expect(await setSsoRequired(db, { orgId: fresh.orgId }, { required: false, actor: "cli", now: NOW })).toEqual({
      kind: "unchanged",
    });
  });

  test("10b: all refusal reasons come together; the off-domain list holds only members, not the break-glass owner", async () => {
    const org = await makeOrg();
    await addProvider(org);
    const olaf = await makeMember(org, `olaf@${freshDomain()}`, { breakGlass: true });
    const bob = await makeMember(org, `bob@${freshDomain()}`);
    const sub = await makeMember(org, `sub@sub.${org.domain}`); // a subdomain does not match (one domain per provider)
    const result = await setSsoRequired(db, { orgId: org.orgId }, { required: true, actor: "cli", now: NOW });
    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") return;
    expect(result.reasons).toEqual(["unproved", "flag_off", "no_break_glass", "off_domain_members"]);
    expect([...result.userIds].sort()).toEqual([bob.id, sub.id].sort());
    expect(result.userIds).not.toContain(olaf.id);
  });
});

describe("--require on|off across organizations (a break-glass owner that another organization refuses)", () => {
  // The user is a member of one more organization; no password is needed (the membership is a row).
  async function addMembership(org: Org, userId: string, breakGlass: boolean): Promise<void> {
    await db
      .insertInto("memberships")
      .values({
        org_id: org.orgId,
        user_id: userId,
        role: "owner",
        break_glass: breakGlass,
        created_at: new Date(Date.UTC(2026, 1, 1)),
      })
      .execute();
  }

  // A proved provider, the flag on and a break-glass owner with TOTP: every prerequisite except the cross-organization ones.
  async function readyOrg(): Promise<{ org: Org; breakGlass: Person }> {
    const org = await makeOrg();
    await addProvider(org);
    expect((await cli(org, ["--attest", "--confirm", org.domain])).out).toEqual(["attested"]);
    await flagOn(org);
    const breakGlass = await makeMember(org, `olaf@${org.domain}`, { breakGlass: true });
    await enrol(breakGlass.email);
    return { org, breakGlass };
  }

  const setRequiredOf = (org: Org, required: boolean) =>
    setSsoRequired(db, { orgId: org.orgId }, { required, actor: "cli", now: NOW });

  test("13: the break-glass owner is a plain member of an organization that requires SSO: refused no_break_glass; free again: changed", async () => {
    const { org: a, breakGlass: olaf } = await readyOrg();
    const b = await makeOrg();
    await addMembership(b, olaf.id, false);
    await db.updateTable("organizations").set({ sso_required: true }).where("id", "=", b.orgId).execute();
    expect(await isPasswordSignInRefused(db, olaf.id)).toBe(true);

    expect(await setRequiredOf(a, true)).toEqual({ kind: "refused", reasons: ["no_break_glass"], userIds: [] });
    const flag = await db
      .selectFrom("organizations")
      .select("sso_required")
      .where("id", "=", a.orgId)
      .executeTakeFirstOrThrow();
    expect(flag.sso_required).toBe(false);
    expect(await auditRows(a.orgId, auditEvents.ssoRequiredChanged)).toEqual([]);

    await db.updateTable("organizations").set({ sso_required: false }).where("id", "=", b.orgId).execute();
    expect(await setRequiredOf(a, true)).toEqual({ kind: "changed" });
    expect(await isPasswordSignInRefused(db, olaf.id)).toBe(false);
  });

  test("14: the other direction: this switch would refuse the break-glass owner of another organization that requires SSO", async () => {
    const { org: a, breakGlass: olaf } = await readyOrg();
    expect(await setRequiredOf(a, true)).toEqual({ kind: "changed" });
    const { org: b } = await readyOrg();
    await addMembership(b, olaf.id, false);

    const refused = await setRequiredOf(b, true);
    expect(refused.kind).toBe("refused");
    if (refused.kind !== "refused") return;
    expect(refused.reasons).toContain("no_break_glass");
    expect(await isPasswordSignInRefused(db, olaf.id)).toBe(false); // organization A keeps its password path

    // Olaf leaves B: the switch goes on (he is also off-domain there, so he is gone before the check).
    await db.deleteFrom("memberships").where("org_id", "=", b.orgId).where("user_id", "=", olaf.id).execute();
    expect(await setRequiredOf(b, true)).toEqual({ kind: "changed" });
    expect(await isPasswordSignInRefused(db, olaf.id)).toBe(false);
  });

  test("14b: a plain member of another organization that does not require SSO changes nothing: changed", async () => {
    const { org: a, breakGlass: olaf } = await readyOrg();
    const b = await makeOrg();
    await addMembership(b, olaf.id, false);
    expect(await setRequiredOf(a, true)).toEqual({ kind: "changed" });
  });
});

describe("the pending two-factor challenge (carry-over of the stage 06 review)", () => {
  test("12: Pia (not break-glass, TOTP on) starts a password sign-in, the switch goes on: verify-totp gives no session", async () => {
    const org = await makeOrg();
    await addProvider(org);
    await cli(org, ["--attest", "--confirm", org.domain]);
    await flagOn(org);
    const { secret: olafSecret } = await enrolBreakGlass2(org);
    const pia = await makeMember(org, `pia@${org.domain}`);
    const { secret: piaSecret } = await enrol(pia.email);
    const olafBrowser = new Client();
    expect((await olafBrowser.signIn(`olaf@${org.domain}`)).json?.twoFactorRedirect).toBe(true);

    const piaBrowser = new Client();
    const started = await piaBrowser.signIn(pia.email);
    expect(started.status).toBe(200);
    expect(started.json?.twoFactorRedirect).toBe(true);
    expect(piaBrowser.jar.has("ea.two_factor")).toBe(true);
    expect(await challengeRows(pia.id)).toBe(1);

    expect((await cli(org, ["--require", "on"])).out).toEqual(["required yes"]);
    // The challenge of Pia ends with her password sessions; the break-glass owner keeps hers.
    expect(await challengeRows(pia.id)).toBe(0);
    expect(await sessionCount(pia.id)).toBe(0);
    const verified = await piaBrowser.call("POST", "/two-factor/verify-totp", { code: totpCode(piaSecret) });
    expect(verified.status).toBe(401);
    expect(piaBrowser.jar.has("ea.session_token")).toBe(false);
    expect(await sessionCount(pia.id)).toBe(0);
    expect(await piaBrowser.hasSession()).toBe(false);

    // The break-glass owner is not refused: her challenge stays and the code opens a session.
    const olafVerified = await olafBrowser.call("POST", "/two-factor/verify-totp", { code: totpCode(olafSecret) });
    expect(olafVerified.status).toBe(200);
    expect(await olafBrowser.hasSession()).toBe(true);
  });

  async function enrolBreakGlass2(org: Org) {
    const olaf = await makeMember(org, `olaf@${org.domain}`, { breakGlass: true });
    return { olaf, ...(await enrol(olaf.email)) };
  }
});

describe("the secret", () => {
  test("11: show after the proof prints no token and no secret; no output, log or audit row holds the client secret", async () => {
    const org = await makeOrg();
    await addProvider(org);
    const before = await cli(org, []);
    expect(before.out.some((line) => line.startsWith("txt "))).toBe(true);
    await cli(org, ["--attest", "--confirm", org.domain]);
    const shown = await cli(org, []);
    expect(shown.out.some((line) => line.includes("ea-sso=") || line.startsWith("txt "))).toBe(false);
    expect(shown.out).toContain(`domain ${org.domain} proof`);

    const audit = await sql`SELECT actor, event, data FROM audit_log WHERE org_id = ${org.orgId}::uuid`.execute(db);
    const everything = [...printed, ...captured, JSON.stringify(audit.rows)].join("\n");
    expect(everything).not.toContain(fake.clientSecret);
  });
});
