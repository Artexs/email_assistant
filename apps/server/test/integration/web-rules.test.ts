import { randomUUID } from "node:crypto";

import { ruleViewSchema } from "@ea/core";
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import { insertDefaultSettings, rulesRoutes } from "../../src/modules/config";
import { insertInboxFolder, insertMailbox } from "../../src/modules/mail/repo";

import { testCapabilities } from "./fixtures";
import { testDb } from "./helpers";
import { as, TEST_ORIGIN, webOrg, webTestApp, type WebOrg } from "./web-helpers";

const db = testDb();
const NOW = new Date("2026-11-11T12:00:00Z");

const orgs: WebOrg[] = [];

afterEach(async () => {
  for (const org of orgs) await org.cleanup();
  orgs.length = 0;
});

afterAll(async () => {
  await db.destroy();
});

async function addMailbox(orgId: string): Promise<string> {
  const ctx = { orgId };
  const id = randomUUID();
  await insertMailbox(db, ctx, {
    id,
    address: `rules-${id}@x.test`,
    imapHost: "imap.x.test",
    imapPort: 993,
    smtpHost: "smtp.x.test",
    smtpPort: 465,
    capabilities: testCapabilities,
    folderMap: {},
  });
  await insertInboxFolder(db, ctx, id);
  await insertDefaultSettings(db, ctx, id);
  return id;
}

