import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { sql } from "kysely";

import {
  addMember,
  configureFeatures,
  countSsoRequiredWhileKilled,
  createOrganizationWithOwner,
  setOrgFeature,
  unlinkSso,
} from "../../src/modules/tenancy";
import { lockOrganization, lockSsoProvider } from "../../src/modules/tenancy/repo";
import { loadConfig } from "../../src/platform/config";
import { createSecretBox } from "../../src/platform/crypto";
import { createApp } from "../../src/platform/http";
import { runOrgMember } from "../../src/scripts/org-member";
import { webDeps } from "../../src/web";
import { startFakeOidc, type FakeOidc } from "../fake-oidc";
import { fakeOidcConfig, nextIp, SESSION_COOKIE, ssoSignIn, SSO_TEST_ORIGIN } from "../sso-helpers";

import { testDb } from "./helpers";

// Stage 10 of spec/features/active/F119-e7-t7-identity-b-oidc: `org:member` add, end sessions, unlink, and the flag warning.
// `runOrgMember` runs in process, the sign-ins run through the production web wiring against the fake IdP.
const db = testDb();
const repoRoot = resolve(import.meta.dir, "../../../..");
const flagScript = resolve(import.meta.dir, "../../src/scripts/org-flag.ts");
// An address domain off every provider domain; unique per run, so a failed run leaves no clash.
const OFF = `y${randomUUID().slice(0, 8)}.test`;
const NOW = new Date("2026-11-15T10:00:00.000Z");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type App = ReturnType<typeof createApp>;

let fake: FakeOidc;
let app: App;
let dist = "";
let closeWeb: () => Promise<void> = async () => undefined;
const orgIds: string[] = [];
const userIds: string[] = [];
// Every line the CLI printed and every log line, and every address or name the tests used: test 8 searches the first for the second.
const printed: string[] = [];
const logged: string[] = [];
const canaries: string[] = [];
const spies: ReturnType<typeof spyOn>[] = [];

beforeAll(async () => {
  fake = await startFakeOidc();
  dist = mkdtempSync(join(tmpdir(), "ea-org-member-dist-"));
  writeFileSync(join(dist, "404.html"), "not found page");
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    spies.push(
      spyOn(console, method).mockImplementation((...args: unknown[]): void => {
        logged.push(args.map(String).join(" "));
      })
    );
  }
  const web = webDeps(
    loadConfig({
      ...process.env,
      WEB_BASE_URL: SSO_TEST_ORIGIN,
      WEB_AUTH_SECRET: "x".repeat(40),
      WEB_DIST: dist,
      WEB_TRUSTED_ORIGINS: fake.origin,
      AUTH_PWNED_CHECK: "off",
    }),
    db,
    {
      secrets: createSecretBox(randomBytes(32).toString("base64"), 1),
      actionsScope: { kind: "off" },
      botUsername: null,
    }
  );
  if (web === null) throw new Error("webDeps returned null");
  closeWeb = () => web.close();
  app = createApp({ checkDb: async () => true, web: { ...web, connInfo: (c) => c.req.header("x-client-ip") } });
});

afterEach(async () => {
  configureFeatures({ off: [] });
  for (const orgId of orgIds) await db.deleteFrom("organizations").where("id", "=", orgId).execute();
  if (userIds.length > 0) await db.deleteFrom("users").where("id", "in", userIds).execute();
  // A test that fails before it tracks the new user would leave the address behind.
  const addresses = canaries.filter((value) => value.includes("@")).map((value) => value.toLowerCase());
  if (addresses.length > 0) await db.deleteFrom("users").where("email", "in", addresses).execute();
  orgIds.length = 0;
  userIds.length = 0;
});

afterAll(async () => {
  for (const spy of spies) spy.mockRestore();
  await closeWeb();
  fake.stop();
  rmSync(dist, { recursive: true, force: true });
  await db.destroy();
});

interface Org {
  orgId: string;
  domain: string;
  ownerId: string;
}

