import { randomUUID } from "node:crypto";

import { organizationSettingsSchema, organizationViewSchema } from "@ea/core";
import { afterAll, afterEach, describe, expect, test } from "bun:test";

import { tenancyRoutes } from "../../src/modules/tenancy";
import { insertUser } from "../../src/modules/tenancy/repo";
import { countMailboxes, onboardingDeps } from "../../src/web";

import { testDb } from "./helpers";
import { as, noBackupCodes, TEST_ORIGIN, webOrg, webTestApp, type WebOrg } from "./web-helpers";

const db = testDb();
const off = { kind: "off", reason: "env_off" } as const;

const orgs: WebOrg[] = [];
const userIds: string[] = [];

afterEach(async () => {
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
  const { id: nobodyId } = await insertUser(db, { email: `web-org-n-${randomUUID()}@x.test`, displayName: "Nobody" });
  userIds.push(nobodyId);
  const app = webTestApp({
    db,
    sessions: {
      owner: org.ownerId,
      assistant: org.assistantId,
      other: org.otherOwnerId,
      nobody: nobodyId,
    },
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
          backupCodesLeft: noBackupCodes,
          ...onboardingDeps(db, async () => "fake_ea_bot"),
        })
      ),
  });
  return { org, app };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function json(res: Response): Promise<Record<string, any>> {
  return res.json();
}

describe("route matrix", () => {
  test("no session → 401 on the three routes", async () => {
    const { app } = await setup();
    const noCookie = { origin: TEST_ORIGIN, "content-type": "application/json" };
    expect((await app.request("/api/organization")).status).toBe(401);
    expect((await app.request("/api/organization", { method: "PATCH", headers: noCookie, body: "{}" })).status).toBe(
      401
    );
    expect(
      (await app.request("/api/me/digest-times", { method: "PATCH", headers: noCookie, body: '{"times":[]}' })).status
    ).toBe(401);
  });

  test("a user without a membership → 403 on the three routes", async () => {
    const { app } = await setup();
    const get = await app.request("/api/organization", as("nobody"));
    expect(get.status).toBe(403);
    const patch = await app.request(
      "/api/organization",
      as("nobody", { method: "PATCH", body: { timezone: "Europe/London" } })
    );
    expect(patch.status).toBe(403);
    const times = await app.request(
      "/api/me/digest-times",
      as("nobody", { method: "PATCH", body: { times: ["08:00"] } })
    );
    expect(times.status).toBe(403);
  });

  test("an assistant: 403 on the owner route, 200 on the member routes", async () => {
    const { app } = await setup();
    const patch = await app.request(
      "/api/organization",
      as("assistant", { method: "PATCH", body: { timezone: "Europe/London" } })
    );
    expect(patch.status).toBe(403);
    expect(await json(patch)).toEqual({ error: "owner_only" });
    expect((await app.request("/api/organization", as("assistant"))).status).toBe(200);
    const times = await app.request(
      "/api/me/digest-times",
      as("assistant", { method: "PATCH", body: { times: ["09:00"] } })
    );
    expect(times.status).toBe(200);
  });

  test("bad bodies → 400 with details; no Origin → 403", async () => {
    const { app } = await setup();
    const empty = await app.request("/api/organization", as("owner", { method: "PATCH", body: {} }));
    expect(empty.status).toBe(400);
    const emptyBody = await json(empty);
    expect(emptyBody.error).toBe("validation");
    expect(emptyBody.details[0].message).toBe("empty_patch");
    const wrongType = await app.request("/api/organization", as("owner", { method: "PATCH", body: { styleText: 5 } }));
    expect(wrongType.status).toBe(400);
    const noOrigin = await app.request("/api/organization", {
      method: "PATCH",
      headers: { cookie: "ea.session_token=owner", "content-type": "application/json" },
      body: JSON.stringify({ timezone: "Europe/London" }),
    });
    expect(noOrigin.status).toBe(403);
    expect(await json(noOrigin)).toEqual({ error: "bad_origin" });
    const badTimes = await app.request(
      "/api/me/digest-times",
      as("owner", { method: "PATCH", body: { times: ["8:00"] } })
    );
    expect(badTimes.status).toBe(400);
    expect((await json(badTimes)).details[0].message).toBe("time_invalid");
  });
});

