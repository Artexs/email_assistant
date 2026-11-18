import { randomUUID } from "node:crypto";

import { settingsViewSchema, type UrgencyProfile } from "@ea/core";
import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";

import { insertDefaultSettings, settingsRoutes } from "../../src/modules/config";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { insertInboxFolder, insertMailbox } from "../../src/modules/mail/repo";
import { setLogLevel } from "../../src/platform/log";
import { settingsRouteDeps } from "../../src/web";

import { testCapabilities } from "./fixtures";
import { testDb } from "./helpers";
import { as, webOrg, webTestApp, type WebOrg } from "./web-helpers";

// PUT /api/settings/:mailboxId/urgency. The profile may name people: no label or keyword reaches a log
// line, an audit row or an error body.
const db = testDb();
const NOW = new Date("2026-11-15T12:00:00Z");
const UNKNOWN = "00000000-0000-4000-8000-000000000000";
const CANARY = "CANARY-VIP-Zofia-Nowak";

const orgs: WebOrg[] = [];

afterEach(async () => {
  setLogLevel("info");
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
    address: `urgency-${id}@x.test`,
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
    routers: (api) => api.route("/", settingsRoutes(settingsRouteDeps(db, () => NOW, NO_TEST_SENDERS))),
  });
  return { org, app, m1, m2 };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function json(res: Response): Promise<Record<string, any>> {
  return res.json();
}

const put = (app: Awaited<ReturnType<typeof setup>>["app"], id: string, cookie: string, body: unknown) =>
  app.request(`/api/settings/${id}/urgency`, as(cookie, { method: "PUT", body }));

async function stored(mailboxId: string) {
  return db
    .selectFrom("mailbox_settings")
    .select(["urgency_profile", "updated_at"])
    .where("mailbox_id", "=", mailboxId)
    .executeTakeFirstOrThrow();
}

async function auditRows(orgId: string) {
  return db
    .selectFrom("audit_log")
    .select(["actor", "data"])
    .where("org_id", "=", orgId)
    .where("event", "=", "settings.urgency_set")
    .orderBy("id")
    .execute();
}

const profile: UrgencyProfile = {
  topics: [
    { label: `${CANARY} contract`, keywords: [`${CANARY}-kw`, "renewal"] },
    { label: "audit", keywords: [] },
  ],
  deadlines: [{ label: `${CANARY} tax`, due: "2026-12-01" }],
};

