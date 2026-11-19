import { randomUUID } from "node:crypto";

import { noticeRoutesSchema, notifyViewSchema } from "@ea/core";
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import type { Hono } from "hono";

import { auditEvents } from "../../src/modules/audit";
import { channelRoutes } from "../../src/modules/channels";
import { upsertPushSubscription } from "../../src/modules/channels/push";
import { insertMailbox, setMailboxStatus } from "../../src/modules/mail/repo";
import { upsertOrgFeature } from "../../src/modules/tenancy";
import type { Db } from "../../src/platform/db";
import type { ApiEnv } from "../../src/platform/http";

import { randomChatId, testCapabilities } from "./fixtures";
import { testDb } from "./helpers";
import { as, webOrg, webTestApp, type WebOrg } from "./web-helpers";
import { box, newSession } from "./web-push-kit";

// GET/PATCH /api/me/notify (tests 7, 8 and 9 of the stage).
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

async function setup(
  flags: { quiet?: boolean; mail?: boolean; push?: boolean } = { quiet: true, mail: true },
  routeDb: Db = db
) {
  const org = await webOrg(db);
  orgs.push(org);
  const ctx = { orgId: org.orgId };
  for (const [flag, enabled] of [
    ["user_quiet_hours", flags.quiet ?? false],
    ["report_mail", flags.mail ?? false],
    ["web_push", flags.push ?? false],
  ] as const) {
    if (enabled) await upsertOrgFeature(db, ctx, { flag, enabled, setBy: org.ownerId, setAt: NOW });
  }
  const app = webTestApp({
    db,
    sessions: { owner: org.ownerId, assistant: org.assistantId, "other-owner": org.otherOwnerId },
    routers: (api: Hono<ApiEnv>) =>
      api.route("/", channelRoutes({ db: routeDb, now: () => NOW, botUsername: async () => "fake_ea_bot" })),
  });
  return { org, ctx, app };
}

async function addMailbox(orgId: string, opts: { createdAt: Date; status?: "paused" }): Promise<string> {
  const id = randomUUID();
  const ctx = { orgId };
  await insertMailbox(db, ctx, {
    id,
    address: `notify-${id}@x.test`,
    imapHost: "imap.x.test",
    imapPort: 993,
    smtpHost: "smtp.x.test",
    smtpPort: 465,
    capabilities: testCapabilities,
    folderMap: {},
  });
  await db.updateTable("mailboxes").set({ created_at: opts.createdAt }).where("id", "=", id).execute();
  if (opts.status) await setMailboxStatus(db, ctx, id, opts.status);
  return id;
}

const rowOf = (orgId: string, userId: string) =>
  db
    .selectFrom("memberships")
    .select(["quiet_start", "quiet_end", "report_channel", "report_mailbox_id"])
    .where("org_id", "=", orgId)
    .where("user_id", "=", userId)
    .executeTakeFirstOrThrow();

const auditOf = (orgId: string) =>
  db
    .selectFrom("audit_log")
    .select(["actor", "data"])
    .where("org_id", "=", orgId)
    .where("event", "=", auditEvents.memberNotifyChanged)
    .orderBy("created_at")
    .execute();

const patch = (cookie: string, body: unknown) => as(cookie, { method: "PATCH", body });
const DEFAULT_ROW = { quiet_start: null, quiet_end: null, report_channel: "telegram", report_mailbox_id: null };

describe("GET /api/me/notify", () => {
  test("a member reads the own row and the active mailboxes, oldest first; no cookie is 401", async () => {
    const { org, app } = await setup();
    const older = await addMailbox(org.orgId, { createdAt: new Date("2026-11-01T00:00:00Z") });
    const newer = await addMailbox(org.orgId, { createdAt: new Date("2026-11-02T00:00:00Z") });
    await addMailbox(org.orgId, { createdAt: new Date("2026-11-03T00:00:00Z"), status: "paused" });
    const res = await app.request("/api/me/notify", as("assistant"));
    expect(res.status).toBe(200);
    const view = notifyViewSchema.parse(await res.json());
    expect(view).toMatchObject({ quietStart: null, quietEnd: null, reportChannel: "telegram", reportMailboxId: null });
    expect(view.telegramLinked).toBe(false);
    expect(view.mailboxes.map((mailbox) => mailbox.id)).toEqual([older, newer]);
    const bare = await app.request("/api/me/notify", { headers: { origin: "http://127.0.0.1:8080" } });
    expect(bare.status).toBe(401);
  });
});

