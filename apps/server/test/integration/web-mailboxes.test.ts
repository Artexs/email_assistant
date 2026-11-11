import { randomBytes, randomUUID } from "node:crypto";

import { mailboxListSchema, mailboxViewSchema, type ScopeEnv } from "@ea/core";
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import type { Hono } from "hono";

import { queueMailboxRemovedNotices } from "../../src/modules/channels";
import { insertDefaultSettings } from "../../src/modules/config";
import { mailRoutes, WEB_MAIL_TIMEOUTS } from "../../src/modules/mail";
import { insertInboxFolder, insertMailbox, setMailboxStatus } from "../../src/modules/mail/repo";
import { createSecretBox } from "../../src/platform/crypto";
import type { ApiEnv } from "../../src/platform/http";

import { linkChat, randomChatId, testCapabilities } from "./fixtures";
import { testDb } from "./helpers";
import { as, TEST_ORIGIN, webOrg, webTestApp, type WebOrg } from "./web-helpers";

const db = testDb();
const NOW = new Date("2026-11-11T10:00:00.000Z");

const orgs: WebOrg[] = [];

afterEach(async () => {
  for (const org of orgs) await org.cleanup();
  orgs.length = 0;
});

afterAll(async () => {
  await db.destroy();
});

async function addMailbox(orgId: string, address: string, createdAt: Date): Promise<string> {
  const ctx = { orgId };
  const id = randomUUID();
  await insertMailbox(db, ctx, {
    id,
    address,
    imapHost: "imap.x.test",
    imapPort: 993,
    smtpHost: "smtp.x.test",
    smtpPort: 465,
    capabilities: testCapabilities,
    folderMap: {},
  });
  await db.updateTable("mailboxes").set({ created_at: createdAt }).where("id", "=", id).execute();
  await insertInboxFolder(db, ctx, id);
  await insertDefaultSettings(db, ctx, id);
  await db
    .insertInto("mailbox_credentials")
    .values({ mailbox_id: id, org_id: orgId, encrypted_secret: "x", secret_kind: "password", key_version: 1 })
    .execute();
  return id;
}

async function setup() {
  const org = await webOrg(db);
  orgs.push(org);
  const suffix = randomUUID();
  const address1 = `box-one-${suffix}@x.test`;
  const address2 = `box-two-${suffix}@x.test`;
  const m1 = await addMailbox(org.orgId, address1, new Date("2026-11-01T10:00:00Z"));
  const m2 = await addMailbox(org.orgId, address2, new Date("2026-11-02T10:00:00Z"));
  const other = await addMailbox(org.otherOrgId, `box-other-${suffix}@x.test`, new Date("2026-11-03T10:00:00Z"));
  const scopeEnv: ScopeEnv = {
    triage: "all",
    actions: "synthetic",
    send: "off",
    testMailboxAddress: address1.toUpperCase(),
  };
  const app = webTestApp({
    db,
    sessions: { owner: org.ownerId, assistant: org.assistantId },
    routers: (api: Hono<ApiEnv>) =>
      api.route(
        "/",
        mailRoutes({
          db,
          now: () => NOW,
          scopeEnv,
          connect: {
            db,
            secrets: createSecretBox(randomBytes(32).toString("base64"), 1),
            openProvider: async () => {
              throw new Error("not used");
            },
            verifySmtp: async () => {
              throw new Error("not used");
            },
            timeouts: WEB_MAIL_TIMEOUTS,
          },
          allowLocalHosts: false,
          onRemoved: async (trx, ctx, input) => {
            await queueMailboxRemovedNotices(trx, ctx, input);
          },
        })
      ),
  });
  return { org, app, m1, m2, other, address1, address2 };
}

const auditOf = (orgId: string, event: string) =>
  db.selectFrom("audit_log").selectAll().where("org_id", "=", orgId).where("event", "=", event).execute();