// An organization with a proved provider row at the fake IdP and the flag `sso_sign_in` on. Its owner has no password here.
async function ssoOrg(options: { required?: boolean } = {}): Promise<Org> {
  const domain = `d${randomUUID().replaceAll("-", "")}.x.test`;
  const { orgId, userId } = await createOrganizationWithOwner(db, {
    orgName: `Member org ${randomUUID()}`,
    timezone: "Europe/Warsaw",
    email: `owner@${domain}`,
    displayName: "Owner",
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
  await setOrgFeature(db, { orgId }, { flag: "sso_sign_in", enabled: true, actor: "test", now: NOW });
  if (options.required)
    await db.updateTable("organizations").set({ sso_required: true }).where("id", "=", orgId).execute();
  return { orgId, domain, ownerId: userId };
}

// Runs the CLI in process; every printed line goes to `printed` for test 8.
async function cli(...argv: string[]): Promise<{ code: number; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runOrgMember(argv, {
    db,
    out: (line) => {
      out.push(line);
      printed.push(line);
    },
    err: (line) => {
      err.push(line);
      printed.push(line);
    },
    now: () => NOW,
  });
  return { code, out, err };
}

// An address or a name that must never reach stdout, stderr, a log line or an audit row.
function canary(value: string): string {
  canaries.push(value);
  return value;
}

async function addEve(org: Org, local = "eve"): Promise<{ email: string; userId: string }> {
  const email = canary(`${local}@${org.domain}`);
  const result = await cli(
    "--org-id",
    org.orgId,
    "--add",
    "--email",
    email,
    "--display-name",
    canary(`Name ${local} ${randomUUID()}`)
  );
  expect(result.code).toBe(0);
  const userId = result.out[0]?.replace("added ", "") ?? "";
  expect(userId).toMatch(UUID);
  userIds.push(userId);
  return { email, userId };
}

// A session row by SQL. An SSO session starts now (the table trigger caps it 12 h after the start).
async function seedSession(userId: string, method: "sso" | "password"): Promise<void> {
  await sql`INSERT INTO auth_sessions (user_id, token, expires_at, sign_in_method, sso_started_at)
    VALUES (${userId}::uuid, ${randomUUID()}, now() + interval '1 hour', ${method}, ${method === "sso" ? sql`now()` : null})`.execute(
    db
  );
}

async function seedLink(userId: string, providerId: string): Promise<void> {
  await sql`INSERT INTO auth_accounts (account_id, provider_id, user_id)
    VALUES (${`sub-${randomUUID()}`}, ${providerId}, ${userId}::uuid)`.execute(db);
}

const sessionMethods = async (userId: string): Promise<string[]> =>
  (
    await sql<{
      method: string;
    }>`SELECT sign_in_method AS method FROM auth_sessions WHERE user_id = ${userId}::uuid ORDER BY sign_in_method`.execute(
      db
    )
  ).rows.map((row) => row.method);
const linkCount = async (userId: string): Promise<number> =>
  Number(
    (
      await sql<{
        n: string;
      }>`SELECT count(*) AS n FROM auth_accounts WHERE user_id = ${userId}::uuid AND provider_id <> 'credential'`.execute(
        db
      )
    ).rows[0]?.n
  );
const membershipRows = (orgId: string) =>
  db.selectFrom("memberships").select(["user_id", "role", "break_glass"]).where("org_id", "=", orgId).execute();
const auditRows = (orgId: string, event: string) =>
  db
    .selectFrom("audit_log")
    .select(["actor", "data"])
    .where("org_id", "=", orgId)
    .where("event", "=", event)
    .orderBy("id")
    .execute();
const allAuditRows = (orgId: string) => db.selectFrom("audit_log").select("id").where("org_id", "=", orgId).execute();
const userRows = (email: string) =>
  db.selectFrom("users").selectAll().where("email", "=", email.toLowerCase()).execute();

async function signIn(org: Org, email: string) {
  fake.setUser({ sub: `sub-${email}`, email, emailVerified: true });
  return ssoSignIn(app, fake, { email, providerId: org.orgId });
}

const me = (cookie: string) =>
  app.request("/api/me", { headers: { cookie: `${SESSION_COOKIE}=${cookie}`, "x-client-ip": nextIp() } });

describe("org:member (F119 stage 10)", () => {
  test("1. add: one user without a password, one membership, one audit row; the same address again: email_taken", async () => {
    const a = await ssoOrg();
    const b = await ssoOrg();
    const before = (await membershipRows(a.orgId)).length;
    const eve = await addEve(a);

    const users = await userRows(eve.email);
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ id: eve.userId, email_verified: true, locale: "pl" });
    expect(
      Number(
        (
          await sql<{ n: string }>`SELECT count(*) AS n FROM auth_accounts WHERE user_id = ${eve.userId}::uuid`.execute(
            db
          )
        ).rows[0]?.n
      )
    ).toBe(0);
    const memberships = await membershipRows(a.orgId);
    expect(memberships).toHaveLength(before + 1);
    expect(memberships.find((row) => row.user_id === eve.userId)).toMatchObject({
      role: "assistant",
      break_glass: false,
    });
    expect(await auditRows(a.orgId, "org.member_added")).toEqual([
      { actor: "cli", data: { user_id: eve.userId, role: "assistant" } },
    ]);
    // The other organization got nothing.
    expect(await membershipRows(b.orgId)).toHaveLength(1);
    expect(await auditRows(b.orgId, "org.member_added")).toEqual([]);

    // The same address in other letters, in the same and in another organization: taken, nothing written.
    for (const org of [a, b]) {
      const again = await cli(
        "--org-id",
        org.orgId,
        "--add",
        "--email",
        ` ${eve.email.replace("eve", "Eve").toUpperCase()} `,
        "--display-name",
        "Eve"
      );
      expect(again).toEqual({ code: 1, out: [], err: ["error email_taken"] });
    }
    expect(await userRows(eve.email)).toHaveLength(1);
    expect(await membershipRows(a.orgId)).toHaveLength(before + 1);
    expect(await membershipRows(b.orgId)).toHaveLength(1);
    expect(await auditRows(a.orgId, "org.member_added")).toHaveLength(1);

    // An unknown organization; an owner with a language.
    const missing = await cli("--org-id", randomUUID(), "--add", "--email", `zed@${a.domain}`, "--display-name", "Zed");
    expect(missing).toEqual({ code: 1, out: [], err: ["error not_found"] });
    const owner = await cli(
      "--org-id",
      a.orgId,
      "--add",
      "--email",
      canary(`ola@${a.domain}`),
      "--display-name",
      "Ola",
      "--role",
      "owner",
      "--lang",
      "en"
    );
    expect(owner.code).toBe(0);
    userIds.push(owner.out[0]?.replace("added ", "") ?? "");
    expect(await userRows(`ola@${a.domain}`)).toMatchObject([{ locale: "en" }]);
    expect(
      (await membershipRows(a.orgId)).find((row) => row.role === "owner" && row.break_glass === false)
    ).toBeDefined();
    expect(logged.some((line) => line.includes("org_member_added") && line.includes(eve.userId))).toBe(true);
  });

  test("2. SSO required: an address off the provider domain gives off_domain and writes nothing", async () => {
    const a = await ssoOrg({ required: true });
    const b = await ssoOrg();
    const before = await membershipRows(a.orgId);
    const auditBefore = (await allAuditRows(a.orgId)).length;
    const off = await cli("--org-id", a.orgId, "--add", "--email", canary(`fay@${OFF}`), "--display-name", "Fay");
    expect(off).toEqual({ code: 1, out: [], err: ["error off_domain"] });
    // A subdomain is off the domain too (one domain per provider).
    const sub = await cli(
      "--org-id",
      a.orgId,
      "--add",
      "--email",
      canary(`gus@mail.${a.domain}`),
      "--display-name",
      "Gus"
    );
    expect(sub.err).toEqual(["error off_domain"]);
    expect(await userRows(`fay@${OFF}`)).toEqual([]);
    expect(await userRows(`gus@mail.${a.domain}`)).toEqual([]);
    expect(await membershipRows(a.orgId)).toEqual(before);
    expect((await allAuditRows(a.orgId)).length).toBe(auditBefore);

    // On the domain it works; an organization without the rule takes any address.
    await addEve(a, "hal");
    expect(
      (await cli("--org-id", b.orgId, "--add", "--email", canary(`ivy@${OFF}`), "--display-name", "Ivy")).code
    ).toBe(0);
    userIds.push((await userRows(`ivy@${OFF}`))[0]?.id ?? "");
  });

  test("3. Eve signs in through the fake IdP: linked by e-mail, one SSO session, sso.login with first_link", async () => {
    const a = await ssoOrg();
    const eve = await addEve(a);
    const result = await signIn(a, eve.email);
    expect(result.location).toBe("/app");
    expect(result.sessionCookie).not.toBeNull();
    expect(await linkCount(eve.userId)).toBe(1);
    expect(await sessionMethods(eve.userId)).toEqual(["sso"]);
    expect((await auditRows(a.orgId, "sso.login")).map((row) => row.data)).toEqual([
      { provider_id: a.orgId, first_link: true },
    ]);
    expect((await me(result.sessionCookie ?? "")).status).toBe(200);
  });

  test("4. end sessions: --only-sso ends the SSO ones, then all; the old cookie answers 401; another member is not touched", async () => {
    const a = await ssoOrg();
    const eve = await addEve(a);
    const other = await addEve(a, "ota");
    const signed = await signIn(a, eve.email);
    const cookie = signed.sessionCookie ?? "";
    await seedSession(eve.userId, "sso");
    await seedSession(eve.userId, "password");
    await seedSession(other.userId, "sso");
    expect(await sessionMethods(eve.userId)).toEqual(["password", "sso", "sso"]);
    expect((await me(cookie)).status).toBe(200);

    const sso = await cli("--org-id", a.orgId, "--user-id", eve.userId, "--end-sessions", "--only-sso");
    expect(sso).toEqual({ code: 0, out: ["ended 2"], err: [] });
    expect(await sessionMethods(eve.userId)).toEqual(["password"]);
    expect((await me(cookie)).status).toBe(401);
    expect(await sessionMethods(other.userId)).toEqual(["sso"]);

    const all = await cli("--org-id", a.orgId, "--user-id", eve.userId, "--end-sessions");
    expect(all.out).toEqual(["ended 1"]);
    expect(await sessionMethods(eve.userId)).toEqual([]);
    expect(await sessionMethods(other.userId)).toEqual(["sso"]);

    expect((await auditRows(a.orgId, "web.member_sessions_ended")).map((row) => row.data)).toEqual([
      { user_id: eve.userId, count: 2, only_sso: true },
      { user_id: eve.userId, count: 1, only_sso: false },
    ]);
  });

  test("5. unlink: the link and the SSO sessions go, a password session stays; the next sign-in links again", async () => {
    const a = await ssoOrg();
    const b = await ssoOrg();
    const eve = await addEve(a);
    const bUser = await addEve(b, "bea");
    const signed = await signIn(a, eve.email);
    await signIn(b, bUser.email);
    await seedSession(eve.userId, "password");
    expect(await linkCount(eve.userId)).toBe(1);

    const result = await cli("--org-id", a.orgId, "--user-id", eve.userId, "--unlink-sso");
    expect(result).toEqual({ code: 0, out: ["unlinked, sessions 1"], err: [] });
    expect(await linkCount(eve.userId)).toBe(0);
    expect(await sessionMethods(eve.userId)).toEqual(["password"]);
    expect((await me(signed.sessionCookie ?? "")).status).toBe(401);
    expect((await auditRows(a.orgId, "sso.unlinked")).map((row) => row.data)).toEqual([
      { user_id: eve.userId, sessions_ended: 1 },
    ]);
    // The other organization keeps its link and session.
    expect(await linkCount(bUser.userId)).toBe(1);
    expect(await sessionMethods(bUser.userId)).toEqual(["sso"]);

    // Nothing left to unlink.
    expect(await cli("--org-id", a.orgId, "--user-id", eve.userId, "--unlink-sso")).toEqual({
      code: 0,
      out: ["none"],
      err: [],
    });
    expect(await auditRows(a.orgId, "sso.unlinked")).toHaveLength(1);

    const again = await signIn(a, eve.email);
    expect(again.location).toBe("/app");
    expect(await linkCount(eve.userId)).toBe(1);
    expect((await auditRows(a.orgId, "sso.login")).map((row) => row.data)).toEqual([
      { provider_id: a.orgId, first_link: true },
      { provider_id: a.orgId, first_link: true },
    ]);
  });

  test("6. a user of another organization: not_member for both commands, nothing changes", async () => {
    const a = await ssoOrg();
    const b = await ssoOrg();
    const bUser = await addEve(b, "bob");
    await signIn(b, bUser.email);
    await seedSession(bUser.userId, "password");
    const sessionsBefore = await sessionMethods(bUser.userId);
    const auditBefore = [(await allAuditRows(a.orgId)).length, (await allAuditRows(b.orgId)).length];

    for (const flags of [["--end-sessions"], ["--end-sessions", "--only-sso"], ["--unlink-sso"]]) {
      const result = await cli("--org-id", a.orgId, "--user-id", bUser.userId, ...flags);
      expect(result).toEqual({ code: 1, out: [], err: ["error not_member"] });
    }
    // An unknown user and an unknown organization give the same answer.
    expect((await cli("--org-id", a.orgId, "--user-id", randomUUID(), "--end-sessions")).err).toEqual([
      "error not_member",
    ]);
    expect((await cli("--org-id", randomUUID(), "--user-id", bUser.userId, "--unlink-sso")).err).toEqual([
      "error not_member",
    ]);
    expect(await sessionMethods(bUser.userId)).toEqual(sessionsBefore);
    expect(await linkCount(bUser.userId)).toBe(1);
    expect([(await allAuditRows(a.orgId)).length, (await allAuditRows(b.orgId)).length]).toEqual(auditBefore);
  });

  test("8. stdout, stderr, the log capture and the audit rows hold no address and no name", async () => {
    const a = await ssoOrg({ required: true });
    const eve = await addEve(a);
    await cli("--org-id", a.orgId, "--add", "--email", canary(`zoe@${OFF}`), "--display-name", canary("Zoe Canary"));
    await signIn(a, eve.email);
    await cli("--org-id", a.orgId, "--user-id", eve.userId, "--end-sessions");
    await cli("--org-id", a.orgId, "--user-id", eve.userId, "--unlink-sso");
    expect(canaries.length).toBeGreaterThan(8);
    const text = [...printed, ...logged].join("\n");
    for (const value of canaries) expect(text).not.toContain(value);
    expect(text).not.toContain(".x.test");
    expect(printed.length).toBeGreaterThan(8);
    const audit = JSON.stringify(
      await db.selectFrom("audit_log").select("data").where("org_id", "=", a.orgId).execute()
    );
    expect(audit).not.toContain("@");
    for (const value of canaries) expect(audit).not.toContain(value);
    // Logged ids are lower-case UUIDs, and the member lines carry the id of the user.
    const memberLines = logged.filter((line) => /member_added|member_sessions_ended|sso_unlinked/.test(line));
    expect(memberLines.length).toBeGreaterThan(3);
    for (const line of memberLines) {
      const ids = [...line.matchAll(/user_id=(\S+)/g)].map((match) => match[1] ?? "");
      expect(ids.length).toBe(1);
      for (const id of ids) expect(id).toMatch(UUID);
    }
  });
});