describe("PATCH /api/me/notify: quiet hours", () => {
  test("7. 23:00 and 06:00 are stored and audited by key name; 25:00 is 400; one of the two is 400", async () => {
    const { org, app } = await setup();
    const ok = await app.request("/api/me/notify", patch("owner", { quietStart: "23:00", quietEnd: "06:00" }));
    expect(ok.status).toBe(200);
    expect(notifyViewSchema.parse(await ok.json())).toMatchObject({ quietStart: "23:00", quietEnd: "06:00" });
    expect(await rowOf(org.orgId, org.ownerId)).toMatchObject({ quiet_start: "23:00", quiet_end: "06:00" });
    expect(await auditOf(org.orgId)).toEqual([
      { actor: org.ownerId, data: { via: "web", keys: "quiet_start,quiet_end" } },
    ]);

    for (const body of [
      { quietStart: "25:00", quietEnd: "06:00" },
      { quietStart: "23:00", quietEnd: "6:00" },
      { quietStart: "22:00" },
      { quietEnd: "07:00" },
      { quietStart: "22:00", quietEnd: null },
      { quietStart: "22:00", quietEnd: "07:00", reportChannel: "mail" },
      {},
    ]) {
      expect((await app.request("/api/me/notify", patch("owner", body))).status).toBe(400);
    }
    expect(await rowOf(org.orgId, org.ownerId)).toMatchObject({ quiet_start: "23:00", quiet_end: "06:00" });
  });

  test("both null resets to the default; the same value twice writes no second audit row", async () => {
    const { org, app } = await setup();
    const same = patch("owner", { quietStart: "21:00", quietEnd: "08:00" });
    await app.request("/api/me/notify", same);
    await app.request("/api/me/notify", same);
    expect(await auditOf(org.orgId)).toHaveLength(1);
    expect((await app.request("/api/me/notify", patch("owner", { quietStart: null, quietEnd: null }))).status).toBe(
      200
    );
    expect(await rowOf(org.orgId, org.ownerId)).toMatchObject({ quiet_start: null, quiet_end: null });
    expect(await auditOf(org.orgId)).toHaveLength(2);
  });

  test("with the flag off a write is 404 and stores nothing", async () => {
    const { org, app } = await setup({ mail: true });
    const res = await app.request("/api/me/notify", patch("owner", { quietStart: "23:00", quietEnd: "06:00" }));
    expect(res.status).toBe(404);
    expect(await rowOf(org.orgId, org.ownerId)).toEqual(DEFAULT_ROW);
  });
});

