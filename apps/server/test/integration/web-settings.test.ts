import { randomUUID } from "node:crypto";
import { format } from "node:util";

import { barCategories, noGoBodySchema, settingsChangeSchema, settingsViewSchema, HOUR_MS, DAY_MS } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { insertDefaultSettings, settingsRoutes } from "../../src/modules/config";
import { ensureSyncFolders, getSentSyncView, NO_TEST_SENDERS } from "../../src/modules/mail";
import {
  getSentSyncState,
  insertInboxFolder,
  insertMailbox,
  insertSentEmails,
  type NewSentEmail,
  setFolderMapEntry,
  writeSentSwitch,
} from "../../src/modules/mail/repo";
import { configureFeatures, upsertOrgFeature } from "../../src/modules/tenancy";
import { settingsRouteDeps } from "../../src/web";

import { insertTriagedWithActions, testCapabilities } from "./fixtures";
import { testDb } from "./helpers";
import { as, TEST_ORIGIN, webOrg, webTestApp, type WebOrg } from "./web-helpers";

const db = testDb();
const NOW = new Date("2026-11-11T12:00:00Z");
const UNKNOWN = "00000000-0000-4000-8000-000000000000";

const orgs: WebOrg[] = [];

beforeEach(() => {
  configureFeatures({ off: [] });
});

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
    routers: (api) => api.route("/", settingsRoutes(settingsRouteDeps(db, () => NOW, NO_TEST_SENDERS))),
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
    .orderBy("id")
    .execute();
}

const patchRoutes = [
  { path: "mode", body: { mode: "assist", keepSwitches: false } },
  { path: "switches/flag", body: { value: true } },
  { path: "auto/info", body: { auto: true } },
  { path: "sync-folders/offers", body: { enabled: false } },
  { path: "sent-sync", body: { enabled: true } },
] as const;