describe("PUT /api/settings/:mailboxId/urgency", () => {
  test("the owner sets a profile: 200 with the settings view, GET shows it, updated_at moves", async () => {
    const { app, m1 } = await setup();
    const before = await stored(m1);
    const res = await put(app, m1, "owner", { profile });
    expect(res.status).toBe(200);
    const view = settingsViewSchema.parse(await json(res));
    expect(view.mailboxId).toBe(m1);
    expect(view.urgencyProfile).toEqual(profile);
    const get = settingsViewSchema.parse(await json(await app.request(`/api/settings/${m1}`, as("owner"))));
    expect(get.urgencyProfile).toEqual(profile);
    const after = await stored(m1);
    expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
  });

  test("a fresh mailbox shows urgencyProfile null; null and an empty profile store null", async () => {
    const { app, m1 } = await setup();
    const fresh = settingsViewSchema.parse(await json(await app.request(`/api/settings/${m1}`, as("owner"))));
    expect(fresh.urgencyProfile).toBeNull();

    await put(app, m1, "owner", { profile });
    expect((await stored(m1)).urgency_profile).not.toBeNull();
    const cleared = await put(app, m1, "owner", { profile: null });
    expect(cleared.status).toBe(200);
    expect((await json(cleared)).urgencyProfile).toBeNull();
    expect((await stored(m1)).urgency_profile).toBeNull();

    await put(app, m1, "owner", { profile });
    const empty = await put(app, m1, "owner", { profile: { topics: [], deadlines: [] } });
    expect(empty.status).toBe(200);
    expect((await json(empty)).urgencyProfile).toBeNull();
    expect((await stored(m1)).urgency_profile).toBeNull();
  });

  test("the same profile again changes nothing: no new audit row, same updated_at", async () => {
    const { app, m1, org } = await setup();
    await put(app, m1, "owner", { profile });
    const first = await stored(m1);
    expect((await put(app, m1, "owner", { profile })).status).toBe(200);
    expect((await stored(m1)).updated_at.getTime()).toBe(first.updated_at.getTime());
    expect(await auditRows(org.orgId)).toHaveLength(1);
  });

  test("no cookie → 401; the assistant → 403 owner_only and no write", async () => {
    const { app, m1, org } = await setup();
    const noCookie = await app.request(`/api/settings/${m1}/urgency`, {
      method: "PUT",
      headers: { origin: "http://127.0.0.1:8080", "content-type": "application/json" },
      body: JSON.stringify({ profile }),
    });
    expect(noCookie.status).toBe(401);
    const res = await put(app, m1, "assistant", { profile });
    expect(res.status).toBe(403);
    expect(await json(res)).toEqual({ error: "owner_only" });
    expect((await stored(m1)).urgency_profile).toBeNull();
    expect(await auditRows(org.orgId)).toHaveLength(0);
  });

  test("a mailbox of another organization, an unknown id and a non-UUID → 404, even with a bad body", async () => {
    const { app, m1, m2, org } = await setup();
    for (const id of [m2, UNKNOWN, "not-a-uuid"]) {
      expect((await put(app, id, "owner", { profile })).status).toBe(404);
      expect((await put(app, id, "owner", { profile: { topics: 1 } })).status).toBe(404);
    }
    // The owner of the other organization cannot write to m1.
    expect((await put(app, m1, "other", { profile })).status).toBe(404);
    expect((await stored(m1)).urgency_profile).toBeNull();
    expect((await stored(m2)).urgency_profile).toBeNull();
    expect(await auditRows(org.orgId)).toHaveLength(0);
    expect(await auditRows(org.otherOrgId)).toHaveLength(0);
  });

  test("the second organization sets its own profile and the first one's stays untouched", async () => {
    const { app, m1, m2, org } = await setup();
    await put(app, m1, "owner", { profile });
    const other: UrgencyProfile = { topics: [{ label: "other topic", keywords: [] }], deadlines: [] };
    expect((await put(app, m2, "other", { profile: other })).status).toBe(200);
    expect((await stored(m1)).urgency_profile).toEqual(profile);
    expect((await stored(m2)).urgency_profile).toEqual(other);
    expect(await auditRows(org.orgId)).toHaveLength(1);
    expect(await auditRows(org.otherOrgId)).toHaveLength(1);
  });

  test("21 topics → 400 validation with the path, no write, and the body does not echo a label", async () => {
    const { app, m1, org } = await setup();
    const topics = Array.from({ length: 21 }, (_, index) => ({ label: `${CANARY}-${index}`, keywords: [] }));
    const res = await put(app, m1, "owner", { profile: { topics, deadlines: [] } });
    expect(res.status).toBe(400);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.error).toBe("validation");
    expect(body.details[0].path).toBe("profile.topics");
    expect(text).not.toContain(CANARY);
    expect((await stored(m1)).urgency_profile).toBeNull();
    expect(await auditRows(org.orgId)).toHaveLength(0);
  });

  test("a bad deadline date, an extra key and a missing profile → 400", async () => {
    const { app, m1 } = await setup();
    const bad = [
      { profile: { topics: [], deadlines: [{ label: "x", due: "tomorrow" }] } },
      { profile: { topics: [{ label: "x", keywords: [], extra: 1 }], deadlines: [] } },
      {},
    ];
    for (const body of bad) expect((await put(app, m1, "owner", body)).status).toBe(400);
    expect((await stored(m1)).urgency_profile).toBeNull();
  });

  test("the audit row holds counts, via and the mailbox id: no label, no keyword", async () => {
    const { app, m1, org } = await setup();
    await put(app, m1, "owner", { profile });
    const rows = await auditRows(org.orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor).toBe(org.ownerId);
    expect(rows[0]?.data).toEqual({ mailbox_id: m1, topics: 2, deadlines: 1, via: "web" });
    expect(JSON.stringify(rows[0]?.data)).not.toContain(CANARY);
    await put(app, m1, "owner", { profile: null });
    const [, cleared] = await auditRows(org.orgId);
    expect(cleared?.data).toEqual({ mailbox_id: m1, topics: 0, deadlines: 0, via: "web" });
  });

  test("no log line holds a label or a keyword of the profile", async () => {
    const lines: string[] = [];
    const sink = (...args: unknown[]): void => {
      lines.push(args.map(String).join(" "));
    };
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((name) =>
      spyOn(console, name).mockImplementation(sink)
    );
    setLogLevel("debug");
    try {
      const { app, m1 } = await setup();
      await put(app, m1, "owner", { profile });
      const topics = Array.from({ length: 21 }, (_, index) => ({ label: `${CANARY}-${index}`, keywords: [] }));
      await put(app, m1, "owner", { profile: { topics, deadlines: [] } });
      await put(app, m1, "owner", { profile: null });
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join("\n")).not.toContain("CANARY");
  });
});
