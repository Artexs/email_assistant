import { randomBytes, randomUUID } from "node:crypto";

import { meSchema } from "@ea/core";
import { hashPassword } from "better-auth/crypto";
import { afterAll, afterEach, describe, expect, test } from "bun:test";

import { insertMailbox, setMailboxStatus } from "../../src/modules/mail/repo";
import {
  configureFeatures,
  isOrgSuspended,
  setDigestTimes,
  tenancyRoutes,
  upsertOrgFeature,
} from "../../src/modules/tenancy";
import { insertUser } from "../../src/modules/tenancy/repo";
import { loadConfig } from "../../src/platform/config";
import { createSecretBox } from "../../src/platform/crypto";
import { createApp } from "../../src/platform/http";
import { countMailboxes, onboardingDeps, webDeps } from "../../src/web";

import { testCapabilities } from "./fixtures";
import { testDb } from "./helpers";
import { as, noBackupCodes, webOrg, webTestApp, type WebOrg } from "./web-helpers";

const db = testDb();
const off = { kind: "off", reason: "env_off" } as const;

const orgs: WebOrg[] = [];
const userIds: string[] = [];

afterEach(async () => {
  configureFeatures({ off: [] });
  for (const org of orgs) await org.cleanup();
  if (userIds.length > 0) await db.deleteFrom("users").where("id", "in", userIds).execute();
  orgs.length = 0;
  userIds.length = 0;
});

afterAll(async () => {
  await db.destroy();
});

async function setup() {
  const org = await webOrg(db);
  orgs.push(org);
  const owner = await db.selectFrom("users").select("email").where("id", "=", org.ownerId).executeTakeFirstOrThrow();
  const { id: nobodyId } = await insertUser(db, { email: `web-me-n-${randomUUID()}@x.test`, displayName: "Nobody" });
  userIds.push(nobodyId);

  const ctx = { orgId: org.orgId };
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
  return { ownerEmail: owner.email, orgId: org.orgId, ownerId: org.ownerId, assistantId: org.assistantId, nobodyId };
}

function appFor(
  ids: { ownerId: string; assistantId: string; nobodyId: string },
  operatorContact: string | null = null,
  operatorUserIds?: ReadonlySet<string>,
  twoFactorOff?: ReadonlySet<string>
) {
  return webTestApp({
    db,
    sessions: { "good-owner": ids.ownerId, "good-assistant": ids.assistantId, "good-nobody": ids.nobodyId },
    isOrgSuspended: (orgId) => isOrgSuspended(db, { orgId }),
    ...(operatorUserIds ? { operatorUserIds } : {}),
    ...(twoFactorOff ? { twoFactorOff } : {}),
    routers: (api) =>
      api.route(
        "/",
        tenancyRoutes({
          db,
          now: () => new Date(),
          scopes: { triage: off, actions: off, send: off },
          countMailboxes: countMailboxes(db),
          operatorContact,
          sessions: async () => [],
          backupCodesLeft: noBackupCodes,
          ...onboardingDeps(db, async () => "fake_ea_bot"),
        })
      ),
  });
}

