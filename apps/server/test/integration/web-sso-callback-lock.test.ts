import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, expect, spyOn, test } from "bun:test";
import { sql } from "kysely";

import {
  configureFeatures,
  createOrganizationWithOwner,
  removeSsoProvider,
  setOrgFeature,
  unlinkSso,
} from "../../src/modules/tenancy";
import { loadConfig } from "../../src/platform/config";
import { createSecretBox } from "../../src/platform/crypto";
import { createApp } from "../../src/platform/http";
import { setLogLevel } from "../../src/platform/log";
import { webDeps } from "../../src/web";
import { startFakeOidc, type FakeOidc } from "../fake-oidc";
import { fakeOidcConfig, nextIp, ssoSignIn, SSO_TEST_ORIGIN, type SsoSignInResult } from "../sso-helpers";

import { testDb } from "./helpers";

// A real SSO callback holds the provider row (the plugin runs `UPDATE sso_providers SET provider_id = provider_id` first
// in the callback transaction), so an unlink or a removal that races a callback never leaves a half state
// (`unlinkSso`, `removeSsoProvider`: they take the provider row `FOR UPDATE`). The callback is held in flight by a lock on
// `org_features`, which the resolver reads right after the plugin took the provider lock. Both sides are checked through
// the production wiring (`webDeps`) and a fake IdP.
const db = testDb();
const NOW = new Date("2026-11-19T10:00:00Z");

type App = ReturnType<typeof createApp>;

let fake: FakeOidc;
let dist = "";
let app: App;
let closeWeb: () => Promise<void>;
const orgIds: string[] = [];
const userIds: string[] = [];
const spies: ReturnType<typeof spyOn>[] = [];

beforeAll(async () => {
  fake = await startFakeOidc();
  dist = mkdtempSync(join(tmpdir(), "ea-sso-lock-dist-"));
  writeFileSync(join(dist, "404.html"), "not found page");
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    spies.push(spyOn(console, method).mockImplementation((): void => undefined));
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
      sendScope: { kind: "off" },
      botUsername: null,
    }
  );
  if (web === null) throw new Error("webDeps returned null");
  closeWeb = () => web.close();
  app = createApp({ checkDb: async () => true, web: { ...web, connInfo: (c) => c.req.header("x-client-ip") } });
});

afterEach(async () => {
  setLogLevel("info");
  configureFeatures({ off: [] });
  for (const orgId of orgIds.splice(0)) await db.deleteFrom("organizations").where("id", "=", orgId).execute();
  const ids = userIds.splice(0);
  if (ids.length > 0) await db.deleteFrom("users").where("id", "in", ids).execute();
});

afterAll(async () => {
  for (const spy of spies) spy.mockRestore();
  await closeWeb();
  fake.stop();
  rmSync(dist, { recursive: true, force: true });
  await db.destroy();
});

interface SsoOrg {
  orgId: string;
  domain: string;
  email: string;
  userId: string;
}

// An organization with a member on the provider domain, a proved provider row at the fake IdP and the flag `sso_sign_in`.
async function ssoOrg(): Promise<SsoOrg> {
  const domain = `d${randomUUID().replaceAll("-", "")}.x.test`;
  const email = `ann@${domain}`;
  const { orgId, userId } = await createOrganizationWithOwner(db, {
    orgName: "Sso lock org",
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
      domain_verified: true,
      domain_proof: "dns",
      oidc_config: fakeOidcConfig(fake),
    })
    .execute();
  fake.registerRedirectUri(`${SSO_TEST_ORIGIN}/api/auth/sso/callback/${orgId}`);
  await setOrgFeature(db, { orgId }, { flag: "sso_sign_in", enabled: true, actor: "test", now: new Date() });
  fake.setUser({ sub: `sub-${userId}`, email, emailVerified: true });
  return { orgId, domain, email, userId };
}

// Holds an exclusive lock on `org_features` until `release()`: the resolver of the callback cannot read the flag, so the callback stays in flight.
async function holdFeaturesTable(): Promise<{ release: () => Promise<void> }> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let held!: () => void;
  const locked = new Promise<void>((resolve) => (held = resolve));
  const tx = db.transaction().execute(async (trx) => {
    await sql`LOCK TABLE org_features IN ACCESS EXCLUSIVE MODE`.execute(trx);
    held();
    await released;
  });
  await locked;
  return {
    release: async () => {
      release();
      await tx;
    },
  };
}