describe("org:member locks (two connections)", () => {
  const pending = async (promise: Promise<unknown>): Promise<boolean> => {
    let settled = false;
    void promise.then(
      () => (settled = true),
      () => (settled = true)
    );
    await Bun.sleep(400);
    return !settled;
  };

  test("an add waits for the organization lock, then sees what the other writer committed", async () => {
    const a = await ssoOrg();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolveHeld) => (release = resolveHeld));
    let locked: () => void = () => undefined;
    const lockedPromise = new Promise<void>((resolveLocked) => (locked = resolveLocked));
    const holder = db.transaction().execute(async (trx) => {
      await lockOrganization(trx, { orgId: a.orgId });
      locked();
      await held;
      await trx.updateTable("organizations").set({ sso_required: true }).where("id", "=", a.orgId).execute();
    });
    await lockedPromise;
    const email = canary(`lee@${OFF}`);
    const add = addMember(
      db,
      { orgId: a.orgId },
      { email, displayName: "Lee", role: "assistant", locale: "pl", actor: "test", now: NOW }
    );
    expect(await pending(add)).toBe(true);
    release();
    await holder;
    // The rule went on while the add waited: the add reads it after the lock and refuses the address.
    expect(await add).toEqual({ kind: "off_domain" });
    expect(await userRows(email)).toEqual([]);
  });

  test("the same address added to two organizations at once: one user, one email_taken", async () => {
    const a = await ssoOrg();
    const b = await ssoOrg();
    const email = canary(`pat@shared-${randomUUID().slice(0, 8)}.x.test`);
    const input = {
      email,
      displayName: "Pat",
      role: "assistant" as const,
      locale: "pl" as const,
      actor: "test",
      now: NOW,
    };
    // The two organizations have no rule, so both adds pass the address check and meet at the unique index.
    const results = await Promise.all([
      addMember(db, { orgId: a.orgId }, input),
      addMember(db, { orgId: b.orgId }, input),
    ]);
    expect(results.map((result) => result.kind).sort()).toEqual(["added", "email_taken"]);
    const users = await userRows(email);
    expect(users).toHaveLength(1);
    userIds.push(users[0]?.id ?? "");
    expect((await membershipRows(a.orgId)).length + (await membershipRows(b.orgId)).length).toBe(3);
  });

  test("an unlink waits for the provider lock of a callback in flight", async () => {
    const a = await ssoOrg();
    const eve = await addEve(a);
    await seedLink(eve.userId, a.orgId);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolveHeld) => (release = resolveHeld));
    let locked: () => void = () => undefined;
    const lockedPromise = new Promise<void>((resolveLocked) => (locked = resolveLocked));
    const holder = db.transaction().execute(async (trx) => {
      await lockSsoProvider(trx, { orgId: a.orgId });
      locked();
      await held;
    });
    await lockedPromise;
    const unlink = unlinkSso(db, { orgId: a.orgId }, { userId: eve.userId, actor: "test", now: NOW });
    expect(await pending(unlink)).toBe(true);
    expect(await linkCount(eve.userId)).toBe(1);
    release();
    await holder;
    expect(await unlink).toEqual({ kind: "unlinked", sessionsEnded: 0 });
    expect(await linkCount(eve.userId)).toBe(0);
  });
});