describe("mailbox routes", () => {
  test("the access matrix", async () => {
    const { app, m1, other } = await setup();
    const routes: [string, string][] = [
      ["POST", `/api/mailboxes/${m1}/pause`],
      ["POST", `/api/mailboxes/${m1}/resume`],
      ["DELETE", `/api/mailboxes/${m1}`],
    ];
    const noCookie = (method: string) => ({ method, headers: { origin: TEST_ORIGIN } });
    expect((await app.request("/api/mailboxes", noCookie("GET"))).status).toBe(401);
    for (const [method, path] of routes) {
      expect((await app.request(path, noCookie(method))).status).toBe(401);
      const asAssistant = await app.request(path, as("assistant", { method, body: { confirmAddress: "x" } }));
      expect(asAssistant.status).toBe(403);
      expect(await asAssistant.json()).toEqual({ error: "owner_only" });
    }
    expect((await app.request("/api/mailboxes", as("assistant"))).status).toBe(200);

    const body = { confirmAddress: "x@x.test" };
    for (const [method, suffix] of [
      ["POST", "pause"],
      ["POST", "resume"],
      ["DELETE", ""],
    ] as const) {
      for (const id of [other, "not-a-uuid"]) {
        const path = suffix ? `/api/mailboxes/${id}/${suffix}` : `/api/mailboxes/${id}`;
        const res = await app.request(path, as("owner", { method, body }));
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: "not_found" });
      }
    }

    const empty = await app.request(`/api/mailboxes/${m1}`, as("owner", { method: "DELETE", body: {} }));
    expect(empty.status).toBe(400);
    const json = (await empty.json()) as { error: string; details: { path: string }[] };
    expect(json.error).toBe("validation");
    expect(json.details[0]?.path).toBe("confirmAddress");

    const noOrigin = await app.request(`/api/mailboxes/${m1}`, {
      method: "DELETE",
      headers: { cookie: "ea.session_token=owner", "content-type": "application/json" },
      body: JSON.stringify({ confirmAddress: "x" }),
    });
    expect(noOrigin.status).toBe(403);
    expect(await noOrigin.json()).toEqual({ error: "bad_origin" });
  });

  test("GET lists the views in creation order with the scope badges", async () => {
    const { app, m1, m2, address1, address2 } = await setup();
    const res = await app.request("/api/mailboxes", as("owner"));
    expect(res.status).toBe(200);
    const views = mailboxListSchema.parse(await res.json());
    expect(views.map((v) => v.id)).toEqual([m1, m2]);
    expect(views.map((v) => v.address)).toEqual([address1, address2]);
    const [first, second] = views;
    expect(first?.scopes.triage).toEqual({ state: "on", reason: "test_mailbox_only" });
    expect(first?.scopes.actions).toEqual({ state: "synthetic", reason: "synthetic_only" });
    expect(first?.scopes.send).toEqual({ state: "off", reason: "env_off" });
    expect(second?.scopes.triage).toEqual({ state: "off", reason: "other_mailbox" });
    expect(first?.mode).toBe("shadow");
    expect(first?.lastSyncedAt).toBeNull();
    expect(first?.secretKind).toBe("password");
  });

  test("pause and resume write one audit row each and are idempotent", async () => {
    const { org, app, m1 } = await setup();
    const pause = () => app.request(`/api/mailboxes/${m1}/pause`, as("owner", { method: "POST" }));
    const first = await pause();
    expect(first.status).toBe(200);
    expect(mailboxViewSchema.parse(await first.json()).status).toBe("paused");
    const [row] = await auditOf(org.orgId, "mailbox.paused");
    expect(row?.data).toEqual({ mailbox_id: m1, via: "web" });
    expect(row?.actor).toBe(org.ownerId);

    expect((await pause()).status).toBe(200);
    expect(await auditOf(org.orgId, "mailbox.paused")).toHaveLength(1);

    const resume = await app.request(`/api/mailboxes/${m1}/resume`, as("owner", { method: "POST" }));
    expect(resume.status).toBe(200);
    expect(mailboxViewSchema.parse(await resume.json()).status).toBe("active");
    expect(await auditOf(org.orgId, "mailbox.resumed")).toHaveLength(1);
  });

  test("pause of a mailbox in auth_error gives 409", async () => {
    const { org, app, m2 } = await setup();
    await setMailboxStatus(db, { orgId: org.orgId }, m2, "auth_error");
    const res = await app.request(`/api/mailboxes/${m2}/pause`, as("owner", { method: "POST" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "wrong_status" });
  });

  test("delete takes the typed address, notifies the linked owner and then gives 404", async () => {
    const { org, app, m1, m2, address1 } = await setup();
    await db.transaction().execute((trx) => linkChat(trx, { orgId: org.orgId }, org.ownerId, randomChatId(), NOW));
    const remove = () =>
      app.request(
        `/api/mailboxes/${m1}`,
        as("owner", { method: "DELETE", body: { confirmAddress: ` ${address1.toUpperCase()} ` } })
      );
    const res = await remove();
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");

    const list = mailboxListSchema.parse(await (await app.request("/api/mailboxes", as("owner"))).json());
    expect(list.map((v) => v.id)).toEqual([m2]);
    const outbox = await db
      .selectFrom("outbox")
      .select("id")
      .where("org_id", "=", org.orgId)
      .where("kind", "=", "mailbox_removed")
      .execute();
    expect(outbox).toHaveLength(1);

    expect((await remove()).status).toBe(404);
  });

  test("delete with the wrong address changes nothing", async () => {
    const { app, m1 } = await setup();
    const res = await app.request(
      `/api/mailboxes/${m1}`,
      as("owner", { method: "DELETE", body: { confirmAddress: "wrong@x.test" } })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "confirm_mismatch" });
    const views = mailboxListSchema.parse(await (await app.request("/api/mailboxes", as("owner"))).json());
    expect(views.find((v) => v.id === m1)?.status).toBe("active");
  });
});
