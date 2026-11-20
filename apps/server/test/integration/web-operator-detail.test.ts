import { randomBytes, randomUUID } from "node:crypto";

import {
  operatorNoticesSchema,
  operatorOrgDetailSchema,
  type OperatorNotices,
  type OperatorOrgDetail,
  MINUTE_MS,
  HOUR_MS,
  DAY_MS,
} from "@ea/core";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { auditEvents, recordAudit } from "../../src/modules/audit";
import { insertOutbox } from "../../src/modules/channels";
import { insertMailbox } from "../../src/modules/mail/repo";
import { listOperatorNotices } from "../../src/modules/operator";
import { operatorRoutes } from "../../src/modules/operator/routes";
import { insertDigest, markDigestSent } from "../../src/modules/reports";
import { upsertOrgFeature } from "../../src/modules/tenancy";
import { loadConfig } from "../../src/platform/config";
import { createSecretBox } from "../../src/platform/crypto";
import { apiRouters } from "../../src/web";

import { insertAction, insertTestEmail, insertTriaged, testCapabilities } from "./fixtures";
import { testDb } from "./helpers";
import { as, noBackupCodes, noPrivacy, TEST_ORIGIN, webOrg, webTestApp, type WebOrg } from "./web-helpers";

// GET /api/operator/orgs/:orgId and GET /api/operator/notices.
const db = testDb();
const key = randomBytes(32).toString("base64");
const testConfig = loadConfig({
  DATABASE_URL: process.env.DATABASE_URL,
  CREDENTIALS_KEY: key,
  WEB_BASE_URL: TEST_ORIGIN,
  WEB_AUTH_SECRET: "x".repeat(32),
});
const extras = {
  secrets: createSecretBox(key, 1),
  actionsScope: { kind: "off" } as const,
  sendScope: { kind: "off" } as const,
  botUsername: null,
};
const NOW = new Date("2026-11-20T10:00:00Z");
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

let org: WebOrg;
let activeId: string;
let authErrorId: string;
const sessions = () => ({ owner: org.ownerId, assistant: org.assistantId, other: org.otherOwnerId });
const app = () =>
  webTestApp({
    db,
    sessions: sessions(),
    routers: apiRouters(
      testConfig,
      db,
      extras,
      () => NOW,
      async () => [],
      noBackupCodes,
      noPrivacy
    ),
    operatorUserIds: new Set([org.assistantId]),
  });

async function insertMailboxRow(
  orgId: string,
  status: "active" | "auth_error",
  times: { lastSyncedAt: Date | null; statusChangedAt: Date }
) {
  const id = randomUUID();
  await insertMailbox(
    db,
    { orgId },
    {
      id,
      address: `operator-detail-${id}@x.test`,
      imapHost: "imap.x.test",
      imapPort: 993,
      smtpHost: "smtp.x.test",
      smtpPort: 465,
      capabilities: testCapabilities,
      folderMap: { drafts: "Drafts" },
    }
  );
  await db
    .updateTable("mailboxes")
    .set({ status, last_synced_at: times.lastSyncedAt, status_changed_at: times.statusChangedAt })
    .where("org_id", "=", orgId)
    .where("id", "=", id)
    .execute();
  return id;
}

const notice = (orgId: string, kind: string, noticeKey: string, when: Date) =>
  recordAudit(
    db,
    { orgId },
    { actor: "system", event: auditEvents.operatorNotice, data: { kind, key: noticeKey }, at: when }
  );

