import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { sql } from "kysely";

import { auditEvents, recordAudit } from "../../src/modules/audit";
import {
  createOrganizationWithOwner,
  getSsoState,
  removeSsoProvider,
  setSsoProvider,
  type SetSsoProviderResult,
} from "../../src/modules/tenancy";
import { buildOidcConfig, discoverProviderConfig } from "../../src/platform/auth-sso";
import { startFakeOidc, type FakeOidc } from "../fake-oidc";

import { testDb } from "./helpers";

// Stage 07 of spec/features/active/F119-e7-t7-identity-b-oidc: the provider service (`setSsoProvider`, `removeSsoProvider`,
// `getSsoState`). The configs come from `discoverProviderConfig` and `buildOidcConfig`, against the fake IdP.
const db = testDb();

let fakeA: FakeOidc;
let fakeB: FakeOidc;
const orgIds: string[] = [];
const userIds: string[] = [];
const output: string[] = [];
const spies: ReturnType<typeof spyOn>[] = [];

beforeAll(async () => {
  fakeA = await startFakeOidc();
  fakeB = await startFakeOidc();
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    spies.push(
      spyOn(console, method).mockImplementation(
        (...args: unknown[]): void => void output.push(args.map(String).join(" "))
      )
    );
  }
});

afterEach(async () => {
  for (const orgId of orgIds) await db.deleteFrom("organizations").where("id", "=", orgId).execute();
  if (userIds.length > 0) await db.deleteFrom("users").where("id", "in", userIds).execute();
  orgIds.length = 0;
  userIds.length = 0;
});

afterAll(async () => {
  for (const spy of spies) spy.mockRestore();
  fakeA.stop();
  fakeB.stop();
  await db.destroy();
});

const freshDomain = () => `d${randomUUID().replaceAll("-", "")}.x.test`;
const NOW = new Date("2026-11-15T10:00:00.000Z");

interface Org {
  orgId: string;
  userId: string;
  email: string;
  domain: string;
}

async function seedOrg(): Promise<Org> {
  const domain = freshDomain();
  const email = `ann@${domain}`;
  const { orgId, userId } = await createOrganizationWithOwner(db, {
    orgName: "Sso provider org",
    timezone: "Europe/Warsaw",
    email,
    displayName: "Ann",
  });
  orgIds.push(orgId);
  userIds.push(userId);
  return { orgId, userId, email, domain };
}

// The config of a fake IdP, made the way the CLI makes it. `clientId` and `clientSecret` default to the fake's own.
async function configOf(fake: FakeOidc, client: { clientId?: string; clientSecret?: string } = {}) {
  const found = await discoverProviderConfig(fake.issuer, { allowOrigins: [fake.origin], timeoutMs: 5000 });
  if (found.kind !== "ok") throw new Error(`discovery failed: ${found.code}`);
  const clientId = client.clientId ?? fake.clientId;
  const oidcConfig = buildOidcConfig(found.discovered, {
    clientId,
    clientSecret: client.clientSecret ?? fake.clientSecret,
  });
  return { issuer: fake.issuer, clientId, oidcConfig };
}

async function setFor(
  org: Org,
  config: { issuer: string; clientId: string; oidcConfig: string },
  domain = org.domain
): Promise<SetSsoProviderResult> {
  return setSsoProvider(db, { orgId: org.orgId }, { ...config, domain, actor: "cli", now: NOW });
}

async function providerRows(orgId: string) {
  return db.selectFrom("sso_providers").selectAll().where("org_id", "=", orgId).execute();
}