async function setup() {
  const org = await webOrg(db);
  orgs.push(org);
  const m1 = await addMailbox(org.orgId);
  const m2 = await addMailbox(org.otherOrgId);
  const app = webTestApp({
    db,
    sessions: { owner: org.ownerId, assistant: org.assistantId, other: org.otherOwnerId },
    routers: (api) => api.route("/", rulesRoutes({ db, now: () => NOW })),
  });
  return { org, app, m1, m2 };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function json(res: Response): Promise<any> {
  return res.json();
}

async function auditRows(orgId: string, event: string) {
  return db
    .selectFrom("audit_log")
    .select(["actor", "data"])
    .where("org_id", "=", orgId)
    .where("event", "=", event)
    .execute();
}

const post = (cookie: string, body: unknown) => as(cookie, { method: "POST", body });

describe("rules routes: matrix", () => {
  test("401, 403, 400 and 404 answers", async () => {
    const { app } = await setup();
    const anyId = randomUUID();
    const calls = [
      { path: "/api/rules", method: "GET" },
      { path: "/api/rules", method: "POST" },
      { path: `/api/rules/${anyId}`, method: "DELETE" },
    ];
    for (const call of calls) {
      const res = await app.request(call.path, { method: call.method, headers: { origin: TEST_ORIGIN } });
      expect(res.status).toBe(401);
    }

    expect((await app.request("/api/rules", as("assistant"))).status).toBe(200);
    const forbiddenPost = await app.request("/api/rules", post("assistant", { kind: "vip", pattern: "a@x.test" }));
    expect(forbiddenPost.status).toBe(403);
    expect(await json(forbiddenPost)).toEqual({ error: "owner_only" });
    const forbiddenDelete = await app.request(`/api/rules/${anyId}`, as("assistant", { method: "DELETE" }));
    expect(forbiddenDelete.status).toBe(403);
    expect(await json(forbiddenDelete)).toEqual({ error: "owner_only" });

    const bad = await app.request("/api/rules", post("owner", { kind: "vip", pattern: "@x.pl" }));
    expect(bad.status).toBe(400);
    const badText = await bad.text();
    expect(badText).not.toContain("@x.pl");
    const badBody = JSON.parse(badText);
    expect(badBody.error).toBe("validation");
    expect(badBody.details[0]).toMatchObject({ path: "pattern", message: "pattern_invalid" });

    const badQuery = await app.request("/api/rules?mailboxId=nope", as("owner"));
    expect(badQuery.status).toBe(400);
    const queryBody = await json(badQuery);
    expect(queryBody.error).toBe("validation");
    expect(queryBody.details[0].path).toBe("mailboxId");

    expect((await app.request("/api/rules/not-a-uuid", as("owner", { method: "DELETE" }))).status).toBe(404);

    const noOrigin = as("owner", { method: "POST", body: { kind: "vip", pattern: "a@x.test" } });
    delete (noOrigin.headers as Record<string, string>).origin;
    const res = await app.request("/api/rules", noOrigin);
    expect(res.status).toBe(403);
    expect(await json(res)).toEqual({ error: "bad_origin" });
  });
});

describe("rules routes: add", () => {
  test("adds an org-wide rule, normalized; a duplicate answers 409", async () => {
    const { app } = await setup();
    const res = await app.request("/api/rules", post("owner", { kind: "vip", pattern: " Boss@Firma.TEST " }));
    expect(res.status).toBe(201);
    const view = ruleViewSchema.parse(await json(res));
    expect(view).toMatchObject({ kind: "vip", pattern: "boss@firma.test", mailboxId: null });

    const again = await app.request("/api/rules", post("owner", { kind: "vip", pattern: "boss@firma.test" }));
    expect(again.status).toBe(409);
    expect(await json(again)).toEqual({ error: "rule_exists" });
  });

  test("a mailbox rule needs a mailbox of the organization", async () => {
    const { app, m1, m2 } = await setup();
    const ok = await app.request(
      "/api/rules",
      post("owner", { kind: "blocklist", pattern: "spam.test", mailboxId: m1 })
    );
    expect(ok.status).toBe(201);
    expect((await json(ok)).mailboxId).toBe(m1);

    const foreign = await app.request(
      "/api/rules",
      post("owner", { kind: "blocklist", pattern: "spam.test", mailboxId: m2 })
    );
    expect(foreign.status).toBe(404);
    const unknown = await app.request(
      "/api/rules",
      post("owner", { kind: "blocklist", pattern: "spam.test", mailboxId: randomUUID() })
    );
    expect(unknown.status).toBe(404);
  });

  test("the cap answers 409 rule_limit", async () => {
    const { app, org } = await setup();
    await sql`
      INSERT INTO sender_rules (org_id, mailbox_id, pattern, kind)
      SELECT ${org.orgId}::uuid, NULL, 'r' || n || '.test', 'vip' FROM generate_series(1, 1000) AS n
    `.execute(db);
    const res = await app.request("/api/rules", post("owner", { kind: "vip", pattern: "new.test" }));
    expect(res.status).toBe(409);
    expect(await json(res)).toEqual({ error: "rule_limit" });
  });
});

describe("rules routes: list and tenant filter", () => {
  test("lists in creation order; the mailbox filter keeps org-wide and own rules", async () => {
    const { app, org, m1, m2 } = await setup();
    const m3 = await addMailbox(org.orgId);
    await app.request("/api/rules", post("owner", { kind: "vip", pattern: "boss@firma.test" }));
    await app.request("/api/rules", post("owner", { kind: "blocklist", pattern: "spam.test", mailboxId: m1 }));
    // One transaction per request, so created_at differs; the order is stable.
    const all = await json(await app.request("/api/rules", as("owner")));
    expect(all.map((r: { pattern: string }) => r.pattern)).toEqual(["boss@firma.test", "spam.test"]);

    const forM1 = await json(await app.request(`/api/rules?mailboxId=${m1}`, as("owner")));
    expect(forM1).toHaveLength(2);

    await app.request("/api/rules", post("owner", { kind: "whitelist", pattern: "third.test", mailboxId: m3 }));
    const filtered = await json(await app.request(`/api/rules?mailboxId=${m1}`, as("owner")));
    expect(filtered.map((r: { pattern: string }) => r.pattern)).toEqual(["boss@firma.test", "spam.test"]);

    const foreign = await app.request(`/api/rules?mailboxId=${m2}`, as("owner"));
    expect(foreign.status).toBe(200);
    expect((await json(foreign)).map((r: { pattern: string }) => r.pattern)).toEqual(["boss@firma.test"]);
  });

  test("another organization sees nothing and deletes nothing", async () => {
    const { app } = await setup();
    const created = await json(await app.request("/api/rules", post("owner", { kind: "vip", pattern: "a@x.test" })));
    expect(await json(await app.request("/api/rules", as("other")))).toEqual([]);
    const del = await app.request(`/api/rules/${created.id}`, as("other", { method: "DELETE" }));
    expect(del.status).toBe(404);
    const still = await json(await app.request("/api/rules", as("owner")));
    expect(still.map((r: { id: string }) => r.id)).toEqual([created.id]);
  });
});

describe("rules routes: delete and audit", () => {
  test("deletes once; the audit rows name the owner and hold no pattern", async () => {
    const { app, org } = await setup();
    const first = await json(
      await app.request("/api/rules", post("owner", { kind: "vip", pattern: "boss@firma.test" }))
    );
    await app.request("/api/rules", post("owner", { kind: "blocklist", pattern: "spam.test" }));

    const del = await app.request(`/api/rules/${first.id}`, as("owner", { method: "DELETE" }));
    expect(del.status).toBe(204);
    expect(await del.text()).toBe("");
    const again = await app.request(`/api/rules/${first.id}`, as("owner", { method: "DELETE" }));
    expect(again.status).toBe(404);

    const added = await auditRows(org.orgId, "rule.added");
    const removed = await auditRows(org.orgId, "rule.removed");
    expect(added).toHaveLength(2);
    expect(removed).toHaveLength(1);
    for (const row of [...added, ...removed]) {
      expect(row.actor).toBe(org.ownerId);
      expect(JSON.stringify(row.data)).not.toMatch(/firma|spam/);
    }
  });
});
