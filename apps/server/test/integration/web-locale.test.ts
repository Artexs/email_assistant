import { meSchema } from "@ea/core";
import { afterAll, afterEach, describe, expect, test } from "bun:test";

import { getUserAuthProfile, isOrgSuspended, tenancyRoutes } from "../../src/modules/tenancy";
import { countMailboxes, onboardingDeps } from "../../src/web";

import { testDb } from "./helpers";
import { as, webOrg, webTestApp, type WebOrg } from "./web-helpers";

const db = testDb();
const off = { kind: "off", reason: "env_off" } as const;
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
  const app = webTestApp({
    db,
    sessions: { owner: org.ownerId, assistant: org.assistantId },
    isOrgSuspended: (orgId) => isOrgSuspended(db, { orgId }),
    routers: (api) =>
      api.route(
        "/",
        tenancyRoutes({
          db,
          now: () => new Date(),
          scopes: { triage: off, actions: off, send: off },
          countMailboxes: countMailboxes(db),
          operatorContact: null,
          sessions: async () => [],
          ...onboardingDeps(db, async () => "fake_ea_bot"),
        })
      ),
  });
  return { org, app };
}

const localeOf = async (userId: string): Promise<string | null> =>
  (await db.selectFrom("users").select("locale").where("id", "=", userId).executeTakeFirstOrThrow()).locale;

const patch = (cookie: string, body: unknown) => as(cookie, { method: "PATCH", body });

describe("PATCH /api/me/locale", () => {
  test("without a session it answers 401", async () => {
    const { app } = await setup();
    const res = await app.request("/api/me/locale", {
      method: "PATCH",
      headers: { origin: "http://127.0.0.1:8080", "content-type": "application/json" },
      body: JSON.stringify({ locale: "en" }),
    });
    expect(res.status).toBe(401);
  });

  test("a bad or empty body answers 400 and stores nothing", async () => {
    const { org, app } = await setup();
    expect((await app.request("/api/me/locale", patch("owner", { locale: "de" }))).status).toBe(400);
    expect((await app.request("/api/me/locale", patch("owner", {}))).status).toBe(400);
    expect(await localeOf(org.ownerId)).toBeNull();
  });

  test("the owner stores en, then pl; the same call twice is fine; /api/me and the auth profile follow", async () => {
    const { org, app } = await setup();
    expect((await app.request("/api/me/locale", patch("owner", { locale: "en" }))).status).toBe(204);
    expect(await localeOf(org.ownerId)).toBe("en");
    const me = meSchema.parse(await (await app.request("/api/me", as("owner"))).json());
    expect(me.user.locale).toBe("en");
    expect((await getUserAuthProfile(db, org.ownerId))?.locale).toBe("en");

    expect((await app.request("/api/me/locale", patch("owner", { locale: "pl" }))).status).toBe(204);
    expect(await localeOf(org.ownerId)).toBe("pl");
    expect((await app.request("/api/me/locale", patch("owner", { locale: "pl" }))).status).toBe(204);
    expect(await localeOf(org.ownerId)).toBe("pl");
  });

  test("an assistant sets only its own value", async () => {
    const { org, app } = await setup();
    expect((await app.request("/api/me/locale", patch("assistant", { locale: "en" }))).status).toBe(204);
    expect(await localeOf(org.assistantId)).toBe("en");
    expect(await localeOf(org.ownerId)).toBeNull();
  });

  test("a suspended organization still stores the language, and still refuses other writes", async () => {
    const { org, app } = await setup();
    await db.updateTable("organizations").set({ plan: "suspended" }).where("id", "=", org.orgId).execute();
    expect((await app.request("/api/me/locale", patch("owner", { locale: "en" }))).status).toBe(204);
    expect(await localeOf(org.ownerId)).toBe("en");
    const other = await app.request("/api/me/digest-times", patch("owner", { times: ["08:00"] }));
    expect(other.status).toBe(403);
    expect(await other.json()).toEqual({ error: "org_suspended" });
  });

  test("a fresh user has a null locale in /api/me", async () => {
    const { app } = await setup();
    const me = meSchema.parse(await (await app.request("/api/me", as("owner"))).json());
    expect(me.user.locale).toBeNull();
  });
});
