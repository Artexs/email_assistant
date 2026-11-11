import { randomUUID } from "node:crypto";

import { barCategories, noGoBodySchema, settingsChangeSchema, settingsViewSchema } from "@ea/core";
import { afterAll, afterEach, describe, expect, test } from "bun:test";

import { insertDefaultSettings, settingsRoutes } from "../../src/modules/config";
import { ensureSyncFolders } from "../../src/modules/mail";
import { insertInboxFolder, insertMailbox } from "../../src/modules/mail/repo";
import { settingsRouteDeps } from "../../src/web";

import { insertTriagedWithActions, testCapabilities } from "./fixtures";
import { testDb } from "./helpers";
import { as, TEST_ORIGIN, webOrg, webTestApp, type WebOrg } from "./web-helpers";

const db = testDb();
const NOW = new Date("2026-11-11T12:00:00Z");
const UNKNOWN = "00000000-0000-4000-8000-000000000000";

const orgs: WebOrg[] = [];

afterEach(async () => {
  for (const org of orgs) await org.cleanup();
  orgs.length = 0;
});

afterAll(async () => {
  await db.destroy();
});

async function addMailbox(orgId: string, withSettings = true): Promise<string> {
  const ctx = { orgId };
  const id = randomUUID();
  await insertMailbox(db, ctx, {
    id,
    address: `settings-${id}@x.test`,
    imapHost: "imap.x.test",
    imapPort: 993,
    smtpHost: "smtp.x.test",
    smtpPort: 465,
    capabilities: testCapabilities,
    folderMap: {},
  });
  await insertInboxFolder(db, ctx, id);
  if (withSettings) await insertDefaultSettings(db, ctx, id);
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
    routers: (api) => api.route("/", settingsRoutes(settingsRouteDeps(db, () => NOW))),
  });
  return { org, app, m1, m2, ctx: { orgId: org.orgId } };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function json(res: Response): Promise<Record<string, any>> {
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

const patchRoutes = [
  { path: "mode", body: { mode: "assist", keepSwitches: false } },
  { path: "switches/flag", body: { value: true } },
  { path: "auto/info", body: { auto: true } },
  { path: "sync-folders/offers", body: { enabled: false } },
] as const;

describe("route matrix", () => {
  test("no cookie → 401 on the five routes", async () => {
    const { app, m1 } = await setup();
    const noCookie = { origin: TEST_ORIGIN, "content-type": "application/json" };
    expect((await app.request(`/api/settings/${m1}`)).status).toBe(401);
    for (const route of patchRoutes) {
      const res = await app.request(`/api/settings/${m1}/${route.path}`, {
        method: "PATCH",
        headers: noCookie,
        body: JSON.stringify(route.body),
      });
      expect(res.status).toBe(401);
    }
  });

  test("the assistant: GET 200, the four PATCH routes 403 owner_only", async () => {
    const { app, m1 } = await setup();
    expect((await app.request(`/api/settings/${m1}`, as("assistant"))).status).toBe(200);
    for (const route of patchRoutes) {
      const res = await app.request(
        `/api/settings/${m1}/${route.path}`,
        as("assistant", { method: "PATCH", body: route.body })
      );
      expect(res.status).toBe(403);
      expect(await json(res)).toEqual({ error: "owner_only" });
    }
  });

  test("another organization's id, an unknown id and a non-UUID → 404; auto never 409", async () => {
    const { app, m2 } = await setup();
    for (const id of [m2, UNKNOWN, "not-a-uuid"]) {
      expect((await app.request(`/api/settings/${id}`, as("owner"))).status).toBe(404);
      for (const route of patchRoutes) {
        const res = await app.request(
          `/api/settings/${id}/${route.path}`,
          as("owner", { method: "PATCH", body: route.body })
        );
        expect(res.status).toBe(404);
      }
    }
    // A foreign id with a bad body is 404, not 400.
    const bad = await app.request(`/api/settings/${m2}/mode`, as("owner", { method: "PATCH", body: { mode: "on" } }));
    expect(bad.status).toBe(404);
  });

  test("a bad :name, :category or :key → 404", async () => {
    const { app, m1 } = await setup();
    const cases = [
      { path: "switches/nope", body: { value: true } },
      { path: "auto/delegation", body: { auto: true } },
      { path: "sync-folders/inbox", body: { enabled: false } },
    ];
    for (const route of cases) {
      const res = await app.request(
        `/api/settings/${m1}/${route.path}`,
        as("owner", { method: "PATCH", body: route.body })
      );
      expect(res.status).toBe(404);
    }
  });

  test("a bad body → 400 validation with details", async () => {
    const { app, m1 } = await setup();
    const res = await app.request(`/api/settings/${m1}/mode`, as("owner", { method: "PATCH", body: { mode: "on" } }));
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error).toBe("validation");
    expect(body.details[0].path).toBe("mode");
  });

  test("a PATCH without Origin → 403 bad_origin", async () => {
    const { app, m1 } = await setup();
    const res = await app.request(`/api/settings/${m1}/mode`, {
      method: "PATCH",
      headers: { cookie: "ea.session_token=owner", "content-type": "application/json" },
      body: JSON.stringify({ mode: "assist", keepSwitches: false }),
    });
    expect(res.status).toBe(403);
    expect((await json(res)).error).toBe("bad_origin");
  });
});