// Ann's link at the provider, one SSO session and one password session.
async function linkAnn(org: Org): Promise<void> {
  await sql`INSERT INTO auth_accounts (account_id, provider_id, user_id) VALUES (${`sub-${org.userId}`}, ${org.orgId}, ${org.userId}::uuid)`.execute(
    db
  );
  await sql`INSERT INTO auth_sessions (token, user_id, expires_at, sign_in_method, sso_started_at)
    VALUES (${randomBytes(16).toString("hex")}, ${org.userId}::uuid, now() + interval '1 hour', 'sso', now())`.execute(
    db
  );
  await sql`INSERT INTO auth_sessions (token, user_id, expires_at)
    VALUES (${randomBytes(16).toString("hex")}, ${org.userId}::uuid, now() + interval '1 day')`.execute(db);
}

async function annState(org: Org) {
  const links = await sql<{
    n: string;
  }>`SELECT count(*) AS n FROM auth_accounts WHERE provider_id = ${org.orgId}`.execute(db);
  const sso = await sql<{
    n: string;
  }>`SELECT count(*) AS n FROM auth_sessions WHERE user_id = ${org.userId}::uuid AND sign_in_method = 'sso'`.execute(
    db
  );
  const password = await sql<{
    n: string;
  }>`SELECT count(*) AS n FROM auth_sessions WHERE user_id = ${org.userId}::uuid AND sign_in_method = 'password'`.execute(
    db
  );
  return { links: Number(links.rows[0]?.n), sso: Number(sso.rows[0]?.n), password: Number(password.rows[0]?.n) };
}

async function auditRows(orgId: string, event: string) {
  const result = await sql<{ actor: string; data: Record<string, unknown> }>`
    SELECT actor, data FROM audit_log WHERE org_id = ${orgId}::uuid AND event = ${event} ORDER BY created_at, id`.execute(
    db
  );
  return result.rows;
}

const setRequired = (orgId: string, on: boolean) =>
  sql`UPDATE organizations SET sso_required = ${on} WHERE id = ${orgId}::uuid`.execute(db);

async function requiredOf(orgId: string): Promise<boolean> {
  const row = await db
    .selectFrom("organizations")
    .select("sso_required")
    .where("id", "=", orgId)
    .executeTakeFirstOrThrow();
  return row.sso_required;
}