describe("route matrix", () => {
  test("no cookie → 401 on the six routes", async () => {
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

  test("the assistant: GET 200, the five PATCH routes 403 owner_only", async () => {
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

  test("another organization's owner gets 404 on GET and PATCH and changes nothing", async () => {
    const { app, m1, org } = await setup();
    const before = await json(await app.request(`/api/settings/${m1}`, as("owner")));
    const bodies = [
      { path: "mode", body: { mode: "assist", keepSwitches: false } },
      { path: "auto/info", body: { auto: true } },
      { path: "auto/info", body: { auto: true, force: true } },
    ];
    expect((await app.request(`/api/settings/${m1}`, as("other"))).status).toBe(404);
    for (const item of bodies) {
      const res = await app.request(
        `/api/settings/${m1}/${item.path}`,
        as("other", { method: "PATCH", body: item.body })
      );
      expect(res.status).toBe(404);
    }
    expect(await json(await app.request(`/api/settings/${m1}`, as("owner")))).toEqual(before);
    for (const event of ["mailbox.mode_changed", "mailbox.policy_changed", "mailbox.switch_changed"]) {
      expect(await auditRows(org.orgId, event)).toHaveLength(0);
    }
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

  test("a bad body on each PATCH route → 400 validation with the path of the bad field", async () => {
    const { app, m1 } = await setup();
    const cases = [
      { path: "mode", body: { mode: "on", keepSwitches: false }, field: "mode" },
      { path: "mode", body: { mode: "assist" }, field: "keepSwitches" },
      { path: "switches/flag", body: { value: "yes" }, field: "value" },
      { path: "auto/info", body: { auto: "yes" }, field: "auto" },
      { path: "auto/info", body: { auto: true, force: 1 }, field: "force" },
      { path: "sync-folders/offers", body: { enabled: "yes" }, field: "enabled" },
      { path: "sent-sync", body: { enabled: "yes" }, field: "enabled" },
    ];
    for (const item of cases) {
      const res = await app.request(
        `/api/settings/${m1}/${item.path}`,
        as("owner", { method: "PATCH", body: item.body })
      );
      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.error).toBe("validation");
      expect(body.details[0].path).toBe(item.field);
    }
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
        createdAt: new Date(NOW.getTime() - HOUR_MS),
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
        createdAt: new Date(NOW.getTime() - HOUR_MS),
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

  test("a switch change writes one mailbox.switch_changed audit row", async () => {
    const { app, m1, org } = await setup();
    await app.request(
      `/api/settings/${m1}/mode`,
      as("owner", { method: "PATCH", body: { mode: "assist", keepSwitches: false } })
    );
    const res = await app.request(
      `/api/settings/${m1}/switches/move`,
      as("owner", { method: "PATCH", body: { value: false } })
    );
    expect(res.status).toBe(200);
    const rows = await auditRows(org.orgId, "mailbox.switch_changed");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor).toBe(org.ownerId);
    expect(rows[0]?.data).toMatchObject({ field: "switch.move", from: true, to: false });
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

async function setFlag(orgId: string, enabled: boolean): Promise<void> {
  await upsertOrgFeature(db, { orgId }, { flag: "sent_sync", enabled, setBy: "test", setAt: NOW });
}

// The repository function takes a transaction.
function insertRows(ctx: { orgId: string }, rows: NewSentEmail[]): Promise<number> {
  return db.transaction().execute((trx) => insertSentEmails(trx, ctx, rows));
}

// One sent row; the internal date is `ageDays` before NOW.
async function putSent(
  orgId: string,
  mailboxId: string,
  n: number,
  ageDays: number,
  origin: "user" | "system" = "user"
): Promise<void> {
  const at = new Date(NOW.getTime() - ageDays * DAY_MS);
  await insertRows({ orgId }, [
    {
      mailboxId,
      dedupKey: `mid:<settings-sent-${n}-${mailboxId}@x.test>:h1`,
      path: "Sent",
      uidValidity: 7,
      uid: n,
      messageId: null,
      parentMessageId: null,
      referencesIds: [],
      threadKey: `<settings-sent-${n}-${mailboxId}@x.test>`,
      fromAddress: null,
      toAddresses: [],
      ccAddresses: [],
      subject: null,
      sentAt: at,
      internalDate: at,
      origin,
      actionId: origin === "system" ? randomUUID() : null,
      content: origin === "system" ? "headers_only" : "pending",
    },
  ]);
}

async function switchOn(orgId: string, mailboxId: string): Promise<void> {
  await db.transaction().execute((trx) => writeSentSwitch(trx, { orgId }, mailboxId, { enabled: true, at: NOW }));
}

async function sentRows(orgId: string, mailboxId: string): Promise<number> {
  const rows = await db
    .selectFrom("sent_emails")
    .select("id")
    .where("org_id", "=", orgId)
    .where("mailbox_id", "=", mailboxId)
    .execute();
  return rows.length;
}

async function sentView(app: Awaited<ReturnType<typeof setup>>["app"], mailboxId: string) {
  const res = await app.request(`/api/settings/${mailboxId}`, as("owner"));
  expect(res.status).toBe(200);
  return settingsViewSchema.parse(await json(res)).sentSync;
}

function patchSent(app: Awaited<ReturnType<typeof setup>>["app"], mailboxId: string, enabled: boolean, who = "owner") {
  return app.request(`/api/settings/${mailboxId}/sent-sync`, as(who, { method: "PATCH", body: { enabled } }));
}

describe("sentSync in the view and PATCH sent-sync", () => {
  test("flag off, no state: the field is null and PATCH on is 404 (a hidden feature looks absent)", async () => {
    const { app, m1, org } = await setup();
    expect(await sentView(app, m1)).toBeNull();
    const res = await patchSent(app, m1, true);
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: "not_found" });
    expect(await getSentSyncState(db, { orgId: org.orgId }, m1)).toBeUndefined();
    expect(await auditRows(org.orgId, "mailbox.sent_sync_changed")).toHaveLength(0);
  });

  test("flag off, switch on, one row: paused view; PATCH off deletes the row, then the field is null", async () => {
    const { app, m1, org } = await setup();
    await switchOn(org.orgId, m1);
    await putSent(org.orgId, m1, 1, 1);
    expect(await sentView(app, m1)).toMatchObject({ flagOn: false, enabled: true });
    const res = await patchSent(app, m1, false);
    expect(res.status).toBe(200);
    const change = settingsChangeSchema.parse(await json(res));
    expect(change.changed).toBe(true);
    expect(change.settings.sentSync).toBeNull();
    expect(await sentRows(org.orgId, m1)).toBe(0);
    expect(await sentView(app, m1)).toBeNull();
  });

  test("flag on, no state: the off view; with folder_map.sent the folder shows", async () => {
    const { app, m1, org } = await setup();
    await setFlag(org.orgId, true);
    expect(await sentView(app, m1)).toEqual({
      flagOn: true,
      enabled: false,
      folder: null,
      firstPassDone: false,
      lastSentAt: null,
      storedCount: 0,
      errorCode: null,
    });
    await setFolderMapEntry(db, { orgId: org.orgId }, m1, "sent", "Sent");
    expect((await sentView(app, m1))?.folder).toBe("Sent");
  });

  test("a PATCH sent-sync without Origin or with a foreign Origin → 403 bad_origin, nothing changes", async () => {
    const { app, m1, org } = await setup();
    await setFlag(org.orgId, true);
    for (const origin of [undefined, "https://evil.example"]) {
      const res = await app.request(`/api/settings/${m1}/sent-sync`, {
        method: "PATCH",
        headers: {
          cookie: "ea.session_token=owner",
          "content-type": "application/json",
          ...(origin === undefined ? {} : { origin }),
        },
        body: JSON.stringify({ enabled: true }),
      });
      expect(res.status).toBe(403);
      expect((await json(res)).error).toBe("bad_origin");
    }
    expect(await getSentSyncState(db, { orgId: org.orgId }, m1)).toBeUndefined();
    expect(await auditRows(org.orgId, "mailbox.sent_sync_changed")).toHaveLength(0);
  });

  test("flag on, switch already on, PATCH on: 200, changed false, no new audit row, state kept", async () => {
    const { app, m1, org } = await setup();
    await setFlag(org.orgId, true);
    await switchOn(org.orgId, m1);
    const before = await getSentSyncState(db, { orgId: org.orgId }, m1);
    const res = await patchSent(app, m1, true);
    expect(res.status).toBe(200);
    const change = settingsChangeSchema.parse(await json(res));
    expect(change.changed).toBe(false);
    expect(change.settings.sentSync?.enabled).toBe(true);
    expect(await auditRows(org.orgId, "mailbox.sent_sync_changed")).toHaveLength(0);
    expect(await getSentSyncState(db, { orgId: org.orgId }, m1)).toEqual(before);
  });

  test("the owner turns it on: changed, enabled, one audit row with the user; again: changed false", async () => {
    const { app, m1, org } = await setup();
    await setFlag(org.orgId, true);
    const first = await patchSent(app, m1, true);
    expect(first.status).toBe(200);
    const change = settingsChangeSchema.parse(await json(first));
    expect(change.changed).toBe(true);
    expect(change.expired).toBe(0);
    expect(change.settings.sentSync?.enabled).toBe(true);
    const rows = await auditRows(org.orgId, "mailbox.sent_sync_changed");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor).toBe(org.ownerId);
    const again = settingsChangeSchema.parse(await json(await patchSent(app, m1, true)));
    expect(again.changed).toBe(false);
    expect(again.settings.sentSync?.enabled).toBe(true);
    expect(await auditRows(org.orgId, "mailbox.sent_sync_changed")).toHaveLength(1);
  });

  test("two user rows and a system row: storedCount 2 and lastSentAt of the newest; off: 0 and enabled false", async () => {
    const { app, m1, org } = await setup();
    await setFlag(org.orgId, true);
    await setFolderMapEntry(db, { orgId: org.orgId }, m1, "sent", "Sent");
    await switchOn(org.orgId, m1);
    await db
      .updateTable("mailbox_sent_sync")
      .set({ path: "Sent" })
      .where("org_id", "=", org.orgId)
      .where("mailbox_id", "=", m1)
      .execute();
    await putSent(org.orgId, m1, 1, 1);
    await putSent(org.orgId, m1, 2, 2);
    await putSent(org.orgId, m1, 3, 0, "system");
    const view = await sentView(app, m1);
    expect(view?.storedCount).toBe(2);
    expect(view?.lastSentAt).toBe(new Date(NOW.getTime() - DAY_MS).toISOString());
    const change = settingsChangeSchema.parse(await json(await patchSent(app, m1, false)));
    expect(change.settings.sentSync).toMatchObject({ enabled: false, storedCount: 0 });
    expect(await sentRows(org.orgId, m1)).toBe(0);
  });

  test("a member: 403; no session: 401; bad body: 400; another org's id or a non-UUID: 404", async () => {
    const { app, m1, m2, org } = await setup();
    await setFlag(org.orgId, true);
    expect((await patchSent(app, m1, true, "assistant")).status).toBe(403);
    const noSession = await app.request(`/api/settings/${m1}/sent-sync`, {
      method: "PATCH",
      headers: { origin: TEST_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    expect(noSession.status).toBe(401);
    const bad = await app.request(
      `/api/settings/${m1}/sent-sync`,
      as("owner", { method: "PATCH", body: { enabled: "yes" } })
    );
    expect(bad.status).toBe(400);
    expect((await patchSent(app, m2, true)).status).toBe(404);
    // A foreign id with a bad body is 404, not 400.
    const foreignBad = await app.request(
      `/api/settings/${m2}/sent-sync`,
      as("owner", { method: "PATCH", body: { enabled: "yes" } })
    );
    expect(foreignBad.status).toBe(404);
    expect((await patchSent(app, "not-a-uuid", true)).status).toBe(404);
    expect(await getSentSyncState(db, { orgId: org.orgId }, m1)).toBeUndefined();
  });

  test("another organization's owner cannot read or change the switch of this mailbox", async () => {
    const { app, m1, org } = await setup();
    await setFlag(org.orgId, true);
    await setFlag(org.otherOrgId, true);
    await switchOn(org.orgId, m1);
    await putSent(org.orgId, m1, 1, 1);
    expect((await patchSent(app, m1, false, "other")).status).toBe(404);
    expect((await app.request(`/api/settings/${m1}`, as("other"))).status).toBe(404);
    expect((await getSentSyncState(db, { orgId: org.orgId }, m1))?.enabled).toBe(true);
    expect(await sentRows(org.orgId, m1)).toBe(1);
    expect(await auditRows(org.orgId, "mailbox.sent_sync_changed")).toHaveLength(0);
  });

  test("no log line holds the subject, the text or the folder of a sent mail (every console method, util.format)", async () => {
    const { app, m1, org } = await setup();
    await setFlag(org.orgId, true);
    await setFolderMapEntry(db, { orgId: org.orgId }, m1, "sent", "canary-folder");
    await switchOn(org.orgId, m1);
    await putSent(org.orgId, m1, 1, 1);
    await db
      .updateTable("sent_emails")
      .set({ subject: "canary-subject", content: "stored", body_text: "canary-body" })
      .where("mailbox_id", "=", m1)
      .execute();
    const lines: string[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      spyOn(console, method).mockImplementation((...args: unknown[]) => {
        lines.push(format(...args));
      })
    );
    try {
      expect((await app.request(`/api/settings/${m1}`, as("owner"))).status).toBe(200);
      expect((await patchSent(app, m1, false)).status).toBe(200);
      expect((await patchSent(app, m1, false, "other")).status).toBe(404);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    expect(lines.filter((line) => line.includes("canary"))).toEqual([]);
  });

  test("getSentSyncView with the context of another organization gives null", async () => {
    const { m1, org } = await setup();
    await setFlag(org.orgId, true);
    await setFlag(org.otherOrgId, true);
    await switchOn(org.orgId, m1);
    expect(await getSentSyncView(db, { orgId: org.orgId }, m1, NOW)).not.toBeNull();
    expect(await getSentSyncView(db, { orgId: org.otherOrgId }, m1, NOW)).toBeNull();
  });
});
