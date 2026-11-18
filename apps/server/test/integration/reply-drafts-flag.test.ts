import { featureKeys, parseToolSwitches, settingsViewSchema } from "@ea/core";
import { afterAll, afterEach, describe, expect, test } from "bun:test";

import { settingsRoutes } from "../../src/modules/config";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { featureStates, setOrgFeature } from "../../src/modules/tenancy";
import { settingsRouteDeps } from "../../src/web";

import { testDb } from "./helpers";
import { NOW } from "./loops-chaser-fixtures";
import { call, FRIDAY, loopApp, loopWorld, type LoopWorld } from "./web-loops-fixtures";

// The flag `reply_drafts` and the tool switch `reply_drafts`.
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
  return { world, app, mailboxId: world.a.mailboxId, ctx: world.a.ctx };
}

describe("the flag reply_drafts", () => {
  test("1. the flag list of an organization holds reply_drafts: off by default, on after a row, last in registry order", async () => {
    const { ctx, world } = await setup();
    const before = await featureStates(db, ctx);
    expect(before.map((state) => state.flag)).toEqual([...featureKeys]);
    expect(before.find((state) => state.flag === "reply_drafts")).toMatchObject({ enabled: false, source: "default" });
    // `/api/me` lists the keys that are on: none of them is `reply_drafts` yet.
    expect(before.filter((state) => state.enabled).map((state) => state.flag)).not.toContain("reply_drafts");

    await setOrgFeature(db, ctx, { flag: "reply_drafts", enabled: true, actor: "cli", now: NOW });
    const after = await featureStates(db, ctx);
    expect(after.find((state) => state.flag === "reply_drafts")).toMatchObject({ enabled: true, source: "row" });
    // Another organization keeps the default.
    const other = await featureStates(db, world.b.ctx);
    expect(other.find((state) => state.flag === "reply_drafts")).toMatchObject({ enabled: false });
  });
});

describe("the switch reply_drafts", () => {
  test("2. a new mailbox has the switch off in the stored settings", async () => {
    const { mailboxId } = await setup();
    const row = await db
      .selectFrom("mailbox_settings")
      .select("tool_switches")
      .where("mailbox_id", "=", mailboxId)
      .executeTakeFirstOrThrow();
    // The stored JSON has no key or a false one: it never reads as on.
    expect((row.tool_switches as Record<string, unknown>).reply_drafts ?? false).toBe(false);
    expect(parseToolSwitches(row.tool_switches).reply_drafts).toBe(false);
  });

  test("the settings list shows the switch (off) only while the flag is on; a member reads it too", async () => {
    const { app, mailboxId, ctx } = await setup();
    const hidden = await call(app, "member", "GET", `/settings/${mailboxId}`);
    expect(hidden.status).toBe(200);
    settingsViewSchema.parse(hidden.body);
    expect(Object.keys((hidden.body as { toolSwitches: object }).toolSwitches)).not.toContain("reply_drafts");

    await setOrgFeature(db, ctx, { flag: "reply_drafts", enabled: true, actor: "cli", now: NOW });
    const shown = await call(app, "member", "GET", `/settings/${mailboxId}`);
    settingsViewSchema.parse(shown.body);
    expect(shown.body).toMatchObject({ toolSwitches: { reply_drafts: false } });
    expect(Object.keys((shown.body as { toolSwitches: object }).toolSwitches)).toContain("reply_drafts");
  });

  test("an organization with the flag off does not see the key, also when the stored value is true", async () => {
    const { app, mailboxId } = await setup();
    await db
      .updateTable("mailbox_settings")
      .set({ tool_switches: JSON.stringify({ move: true, reply_drafts: true }) })
      .where("mailbox_id", "=", mailboxId)
      .execute();
    const get = await call(app, "owner", "GET", `/settings/${mailboxId}`);
    expect(Object.keys((get.body as { toolSwitches: object }).toolSwitches)).not.toContain("reply_drafts");
    expect(get.body).toMatchObject({ toolSwitches: { move: true } });
  });
});