beforeAll(async () => {
  org = await webOrg(db);
  const ctx = { orgId: org.orgId };
  activeId = await insertMailboxRow(org.orgId, "active", {
    lastSyncedAt: at(-5 * MINUTE_MS),
    statusChangedAt: at(-3 * DAY_MS),
  });
  authErrorId = await insertMailboxRow(org.orgId, "auth_error", {
    lastSyncedAt: null,
    statusChangedAt: at(-30 * HOUR_MS),
  });
  await db.transaction().execute(async (trx) => {
    await insertTriaged(trx, ctx, activeId, { category: "info", createdAt: at(-10 * MINUTE_MS) });
    const digestId = await insertDigest(trx, ctx, {
      userId: org.ownerId,
      slotKey: "2026-11-20T07:00",
      periodStart: at(-12 * HOUR_MS),
      periodEnd: at(-3 * HOUR_MS),
    });
    await markDigestSent(trx, ctx, digestId as string, at(-3 * HOUR_MS));
    const emailId = await insertTestEmail(trx, ctx, activeId);
    await insertAction(trx, ctx, emailId, {
      type: "send",
      status: "applied",
      appliedAt: at(-1 * HOUR_MS),
      approvedAt: at(-1 * HOUR_MS),
    });
    await insertOutbox(trx, ctx, {
      userId: org.ownerId,
      kind: "sync_ok",
      dedupKey: `sync_ok:${randomUUID()}`,
      mailboxId: activeId,
      view: {},
      locale: "en",
      createdAt: at(-30 * MINUTE_MS),
      nextAttemptAt: at(-30 * MINUTE_MS),
    });
  });
  await db
    .updateTable("outbox")
    .set({ status: "sent", sent_at: at(-20 * MINUTE_MS) })
    .where("org_id", "=", org.orgId)
    .execute();
  await upsertOrgFeature(db, ctx, { flag: "stats_page", enabled: true, setBy: "test", setAt: at(-DAY_MS) });
  await notice(org.orgId, "trial_ending", "trial_ending:a", at(-1 * HOUR_MS));
  await notice(org.otherOrgId, "llm_cap", "llm_cap:b", at(-2 * HOUR_MS));
  await notice(org.orgId, "auth_error_24h", "auth_error_24h:a", at(-10 * DAY_MS));
});

afterAll(async () => {
  // Deleting the organizations removes their rows (the cascade); the helper deletes the users.
  await org.cleanup();
  await db.destroy();
});

const paths = () => [`/api/operator/orgs/${org.orgId}`, "/api/operator/notices"];