describe("GET /api/settings/:mailboxId", () => {
  test("the view of a fresh mailbox", async () => {
    const { app, m1 } = await setup();
    const res = await app.request(`/api/settings/${m1}`, as("owner"));
    expect(res.status).toBe(200);
    const view = settingsViewSchema.parse(await json(res));
    expect(view.mailboxId).toBe(m1);
    expect(view.mode).toBe("shadow");
    expect(Object.values(view.toolSwitches).every((value) => value === false)).toBe(true);
    expect(view.categories.map((item) => item.category)).toEqual([...barCategories]);
    for (const item of view.categories) {
      expect(item.auto).toBe(false);
      expect(item.threshold).toBe(0.7);
      expect(item.gate.decision).toBe("no-go: too few");
    }
    expect(view.syncFolders).toEqual([{ key: "inbox", role: "inbox", path: "INBOX", enabled: true }]);
    expect(view.bar).toBe(0.98);
    expect(view.minKept).toBe(30);
  });

  test("a mailbox without a settings row → GET and PATCH mode 404", async () => {
    const { app, org } = await setup();
    const bare = await addMailbox(org.orgId, false);
    expect((await app.request(`/api/settings/${bare}`, as("owner"))).status).toBe(404);
    const res = await app.request(
      `/api/settings/${bare}/mode`,
      as("owner", { method: "PATCH", body: { mode: "assist", keepSwitches: false } })
    );
    expect(res.status).toBe(404);
  });
});

