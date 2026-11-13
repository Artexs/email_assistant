import { randomBytes, randomUUID } from "node:crypto";

import type { OperatorFlags } from "@ea/core";
import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { sql } from "kysely";

import { configureFeatures, isOrgSuspended, upsertOrgFeature } from "../../src/modules/tenancy";
import { insertUser } from "../../src/modules/tenancy/repo";
import { loadConfig } from "../../src/platform/config";
import { createSecretBox } from "../../src/platform/crypto";
import { apiRouters } from "../../src/web";

import { testDb } from "./helpers";
import { as, TEST_ORIGIN, webOrg, webTestApp, type WebOrg } from "./web-helpers";

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
const SET_AT = new Date("2026-11-20T10:00:00Z");

let org: WebOrg;
let lonelyId: string; // a user with no membership
const sessions = () => ({ owner: org.ownerId, assistant: org.assistantId, other: org.otherOwnerId, lonely: lonelyId });
const routers = () =>
  apiRouters(
    testConfig,
    db,
    extras,
    () => new Date(),
    async () => []
  );
const operatorApp = (operatorUserIds: ReadonlySet<string> = new Set([org.assistantId])) =>
  webTestApp({ db, sessions: sessions(), routers: routers(), operatorUserIds });

const flagOn = (orgId: string, flag: "stats_page" | "approvals_page" | "sent_sync" | "old_flag", enabled = true) =>
  upsertOrgFeature(db, { orgId }, { flag: flag as "stats_page", enabled, setBy: "test", setAt: SET_AT });

const rowsOf = (body: OperatorFlags, orgId: string) => body.rows.filter((row) => row.orgId === orgId);

// Log lines of one call, as the log module writes them (info → console.log, warn/error → console.error).
async function captured<T>(run: () => Promise<T>): Promise<{ value: T; lines: string[] }> {
  const errorSpy = spyOn(console, "error").mockImplementation((): void => undefined);
  const logSpy = spyOn(console, "log").mockImplementation((): void => undefined);
  try {
    const value = await run();
    const lines = [...errorSpy.mock.calls, ...logSpy.mock.calls].map((call) => call.join(" "));
    return { value, lines };
  } finally {
    errorSpy.mockRestore();
    logSpy.mockRestore();
  }
}

beforeAll(async () => {
  org = await webOrg(db);
  lonelyId = (await insertUser(db, { email: `web-lonely-${randomUUID()}@x.test`, displayName: "Lonely" })).id;
});

afterEach(async () => {
  await db.deleteFrom("org_features").where("org_id", "in", [org.orgId, org.otherOrgId]).execute();
  configureFeatures({ off: [] });
});

afterAll(async () => {
  await org.cleanup();
  await db.deleteFrom("users").where("id", "=", lonelyId).execute();
  await db.destroy();
});