describe("the provider service (F119 stage 07)", () => {
  test("1: set makes one unproved row and one audit row; the same set again is unchanged and writes nothing", async () => {
    const org = await seedOrg();
    expect(await getSsoState(db, { orgId: org.orgId })).toBeNull();
    const config = await configOf(fakeA);

    expect(await setFor(org, config)).toEqual({ kind: "new" });
    const rows = await providerRows(org.orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider_id: org.orgId,
      issuer: fakeA.issuer,
      domain: org.domain,
      domain_verified: false,
      domain_proof: null,
    });
    const audit = await auditRows(org.orgId, auditEvents.ssoProviderSet);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actor).toBe("cli");
    expect(audit[0]?.data).toEqual({
      provider_id: org.orgId,
      change: "new",
      issuer_host: new URL(fakeA.issuer).host,
      domain: org.domain,
      links_removed: 0,
      sessions_ended: 0,
    });

    await linkAnn(org);
    expect(await getSsoState(db, { orgId: org.orgId })).toEqual({
      providerId: org.orgId,
      issuer: fakeA.issuer,
      domain: org.domain,
      proof: null,
      required: false,
      linkedMembers: 1,
      breakGlassReady: false,
    });

    expect(await setFor(org, config)).toEqual({ kind: "unchanged" });
    expect(await providerRows(org.orgId)).toHaveLength(1);
    expect(await auditRows(org.orgId, auditEvents.ssoProviderSet)).toHaveLength(1);
    expect((await providerRows(org.orgId))[0]?.updated_at.getTime()).toBe(NOW.getTime());
  });

  test("2: a new secret keeps the link and the SSO session; a new client id is a boundary", async () => {
    const org = await seedOrg();
    expect(await setFor(org, await configOf(fakeA))).toEqual({ kind: "new" });
    await linkAnn(org);
    await db
      .updateTable("sso_providers")
      .set({ domain_verified: true, domain_proof: "dns" })
      .where("org_id", "=", org.orgId)
      .execute();
    await setRequired(org.orgId, true);

    expect(await setFor(org, await configOf(fakeA, { clientSecret: "another-secret" }))).toEqual({ kind: "secret" });
    expect(await annState(org)).toEqual({ links: 1, sso: 1, password: 1 });
    expect((await providerRows(org.orgId))[0]).toMatchObject({ domain_verified: true, domain_proof: "dns" });
    expect(await requiredOf(org.orgId)).toBe(true);
    const audit = await auditRows(org.orgId, auditEvents.ssoProviderSet);
    expect(audit.map((row) => row.data.change)).toEqual(["new", "secret"]);

    expect(await setFor(org, await configOf(fakeA, { clientId: "another-client" }))).toEqual({
      kind: "boundary",
      linksRemoved: 1,
      sessionsEnded: 1,
    });
    expect(await annState(org)).toEqual({ links: 0, sso: 0, password: 1 });
  });

  test("3: a new issuer is a boundary: link and SSO session gone, password session stays, not required, unproved", async () => {
    const org = await seedOrg();
    expect(await setFor(org, await configOf(fakeA))).toEqual({ kind: "new" });
    await linkAnn(org);
    await db
      .updateTable("sso_providers")
      .set({ domain_verified: true, domain_proof: "attested" })
      .where("org_id", "=", org.orgId)
      .execute();
    await setRequired(org.orgId, true);

    expect(await setFor(org, await configOf(fakeB))).toEqual({ kind: "boundary", linksRemoved: 1, sessionsEnded: 1 });
    expect(await annState(org)).toEqual({ links: 0, sso: 0, password: 1 });
    expect(await requiredOf(org.orgId)).toBe(false);
    const [row] = await providerRows(org.orgId);
    expect(row).toMatchObject({ issuer: fakeB.issuer, domain_verified: false, domain_proof: null });
    const audit = await auditRows(org.orgId, auditEvents.ssoProviderSet);
    expect(audit[1]?.data).toMatchObject({ change: "boundary", links_removed: 1, sessions_ended: 1 });
  });

  test("3a: a new domain is a boundary too", async () => {
    const org = await seedOrg();
    const config = await configOf(fakeA);
    expect(await setFor(org, config)).toEqual({ kind: "new" });
    await db
      .updateTable("sso_providers")
      .set({ domain_verified: true, domain_proof: "dns" })
      .where("org_id", "=", org.orgId)
      .execute();
    expect(await setFor(org, config, freshDomain())).toEqual({ kind: "boundary", linksRemoved: 0, sessionsEnded: 0 });
    expect((await providerRows(org.orgId))[0]).toMatchObject({ domain_verified: false, domain_proof: null });
  });

  test("4: another organization's domain is domain_taken; a domain with only digit labels is domain_invalid", async () => {
    const a = await seedOrg();
    const b = await seedOrg();
    const config = await configOf(fakeA);
    expect(await setFor(a, config)).toEqual({ kind: "new" });

    expect(await setFor(b, await configOf(fakeB), a.domain)).toEqual({ kind: "domain_taken" });
    expect(await providerRows(b.orgId)).toHaveLength(0);
    expect(await auditRows(b.orgId, auditEvents.ssoProviderSet)).toHaveLength(0);

    for (const domain of ["1.2", "10.20.30", "x", "-a.test", "a b.test"]) {
      expect(await setFor(b, config, domain)).toEqual({ kind: "domain_invalid" });
    }
    expect(await providerRows(b.orgId)).toHaveLength(0);
  });

  test("4a: an unknown organization is not_found", async () => {
    const config = await configOf(fakeA);
    const result = await setSsoProvider(
      db,
      { orgId: randomUUID() },
      { ...config, domain: freshDomain(), actor: "cli", now: NOW }
    );
    expect(result).toEqual({ kind: "not_found" });
  });

  test("5: remove ends the links and SSO sessions, drops the row and the requirement; again: none", async () => {
    const org = await seedOrg();
    expect(await setFor(org, await configOf(fakeA))).toEqual({ kind: "new" });
    await linkAnn(org);
    await setRequired(org.orgId, true);

    expect(await removeSsoProvider(db, { orgId: org.orgId }, { actor: "cli", now: NOW })).toEqual({
      kind: "removed",
      linksRemoved: 1,
      sessionsEnded: 1,
    });
    expect(await providerRows(org.orgId)).toHaveLength(0);
    expect(await requiredOf(org.orgId)).toBe(false);
    expect(await annState(org)).toEqual({ links: 0, sso: 0, password: 1 });
    const audit = await auditRows(org.orgId, auditEvents.ssoProviderRemoved);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.data).toEqual({
      provider_id: org.orgId,
      issuer_host: new URL(fakeA.issuer).host,
      domain: org.domain,
      links_removed: 1,
      sessions_ended: 1,
    });

    expect(await removeSsoProvider(db, { orgId: org.orgId }, { actor: "cli", now: NOW })).toEqual({ kind: "none" });
    expect(await auditRows(org.orgId, auditEvents.ssoProviderRemoved)).toHaveLength(1);
  });

  test("6: discovery against a stopped fake IdP fails and no row is written", async () => {
    const org = await seedOrg();
    const stopped = await startFakeOidc();
    const { issuer, origin } = stopped;
    stopped.stop();
    const found = await discoverProviderConfig(issuer, { allowOrigins: [origin], timeoutMs: 2000 });
    expect(found.kind).toBe("failed");
    expect(await providerRows(org.orgId)).toHaveLength(0);
  });

  test("6b: an endpoint of the discovery document that resolves to a private address fails; a public one passes", async () => {
    // An IdP at an allowed origin whose document names endpoints at a DNS name (the plugin skips its own DNS check for these).
    let origin = "";
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (req) => {
        if (new URL(req.url).pathname !== "/.well-known/openid-configuration")
          return new Response("no", { status: 404 });
        return Response.json({
          issuer: origin,
          authorization_endpoint: "https://login.x.test/authorize",
          token_endpoint: "https://token.x.test/token",
          jwks_uri: `${origin}/jwks`,
        });
      },
    });
    origin = `http://127.0.0.1:${server.port}`;
    try {
      const lookupFor = (privateHost: string) => async (host: string) => [
        { address: host === privateHost ? "10.0.0.1" : "93.184.215.14", family: 4 },
      ];
      const options = { allowOrigins: [origin], timeoutMs: 2000 };
      expect(await discoverProviderConfig(origin, { ...options, lookup: lookupFor("token.x.test") })).toEqual({
        kind: "failed",
        code: "discovery_private_host",
      });
      const ok = await discoverProviderConfig(origin, { ...options, lookup: lookupFor("none.x.test") });
      expect(ok.kind).toBe("ok");
    } finally {
      void server.stop(true);
    }
  });

  test("6a: a break-glass owner with TOTP makes breakGlassReady true", async () => {
    const org = await seedOrg();
    expect(await setFor(org, await configOf(fakeA))).toEqual({ kind: "new" });
    await sql`UPDATE users SET two_factor_enabled = true WHERE id = ${org.userId}::uuid`.execute(db);
    await sql`UPDATE memberships SET break_glass = true WHERE org_id = ${org.orgId}::uuid AND user_id = ${org.userId}::uuid`.execute(
      db
    );
    expect((await getSsoState(db, { orgId: org.orgId }))?.breakGlassReady).toBe(true);
  });

  test("N1: the set takes the organization lock FOR NO KEY UPDATE: an open audit insert of the organization does not block it", async () => {
    const org = await seedOrg();
    const config = await configOf(fakeA);
    const outcome = await db.transaction().execute(async (trx) => {
      // The refusal row of a callback: its foreign key takes a key share on the organization and holds it until commit.
      await recordAudit(
        trx,
        { orgId: org.orgId },
        { actor: "system", event: auditEvents.ssoRefused, data: { code: "x" } }
      );
      const set = setSsoProvider(db, { orgId: org.orgId }, { ...config, domain: org.domain, actor: "cli", now: NOW });
      const timeout = new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 3000));
      return Promise.race([set, timeout]);
    });
    expect(outcome).toEqual({ kind: "new" });
  });

  test("10: no output and no audit row of tests 1 to 6 holds a client secret or the oidc config", async () => {
    const org = await seedOrg();
    const secret = `secret-${randomBytes(8).toString("hex")}`;
    const first = await configOf(fakeA, { clientSecret: secret });
    expect(await setFor(org, first)).toEqual({ kind: "new" });
    expect(await setFor(org, await configOf(fakeA, { clientSecret: `${secret}-2` }))).toEqual({ kind: "secret" });
    expect(await setFor(org, await configOf(fakeB))).toMatchObject({ kind: "boundary" });
    expect(await removeSsoProvider(db, { orgId: org.orgId }, { actor: "cli", now: NOW })).toMatchObject({
      kind: "removed",
    });

    const audit = JSON.stringify([
      ...(await auditRows(org.orgId, auditEvents.ssoProviderSet)),
      ...(await auditRows(org.orgId, auditEvents.ssoProviderRemoved)),
    ]);
    const everything = `${output.join("\n")}\n${audit}\n${JSON.stringify(await getSsoState(db, { orgId: org.orgId }))}`;
    for (const needle of [secret, fakeA.clientSecret, fakeB.clientSecret, "oidc_config", "clientSecret"]) {
      expect(everything).not.toContain(needle);
    }
  });
});

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// A promise that has not settled after `ms` milliseconds.
async function stillPending(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let settled = false;
  void promise.then(
    () => (settled = true),
    () => (settled = true)
  );
  await sleep(ms);
  return !settled;
}