describe("GET /api/me", () => {
  test("returns the owner's shape with the real counts", async () => {
    const ids = await setup();
    const res = await appFor(ids).request("/api/me", as("good-owner"));
    expect(res.status).toBe(200);
    const me = meSchema.parse(await res.json());
    expect(me.role).toBe("owner");
    expect(me.user).toEqual({ id: ids.ownerId, email: ids.ownerEmail, displayName: "Owner", locale: null });
    expect(me.organization).toEqual({
      id: ids.orgId,
      name: "Web org",
      timezone: "Europe/Warsaw",
      plan: "active",
      trialEndsAt: null,
      maxMailboxes: 2,
    });
    expect(me.operatorContact).toBeNull();
    expect(me.mailboxCount).toBe(2);
    expect(me.mailboxesInAuthError).toBe(1);
    expect(me.scopes.triage).toEqual({ kind: "off", reason: "env_off" });
    expect(me.telegram).toEqual({ available: true, linked: false, botUsername: "fake_ea_bot" });
    expect(me.onboarding).toEqual({
      mailbox: true,
      telegram: false,
      telegramAvailable: true,
      mode: false,
      rules: 0,
      done: false,
    });
  });

  test("operator and features: a plain owner has none; a flag row turns one on; the kill list turns it off (D23)", async () => {
    const ids = await setup();
    const read = async (app = appFor(ids)) => {
      const body = await (await app.request("/api/me", as("good-owner"))).json();
      return { me: meSchema.parse(body), raw: JSON.stringify(body) };
    };
    const plain = await read();
    expect(plain.me.operator).toBe(false);
    expect(plain.me.features).toEqual([]);

    await upsertOrgFeature(
      db,
      { orgId: ids.orgId },
      { flag: "stats_page", enabled: true, setBy: "test", setAt: new Date("2026-11-20T10:00:00Z") }
    );
    expect((await read()).me.features).toEqual(["stats_page"]);

    configureFeatures({ off: ["stats_page"] });
    expect((await read()).me.features).toEqual([]);
    configureFeatures({ off: [] });

    const otherOperatorId = randomUUID();
    const operator = await read(appFor(ids, null, new Set([ids.ownerId, otherOperatorId])));
    expect(operator.me.operator).toBe(true);
    const other = await read(appFor(ids, null, new Set([randomUUID()])));
    expect(other.me.operator).toBe(false);
    // The body holds no list of operator ids.
    expect(Object.keys(operator.me).sort()).toEqual(Object.keys(plain.me).sort());
    expect(operator.raw).not.toContain(otherOperatorId);
  });

  test("an operator without TOTP still reads operator: true (F105 D10: the page sends the user to the settings)", async () => {
    const ids = await setup();
    const app = appFor(ids, null, new Set([ids.ownerId]), new Set([ids.ownerId]));
    const me = meSchema.parse(await (await app.request("/api/me", as("good-owner"))).json());
    expect(me.operator).toBe(true);
  });

  test("returns the trial end and the plan to every member", async () => {
    const ids = await setup();
    await db
      .updateTable("organizations")
      .set({ plan: "trial", trial_ends_at: new Date("2026-12-01T00:00:00Z") })
      .where("id", "=", ids.orgId)
      .execute();
    const app = appFor(ids);
    for (const cookie of ["good-owner", "good-assistant"]) {
      const me = meSchema.parse(await (await app.request("/api/me", as(cookie))).json());
      expect(me.organization.plan).toBe("trial");
      expect(me.organization.trialEndsAt).toBe("2026-12-01T00:00:00.000Z");
      expect(me.organization.maxMailboxes).toBe(2);
    }
  });

  test("answers 200 with plan suspended for a suspended organization", async () => {
    const ids = await setup();
    await db.updateTable("organizations").set({ plan: "suspended" }).where("id", "=", ids.orgId).execute();
    const res = await appFor(ids).request("/api/me", as("good-owner"));
    expect(res.status).toBe(200);
    expect(meSchema.parse(await res.json()).organization.plan).toBe("suspended");
  });

  test("returns the operator contact of the deps", async () => {
    const ids = await setup();
    const res = await appFor(ids, "ops@example.test").request("/api/me", as("good-owner"));
    expect(meSchema.parse(await res.json()).operatorContact).toBe("ops@example.test");
  });

  test("returns the digest times sorted, and [] when the member has none", async () => {
    const ids = await setup();
    const app = appFor(ids);
    expect(await setDigestTimes(db, { orgId: ids.orgId }, ids.ownerId, [])).toBe(true); // the column default is 08:00 and 16:00
    const none = meSchema.parse(await (await app.request("/api/me", as("good-owner"))).json());
    expect(none.digestTimes).toEqual([]);
    expect(await setDigestTimes(db, { orgId: ids.orgId }, ids.ownerId, ["13:00", "08:00"])).toBe(true);
    const res = await app.request("/api/me", as("good-owner"));
    expect(meSchema.parse(await res.json()).digestTimes).toEqual(["08:00", "13:00"]);
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
      db,
      {
        secrets: createSecretBox(randomBytes(32).toString("base64"), 1),
        actionsScope: { kind: "off" },
        botUsername: null,
      }
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