describe("PATCH /api/me/notify: report channel", () => {
  test("8. mail with no active mailbox is 409 no_mailbox; a paused mailbox does not count", async () => {
    const { org, app } = await setup();
    const none = await app.request("/api/me/notify", patch("owner", { reportChannel: "mail" }));
    expect(none.status).toBe(409);
    expect(await none.json()).toEqual({ error: "no_mailbox" });
    await addMailbox(org.orgId, { createdAt: new Date("2026-11-01T00:00:00Z"), status: "paused" });
    expect((await app.request("/api/me/notify", patch("owner", { reportChannel: "both" }))).status).toBe(409);
    expect(await rowOf(org.orgId, org.ownerId)).toEqual(DEFAULT_ROW);
    expect(await auditOf(org.orgId)).toEqual([]);
  });

  test("8. mail with an active mailbox stores the oldest active one, or the one asked for", async () => {
    const { org, app } = await setup();
    const oldest = await addMailbox(org.orgId, { createdAt: new Date("2026-11-01T00:00:00Z") });
    const newer = await addMailbox(org.orgId, { createdAt: new Date("2026-11-02T00:00:00Z") });
    const mail = await app.request("/api/me/notify", patch("owner", { reportChannel: "mail" }));
    expect(mail.status).toBe(200);
    expect(notifyViewSchema.parse(await mail.json())).toMatchObject({ reportChannel: "mail", reportMailboxId: oldest });
    expect(await rowOf(org.orgId, org.ownerId)).toMatchObject({ report_channel: "mail", report_mailbox_id: oldest });

    await app.request("/api/me/notify", patch("owner", { reportChannel: "both", reportMailboxId: newer }));
    expect(await rowOf(org.orgId, org.ownerId)).toMatchObject({ report_channel: "both", report_mailbox_id: newer });
    expect((await auditOf(org.orgId)).map((row) => row.data)).toEqual([
      { via: "web", keys: "report_channel,report_mailbox_id" },
      { via: "web", keys: "report_channel,report_mailbox_id" },
    ]);
    // No address and no mailbox id in the audit row: key names only.
    expect(JSON.stringify(await auditOf(org.orgId))).not.toContain("@");
    expect(JSON.stringify(await auditOf(org.orgId))).not.toContain(newer);

    // telegram, or null, clears the mailbox.
    await app.request("/api/me/notify", patch("owner", { reportChannel: null }));
    expect(await rowOf(org.orgId, org.ownerId)).toMatchObject({ report_channel: "telegram", report_mailbox_id: null });
  });

  test("a mailbox of another organization, a paused mailbox and a bad id are refused; telegram needs no mailbox", async () => {
    const { org, app } = await setup();
    await addMailbox(org.orgId, { createdAt: new Date("2026-11-01T00:00:00Z") });
    const foreign = await addMailbox(org.otherOrgId, { createdAt: new Date("2026-11-01T00:00:00Z") });
    const paused = await addMailbox(org.orgId, { createdAt: new Date("2026-11-02T00:00:00Z"), status: "paused" });
    for (const reportMailboxId of [foreign, paused]) {
      const res = await app.request("/api/me/notify", patch("owner", { reportChannel: "mail", reportMailboxId }));
      expect(res.status).toBe(409);
    }
    expect(
      (await app.request("/api/me/notify", patch("owner", { reportChannel: "mail", reportMailboxId: "x" }))).status
    ).toBe(400);
    expect((await app.request("/api/me/notify", patch("owner", { reportChannel: "telegram" }))).status).toBe(200);
    expect(await rowOf(org.orgId, org.ownerId)).toEqual(DEFAULT_ROW);
  });

  test("with the flag report_mail off a write is 404", async () => {
    const { org, app } = await setup({ quiet: true });
    await addMailbox(org.orgId, { createdAt: new Date("2026-11-01T00:00:00Z") });
    expect((await app.request("/api/me/notify", patch("owner", { reportChannel: "mail" }))).status).toBe(404);
    expect(await rowOf(org.orgId, org.ownerId)).toEqual(DEFAULT_ROW);
  });
});

describe("PATCH /api/me/notify: whose row", () => {
  test("9. the caller's row only changes; the other members and the other organization keep their rows", async () => {
    const { org, app } = await setup();
    await addMailbox(org.orgId, { createdAt: new Date("2026-11-01T00:00:00Z") });
    await app.request("/api/me/notify", patch("assistant", { quietStart: "20:00", quietEnd: "05:00" }));
    await app.request("/api/me/notify", patch("assistant", { reportChannel: "both" }));
    expect(await rowOf(org.orgId, org.assistantId)).toMatchObject({
      quiet_start: "20:00",
      quiet_end: "05:00",
      report_channel: "both",
    });
    expect(await rowOf(org.orgId, org.ownerId)).toEqual(DEFAULT_ROW);
    expect(await rowOf(org.otherOrgId, org.otherOwnerId)).toEqual(DEFAULT_ROW);
    // A user id in the body is no key of the schema: 400, nothing changes.
    const named = await app.request(
      "/api/me/notify",
      patch("assistant", { quietStart: "01:00", quietEnd: "02:00", userId: org.ownerId })
    );
    expect(named.status).toBe(400);
    expect(await rowOf(org.orgId, org.ownerId)).toEqual(DEFAULT_ROW);
    expect((await auditOf(org.orgId)).every((row) => row.actor === org.assistantId)).toBe(true);
  });
});

