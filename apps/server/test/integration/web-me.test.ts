import { randomUUID } from "node:crypto";

import { meSchema } from "@ea/core";
import { hashPassword } from "better-auth/crypto";
import { afterAll, afterEach, describe, expect, test } from "bun:test";

import { insertMailbox, setMailboxStatus } from "../../src/modules/mail/repo";
import { createOrganizationWithOwner, listMembershipsOfUser, tenancyRoutes } from "../../src/modules/tenancy";
import { insertMembership, insertUser } from "../../src/modules/tenancy/repo";
import { loadConfig } from "../../src/platform/config";
import { buildTrustedProxies, createApp, type WebDeps } from "../../src/platform/http";
import { countMailboxes, webDeps } from "../../src/web";

import { testCapabilities } from "./fixtures";
import { testDb } from "./helpers";

const db = testDb();
const off = { kind: "off", reason: "env_off" } as const;

const orgIds: string[] = [];
const userIds: string[] = [];

afterEach(async () => {
  for (const orgId of orgIds) await db.deleteFrom("organizations").where("id", "=", orgId).execute();
  if (userIds.length > 0) await db.deleteFrom("users").where("id", "in", userIds).execute();
  orgIds.length = 0;
  userIds.length = 0;
});

afterAll(async () => {
  await db.destroy();
});

async function setup() {
  const ownerEmail = `web-me-${randomUUID()}@x.test`;
  const { orgId, userId: ownerId } = await createOrganizationWithOwner(db, {
    orgName: "Web me",
    timezone: "Europe/Warsaw",
    email: ownerEmail.toUpperCase(),
    displayName: "Owner",
  });
  orgIds.push(orgId);
  userIds.push(ownerId);
  const { id: assistantId } = await insertUser(db, {
    email: `web-me-a-${randomUUID()}@x.test`,
    displayName: "Assistant",
  });
  userIds.push(assistantId);
  await insertMembership(db, { orgId }, { userId: assistantId, role: "assistant" });
  const { id: nobodyId } = await insertUser(db, { email: `web-me-n-${randomUUID()}@x.test`, displayName: "Nobody" });
  userIds.push(nobodyId);

  const ctx = { orgId };
  const mailboxIds = [randomUUID(), randomUUID()];
  for (const [i, id] of mailboxIds.entries()) {
    await insertMailbox(db, ctx, {
      id,
      address: `box${i}-${id}@x.test`,
      imapHost: "imap.x.test",
      imapPort: 993,
      smtpHost: "smtp.x.test",
      smtpPort: 465,
      capabilities: testCapabilities,
      folderMap: {},
    });
  }
  await setMailboxStatus(db, ctx, mailboxIds[0] as string, "auth_error");
  return { ownerEmail: ownerEmail.toLowerCase(), orgId, ownerId, assistantId, nobodyId };
}

function appFor(ids: { ownerId: string; assistantId: string; nobodyId: string }) {
  const sessions: Record<string, string> = {
    "good-owner": ids.ownerId,
    "good-assistant": ids.assistantId,
    "good-nobody": ids.nobodyId,
  };
  const web: WebDeps = {
    auth: {
      handler: async () => new Response(),
      getSession: async (headers) => {
        const userId = sessions[headers.get("cookie")?.replace("ea.session_token=", "") ?? ""];
        return userId ? { userId } : null;
      },
    },
    db,
    now: () => new Date(),
    dist: "/nonexistent/dist",
    baseUrl: new URL("http://127.0.0.1:8080"),
    trustedOrigins: new Set(["http://127.0.0.1:8080"]),
    trustedProxies: buildTrustedProxies([]),
    connInfo: () => undefined,
    listMembershipsOfUser: (userId) => listMembershipsOfUser(db, userId),
    routers: (api) =>
      api.route(
        "/",
        tenancyRoutes({ db, scopes: { triage: off, actions: off, send: off }, countMailboxes: countMailboxes(db) })
      ),
  };
  return createApp({ checkDb: async () => true, web });
}

const as = (cookie: string) => ({ headers: { cookie: `ea.session_token=${cookie}` } });

describe("GET /api/me", () => {
  test("returns the owner's shape with the real counts", async () => {
    const ids = await setup();
    const res = await appFor(ids).request("/api/me", as("good-owner"));
    expect(res.status).toBe(200);
    const me = meSchema.parse(await res.json());
    expect(me.role).toBe("owner");
    expect(me.user).toEqual({ id: ids.ownerId, email: ids.ownerEmail, displayName: "Owner" });
    expect(me.organization).toEqual({ id: ids.orgId, name: "Web me", timezone: "Europe/Warsaw" });
    expect(me.mailboxCount).toBe(2);
    expect(me.mailboxesInAuthError).toBe(1);
    expect(me.scopes.triage).toEqual({ kind: "off", reason: "env_off" });
    expect(me.telegram).toBeNull();
    expect(me.onboarding).toBeNull();
  });

  test("returns role assistant for an assistant", async () => {
    const ids = await setup();
    const res = await appFor(ids).request("/api/me", as("good-assistant"));
    expect(res.status).toBe(200);
    expect(meSchema.parse(await res.json()).role).toBe("assistant");
  });

  test("answers 403 no_organization for a user without a membership", async () => {
    const ids = await setup();
    const res = await appFor(ids).request("/api/me", as("good-nobody"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "no_organization" });
  });

  test("answers 401 without a cookie", async () => {
    const ids = await setup();
    const res = await appFor(ids).request("/api/me");
    expect(res.status).toBe(401);
  });
});

describe("countMailboxes", () => {
  test("counts all mailboxes and those in auth_error", async () => {
    const ids = await setup();
    expect(await countMailboxes(db)({ orgId: ids.orgId })).toEqual({ total: 2, inAuthError: 1 });
  });
});

describe("real webDeps getSession", () => {
  test("maps a real sign-in cookie to the user id", async () => {
    const ids = await setup();
    await db
      .insertInto("auth_accounts")
      .values({
        account_id: ids.ownerId,
        provider_id: "credential",
        user_id: ids.ownerId,
        password: await hashPassword("a-good-password-1"),
        access_token: null,
        access_token_expires_at: null,
        id_token: null,
        refresh_token: null,
        refresh_token_expires_at: null,
        scope: null,
      })
      .execute();
    const web = webDeps(
      loadConfig({
        ...process.env,
        WEB_BASE_URL: "http://127.0.0.1:8080",
        WEB_AUTH_SECRET: "x".repeat(40),
        WEB_DIST: "/nonexistent/dist",
      }),
      db
    );
    if (web === null) throw new Error("webDeps returned null");
    try {
      const app = createApp({ checkDb: async () => true, web });
      const signIn = await app.request("/api/auth/sign-in/email", {
        method: "POST",
        headers: { origin: "http://127.0.0.1:8080", "content-type": "application/json" },
        body: JSON.stringify({ email: ids.ownerEmail, password: "a-good-password-1" }),
      });
      expect(signIn.status).toBe(200);
      const cookie = (signIn.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
      expect(cookie).toContain("ea.session_token=");

      const session = await web.auth.getSession(new Headers({ cookie }));
      expect(session?.userId).toBe(ids.ownerId);
      expect(await web.auth.getSession(new Headers())).toBeNull();

      const res = await app.request("/api/me", { headers: { cookie } });
      expect(res.status).toBe(200);
      const me = meSchema.parse(await res.json());
      expect(me.mailboxCount).toBe(2);
      expect(me.mailboxesInAuthError).toBe(1);
    } finally {
      await web.close();
    }
  });
});
