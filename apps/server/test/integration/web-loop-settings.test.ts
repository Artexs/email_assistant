import { settingsViewSchema, DAY_MS } from "@ea/core";
import { afterAll, afterEach, describe, expect, test } from "bun:test";

import { settingsRoutes } from "../../src/modules/config";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { setOrgFeature } from "../../src/modules/tenancy";
import { settingsRouteDeps } from "../../src/web";

import { testDb } from "./helpers";
import { chase, dueLoop, loopSends, NOW } from "./loops-chaser-fixtures";
import { auditOf } from "./loops-commands-fixtures";
import { call, FRIDAY, loopApp, loopWorld, type LoopWorld } from "./web-loops-fixtures";

// The wait of the open loops and the switch `auto_follow_up` on the settings API.
const db = testDb();
const worlds: LoopWorld[] = [];

afterEach(async () => {
  for (const world of worlds) await world.cleanup();
  worlds.length = 0;
});

afterAll(async () => {
  await db.destroy();
});

async function setup() {
  const world = await loopWorld(db);
  worlds.push(world);
  const app = loopApp(db, world, (api) =>
    api.route("/", settingsRoutes(settingsRouteDeps(db, () => FRIDAY, NO_TEST_SENDERS)))
  );
  const mailboxId = world.a.mailboxId;
  const versionOf = async () =>
    (
      await db
        .selectFrom("mailbox_settings")
        .select("updated_at")
        .where("mailbox_id", "=", mailboxId)
        .executeTakeFirstOrThrow()
    ).updated_at.getTime();
  return { world, app, mailboxId, ctx: world.a.ctx, versionOf };
}

const rawSwitches = async (mailboxId: string) =>
  (
    await db
      .selectFrom("mailbox_settings")
      .select("tool_switches")
      .where("mailbox_id", "=", mailboxId)
      .executeTakeFirstOrThrow()
  ).tool_switches as Record<string, unknown>;

describe("T8 PATCH loop-wait", () => {
  test("5 sets the wait, writes a new version and one settings.changed row; the same value again changes nothing", async () => {
    const { app, mailboxId, ctx, world, versionOf } = await setup();
    const before = await versionOf();
    const res = await call(app, "owner", "PATCH", `/settings/${mailboxId}/loop-wait`, { days: 5 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ changed: true, settings: { loopWaitDays: 5 } });
    settingsViewSchema.parse(res.body.settings);
    expect(await versionOf()).toBeGreaterThan(before);
    const rows = await auditOf(db, ctx.orgId, "settings.changed");
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({
      actor: world.a.userId,
      data: { mailbox_id: mailboxId, field: "loop_wait_days", from: 3, to: 5, via: "web" },
    });
    const version = await versionOf();
    const same = await call(app, "owner", "PATCH", `/settings/${mailboxId}/loop-wait`, { days: 5 });
    expect(same.body).toMatchObject({ changed: false, settings: { loopWaitDays: 5 } });
    expect(await versionOf()).toBe(version);
    expect((await auditOf(db, ctx.orgId, "settings.changed")).length).toBe(1);
    // The GET shows the wait too.
    const get = await call(app, "member", "GET", `/settings/${mailboxId}`);
    expect(get.body).toMatchObject({ loopWaitDays: 5 });
  });

  test("the edges 1 and 10 are valid; 0, 11, 2.5, a string, a missing field and an extra field are 400 and change nothing", async () => {
    const { app, mailboxId, ctx } = await setup();
    for (const days of [1, 10]) {
      const res = await call(app, "owner", "PATCH", `/settings/${mailboxId}/loop-wait`, { days });
      expect([days, res.status]).toEqual([days, 200]);
    }
    const stored = async () =>
      (
        await db
          .selectFrom("mailbox_settings")
          .select("loop_wait_days")
          .where("mailbox_id", "=", mailboxId)
          .executeTakeFirstOrThrow()
      ).loop_wait_days;
    expect(await stored()).toBe(10);
    for (const body of [{ days: 0 }, { days: 11 }, { days: 2.5 }, { days: "5" }, {}, { days: 4, extra: 1 }]) {
      const res = await call(app, "owner", "PATCH", `/settings/${mailboxId}/loop-wait`, body);
      expect([JSON.stringify(body), res.status, res.body.error]).toEqual([JSON.stringify(body), 400, "validation"]);
    }
    expect(await stored()).toBe(10);
    expect((await auditOf(db, ctx.orgId, "settings.changed")).length).toBe(2);
  });

  test("it changes the due date of loops opened later only: an open loop keeps its due date", async () => {
    const { app, mailboxId, world } = await setup();
    const loop = await db.transaction().execute((trx) => dueLoop(trx, world.a));
    const dueOf = async () =>
      (
        await db.selectFrom("open_loops").select("due_at").where("id", "=", loop.id).executeTakeFirstOrThrow()
      ).due_at.toISOString();
    const before = await dueOf();
    await call(app, "owner", "PATCH", `/settings/${mailboxId}/loop-wait`, { days: 7 });
    expect(await dueOf()).toBe(before);
  });

  test("the flag off: 404 for the owner, the view still shows the number", async () => {
    const { app, mailboxId, ctx } = await setup();
    await setOrgFeature(db, ctx, { flag: "open_loops", enabled: false, actor: "cli", now: FRIDAY });
    const res = await call(app, "owner", "PATCH", `/settings/${mailboxId}/loop-wait`, { days: 5 });
    expect([res.status, res.body]).toEqual([404, { error: "not_found" }]);
    expect((await call(app, "owner", "GET", `/settings/${mailboxId}`)).body).toMatchObject({ loopWaitDays: 3 });
  });
});

