import { randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, test } from "bun:test";

import { insertDefaultSettings, settingsRoutes } from "../../src/modules/config";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { insertInboxFolder, insertMailbox } from "../../src/modules/mail/repo";
import { settingsRouteDeps } from "../../src/web";

import { testCapabilities } from "./fixtures";
import { testDb } from "./helpers";
import { as, webOrg, webTestApp, type WebOrg } from "./web-helpers";

// The urgency route as the Rules page card reaches it (F110 stage 21 review): who may write, and the limits of the values.
const db = testDb();
const NOW = new Date("2026-11-15T12:00:00Z");
const orgs: WebOrg[] = [];
afterEach(async () => {
  for (const org of orgs) await org.cleanup();
  orgs.length = 0;
});
afterAll(async () => {
  await db.destroy();
});

async function setup() {
  const org = await webOrg(db);
  orgs.push(org);
  const id = randomUUID();
  const ctx = { orgId: org.orgId };
  await insertMailbox(db, ctx, {
    id,
    address: `urgency-values-${id}@x.test`,
    imapHost: "imap.x.test",
    imapPort: 993,
    smtpHost: "smtp.x.test",
    smtpPort: 465,
    capabilities: testCapabilities,
    folderMap: {},
  });
  await insertInboxFolder(db, ctx, id);
  await insertDefaultSettings(db, ctx, id);
  const app = webTestApp({
    db,
    sessions: { owner: org.ownerId, assistant: org.assistantId, other: org.otherOwnerId },
    routers: (api) => api.route("/", settingsRoutes(settingsRouteDeps(db, () => NOW, NO_TEST_SENDERS))),
  });
  return { app, id };
}

type App = Awaited<ReturnType<typeof setup>>["app"];
const put = (app: App, id: string, cookie: string, body: unknown) =>
  app.request(`/api/settings/${id}/urgency`, as(cookie, { method: "PUT", body }));
const get = (app: App, id: string, cookie: string) => app.request(`/api/settings/${id}`, as(cookie));
const one = (label: string, keywords: string[] = []) => ({ profile: { topics: [{ label, keywords }], deadlines: [] } });
const storedLabel = async (app: App, id: string): Promise<string | null> => {
  const view = (await (await get(app, id, "owner")).json()) as {
    urgencyProfile: { topics: { label: string }[] } | null;
  };
  return view.urgencyProfile?.topics[0]?.label ?? null;
};

describe("urgency route values", () => {
  test("a member gets 403 and the stored profile does not change", async () => {
    const { app, id } = await setup();
    expect((await put(app, id, "owner", one("owner label"))).status).toBe(200);
    expect((await put(app, id, "assistant", one("member label"))).status).toBe(403);
    expect((await put(app, id, "assistant", { profile: null })).status).toBe(403);
    expect(await storedLabel(app, id)).toBe("owner label");
  });

  test("the label limit is 80 characters and the keyword limit is 40", async () => {
    const { app, id } = await setup();
    expect((await put(app, id, "owner", one("x".repeat(80), ["k".repeat(40)]))).status).toBe(200);
    expect((await put(app, id, "owner", one("x".repeat(81)))).status).toBe(400);
    expect((await put(app, id, "owner", one("t", ["k".repeat(41)]))).status).toBe(400);
    expect((await put(app, id, "owner", one("t", ["k".repeat(10_000)]))).status).toBe(400);
    expect(await storedLabel(app, id)).toBe("x".repeat(80));
  });

  test("a NUL character in a label or a keyword gives 400 and changes nothing", async () => {
    const { app, id } = await setup();
    expect((await put(app, id, "owner", one("kept"))).status).toBe(200);
    expect((await put(app, id, "owner", one("a\u0000b"))).status).toBe(400);
    expect((await put(app, id, "owner", one("t", ["k\u0000"]))).status).toBe(400);
    const deadline = { profile: { topics: [], deadlines: [{ label: "\u0000", due: "2026-12-01" }] } };
    expect((await put(app, id, "owner", deadline)).status).toBe(400);
    expect(await storedLabel(app, id)).toBe("kept");
  });

  test("markup in a label is stored as typed text", async () => {
    const { app, id } = await setup();
    const label = "<img src=x onerror=alert(1)> **bold**";
    expect((await put(app, id, "owner", one(label, ["<b>"]))).status).toBe(200);
    expect(await storedLabel(app, id)).toBe(label);
  });
});