describe("operator detail and notices (F099 stage 08)", () => {
  test("3. no session answers 401; the owner of A and the owner of B answer 404", async () => {
    for (const path of paths()) {
      const anon = await app().request(path, { headers: { origin: TEST_ORIGIN } });
      expect({ path, status: anon.status }).toEqual({ path, status: 401 });
      for (const who of ["owner", "other"]) {
        const res = await app().request(path, as(who));
        expect({ path, who, status: res.status, body: await res.json() }).toEqual({
          path,
          who,
          status: 404,
          body: { error: "not_found" },
        });
      }
    }
  });

  test("4. the operator reads organization A: mailboxes, last runs, flags", async () => {
    const res = await app().request(`/api/operator/orgs/${org.orgId}`, as("assistant"));
    expect(res.status).toBe(200);
    const body: OperatorOrgDetail = operatorOrgDetailSchema.parse(await res.json());
    expect(body.orgId).toBe(org.orgId);
    expect(body.at).toBe(NOW.toISOString());
    expect(body.mailboxes).toEqual([
      {
        mailboxId: activeId,
        status: "active",
        statusChangedAt: at(-3 * DAY_MS).toISOString(),
        lastSyncedAt: at(-5 * MINUTE_MS).toISOString(),
      },
      {
        mailboxId: authErrorId,
        status: "auth_error",
        statusChangedAt: at(-30 * HOUR_MS).toISOString(),
        lastSyncedAt: null,
      },
    ]);
    expect(body.lastRuns).toEqual({
      sync: at(-5 * MINUTE_MS).toISOString(),
      triage: at(-10 * MINUTE_MS).toISOString(),
      digest: at(-3 * HOUR_MS).toISOString(),
      send: at(-1 * HOUR_MS).toISOString(),
      notice: at(-20 * MINUTE_MS).toISOString(),
    });
    expect(body.flags).toContainEqual({ flag: "stats_page", enabled: true, source: "row" });
    expect(body.failures24h).toEqual({ sends: 0, outbox: 0 });
  });

  test("5. organization B has no mailboxes and no runs", async () => {
    const res = await app().request(`/api/operator/orgs/${org.otherOrgId}`, as("assistant"));
    expect(res.status).toBe(200);
    const body = operatorOrgDetailSchema.parse(await res.json());
    expect(body.mailboxes).toEqual([]);
    expect(body.lastRuns).toEqual({ sync: null, triage: null, digest: null, send: null, notice: null });
    expect(body.sso).toBeNull();
  });

  test("6. an id that is not a UUID and an unknown UUID answer 404 not_found", async () => {
    for (const id of ["not-a-uuid", randomUUID()]) {
      const res = await app().request(`/api/operator/orgs/${id}`, as("assistant"));
      expect({ id, status: res.status, body: await res.json() }).toEqual({
        id,
        status: 404,
        body: { error: "not_found" },
      });
    }
  });

  test("6b. an id that is not a UUID answers 404 before any database call", async () => {
    const noDb = new Proxy({}, { get: () => Promise.reject(new Error("database call")) }) as never;
    const routes = operatorRoutes({ db: noDb, now: () => NOW, planHooks: {} });
    for (const id of ["not-a-uuid", "123", "%20"]) {
      const res = await routes.request(`/orgs/${id}`);
      expect({ id, status: res.status, body: await res.json() }).toEqual({
        id,
        status: 404,
        body: { error: "not_found" },
      });
    }
  });

  test("7. notices: A and B rows newest first, `days` widens the window, bad `days` answers 400", async () => {
    const mine = (body: OperatorNotices) =>
      body.notices.filter((row) => row.orgId === org.orgId || row.orgId === org.otherOrgId);
    const week = await app().request("/api/operator/notices", as("assistant"));
    expect(week.status).toBe(200);
    const weekBody = operatorNoticesSchema.parse(await week.json());
    expect(weekBody.since).toBe(at(-7 * DAY_MS).toISOString());
    expect(mine(weekBody)).toEqual([
      { orgId: org.orgId, kind: "trial_ending", key: "trial_ending:a", at: at(-1 * HOUR_MS).toISOString() },
      { orgId: org.otherOrgId, kind: "llm_cap", key: "llm_cap:b", at: at(-2 * HOUR_MS).toISOString() },
    ]);
    const month = await app().request("/api/operator/notices?days=30", as("assistant"));
    expect(mine(operatorNoticesSchema.parse(await month.json())).map((row) => row.kind)).toEqual([
      "trial_ending",
      "llm_cap",
      "auth_error_24h",
    ]);
    for (const days of ["0", "31"]) {
      const res = await app().request(`/api/operator/notices?days=${days}`, as("assistant"));
      expect({ days, status: res.status }).toEqual({ days, status: 400 });
    }
  });

  // Golden: the order of equal times, as the per-organization reads gave it before the list was batched.
  test("7b. notices of one time: by organization id, and inside one organization the newest row first", async () => {
    const when = at(-3 * DAY_MS);
    await notice(org.orgId, "llm_cap", "tie:a1", when);
    await notice(org.orgId, "llm_cap", "tie:a2", when);
    await notice(org.otherOrgId, "llm_cap", "tie:b1", when);
    const res = await app().request("/api/operator/notices", as("assistant"));
    const rows = operatorNoticesSchema.parse(await res.json()).notices.filter((row) => row.key.startsWith("tie:"));
    const orgs = [org.orgId, org.otherOrgId].sort((x, y) => x.localeCompare(y));
    const keysOf = (orgId: string) => (orgId === org.orgId ? ["tie:a2", "tie:a1"] : ["tie:b1"]);
    expect(rows.map((row) => `${row.orgId}:${row.key}`)).toEqual(
      orgs.flatMap((orgId) => keysOf(orgId).map((key) => `${orgId}:${key}`))
    );
  });

  test("7c. the notice list reads once, not once per organization", async () => {
    let queries = 0;
    const counted = db.withPlugin({
      transformQuery: (args) => {
        queries += 1;
        return args.node;
      },
      transformResult: (args) => Promise.resolve(args.result),
    });
    await listOperatorNotices({ db: counted, now: () => NOW }, 7);
    expect(queries).toBeLessThanOrEqual(2);
  });

  test("8. neither body holds an organization name, an address or a display name", async () => {
    for (const path of [
      `/api/operator/orgs/${org.orgId}`,
      `/api/operator/orgs/${org.otherOrgId}`,
      "/api/operator/notices?days=30",
    ]) {
      const text = await (await app().request(path, as("assistant"))).text();
      for (const forbidden of ["Web org", "Web other org", "@x.test", "Owner", "Assistant"]) {
        expect({ path, forbidden, found: text.includes(forbidden) }).toEqual({ path, forbidden, found: false });
      }
    }
  });

  test("9. F119: org A with a proved provider shows the sso object, org B without a provider shows null; no issuer, client id or secret", async () => {
    await db
      .insertInto("sso_providers")
      .values({
        provider_id: org.orgId,
        org_id: org.orgId,
        issuer: "https://login.idp-issuer.test/tenant-guid",
        domain: "x.test",
        domain_verified: true,
        domain_proof: "dns",
        oidc_config: JSON.stringify({ clientId: "client-id-canary", clientSecret: "client-secret-canary" }),
      })
      .execute();
    // One linked member (Ann: the assistant) and a break-glass owner with TOTP on (Olaf: the owner).
    await db
      .insertInto("auth_accounts")
      .values({ account_id: "idp-subject-ann", provider_id: org.orgId, user_id: org.assistantId })
      .execute();
    await db
      .updateTable("memberships")
      .set({ break_glass: true })
      .where("org_id", "=", org.orgId)
      .where("user_id", "=", org.ownerId)
      .execute();
    await db.updateTable("users").set({ two_factor_enabled: true }).where("id", "=", org.ownerId).execute();
    try {
      const resA = await app().request(`/api/operator/orgs/${org.orgId}`, as("assistant"));
      const textA = await resA.text();
      const a = operatorOrgDetailSchema.parse(JSON.parse(textA));
      expect(a.sso).toEqual({
        domain: "x.test",
        proof: "dns",
        required: false,
        linkedMembers: 1,
        breakGlassReady: true,
      });
      for (const forbidden of [
        "issuer",
        "clientId",
        "clientSecret",
        "client-id-canary",
        "client-secret-canary",
        "idp-issuer",
        "idp-subject-ann",
        org.ownerId,
        org.assistantId,
      ]) {
        expect({ forbidden, found: textA.includes(forbidden) }).toEqual({ forbidden, found: false });
      }

      const resB = await app().request(`/api/operator/orgs/${org.otherOrgId}`, as("assistant"));
      expect(operatorOrgDetailSchema.parse(await resB.json()).sso).toBeNull();

      // The state follows the rows: required on, attested proof, TOTP off.
      await db.updateTable("organizations").set({ sso_required: true }).where("id", "=", org.orgId).execute();
      await db.updateTable("sso_providers").set({ domain_proof: "attested" }).where("org_id", "=", org.orgId).execute();
      await db.updateTable("users").set({ two_factor_enabled: false }).where("id", "=", org.ownerId).execute();
      const again = operatorOrgDetailSchema.parse(
        await (await app().request(`/api/operator/orgs/${org.orgId}`, as("assistant"))).json()
      );
      expect(again.sso).toEqual({
        domain: "x.test",
        proof: "attested",
        required: true,
        linkedMembers: 1,
        breakGlassReady: false,
      });
    } finally {
      await db.deleteFrom("auth_accounts").where("provider_id", "=", org.orgId).execute();
      await db.deleteFrom("sso_providers").where("org_id", "=", org.orgId).execute();
      await db.updateTable("organizations").set({ sso_required: false }).where("id", "=", org.orgId).execute();
      await db.updateTable("memberships").set({ break_glass: false }).where("org_id", "=", org.orgId).execute();
      await db.updateTable("users").set({ two_factor_enabled: false }).where("id", "=", org.ownerId).execute();
    }
  });
});