describe("T10 who may change it", () => {
  test("a member gets 403 owner_only, also with the flag off; another organization's owner gets 404; no session 401", async () => {
    const { app, mailboxId, ctx, versionOf } = await setup();
    const version = await versionOf();
    for (const path of ["loop-wait", "switches/auto_follow_up"]) {
      const body = path === "loop-wait" ? { days: 5 } : { value: true };
      const res = await call(app, "member", "PATCH", `/settings/${mailboxId}/${path}`, body);
      expect([path, res.status, res.body]).toEqual([path, 403, { error: "owner_only" }]);
      const foreign = await call(app, "other", "PATCH", `/settings/${mailboxId}/${path}`, body);
      expect([path, foreign.status]).toEqual([path, 404]);
    }
    await setOrgFeature(db, ctx, { flag: "open_loops", enabled: false, actor: "cli", now: FRIDAY });
    expect((await call(app, "member", "PATCH", `/settings/${mailboxId}/loop-wait`, { days: 5 })).status).toBe(403);
    expect((await call(app, "owner", "PATCH", "/settings/not-an-id/loop-wait", { days: 5 })).status).toBe(404);
    expect(await versionOf()).toBe(version);
    expect((await auditOf(db, ctx.orgId, "settings.changed")).length).toBe(0);
    const noCookie = { origin: "http://127.0.0.1:8080", "content-type": "application/json" };
    const anon = await app.request(`/api/settings/${mailboxId}/loop-wait`, {
      method: "PATCH",
      headers: noCookie,
      body: JSON.stringify({ days: 5 }),
    });
    expect(anon.status).toBe(401);
  });
});

describe("T9 the switch auto_follow_up", () => {
  test("it is off by default and the chaser plans nothing; on, the chaser plans a waiting follow-up", async () => {
    const { app, mailboxId, world } = await setup();
    const loop = await db.transaction().execute((trx) => dueLoop(trx, world.a));
    const get = await call(app, "owner", "GET", `/settings/${mailboxId}`);
    expect(get.body).toMatchObject({ toolSwitches: { auto_follow_up: false } });
    await chase(db, { ctx: world.a.ctx, mailboxId }, NOW, { force: true });
    expect(await loopSends(db, world.a.ctx.orgId)).toEqual([]);

    const on = await call(app, "owner", "PATCH", `/settings/${mailboxId}/switches/auto_follow_up`, { value: true });
    expect(on.body).toMatchObject({ changed: true, settings: { toolSwitches: { auto_follow_up: true } } });
    expect((await rawSwitches(mailboxId)).auto_follow_up).toBe(true);
    await chase(db, { ctx: world.a.ctx, mailboxId }, new Date(NOW.getTime() + DAY_MS), { force: true });
    const sends = await loopSends(db, world.a.ctx.orgId);
    expect(sends.map((send) => [send.loop_id, send.status])).toEqual([[loop.id, "awaiting_approval"]]);
  });

  test("a mode change keeps the stored switch (the schema does not drop the key)", async () => {
    const { app, mailboxId } = await setup();
    await call(app, "owner", "PATCH", `/settings/${mailboxId}/switches/auto_follow_up`, { value: true });
    const mode = await call(app, "owner", "PATCH", `/settings/${mailboxId}/mode`, {
      mode: "shadow",
      keepSwitches: true,
    });
    expect(mode.status).toBe(200);
    await call(app, "owner", "PATCH", `/settings/${mailboxId}/switches/move`, { value: true });
    expect((await rawSwitches(mailboxId)).auto_follow_up).toBe(true);
  });

  test("it is in the switch list only while open_loops is on; with the flag off the route is a 404", async () => {
    const { app, mailboxId, ctx } = await setup();
    await setOrgFeature(db, ctx, { flag: "open_loops", enabled: false, actor: "cli", now: FRIDAY });
    const view = (await call(app, "owner", "GET", `/settings/${mailboxId}`)).body.toolSwitches as Record<
      string,
      unknown
    >;
    expect(Object.keys(view).sort()).toEqual(["create_draft", "flag", "mark_read", "move", "move_unsure"]);
    const res = await call(app, "owner", "PATCH", `/settings/${mailboxId}/switches/auto_follow_up`, { value: true });
    expect([res.status, res.body]).toEqual([404, { error: "not_found" }]);
    expect(Object.keys(await rawSwitches(mailboxId))).not.toContain("auto_follow_up");
  });
});

describe("sentTracking in the view", () => {
  test("on while the flag and the switch are on; off after the switch goes off; flag_off while the flag sent_sync is off", async () => {
    const { app, mailboxId, ctx } = await setup();
    const state = async () => (await call(app, "member", "GET", `/settings/${mailboxId}`)).body.sentTracking;
    expect(await state()).toBe("on");
    await call(app, "owner", "PATCH", `/settings/${mailboxId}/sent-sync`, { enabled: false });
    expect(await state()).toBe("off");
    await call(app, "owner", "PATCH", `/settings/${mailboxId}/sent-sync`, { enabled: true });
    expect(await state()).toBe("on");
    await setOrgFeature(db, ctx, { flag: "sent_sync", enabled: false, actor: "cli", now: FRIDAY });
    expect(await state()).toBe("flag_off");
  });
});
