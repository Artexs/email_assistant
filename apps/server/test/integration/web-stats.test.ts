import { randomUUID } from "node:crypto";

import { statsResponseSchema } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";

import { listUrgentNoticeTimes } from "../../src/modules/channels";
import { statsRoutes, weekStats } from "../../src/modules/reports";
import { configureFeatures, upsertOrgFeature } from "../../src/modules/tenancy";
import { insertMembership, insertUser } from "../../src/modules/tenancy/repo";

import { testDb } from "./helpers";
import { WEEK, seedWeek, type SeededWeek } from "./metrics-fixtures";
import { as, webTestApp } from "./web-helpers";

const db = testDb();
const NOW = new Date("2026-11-24T10:00:00Z");
const deps = { urgentNotices: listUrgentNoticeTimes, testMail: { senders: [] } };

let seeded: SeededWeek;
let assistantId: string;

const flag = (enabled: boolean) =>
  upsertOrgFeature(db, seeded.orgA.ctx, { flag: "stats_page", enabled, setBy: "test", setAt: NOW });

function app() {
  return webTestApp({
    db,
    sessions: { owner: seeded.orgA.ownerId, assistant: assistantId },
    routers: (api) => api.route("/", statsRoutes({ db, now: () => NOW, ...deps })),
  });
}

// Committed rows (the route reads through the pool); the cleanup deletes the organizations and the rows go with them.
beforeEach(async () => {
  seeded = await db.transaction().execute((trx) => seedWeek(trx));
  assistantId = (await insertUser(db, { email: `stats-assistant-${randomUUID()}@x.test`, displayName: "Assistant" }))
    .id;
  await insertMembership(db, seeded.orgA.ctx, { userId: assistantId, role: "assistant" });
});

afterEach(async () => {
  configureFeatures({ off: [] });
  const orgIds = [seeded.orgA.ctx.orgId, seeded.orgB.ctx.orgId];
  const members = await db.selectFrom("memberships").select("user_id").where("org_id", "in", orgIds).execute();
  await db.deleteFrom("organizations").where("id", "in", orgIds).execute();
  await db
    .deleteFrom("users")
    .where(
      "id",
      "in",
      members.map((row) => row.user_id)
    )
    .execute();
});

afterAll(async () => {
  await db.destroy();
});

describe("GET /api/stats", () => {
  test("no session gives 401; the flag off gives 404 for an owner", async () => {
    expect((await app().request("/api/stats")).status).toBe(401);
    const res = await app().request("/api/stats", as("owner"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  test("the flag on: 8 weeks, newest first, the first equals the week service", async () => {
    await flag(true);
    const res = await app().request("/api/stats", as("owner"));
    expect(res.status).toBe(200);
    const { weeks } = statsResponseSchema.parse(await res.json());
    expect(weeks).toHaveLength(8);
    expect(weeks[0]?.weekStart).toBe(WEEK);
    expect(weeks[1]?.weekStart).toBe("2026-11-09");
    const direct = await weekStats(db, seeded.orgA.ctx, { weekStart: WEEK, mailboxId: null, now: NOW }, deps);
    expect(weeks[0]).toEqual(direct as object);
    expect(weeks[0]?.m3.total).toBe(4);
    expect(weeks[0]?.m8).toHaveLength(5);
    expect(weeks.slice(1).every((week) => week.m8.length === 0)).toBe(true);
  });

  test("weeks, mailboxId and the member role", async () => {
    await flag(true);
    const two = statsResponseSchema.parse(await (await app().request("/api/stats?weeks=2", as("owner"))).json());
    expect(two.weeks).toHaveLength(2);

    const bad = await app().request("/api/stats?weeks=13", as("owner"));
    expect(bad.status).toBe(400);
    expect(JSON.stringify(await bad.json())).not.toContain("13");

    const own = await app().request(`/api/stats?weeks=1&mailboxId=${seeded.orgA.mailboxId}`, as("owner"));
    expect(own.status).toBe(200);
    const foreign = await app().request(`/api/stats?mailboxId=${seeded.orgB.mailboxId}`, as("owner"));
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toEqual({ error: "not_found" });

    const assistant = await app().request("/api/stats?weeks=1", as("assistant"));
    expect(assistant.status).toBe(200);
  });
});