describe("review gaps of stage 07 (TG1 to TG4)", () => {
  test("TG1: removing the provider of org A leaves org B's row, link, SSO session and requirement", async () => {
    const a = await seedOrg();
    const b = await seedOrg();
    expect(await setFor(a, await configOf(fakeA))).toEqual({ kind: "new" });
    expect(await setFor(b, await configOf(fakeB))).toEqual({ kind: "new" });
    await linkAnn(b);
    await setRequired(b.orgId, true);

    expect(await removeSsoProvider(db, { orgId: a.orgId }, { actor: "cli", now: NOW })).toEqual({
      kind: "removed",
      linksRemoved: 0,
      sessionsEnded: 0,
    });
    expect(await providerRows(a.orgId)).toHaveLength(0);
    const rows = await providerRows(b.orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider_id: b.orgId, issuer: fakeB.issuer, domain: b.domain });
    expect(await annState(b)).toEqual({ links: 1, sso: 1, password: 1 });
    expect(await requiredOf(b.orgId)).toBe(true);
    expect(await auditRows(b.orgId, auditEvents.ssoProviderRemoved)).toHaveLength(0);
  });

  test("TG2: the jwks and userinfo hosts of a discovery document get the DNS check", async () => {
    let origin = "";
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (req) => {
        if (new URL(req.url).pathname !== "/.well-known/openid-configuration")
          return new Response("no", { status: 404 });
        return Response.json({
          issuer: origin,
          authorization_endpoint: `${origin}/authorize`,
          token_endpoint: `${origin}/token`,
          jwks_uri: "https://keys.x.test/jwks",
          userinfo_endpoint: "https://ui.x.test/userinfo",
        });
      },
    });
    origin = `http://127.0.0.1:${server.port}`;
    try {
      const lookupFor = (privateHost: string) => async (host: string) => [
        { address: host === privateHost ? "10.0.0.1" : "93.184.215.14", family: 4 },
      ];
      const options = { allowOrigins: [origin], timeoutMs: 2000 };
      for (const host of ["keys.x.test", "ui.x.test"]) {
        expect(await discoverProviderConfig(origin, { ...options, lookup: lookupFor(host) })).toEqual({
          kind: "failed",
          code: "discovery_private_host",
        });
      }
      expect((await discoverProviderConfig(origin, { ...options, lookup: lookupFor("none.x.test") })).kind).toBe("ok");
    } finally {
      void server.stop(true);
    }
  });

  test("TG3: a domain race on a new row: the loser gets domain_taken, no row and no audit row", async () => {
    const a = await seedOrg();
    const b = await seedOrg();
    const domain = freshDomain();
    const configA = await configOf(fakeA);
    const configB = await configOf(fakeB);

    const loser = await db.transaction().execute(async (trx) => {
      expect(await setSsoProvider(trx, { orgId: a.orgId }, { ...configA, domain, actor: "cli", now: NOW })).toEqual({
        kind: "new",
      });
      const pending = setFor(b, configB, domain);
      expect(await stillPending(pending, 500)).toBe(true);
      return { pending };
    });
    expect(await loser.pending).toEqual({ kind: "domain_taken" });
    expect(await providerRows(b.orgId)).toHaveLength(0);
    expect(await auditRows(b.orgId, auditEvents.ssoProviderSet)).toHaveLength(0);
    expect((await providerRows(a.orgId))[0]?.domain).toBe(domain);
  });

  test("TG3a: a domain race on an existing row: the loser gets domain_taken and keeps its row", async () => {
    const a = await seedOrg();
    const b = await seedOrg();
    const domain = freshDomain();
    const configA = await configOf(fakeA);
    const configB = await configOf(fakeB);
    expect(await setFor(b, configB)).toEqual({ kind: "new" });

    const loser = await db.transaction().execute(async (trx) => {
      expect(await setSsoProvider(trx, { orgId: a.orgId }, { ...configA, domain, actor: "cli", now: NOW })).toEqual({
        kind: "new",
      });
      const pending = setFor(b, configB, domain);
      expect(await stillPending(pending, 500)).toBe(true);
      return { pending };
    });
    expect(await loser.pending).toEqual({ kind: "domain_taken" });
    const rows = await providerRows(b.orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.domain).toBe(b.domain);
    expect(await auditRows(b.orgId, auditEvents.ssoProviderSet)).toHaveLength(1);
  });

  test("TG4: a removal waits for a callback in flight, then ends the link and the session it made", async () => {
    const org = await seedOrg();
    expect(await setFor(org, await configOf(fakeA))).toEqual({ kind: "new" });

    const held = await db.transaction().execute(async (trx) => {
      // The plugin holds the provider row like this during a callback.
      await sql`UPDATE sso_providers SET provider_id = provider_id WHERE org_id = ${org.orgId}::uuid`.execute(trx);
      const removal = removeSsoProvider(db, { orgId: org.orgId }, { actor: "cli", now: NOW });
      expect(await stillPending(removal, 500)).toBe(true);
      await sql`INSERT INTO auth_accounts (account_id, provider_id, user_id) VALUES (${`sub-${org.userId}`}, ${org.orgId}, ${org.userId}::uuid)`.execute(
        trx
      );
      await sql`INSERT INTO auth_sessions (token, user_id, expires_at, sign_in_method, sso_started_at)
        VALUES (${randomBytes(16).toString("hex")}, ${org.userId}::uuid, now() + interval '1 hour', 'sso', now())`.execute(
        trx
      );
      return { removal };
    });
    expect(await held.removal).toEqual({ kind: "removed", linksRemoved: 1, sessionsEnded: 1 });
    expect(await providerRows(org.orgId)).toHaveLength(0);
    expect((await annState(org)).links).toBe(0);
  });
});