describe("GET /api/organization", () => {
  test("returns the settings with the server's zone list", async () => {
    const { app } = await setup();
    const res = await app.request("/api/organization", as("owner"));
    expect(res.status).toBe(200);
    const body = organizationSettingsSchema.parse(await json(res));
    expect(body.timezone).toBe("Europe/Warsaw");
    expect(body.timezones).toContain("Europe/Warsaw");
    expect(body.timezones).toContain("Europe/London");
    expect(body.retentionDays).toBe(30);
    expect(body.styleText).toBeNull();
  });
});

describe("PATCH /api/organization", () => {
  test("changes the timezone; a bad zone → 400 timezone_invalid", async () => {
    const { app } = await setup();
    const ok = await app.request(
      "/api/organization",
      as("owner", { method: "PATCH", body: { timezone: "Europe/London" } })
    );
    expect(ok.status).toBe(200);
    expect(organizationViewSchema.parse(await json(ok)).timezone).toBe("Europe/London");
    const me = await json(await app.request("/api/me", as("owner")));
    expect(me.organization.timezone).toBe("Europe/London");

    const bad = await app.request(
      "/api/organization",
      as("owner", { method: "PATCH", body: { timezone: "Mars/Base" } })
    );
    expect(bad.status).toBe(400);
    const body = await json(bad);
    expect(body.error).toBe("validation");
    expect(body.details[0]).toMatchObject({ path: "timezone", message: "timezone_invalid" });
  });

  test("changes, clears and limits the signature", async () => {
    const { app } = await setup();
    const set = await app.request(
      "/api/organization",
      as("owner", { method: "PATCH", body: { styleText: "  Anna\r\nCEO  " } })
    );
    expect(set.status).toBe(200);
    expect((await json(set)).styleText).toBe("Anna\nCEO");
    const cleared = await app.request("/api/organization", as("owner", { method: "PATCH", body: { styleText: "" } }));
    expect(cleared.status).toBe(200);
    expect((await json(cleared)).styleText).toBeNull();
    const long = await app.request(
      "/api/organization",
      as("owner", { method: "PATCH", body: { styleText: "a".repeat(501) } })
    );
    expect(long.status).toBe(400);
    expect((await json(long)).details[0].message).toBe("style_too_long");
  });

  test("tenant: another organization's owner changes only their own organization", async () => {
    const { app } = await setup();
    const res = await app.request(
      "/api/organization",
      as("other", { method: "PATCH", body: { timezone: "Asia/Tokyo" } })
    );
    expect(res.status).toBe(200);
    expect((await json(res)).timezone).toBe("Asia/Tokyo");
    const first = await json(await app.request("/api/organization", as("owner")));
    expect(first.timezone).toBe("Europe/Warsaw");
  });
});

describe("PATCH /api/me/digest-times", () => {
  test("sorts the times and changes only the session user's row", async () => {
    const { app } = await setup();
    const ownerBefore = (await json(await app.request("/api/me", as("owner")))).digestTimes;
    const res = await app.request(
      "/api/me/digest-times",
      as("assistant", { method: "PATCH", body: { times: ["13:00", "08:00"] } })
    );
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ times: ["08:00", "13:00"] });
    expect((await json(await app.request("/api/me", as("assistant")))).digestTimes).toEqual(["08:00", "13:00"]);
    const ownerTimes = (await json(await app.request("/api/me", as("owner")))).digestTimes;
    expect(ownerTimes).toEqual(ownerBefore);

    const none = await app.request("/api/me/digest-times", as("assistant", { method: "PATCH", body: { times: [] } }));
    expect(await json(none)).toEqual({ times: [] });
  });

  test("duplicates and seven times → 400", async () => {
    const { app } = await setup();
    const dup = await app.request(
      "/api/me/digest-times",
      as("owner", { method: "PATCH", body: { times: ["08:00", "08:00"] } })
    );
    expect(dup.status).toBe(400);
    expect((await json(dup)).details[0].message).toBe("times_duplicate");
    const seven = await app.request(
      "/api/me/digest-times",
      as("owner", {
        method: "PATCH",
        body: { times: ["01:00", "02:00", "03:00", "04:00", "05:00", "06:00", "07:00"] },
      })
    );
    expect(seven.status).toBe(400);
  });
});
