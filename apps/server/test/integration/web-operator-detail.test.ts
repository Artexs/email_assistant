import { randomBytes, randomUUID } from "node:crypto";

import { operatorNoticesSchema, operatorOrgDetailSchema, type OperatorNotices, type OperatorOrgDetail } from "@ea/core";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { auditEvents, recordAudit } from "../../src/modules/audit";
import { insertOutbox } from "../../src/modules/channels";
import { operatorRoutes } from "../../src/modules/operator/routes";
import { insertMailbox } from "../../src/modules/mail/repo";
import { insertDigest, markDigestSent } from "../../src/modules/reports";
import { upsertOrgFeature } from "../../src/modules/tenancy";
import { loadConfig } from "../../src/platform/config";
import { createSecretBox } from "../../src/platform/crypto";
import { apiRouters } from "../../src/web";

import { insertAction, insertTestEmail, insertTriaged, testCapabilities } from "./fixtures";
import { testDb } from "./helpers";
import { as, TEST_ORIGIN, webOrg, webTestApp, type WebOrg } from "./web-helpers";

// F099 stage 08: GET /api/operator/orgs/:orgId and GET /api/operator/notices (plan D15, D16, D17, D19).
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
  botUsername: null,
};
const NOW = new Date("2026-11-20T10:00:00Z");
const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
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
      async () => []
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
    lastSyncedAt: at(-5 * MINUTE),
    statusChangedAt: at(-3 * DAY),
  });
  authErrorId = await insertMailboxRow(org.orgId, "auth_error", {
    lastSyncedAt: null,
    statusChangedAt: at(-30 * HOUR),
  });
  await db.transaction().execute(async (trx) => {
    await insertTriaged(trx, ctx, activeId, { category: "info", createdAt: at(-10 * MINUTE) });
    const digestId = await insertDigest(trx, ctx, {
      userId: org.ownerId,
      slotKey: "2026-11-20T07:00",
      periodStart: at(-12 * HOUR),
      periodEnd: at(-3 * HOUR),
    });
    await markDigestSent(trx, ctx, digestId as string, at(-3 * HOUR));
    const emailId = await insertTestEmail(trx, ctx, activeId);
    await insertAction(trx, ctx, emailId, {
      type: "send",
      status: "applied",
      appliedAt: at(-1 * HOUR),
      approvedAt: at(-1 * HOUR),
    });
    await insertOutbox(trx, ctx, {
      userId: org.ownerId,
      kind: "sync_ok",
      dedupKey: `sync_ok:${randomUUID()}`,
      mailboxId: activeId,
      view: {},
      locale: "en",
      createdAt: at(-30 * MINUTE),
      nextAttemptAt: at(-30 * MINUTE),
    });
  });
  await db
    .updateTable("outbox")
    .set({ status: "sent", sent_at: at(-20 * MINUTE) })
    .where("org_id", "=", org.orgId)
    .execute();
  await upsertOrgFeature(db, ctx, { flag: "stats_page", enabled: true, setBy: "test", setAt: at(-DAY) });
  await notice(org.orgId, "trial_ending", "trial_ending:a", at(-1 * HOUR));
  await notice(org.otherOrgId, "llm_cap", "llm_cap:b", at(-2 * HOUR));
  await notice(org.orgId, "auth_error_24h", "auth_error_24h:a", at(-10 * DAY));
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
        statusChangedAt: at(-3 * DAY).toISOString(),
        lastSyncedAt: at(-5 * MINUTE).toISOString(),
      },
      {
        mailboxId: authErrorId,
        status: "auth_error",
        statusChangedAt: at(-30 * HOUR).toISOString(),
        lastSyncedAt: null,
      },
    ]);
    expect(body.lastRuns).toEqual({
      sync: at(-5 * MINUTE).toISOString(),
      triage: at(-10 * MINUTE).toISOString(),
      digest: at(-3 * HOUR).toISOString(),
      send: at(-1 * HOUR).toISOString(),
      notice: at(-20 * MINUTE).toISOString(),
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
    const routes = operatorRoutes({ db: noDb, now: () => NOW });
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
    expect(weekBody.since).toBe(at(-7 * DAY).toISOString());
    expect(mine(weekBody)).toEqual([
      { orgId: org.orgId, kind: "trial_ending", key: "trial_ending:a", at: at(-1 * HOUR).toISOString() },
      { orgId: org.otherOrgId, kind: "llm_cap", key: "llm_cap:b", at: at(-2 * HOUR).toISOString() },
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
});