// Polls until `count` backends of this database wait for a lock.
async function waitForLockWaiters(count: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const result = await sql<{ n: number }>`SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`.execute(db);
    if ((result.rows[0]?.n ?? 0) >= count) return;
    if (Date.now() > deadline) throw new Error(`no ${count} lock waiters after 10 s`);
    await Bun.sleep(25);
  }
}

const callbackOf = (org: SsoOrg): Promise<SsoSignInResult> =>
  ssoSignIn(app, fake, { email: org.email, providerId: org.orgId });

async function counts(org: SsoOrg): Promise<{ links: number; ssoSessions: number; providers: number }> {
  const result = await sql<{ links: number; sessions: number; providers: number }>`SELECT
      (SELECT count(*)::int FROM auth_accounts WHERE provider_id = ${org.orgId} AND user_id = ${org.userId}::uuid) AS links,
      (SELECT count(*)::int FROM auth_sessions WHERE user_id = ${org.userId}::uuid AND sign_in_method = 'sso') AS sessions,
      (SELECT count(*)::int FROM sso_providers WHERE org_id = ${org.orgId}::uuid) AS providers`.execute(db);
  const row = result.rows[0];
  return { links: row?.links ?? -1, ssoSessions: row?.sessions ?? -1, providers: row?.providers ?? -1 };
}

test("an unlink that starts while a callback is in flight waits, then removes the link and the session the callback made", async () => {
  const org = await ssoOrg();
  const hold = await holdFeaturesTable();
  const callback = callbackOf(org);
  // The callback reaches the resolver (blocked on the table lock), so it holds the provider row.
  await waitForLockWaiters(1);
  const unlink = unlinkSso(db, { orgId: org.orgId }, { userId: org.userId, actor: "test", now: NOW });
  await waitForLockWaiters(2);
  expect(await counts(org)).toEqual({ links: 0, ssoSessions: 0, providers: 1 });

  await hold.release();
  const signedIn = await callback;
  expect(signedIn.location).toBe("/app");
  expect(signedIn.sessionCookie).not.toBeNull();
  // The unlink ran after the callback commit: it saw the link, so it ended the link and the session.
  expect(await unlink).toEqual({ kind: "unlinked", sessionsEnded: 1 });
  expect(await counts(org)).toEqual({ links: 0, ssoSessions: 0, providers: 1 });
}, 30_000);

test("a provider removal that starts while a callback is in flight waits, then removes the link and the session", async () => {
  const org = await ssoOrg();
  const hold = await holdFeaturesTable();
  const callback = callbackOf(org);
  await waitForLockWaiters(1);
  const removal = removeSsoProvider(db, { orgId: org.orgId }, { actor: "cli", now: NOW, confirmDomain: org.domain });
  await waitForLockWaiters(2);

  await hold.release();
  expect((await callback).location).toBe("/app");
  expect(await removal).toEqual({ kind: "removed", linksRemoved: 1, sessionsEnded: 1 });
  expect(await counts(org)).toEqual({ links: 0, ssoSessions: 0, providers: 0 });
}, 30_000);

test("a callback that starts while the removal holds the provider row ends in an error: no link, no session", async () => {
  const org = await ssoOrg();
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let held!: () => void;
  const locked = new Promise<void>((resolve) => (held = resolve));
  // The removal's own lock and delete, held open by the test.
  const removal = db.transaction().execute(async (trx) => {
    await sql`SELECT 1 FROM sso_providers WHERE org_id = ${org.orgId}::uuid FOR UPDATE`.execute(trx);
    held();
    await released;
    await sql`DELETE FROM sso_providers WHERE org_id = ${org.orgId}::uuid`.execute(trx);
  });
  await locked;
  const callback = callbackOf(org);
  await waitForLockWaiters(1);
  release();
  await removal;

  const result = await callback;
  expect(result.sessionCookie).toBeNull();
  expect(result.location).toContain("/login?sso=failed");
  expect(await counts(org)).toEqual({ links: 0, ssoSessions: 0, providers: 0 });
}, 30_000);
