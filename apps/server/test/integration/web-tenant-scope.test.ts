import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { sql } from "kysely";

import { insertSenderRule } from "../../src/modules/config/repo";
import { insertInboxFolder, insertMailbox } from "../../src/modules/mail/repo";
import { loadConfig } from "../../src/platform/config";
import { createSecretBox } from "../../src/platform/crypto";
import { currentTenantScope, withTenantScope } from "../../src/platform/db";
import { apiRouters } from "../../src/web";

import { testCapabilities } from "./fixtures";
import { testDb } from "./helpers";
import { as, noBackupCodes, TEST_ORIGIN, webOrg, webTestApp, type WebOrg } from "./web-helpers";

// RLS safety net (ADR 0011): every /api route except /api/operator/* runs in the tenant scope of the session's
// organization, and a query that forgets its org_id filter still sees only that organization.
// A test sets app.org_id only with a transaction-local set_config; code must never leave a raw transaction open on a
// held connection (the driver remembers the value per connection).
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

// The one /api exception (ADR 0027): operator routes read across organizations.
const UNSCOPED_PREFIXES = ["/api/operator/"];

let org: WebOrg;
let mailboxA: { id: string; address: string };
let mailboxB: { id: string; address: string };
const seen: { method: string; path: string; scope: string | null }[] = [];
const walked = new Set<string>();

async function makeMailbox(orgId: string): Promise<{ id: string; address: string }> {
  const id = randomUUID();
  const address = `rls-${randomUUID()}@x.test`;
  await insertMailbox(
    db,
    { orgId },
    {
      id,
      address,
      imapHost: "imap.x.test",
      imapPort: 993,
      smtpHost: "smtp.x.test",
      smtpPort: 465,
      capabilities: testCapabilities,
      folderMap: { drafts: "Drafts" },
    }
  );
  await insertInboxFolder(db, { orgId }, id);
  return { id, address };
}

const realRouters = apiRouters(
  testConfig,
  db,
  extras,
  () => new Date(),
  async () => [],
  noBackupCodes
);

const walkApp = () =>
  webTestApp({
    db,
    sessions: { owner: org.ownerId },
    operatorUserIds: new Set([org.ownerId]),
    routers: (api) => {
      api.use("*", async (c, next) => {
        seen.push({ method: c.req.method, path: c.req.path, scope: currentTenantScope() });
        await next();
      });
      realRouters(api);
    },
  });

const probeIds = async (orgIds: string[]) => {
  const { rows } = await sql<{ org_id: string }>`
    select org_id from mailboxes where org_id in (${sql.join(orgIds)}) order by org_id`.execute(db);
  return rows.map((row) => row.org_id);
};

const probeApp = () =>
  webTestApp({
    db,
    sessions: { owner: org.ownerId, other: org.otherOwnerId },
    operatorUserIds: new Set([org.ownerId]),
    routers: (api) => {
      // The deliberately unfiltered query: it asks for both organizations through the root db.
      const both = async () => ({ orgIds: await probeIds([org.orgId, org.otherOrgId]) });
      api.get("/rls-probe", async (c) => c.json(await both()));
      api.get("/operator/rls-probe", async (c) => c.json(await both()));
      api.post("/rls-probe-write", async (c) => {
        await insertSenderRule(
          db,
          { orgId: org.otherOrgId },
          { mailboxId: null, pattern: "rls-probe@x.test", kind: "vip" }
        );
        return c.json({ ok: true });
      });
    },
  });

beforeAll(async () => {
  org = await webOrg(db);
  mailboxA = await makeMailbox(org.orgId);
  mailboxB = await makeMailbox(org.otherOrgId);
});

afterAll(async () => {
  await org.cleanup();
  await db.destroy();
});

