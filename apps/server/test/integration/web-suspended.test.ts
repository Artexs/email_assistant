import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { sql } from "kysely";

import { isOrgSuspended } from "../../src/modules/tenancy";
import { loadConfig } from "../../src/platform/config";
import { createSecretBox } from "../../src/platform/crypto";
import { apiRouters } from "../../src/web";

import { testDb } from "./helpers";
import { as, noBackupCodes, noPrivacy, TEST_ORIGIN, webOrg, webTestApp, type WebOrg } from "./web-helpers";

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

// The 20 write routes of S6a (F4), written out: a new write route fails this test until it is listed here.
const WRITE_ROUTES = [
  "DELETE /api/channels/telegram/link",
  "DELETE /api/mailboxes/:id",
  "DELETE /api/rules/:id",
  "PATCH /api/me/digest-times",
  "PATCH /api/organization",
  "PATCH /api/settings/:mailboxId/auto/:category",
  "PATCH /api/settings/:mailboxId/mode",
  "PATCH /api/settings/:mailboxId/switches/:name",
  "PATCH /api/settings/:mailboxId/sync-folders/:key",
  "POST /api/actions/:id/mistake",
  "POST /api/actions/:id/reject-reason",
  "POST /api/actions/undo",
  "POST /api/channels/telegram/link",
  "POST /api/feedback",
  "POST /api/mailboxes",
  "POST /api/mailboxes/:id/password",
  "POST /api/mailboxes/:id/pause",
  "POST /api/mailboxes/:id/resume",
  "POST /api/onboarding/keep-mode",
  "POST /api/rules",
];

// Write routes in `SUSPENDED_WRITE_ALLOW`: a paused account may still call them (web-terms.test.ts proves it).
const ALLOWED_WHEN_SUSPENDED = [
  "DELETE /api/organization",
  "POST /api/me/terms",
  "PATCH /api/me/locale",
  "POST /api/operator/orgs/:orgId/flags",
  "POST /api/operator/orgs/:orgId/plan",
];

let org: WebOrg;
const sessions = () => ({ owner: org.ownerId, assistant: org.assistantId, other: org.otherOwnerId });
const routers = () =>
  apiRouters(
    testConfig,
    db,
    extras,
    () => new Date(),
    async () => [],
    noBackupCodes,
    noPrivacy
  );

const suspendedApp = () =>
  webTestApp({
    db,
    sessions: sessions(),
    routers: routers(),
    isOrgSuspended: (id) => isOrgSuspended(db, { orgId: id }),
  });

beforeAll(async () => {
  org = await webOrg(db);
  await sql`UPDATE organizations SET plan = 'suspended' WHERE id = ${org.orgId}`.execute(db);
});

afterAll(async () => {
  await org.cleanup();
  await db.destroy();
});

describe("a suspended organization on the web (D4, S2)", () => {
  test("every write route answers org_suspended", async () => {
    const app = suspendedApp();
    const found = new Set<string>();
    for (const route of app.routes) {
      if (!route.path.startsWith("/api/") || route.path.startsWith("/api/auth")) continue;
      if (["GET", "HEAD", "ALL"].includes(route.method)) continue;
      found.add(`${route.method} ${route.path}`);
    }
    expect([...found].sort()).toEqual([...WRITE_ROUTES, ...ALLOWED_WHEN_SUSPENDED].sort());

    for (const entry of found) {
      if (ALLOWED_WHEN_SUSPENDED.includes(entry)) continue;
      const [method = "", pattern = ""] = entry.split(" ");
      const path = pattern.replace(/:[A-Za-z]+/g, () => randomUUID());
      for (const who of ["owner", "assistant"]) {
        const res = await app.request(path, as(who, { method, body: {} }));
        expect({ entry, who, status: res.status, body: await res.json() }).toEqual({
          entry,
          who,
          status: 403,
          body: { error: "org_suspended" },
        });
      }
    }
  });

  test("another organization (active) still writes", async () => {
    const app = suspendedApp();
    const times = await app.request(
      "/api/me/digest-times",
      as("other", { method: "PATCH", body: { times: ["08:00"] } })
    );
    expect(times.status).toBe(200);
    const pause = await app.request(`/api/mailboxes/${randomUUID()}/pause`, as("other", { method: "POST", body: {} }));
    expect(pause.status).toBe(404);
  });

  test("an operator write under /api/operator passes the gate while its organization is suspended (D21)", async () => {
    const app = webTestApp({
      db,
      sessions: sessions(),
      routers: routers(),
      isOrgSuspended: (id) => isOrgSuspended(db, { orgId: id }),
      operatorUserIds: new Set([org.assistantId]),
    });
    // The gate lets the call through; there is no POST /api/operator/flags, so the router answers 404.
    const post = await app.request("/api/operator/flags", as("assistant", { method: "POST", body: {} }));
    expect({ status: post.status, body: await post.json() }).toEqual({ status: 404, body: { error: "not_found" } });
    const other = await app.request("/api/rules", as("assistant", { method: "POST", body: {} }));
    expect({ status: other.status, body: await other.json() }).toEqual({
      status: 403,
      body: { error: "org_suspended" },
    });
  });

  test("a non-operator POST to an operator write route answers 404, also when its organization is suspended (D21)", async () => {
    // No operatorUserIds, and an operator set that holds another user: the owner and the assistant of the suspended org are not operators.
    const apps = [
      suspendedApp(),
      webTestApp({
        db,
        sessions: sessions(),
        routers: routers(),
        isOrgSuspended: (id) => isOrgSuspended(db, { orgId: id }),
        operatorUserIds: new Set([org.otherOwnerId]),
      }),
    ];
    for (const app of apps) {
      for (const path of [`/api/operator/orgs/${org.otherOrgId}/plan`, `/api/operator/orgs/${org.otherOrgId}/flags`]) {
        for (const who of ["owner", "assistant"]) {
          const res = await app.request(path, as(who, { method: "POST", body: { plan: "active" } }));
          expect({ path, who, status: res.status, body: await res.json() }).toEqual({
            path,
            who,
            status: 404,
            body: { error: "not_found" },
          });
        }
      }
    }
    const plan = await db
      .selectFrom("organizations")
      .select("plan")
      .where("id", "=", org.otherOrgId)
      .executeTakeFirstOrThrow();
    expect(plan.plan).toBe("active");
  });

  test("reads stay", async () => {
    const app = suspendedApp();
    expect((await app.request("/api/me", as("owner"))).status).toBe(200);
    expect((await app.request("/api/mailboxes", as("owner"))).status).toBe(200);
  });

  test("without isOrgSuspended a write is not org_suspended", async () => {
    const app = webTestApp({ db, sessions: sessions(), routers: routers() });
    const res = await app.request(`/api/mailboxes/${randomUUID()}/pause`, as("owner", { method: "POST", body: {} }));
    expect(res.status).toBe(404);
  });

  test("a throwing isOrgSuspended fails closed: 500 internal", async () => {
    const app = webTestApp({
      db,
      sessions: sessions(),
      routers: routers(),
      isOrgSuspended: async () => {
        throw new Error("db down");
      },
    });
    const errorSpy = spyOn(console, "error").mockImplementation((): void => undefined);
    try {
      const res = await app.request(
        "/api/organization",
        as("owner", { method: "PATCH", body: { timezone: "Europe/London" } })
      );
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "internal" });
    } finally {
      errorSpy.mockRestore();
    }
  });
});