describe("PATCH mode and switches", () => {
  test("mode assist sets the three default switches and writes one audit row", async () => {
    const { app, m1, org } = await setup();
    const res = await app.request(
      `/api/settings/${m1}/mode`,
      as("owner", { method: "PATCH", body: { mode: "assist", keepSwitches: false } })
    );
    expect(res.status).toBe(200);
    const change = settingsChangeSchema.parse(await json(res));
    expect(change.changed).toBe(true);
    expect(change.settings.mode).toBe("assist");
    expect(change.settings.toolSwitches).toMatchObject({ move: true, mark_read: true, flag: true });
    const rows = await auditRows(org.orgId, "mailbox.mode_changed");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor).toBe(org.ownerId);
    expect(rows[0]?.data).toMatchObject({ switches_set: true });
  });

  test("a switch off and mode shadow expire the ready rows", async () => {
    const { app, m1, ctx } = await setup();
    await app.request(
      `/api/settings/${m1}/mode`,
      as("owner", { method: "PATCH", body: { mode: "assist", keepSwitches: false } })
    );
    const mail = await db.transaction().execute((trx) =>
      insertTriagedWithActions(trx, ctx, m1, {
        category: "info",
        createdAt: new Date(NOW.getTime() - 3_600_000),
        actions: [{ type: "move", status: "ready" }],
      })
    );
    const off = await app.request(
      `/api/settings/${m1}/switches/move`,
      as("owner", { method: "PATCH", body: { value: false } })
    );
    expect(off.status).toBe(200);
    expect((await json(off)).expired).toBe(1);
    const row = await db
      .selectFrom("actions")
      .select("status")
      .where("id", "=", mail.actionIds[0] ?? "")
      .executeTakeFirstOrThrow();
    expect(row.status).toBe("expired");

    const flag = await db.transaction().execute((trx) =>
      insertTriagedWithActions(trx, ctx, m1, {
        category: "info",
        createdAt: new Date(NOW.getTime() - 3_600_000),
        uid: 2,
        actions: [{ type: "flag", status: "ready" }],
      })
    );
    const shadow = await app.request(
      `/api/settings/${m1}/mode`,
      as("owner", { method: "PATCH", body: { mode: "shadow", keepSwitches: false } })
    );
    expect(shadow.status).toBe(200);
    expect((await json(shadow)).expired).toBeGreaterThanOrEqual(1);
    const flagRow = await db
      .selectFrom("actions")
      .select("status")
      .where("id", "=", flag.actionIds[0] ?? "")
      .executeTakeFirstOrThrow();
    expect(flagRow.status).toBe("expired");
  });

  test("a paused and an auth_error mailbox still take a switch", async () => {
    const { app, m1, m2, org } = await setup();
    const second = await addMailbox(org.orgId);
    await db.updateTable("mailboxes").set({ status: "paused" }).where("id", "=", m1).execute();
    await db.updateTable("mailboxes").set({ status: "auth_error" }).where("id", "=", second).execute();
    expect(m2).not.toBe(second);
    for (const id of [m1, second]) {
      const res = await app.request(
        `/api/settings/${id}/switches/flag`,
        as("owner", { method: "PATCH", body: { value: true } })
      );
      expect(res.status).toBe(200);
    }
  });

  test("two PATCHes at once both apply", async () => {
    const { app, m1 } = await setup();
    const [a, b] = await Promise.all([
      app.request(`/api/settings/${m1}/switches/flag`, as("owner", { method: "PATCH", body: { value: true } })),
      app.request(`/api/settings/${m1}/switches/mark_read`, as("owner", { method: "PATCH", body: { value: true } })),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const view = await json(await app.request(`/api/settings/${m1}`, as("owner")));
    expect(view.toolSwitches).toMatchObject({ flag: true, mark_read: true });
  });
});

describe("PATCH auto", () => {
  test("no-go → 409, force → 200 with forced, off → 200", async () => {
    const { app, m1, org } = await setup();
    const refused = await app.request(
      `/api/settings/${m1}/auto/info`,
      as("owner", { method: "PATCH", body: { auto: true } })
    );
    expect(refused.status).toBe(409);
    const body = noGoBodySchema.parse(await json(refused));
    expect(body.gate).toMatchObject({ decision: "no-go: too few", kept: 0 });
    const policy = await db
      .selectFrom("mailbox_settings")
      .select("category_policy")
      .where("mailbox_id", "=", m1)
      .executeTakeFirstOrThrow();
    expect(policy.category_policy).toEqual({});
    expect(await auditRows(org.orgId, "mailbox.policy_changed")).toHaveLength(0);

    const forced = await app.request(
      `/api/settings/${m1}/auto/info`,
      as("owner", { method: "PATCH", body: { auto: true, force: true } })
    );
    expect(forced.status).toBe(200);
    const change = settingsChangeSchema.parse(await json(forced));
    expect(change.settings.categories.find((item) => item.category === "info")?.auto).toBe(true);
    const rows = await auditRows(org.orgId, "mailbox.policy_changed");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor).toBe(org.ownerId);
    expect(rows[0]?.data).toMatchObject({ forced: true });

    const off = await app.request(
      `/api/settings/${m1}/auto/info`,
      as("owner", { method: "PATCH", body: { auto: false } })
    );
    expect(off.status).toBe(200);
    expect(
      (await json(off)).settings.categories.find((item: { category: string }) => item.category === "info").auto
    ).toBe(false);
  });
});

describe("PATCH sync-folders", () => {
  test("turns a folder off with one audit row; a missing row → 404", async () => {
    const { app, m1, ctx, org } = await setup();
    await ensureSyncFolders(db, ctx, m1, [{ key: "offers", path: "Oferty", role: "sort" }], NOW);
    const res = await app.request(
      `/api/settings/${m1}/sync-folders/offers`,
      as("owner", { method: "PATCH", body: { enabled: false } })
    );
    expect(res.status).toBe(200);
    const change = settingsChangeSchema.parse(await json(res));
    expect(change.changed).toBe(true);
    expect(change.settings.syncFolders.find((item) => item.key === "offers")?.enabled).toBe(false);
    const rows = await auditRows(org.orgId, "mailbox.sync_folder_changed");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor).toBe(org.ownerId);

    const missing = await app.request(
      `/api/settings/${m1}/sync-folders/social`,
      as("owner", { method: "PATCH", body: { enabled: false } })
    );
    expect(missing.status).toBe(404);
  });
});