describe("the route walk", () => {
  test("every /api route runs in the scope of the session's organization, operator routes without", async () => {
    const app = walkApp();
    const errorSpy = spyOn(console, "error").mockImplementation((): void => undefined);
    const logSpy = spyOn(console, "log").mockImplementation((): void => undefined);
    try {
      const entries = app.routes.filter(
        (route) => route.path.startsWith("/api/") && !route.path.startsWith("/api/auth") && route.method !== "ALL"
      );
      for (const { method, path: pattern } of entries) {
        if (walked.has(`${method} ${pattern}`)) continue;
        walked.add(`${method} ${pattern}`);
        const path = pattern.replace(/:[A-Za-z]+/g, () => randomUUID());
        seen.length = 0;
        await app.request(path, as("owner", { method, body: method === "GET" ? undefined : {} }));
        const last = seen.at(-1);
        expect(last, `${method} ${path} did not reach the recorder`).toBeDefined();
        const expected = UNSCOPED_PREFIXES.some((prefix) => pattern.startsWith(prefix)) ? null : org.orgId;
        expect(last?.scope, `${method} ${path} ran with scope ${last?.scope}`).toBe(expected);
      }
    } finally {
      errorSpy.mockRestore();
      logSpy.mockRestore();
    }
  });

  test("the walked set holds the known routes", () => {
    for (const route of [
      "GET /api/me",
      "GET /api/mailboxes",
      "POST /api/mailboxes",
      "DELETE /api/mailboxes/:id",
      "GET /api/stats",
      "GET /api/operator/flags",
      "POST /api/actions/:id/reject-reason",
      "POST /api/actions/:id/mistake",
    ]) {
      expect(walked.has(route), `${route} was not walked`).toBe(true);
    }
  });
});

describe("a query that forgets its org_id filter", () => {
  test("owner A sees only organization A", async () => {
    const res = await probeApp().request("/api/rls-probe", as("owner"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ orgIds: [org.orgId] });
  });

  test("owner B sees only organization B", async () => {
    const res = await probeApp().request("/api/rls-probe", as("other"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ orgIds: [org.otherOrgId] });
  });

  test("an operator route sees both organizations", async () => {
    const res = await probeApp().request("/api/operator/rls-probe", as("owner"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ orgIds: [org.orgId, org.otherOrgId].sort() });
  });

  test("a job context sees both; inside a tenant scope only its organization", async () => {
    const both = [org.orgId, org.otherOrgId];
    expect(await probeIds(both)).toEqual([...both].sort());
    expect(await withTenantScope(org.orgId, () => probeIds(both))).toEqual([org.orgId]);
  });

  test("a write of a row of organization B under A fails: 500 and no row", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation((): void => undefined);
    try {
      const res = await probeApp().request("/api/rls-probe-write", as("owner", { method: "POST", body: {} }));
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "internal" });
    } finally {
      errorSpy.mockRestore();
    }
    const { rows } = await sql<{ n: string }>`
      select count(*) as n from sender_rules where org_id = ${org.otherOrgId} and pattern = 'rls-probe@x.test'`.execute(
      db
    );
    expect(Number(rows[0]?.n)).toBe(0);
  });
});

describe("real routes under the scope", () => {
  test("DELETE of a mailbox of organization B by owner A gives 404 and changes nothing", async () => {
    const res = await walkApp().request(
      `/api/mailboxes/${mailboxB.id}`,
      as("owner", { method: "DELETE", body: { confirmAddress: mailboxB.address } })
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    const { rows } = await sql<{ n: string }>`select count(*) as n from mailboxes where id = ${mailboxB.id}`.execute(
      db
    );
    expect(Number(rows[0]?.n)).toBe(1);
  });

  test("GET /api/mailboxes lists exactly the mailbox of organization A", async () => {
    const res = await walkApp().request("/api/mailboxes", as("owner"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mailboxes?: { id: string }[] } | { id: string }[];
    const list = Array.isArray(body) ? body : (body.mailboxes ?? []);
    expect(list.map((mailbox) => mailbox.id)).toEqual([mailboxA.id]);
  });

  test("no scope is left in the test process", () => {
    expect(currentTenantScope()).toBeNull();
  });
});