// A Db whose transactions run `hook` just before the UPDATE of a memberships row executes: the point after the read and the
// check of the mailbox, where a race can strike.
function hookedDb(hook: () => Promise<void>): Db {
  type Builder = Record<string, unknown>;
  const wrap = (builder: Builder): Builder =>
    new Proxy(builder, {
      get(target, property) {
        const value = Reflect.get(target, property) as unknown;
        if (property === "executeTakeFirst") {
          return async (...args: unknown[]) => {
            await hook();
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          const result = (value as (...a: unknown[]) => unknown).apply(target, args);
          return typeof result === "object" && result !== null && "execute" in result
            ? wrap(result as Builder)
            : result;
        };
      },
    });
  const wrapTrx = (trx: object) =>
    new Proxy(trx, {
      get(target, property) {
        const value = Reflect.get(target, property) as unknown;
        if (property === "updateTable") {
          return (table: string) => {
            const builder = (target as { updateTable(t: string): Builder }).updateTable(table);
            return table === "memberships" ? wrap(builder) : builder;
          };
        }
        return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    });
  return new Proxy(db, {
    get(target, property) {
      if (property === "transaction") {
        return () => ({
          execute: (fn: (trx: object) => Promise<unknown>) => target.transaction().execute((trx) => fn(wrapTrx(trx))),
        });
      }
      const value = Reflect.get(target, property) as unknown;
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  }) as unknown as Db;
}

describe("PATCH /api/me/notify: review fixes", () => {
  test("GET: telegramLinked is true with a linked chat, false without", async () => {
    const { org, ctx, app } = await setup();
    const read = async () => notifyViewSchema.parse(await (await app.request("/api/me/notify", as("owner"))).json());
    expect((await read()).telegramLinked).toBe(false);
    await db
      .insertInto("chat_links")
      .values({
        org_id: ctx.orgId,
        user_id: org.ownerId,
        channel: "telegram",
        external_chat_id: randomChatId(),
        linked_at: NOW,
      })
      .execute();
    expect((await read()).telegramLinked).toBe(true);
    // The chat of the owner is not the chat of the assistant.
    const other = notifyViewSchema.parse(await (await app.request("/api/me/notify", as("assistant"))).json());
    expect(other.telegramLinked).toBe(false);
  });

  test("telegram with a mailbox id in the body clears the stored mailbox", async () => {
    const { org, app } = await setup();
    const mailboxId = await addMailbox(org.orgId, { createdAt: new Date("2026-11-01T00:00:00Z") });
    await app.request("/api/me/notify", patch("owner", { reportChannel: "mail", reportMailboxId: mailboxId }));
    expect(await rowOf(org.orgId, org.ownerId)).toMatchObject({ report_channel: "mail", report_mailbox_id: mailboxId });
    const res = await app.request(
      "/api/me/notify",
      patch("owner", { reportChannel: "telegram", reportMailboxId: mailboxId })
    );
    expect(res.status).toBe(200);
    expect(notifyViewSchema.parse(await res.json())).toMatchObject({
      reportChannel: "telegram",
      reportMailboxId: null,
    });
    expect(await rowOf(org.orgId, org.ownerId)).toEqual(DEFAULT_ROW);
  });

  test("the quiet window is at most 18 hours: 06:00–00:00 is stored, 05:00–00:00 and 22:00–17:30 are 400", async () => {
    const { org, app } = await setup();
    const ok = await app.request("/api/me/notify", patch("owner", { quietStart: "06:00", quietEnd: "00:00" }));
    expect(ok.status).toBe(200);
    for (const [quietStart, quietEnd] of [
      ["05:00", "00:00"],
      ["22:00", "17:30"],
      ["00:00", "23:59"],
    ]) {
      const res = await app.request("/api/me/notify", patch("owner", { quietStart, quietEnd }));
      expect(res.status).toBe(400);
      expect(JSON.stringify(await res.json())).toContain("quiet_too_long");
    }
    expect(await rowOf(org.orgId, org.ownerId)).toMatchObject({ quiet_start: "06:00", quiet_end: "00:00" });
  });

  test("a mailbox deleted between the check and the write is 409 no_mailbox, not 500; nothing is stored", async () => {
    let victim = "";
    const hooked = hookedDb(async () => {
      // The mailbox goes away on another connection, after the route found it active.
      await db.deleteFrom("mailboxes").where("id", "=", victim).execute();
    });
    const { org, app } = await setup({ quiet: true, mail: true }, hooked);
    victim = await addMailbox(org.orgId, { createdAt: new Date("2026-11-01T00:00:00Z") });
    const res = await app.request("/api/me/notify", patch("owner", { reportChannel: "mail" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "no_mailbox" });
    expect(await rowOf(org.orgId, org.ownerId)).toEqual(DEFAULT_ROW);
    expect(await auditOf(org.orgId)).toEqual([]);
  });

  test("two changes at once: the second reads the row after the first, so its audit row names only the key that it changed", async () => {
    let release: () => void = () => undefined;
    let enter: () => void = () => undefined;
    const entered = new Promise<void>((resolve) => (enter = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    let held = false;
    // The first change stops just before its UPDATE; the second starts then and either waits for the row lock or races past.
    const slow = hookedDb(async () => {
      if (held) return;
      held = true;
      enter();
      await gate;
    });
    const { org, app } = await setup({ quiet: true, mail: true }, slow);
    const second = webTestApp({
      db,
      sessions: { owner: org.ownerId },
      routers: (api: Hono<ApiEnv>) =>
        api.route("/", channelRoutes({ db, now: () => NOW, botUsername: async () => "fake_ea_bot" })),
    });
    const mailboxId = await addMailbox(org.orgId, { createdAt: new Date("2026-11-01T00:00:00Z") });
    const firstDone = app.request(
      "/api/me/notify",
      patch("owner", { reportChannel: "mail", reportMailboxId: mailboxId })
    );
    await entered;
    const secondDone = second.request(
      "/api/me/notify",
      patch("owner", { reportChannel: "both", reportMailboxId: mailboxId })
    );
    // Time for the second request to run to its end when nothing holds it back (it takes a few milliseconds); then the first goes on.
    await new Promise((resolve) => setTimeout(resolve, 80));
    release();
    expect((await firstDone).status).toBe(200);
    expect((await secondDone).status).toBe(200);
    const keys = (await auditOf(org.orgId)).map((row) => (row.data as { keys: string }).keys).sort();
    expect(keys).toEqual(["report_channel", "report_channel,report_mailbox_id"]);
    expect(await rowOf(org.orgId, org.ownerId)).toMatchObject({ report_channel: "both", report_mailbox_id: mailboxId });
  });
});

// The routes of a member per notice group (the flag `web_push`).
describe("notice routes", () => {
  const routesOf = async (orgId: string, userId: string) =>
    noticeRoutesSchema.parse(
      (
        await db
          .selectFrom("memberships")
          .select("notice_routes")
          .where("org_id", "=", orgId)
          .where("user_id", "=", userId)
          .executeTakeFirstOrThrow()
      ).notice_routes
    );
  const read = async (app: Hono<ApiEnv>, cookie: string) =>
    notifyViewSchema.parse(await (await app.request("/api/me/notify", as(cookie))).json());
  const patchRoutes = (app: Hono<ApiEnv>, cookie: string, routes: unknown) =>
    app.request("/api/me/notify", patch(cookie, { routes }));
  const routeAudit = async (orgId: string) => (await auditOf(orgId)).map((row) => row.data);

  async function linkChat(orgId: string, userId: string) {
    await db
      .insertInto("chat_links")
      .values({
        org_id: orgId,
        user_id: userId,
        channel: "telegram",
        external_chat_id: randomChatId(),
        linked_at: NOW,
      })
      .execute();
  }

  async function addDevice(orgId: string, userId: string, sessionExpiresAt?: Date) {
    const sessionId = await newSession(db, userId, sessionExpiresAt);
    await db.transaction().execute((trx) =>
      upsertPushSubscription(
        trx,
        { orgId },
        {
          userId,
          sessionId,
          endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
          p256dh: "B".repeat(87),
          auth: "a".repeat(22),
          deviceLabel: "Chrome on Android",
          box,
          now: NOW,
        }
      )
    );
  }

  test("1. one group is stored, the other keys stay; null removes a key; the view and the audit row follow", async () => {
    const { org, app } = await setup({ push: true });
    const res = await patchRoutes(app, "owner", { urgent: "push" });
    expect(res.status).toBe(200);
    expect(notifyViewSchema.parse(await res.json()).routes).toEqual({ urgent: "push" });
    expect(await routesOf(org.orgId, org.ownerId)).toEqual({ urgent: "push" });

    await patchRoutes(app, "owner", { approvals: "both" });
    expect(await routesOf(org.orgId, org.ownerId)).toEqual({ urgent: "push", approvals: "both" });
    await patchRoutes(app, "owner", { urgent: "telegram", updates: "push" });
    expect(await routesOf(org.orgId, org.ownerId)).toEqual({ urgent: "telegram", approvals: "both", updates: "push" });
    const removed = await patchRoutes(app, "owner", { approvals: null });
    expect(notifyViewSchema.parse(await removed.json()).routes).toEqual({ urgent: "telegram", updates: "push" });
    expect(await routesOf(org.orgId, org.ownerId)).toEqual({ urgent: "telegram", updates: "push" });

    // One audit row per real change, with the key name and no value; the same value again writes none.
    expect(await routeAudit(org.orgId)).toEqual([
      { via: "web", keys: "notice_routes" },
      { via: "web", keys: "notice_routes" },
      { via: "web", keys: "notice_routes" },
      { via: "web", keys: "notice_routes" },
    ]);
    await patchRoutes(app, "owner", { urgent: "telegram", updates: "push" });
    await patchRoutes(app, "owner", { approvals: null });
    expect(await routeAudit(org.orgId)).toHaveLength(4);
    expect(JSON.stringify(await routeAudit(org.orgId))).not.toMatch(/push|both|telegram"/);
  });

  test("2. every group takes every value the database CHECK allows (the schema and the CHECK agree)", async () => {
    const { org, app } = await setup({ push: true });
    for (const group of ["urgent", "approvals", "updates"] as const) {
      for (const value of ["telegram", "push", "both"] as const) {
        const res = await patchRoutes(app, "owner", { [group]: value });
        expect({ group, value, status: res.status }).toEqual({ group, value, status: 200 });
        expect((await routesOf(org.orgId, org.ownerId))[group]).toBe(value);
      }
    }
  });

  test("3. a value outside telegram, push and both, another key, an empty or mixed body: 400, nothing stored or audited", async () => {
    const { org, app } = await setup({ push: true, quiet: true, mail: true });
    for (const routes of [
      { urgent: "fax" },
      { urgent: "PUSH" },
      { urgent: ["push"] },
      { urgent: 1 },
      { digest: "push" },
      { urgent: "push", extra: "telegram" },
      {},
      [],
      "push",
      null,
    ]) {
      const res = await patchRoutes(app, "owner", routes);
      expect({ routes, status: res.status }).toEqual({ routes, status: 400 });
    }
    const mixed = await app.request(
      "/api/me/notify",
      patch("owner", { routes: { urgent: "push" }, quietStart: "22:00", quietEnd: "07:00" })
    );
    expect(mixed.status).toBe(400);
    const mixedChannel = await app.request(
      "/api/me/notify",
      patch("owner", { routes: { urgent: "push" }, reportChannel: "telegram" })
    );
    expect(mixedChannel.status).toBe(400);
    expect(await routesOf(org.orgId, org.ownerId)).toEqual({});
    expect(await routeAudit(org.orgId)).toEqual([]);
  });

  test("3b. the flag web_push off: the routes are refused (404) and nothing is stored; the other groups still work", async () => {
    const { org, app } = await setup({ quiet: true, mail: true });
    const res = await patchRoutes(app, "owner", { urgent: "push" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(await routesOf(org.orgId, org.ownerId)).toEqual({});
    expect(await routeAudit(org.orgId)).toEqual([]);
    expect(
      (await app.request("/api/me/notify", patch("owner", { quietStart: "23:00", quietEnd: "06:00" }))).status
    ).toBe(200);
  });

  test("4. the caller's row only: another member and a member of another organization change their own row, not this one", async () => {
    const { org, app } = await setup({ push: true });
    expect((await patchRoutes(app, "assistant", { updates: "push" })).status).toBe(200);
    expect(await routesOf(org.orgId, org.assistantId)).toEqual({ updates: "push" });
    expect(await routesOf(org.orgId, org.ownerId)).toEqual({});
    // The other organization has no flag: its owner is refused and the first organization keeps its rows.
    expect((await patchRoutes(app, "other-owner", { urgent: "push" })).status).toBe(404);
    expect(await routesOf(org.otherOrgId, org.otherOwnerId)).toEqual({});
    // With the flag on there, the owner of org B changes the row of org B only.
    await upsertOrgFeature(
      db,
      { orgId: org.otherOrgId },
      { flag: "web_push", enabled: true, setBy: org.otherOwnerId, setAt: NOW }
    );
    expect((await patchRoutes(app, "other-owner", { urgent: "both" })).status).toBe(200);
    expect(await routesOf(org.otherOrgId, org.otherOwnerId)).toEqual({ urgent: "both" });
    expect(await routesOf(org.orgId, org.ownerId)).toEqual({});
    expect(await routesOf(org.orgId, org.assistantId)).toEqual({ updates: "push" });
    // A user id in the body is no key: 400.
    expect(
      (await app.request("/api/me/notify", patch("assistant", { routes: { urgent: "push" }, userId: org.ownerId })))
        .status
    ).toBe(400);
  });

  test("5. two changes of two groups at once both stay (the row is locked, the merge reads the new value)", async () => {
    const { org, app } = await setup({ push: true });
    const results = await Promise.all([
      patchRoutes(app, "owner", { urgent: "push" }),
      patchRoutes(app, "owner", { approvals: "both" }),
      patchRoutes(app, "owner", { updates: "push" }),
    ]);
    expect(results.map((res) => res.status)).toEqual([200, 200, 200]);
    expect(await routesOf(org.orgId, org.ownerId)).toEqual({ urgent: "push", approvals: "both", updates: "push" });
  });

  test("6. GET: routeDefaults follow the chat and the live devices of the member (effectiveRoute)", async () => {
    const { org, app } = await setup({ push: true });
    const none = { telegram: false, push: false };
    const tg = { telegram: true, push: false };
    const phone = { telegram: false, push: true };
    const both = { telegram: true, push: true };
    expect((await read(app, "owner")).routeDefaults).toEqual({ urgent: none, approvals: none, updates: none });
    expect((await read(app, "owner")).routes).toEqual({});

    await linkChat(org.orgId, org.ownerId);
    expect((await read(app, "owner")).routeDefaults).toEqual({ urgent: tg, approvals: tg, updates: tg });

    // A device of the assistant and a device with an expired session are not a live device of the owner.
    await addDevice(org.orgId, org.assistantId);
    await addDevice(org.orgId, org.ownerId, new Date("2026-11-10T00:00:00Z"));
    expect((await read(app, "owner")).routeDefaults).toEqual({ urgent: tg, approvals: tg, updates: tg });

    await addDevice(org.orgId, org.ownerId);
    const withDevice = await read(app, "owner");
    expect(withDevice.routeDefaults).toEqual({ urgent: both, approvals: both, updates: tg });
    // The assistant has a device and no chat: push in every group.
    expect((await read(app, "assistant")).routeDefaults).toEqual({ urgent: phone, approvals: phone, updates: phone });

    // The stored choice is in `routes`; `routeDefaults` stays the default.
    await patchRoutes(app, "owner", { urgent: "telegram" });
    const chosen = await read(app, "owner");
    expect(chosen.routes).toEqual({ urgent: "telegram" });
    expect(chosen.routeDefaults).toEqual({ urgent: both, approvals: both, updates: tg });
  });

  test("6b. GET with the flag off: the stored routes show, a device does not count", async () => {
    const { org, app } = await setup({ push: true });
    await linkChat(org.orgId, org.ownerId);
    await addDevice(org.orgId, org.ownerId);
    await patchRoutes(app, "owner", { urgent: "push" });
    await db.deleteFrom("org_features").where("org_id", "=", org.orgId).where("flag", "=", "web_push").execute();
    const view = await read(app, "owner");
    expect(view.routes).toEqual({ urgent: "push" });
    expect(view.routeDefaults.urgent).toEqual({ telegram: true, push: false });
  });
});