describe("GET /api/operator/flags (F087, D5, D15, D18)", () => {
  test("1. no session answers 401", async () => {
    const res = await operatorApp().request("/api/operator/flags", {
      headers: { origin: TEST_ORIGIN },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  test("2. the owner of A answers 404 with the body of an unknown path", async () => {
    const app = operatorApp();
    const unknown = await app.request("/api/no-such-path", as("owner"));
    const { value: res } = await captured(async () => app.request("/api/operator/flags", as("owner")));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(await unknown.json());
  });

  test("3. the owner of B answers 404 not_found", async () => {
    const res = await operatorApp().request("/api/operator/flags", as("other"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  test("4. the operator reads every organization with effective values, three keys per row", async () => {
    await flagOn(org.orgId, "stats_page");
    const res = await operatorApp().request("/api/operator/flags", as("assistant"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as OperatorFlags;
    expect(rowsOf(body, org.orgId)).toEqual([
      { orgId: org.orgId, flag: "stats_page", enabled: true },
      { orgId: org.orgId, flag: "approvals_page", enabled: false },
      { orgId: org.orgId, flag: "sent_sync", enabled: false },
    ]);
    expect(rowsOf(body, org.otherOrgId).map((row) => row.enabled)).toEqual([false, false, false]);
    for (const row of [...rowsOf(body, org.orgId), ...rowsOf(body, org.otherOrgId)]) {
      expect(Object.keys(row).sort()).toEqual(["enabled", "flag", "orgId"]);
    }
  });

  test("5. FEATURES_OFF wins over a row", async () => {
    configureFeatures({ off: ["stats_page"] });
    await flagOn(org.orgId, "stats_page");
    const res = await operatorApp().request("/api/operator/flags", as("assistant"));
    const body = (await res.json()) as OperatorFlags;
    expect(rowsOf(body, org.orgId).find((row) => row.flag === "stats_page")?.enabled).toBe(false);
  });

  test("6. a row with a key outside the registry gives no row", async () => {
    await sql`INSERT INTO org_features (org_id, flag, enabled, set_by, set_at)
      VALUES (${org.orgId}, 'old_flag', true, 'test', ${SET_AT})`.execute(db);
    const res = await operatorApp().request("/api/operator/flags", as("assistant"));
    const body = (await res.json()) as OperatorFlags;
    expect(body.rows.filter((row) => (row.flag as string) === "old_flag")).toEqual([]);
    expect(rowsOf(body, org.orgId)).toHaveLength(3);
  });

  test("7. path forms: the guard covers the prefix, the route is GET /flags only", async () => {
    const app = operatorApp();
    for (const path of [
      "/api/operator",
      "/api/operator/",
      "/api/operator/flags/",
      "/api/operator//flags",
      "/api/operator/%66lags",
    ]) {
      const res = await app.request(path, as("owner"));
      expect({ path, status: res.status, body: await res.json() }).toEqual({
        path,
        status: 404,
        body: { error: "not_found" },
      });
    }
    expect((await app.request("/api/operator/nope", as("assistant"))).status).toBe(404);
    for (const who of ["owner", "assistant"]) {
      const res = await app.request("/api/operator/flags", as(who, { method: "POST", body: {} }));
      expect({ who, status: res.status }).toEqual({ who, status: 404 });
    }
  });

  test("8. the prefix guard does not leak: the owner still reads /api/me", async () => {
    const res = await operatorApp().request("/api/me", as("owner"));
    expect(res.status).toBe(200);
  });

  test("9. an operator with no membership answers 403 no_organization (D17)", async () => {
    const app = operatorApp(new Set([lonelyId]));
    const res = await app.request("/api/operator/flags", as("lonely"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "no_organization" });
  });

  test("10. the operator of a suspended organization still reads", async () => {
    const before = await db
      .selectFrom("organizations")
      .select("plan")
      .where("id", "=", org.orgId)
      .executeTakeFirstOrThrow();
    await sql`UPDATE organizations SET plan = 'suspended' WHERE id = ${org.orgId}`.execute(db);
    try {
      await suspendedOperatorReads();
    } finally {
      await sql`UPDATE organizations SET plan = ${before.plan} WHERE id = ${org.orgId}`.execute(db);
    }
  });
  const suspendedOperatorReads = async () => {
    const app = webTestApp({
      db,
      sessions: sessions(),
      routers: routers(),
      operatorUserIds: new Set([org.assistantId]),
      isOrgSuspended: (id) => isOrgSuspended(db, { orgId: id }),
    });
    expect(await isOrgSuspended(db, { orgId: org.orgId })).toBe(true);
    const res = await app.request("/api/operator/flags", as("assistant"));
    expect(res.status).toBe(200);
  };

  test("11. a web without operatorUserIds answers 404 to the operator user", async () => {
    const app = webTestApp({ db, sessions: sessions(), routers: routers() });
    const res = await app.request("/api/operator/flags", as("assistant"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  test("12. a refusal logs the user id once and no name or address", async () => {
    const app = operatorApp();
    const { lines } = await captured(async () => {
      await app.request("/api/operator/flags", as("owner"));
      await app.request("/api/operator/flags", as("assistant"));
    });
    expect(lines.filter((line) => line.includes(`user_id=${org.ownerId}`))).toHaveLength(1);
    expect(lines.filter((line) => line.includes("operator_route_refused"))).toHaveLength(1);
    for (const line of lines) {
      expect(line).not.toContain("@x.test");
      expect(line).not.toContain("Web org");
      expect(line).not.toContain("Web other org");
    }
  });
});
