import { randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, test } from "bun:test";

import { actionRoutes, getActionFeedback } from "../../src/modules/actions";
import { insertInboxFolder, insertMailbox } from "../../src/modules/mail/repo";
import { setOrgFeature } from "../../src/modules/tenancy";

import { insertDraftAndSend, testCapabilities } from "./fixtures";
import { testDb } from "./helpers";
import { as, TEST_ORIGIN, webOrg, webTestApp, type WebOrg } from "./web-helpers";

const db = testDb();
const NOW = new Date("2026-11-14T12:00:00Z");
const DAY = 24 * 3_600_000;

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
    address: `actions-${id}@x.test`,
    imapHost: "imap.x.test",
    imapPort: 993,
    smtpHost: "smtp.x.test",
    smtpPort: 465,
    capabilities: testCapabilities,
    folderMap: {},
  });
  await insertInboxFolder(db, ctx, id);
  return id;
}

// A send of the given status; an applied send gets its `applied_at` `ageMs` before NOW.
async function addSend(orgId: string, mailboxId: string, status: string, ageMs = DAY): Promise<string> {
  const ctx = { orgId };
  const approved = status === "applied" ? { userId: await ownerOf(orgId), at: NOW } : undefined;
  const { sendId } = await db
    .transaction()
    .execute((trx) => insertDraftAndSend(trx, ctx, mailboxId, { sendStatus: status, approved }));
  if (status === "applied") {
    await db
      .updateTable("actions")
      .set({ applied_at: new Date(NOW.getTime() - ageMs) })
      .where("id", "=", sendId)
      .execute();
  }
  return sendId;
}

async function ownerOf(orgId: string): Promise<string> {
  const row = await db
    .selectFrom("memberships")
    .select("user_id")
    .where("org_id", "=", orgId)
    .where("role", "=", "owner")
    .executeTakeFirstOrThrow();
  return row.user_id;
}

async function setup(opts: { flag: boolean } = { flag: true }) {
  const org = await webOrg(db);
  orgs.push(org);
  const mine = await addMailbox(org.orgId);
  const theirs = await addMailbox(org.otherOrgId);
  if (opts.flag) {
    await setOrgFeature(db, { orgId: org.orgId }, { flag: "mistake_capture", enabled: true, actor: "cli", now: NOW });
  }
  const app = webTestApp({
    db,
    sessions: { owner: org.ownerId, assistant: org.assistantId, other: org.otherOwnerId },
    routers: (api) => api.route("/", actionRoutes({ db, now: () => NOW })),
  });
  return { org, app, mine, theirs };
}

const post = (cookie: string, body: unknown = {}) => as(cookie, { method: "POST", body });

describe("POST /api/actions/:id/reject-reason", () => {
  test("1. 401 without a session, 403 for an assistant, 404 with the flag off", async () => {
    const { org, app, mine } = await setup();
    const id = await addSend(org.orgId, mine, "rejected");
    const url = `/api/actions/${id}/reject-reason`;
    expect((await app.request(url, { method: "POST", headers: { origin: TEST_ORIGIN } })).status).toBe(401);
    const assistant = await app.request(url, post("assistant", { reason: "wrong_person" }));
    expect(assistant.status).toBe(403);
    expect(await assistant.json()).toEqual({ error: "owner_only" });

    const off = await setup({ flag: false });
    const offId = await addSend(off.org.orgId, off.mine, "rejected");
    const res = await off.app.request(`/api/actions/${offId}/reject-reason`, post("owner", { reason: "wrong_person" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(await getActionFeedback(db, { orgId: off.org.orgId }, offId, "reject_reason")).toBeUndefined();
  });

  test("2. 400 for a bad reason, a missing body and a non-UUID id; 404 for another organization's action", async () => {
    const { org, app, mine, theirs } = await setup();
    const id = await addSend(org.orgId, mine, "rejected");
    const bad = await app.request(`/api/actions/${id}/reject-reason`, post("owner", { reason: "bad" }));
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe("validation");
    expect((await app.request(`/api/actions/${id}/reject-reason`, post("owner", {}))).status).toBe(400);
    expect((await app.request("/api/actions/nope/reject-reason", post("owner", { reason: "not_needed" }))).status).toBe(
      400
    );

    const foreign = await addSend(org.otherOrgId, theirs, "rejected");
    const res = await app.request(`/api/actions/${foreign}/reject-reason`, post("owner", { reason: "not_needed" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(await getActionFeedback(db, { orgId: org.otherOrgId }, foreign, "reject_reason")).toBeUndefined();
  });

  test("3. saved, then saved again with another reason (replace); 409 not_rejected for an applied send", async () => {
    const { org, app, mine } = await setup();
    const id = await addSend(org.orgId, mine, "rejected");
    const url = `/api/actions/${id}/reject-reason`;
    const first = await app.request(url, post("owner", { reason: "wrong_person" }));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ status: "saved" });
    const second = await app.request(url, post("owner", { reason: "not_needed" }));
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ status: "saved" });
    expect(await getActionFeedback(db, { orgId: org.orgId }, id, "reject_reason")).toMatchObject({
      reason: "not_needed",
      userId: org.ownerId,
      via: "web",
    });

    const applied = await addSend(org.orgId, mine, "applied");
    const res = await app.request(`/api/actions/${applied}/reject-reason`, post("owner", { reason: "wrong_content" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "not_rejected" });
  });
});

describe("POST /api/actions/:id/mistake", () => {
  test("4. 401, 403, 404 with the flag off, 400 for a non-UUID id, 404 for another organization's action", async () => {
    const { org, app, mine, theirs } = await setup();
    const id = await addSend(org.orgId, mine, "applied");
    expect(
      (await app.request(`/api/actions/${id}/mistake`, { method: "POST", headers: { origin: TEST_ORIGIN } })).status
    ).toBe(401);
    expect((await app.request(`/api/actions/${id}/mistake`, post("assistant"))).status).toBe(403);
    expect((await app.request("/api/actions/nope/mistake", post("owner"))).status).toBe(400);
    const foreign = await addSend(org.otherOrgId, theirs, "applied");
    const res = await app.request(`/api/actions/${foreign}/mistake`, post("owner"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });

    const off = await setup({ flag: false });
    const offId = await addSend(off.org.orgId, off.mine, "applied");
    const offRes = await off.app.request(`/api/actions/${offId}/mistake`, post("owner"));
    expect(offRes.status).toBe(404);
    expect(await getActionFeedback(db, { orgId: off.org.orgId }, offId, "mistake")).toBeUndefined();
  });

  test("5. saved, then already; 409 too_late after 7 days; 409 not_sent for a rejected send", async () => {
    const { org, app, mine } = await setup();
    const id = await addSend(org.orgId, mine, "applied");
    const url = `/api/actions/${id}/mistake`;
    const first = await app.request(url, post("owner"));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ status: "saved" });
    const second = await app.request(url, post("owner"));
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ status: "already" });
    expect(await getActionFeedback(db, { orgId: org.orgId }, id, "mistake")).toMatchObject({
      userId: org.ownerId,
      via: "web",
    });

    const old = await addSend(org.orgId, mine, "applied", 8 * DAY);
    const late = await app.request(`/api/actions/${old}/mistake`, post("owner"));
    expect(late.status).toBe(409);
    expect(await late.json()).toEqual({ error: "too_late" });

    const rejected = await addSend(org.orgId, mine, "rejected");
    const notSent = await app.request(`/api/actions/${rejected}/mistake`, post("owner"));
    expect(notSent.status).toBe(409);
    expect(await notSent.json()).toEqual({ error: "not_sent" });
  });
});