describe("the flag lock-out warning (F119 N12)", () => {
  const runFlag = async (orgId: string, off: boolean) => {
    const proc = Bun.spawn(["bun", flagScript, "--org-id", orgId, "--flag", "sso_sign_in", off ? "--off" : "--on"], {
      cwd: repoRoot,
      env: { ...process.env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    return { code, stdout: await new Response(proc.stdout).text(), stderr: await new Response(proc.stderr).text() };
  };
  const flagOf = async (orgId: string) =>
    (
      await db
        .selectFrom("org_features")
        .select("enabled")
        .where("org_id", "=", orgId)
        .where("flag", "=", "sso_sign_in")
        .executeTakeFirst()
    )?.enabled;
  const WARNING = "warning: sso_required is on; only the break-glass owner can sign in";

  test("9. org:flag --off on an SSO-required organization applies and warns; on another organization it does not warn", async () => {
    const required = await ssoOrg({ required: true });
    const plain = await ssoOrg();
    const off = await runFlag(required.orgId, true);
    expect(off.code).toBe(0);
    expect(off.stdout).toContain(WARNING);
    expect(await flagOf(required.orgId)).toBe(false);
    // The flag stays off for the plain organization after its own write, and no warning is printed.
    const plainOff = await runFlag(plain.orgId, true);
    expect(plainOff.code).toBe(0);
    expect(plainOff.stdout).not.toContain("warning");
    expect(await flagOf(plain.orgId)).toBe(false);
    // Turning it on warns of nothing.
    const on = await runFlag(required.orgId, false);
    expect(on.stdout).not.toContain("warning");
    expect(await flagOf(required.orgId)).toBe(true);
    // A repeated off still warns: the organization is still locked out.
    await runFlag(required.orgId, true);
    expect((await runFlag(required.orgId, true)).stdout).toContain(WARNING);
  });

  test("the start-up count: organizations with SSO required, only when FEATURES_OFF holds sso_sign_in", async () => {
    configureFeatures({ off: ["sso_sign_in"] });
    const before = await countSsoRequiredWhileKilled(db);
    await ssoOrg({ required: true });
    await ssoOrg();
    expect(await countSsoRequiredWhileKilled(db)).toBe(before + 1);
    configureFeatures({ off: [] });
    expect(await countSsoRequiredWhileKilled(db)).toBe(0);
    configureFeatures({ off: ["stats_page"] });
    expect(await countSsoRequiredWhileKilled(db)).toBe(0);
  });
});
