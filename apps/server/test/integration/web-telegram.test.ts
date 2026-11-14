import { TELEGRAM_CONSENT_VERSION, telegramLinkSchema, telegramStateSchema } from "@ea/core";
import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import { Hono } from "hono";

import { channelRoutes, consumeLinkToken } from "../../src/modules/channels";
import type { ApiEnv } from "../../src/platform/http";
import { setLogLevel } from "../../src/platform/log";

import { randomChatId } from "./fixtures";
import { testDb } from "./helpers";
import { as, webOrg, webTestApp, type WebOrg } from "./web-helpers";

const db = testDb();
const NOW = new Date("2026-11-11T10:00:00.000Z");

const orgs: WebOrg[] = [];

afterEach(async () => {
  setLogLevel("info");
  for (const org of orgs) await org.cleanup();
  orgs.length = 0;
});

afterAll(async () => {
  await db.destroy();
});

async function setup(botUsername: (() => Promise<string>) | null = async () => "fake_ea_bot") {
  const org = await webOrg(db);
  orgs.push(org);
  const app = webTestApp({
    db,
    sessions: {
      owner: org.ownerId,
      assistant: org.assistantId,
      "other-owner": org.otherOwnerId,
    },
    routers: (api: Hono<ApiEnv>) => api.route("/", channelRoutes({ db, now: () => NOW, botUsername })),
  });
  return { org, app };
}

const VALID = { consentVersion: TELEGRAM_CONSENT_VERSION };

const tokenRows = (orgId: string) =>
  db.selectFrom("chat_link_tokens").selectAll().where("org_id", "=", orgId).execute();

describe("telegram routes", () => {
  test("no cookie is 401; POST and DELETE without Origin are 403 bad_origin", async () => {
    const { app } = await setup();
    for (const [method, path] of [
      ["GET", "/api/channels/telegram"],
      ["POST", "/api/channels/telegram/link"],
      ["DELETE", "/api/channels/telegram/link"],
    ] as const) {
      const res = await app.request(path, { method, headers: { origin: "http://127.0.0.1:8080" } });
      expect(res.status).toBe(401);
    }
    for (const [method, path] of [
      ["POST", "/api/channels/telegram/link"],
      ["DELETE", "/api/channels/telegram/link"],
    ] as const) {
      const res = await app.request(path, { method, headers: { cookie: "ea.session_token=owner" } });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "bad_origin" });
    }
  });

  test("GET before a link", async () => {
    const { app } = await setup();
    const res = await app.request("/api/channels/telegram", as("owner"));
    expect(res.status).toBe(200);
    expect(telegramStateSchema.parse(await res.json())).toEqual({
      available: true,
      linked: false,
      linkedAt: null,
      botUsername: "fake_ea_bot",
    });
  });

  test("POST /link makes a token, the token links the chat", async () => {
    const { app, org } = await setup();
    const res = await app.request("/api/channels/telegram/link", as("assistant", { method: "POST", body: VALID }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = telegramLinkSchema.parse(await res.json());
    expect(body.url).toMatch(/^https:\/\/t\.me\/fake_ea_bot\?start=[A-Za-z0-9_-]{43}$/);
    expect(body.expiresAt).toBe(new Date(NOW.getTime() + 15 * 60_000).toISOString());
    const rows = await tokenRows(org.orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.user_id).toBe(org.assistantId);

    const token = new URL(body.url).searchParams.get("start") ?? "";
    const linkedAt = new Date(NOW.getTime() + 60_000);
    const consumed = await consumeLinkToken(db, { token, chatId: randomChatId(), now: linkedAt });
    expect(consumed.kind).toBe("linked");

    const state = telegramStateSchema.parse(
      await (await app.request("/api/channels/telegram", as("assistant"))).json()
    );
    expect(state.linked).toBe(true);
    expect(state.linkedAt).toBe(linkedAt.toISOString());
  });

  test("DELETE /link unlinks, audits the user and is idempotent", async () => {
    const { app, org } = await setup();
    const res = await app.request("/api/channels/telegram/link", as("owner", { method: "POST", body: VALID }));
    const token = new URL(telegramLinkSchema.parse(await res.json()).url).searchParams.get("start") ?? "";
    await consumeLinkToken(db, { token, chatId: randomChatId(), now: NOW });

    const first = await app.request("/api/channels/telegram/link", as("owner", { method: "DELETE" }));
    expect(first.status).toBe(204);
    expect(await first.text()).toBe("");
    const state = telegramStateSchema.parse(await (await app.request("/api/channels/telegram", as("owner"))).json());
    expect(state.linked).toBe(false);

    const audits = () =>
      db
        .selectFrom("audit_log")
        .selectAll()
        .where("org_id", "=", org.orgId)
        .where("event", "=", "chat.unlinked")
        .execute();
    const rows = await audits();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor).toBe(org.ownerId);

    const second = await app.request("/api/channels/telegram/link", as("owner", { method: "DELETE" }));
    expect(second.status).toBe(204);
    expect(await audits()).toHaveLength(1);
  });

  test("botUsername null: POST is 409 telegram_off, GET says unavailable, no token row", async () => {
    const { app, org } = await setup(null);
    const res = await app.request("/api/channels/telegram/link", as("owner", { method: "POST" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "telegram_off" });
    const state = telegramStateSchema.parse(await (await app.request("/api/channels/telegram", as("owner"))).json());
    expect(state).toEqual({ available: false, linked: false, linkedAt: null, botUsername: null });
    expect(await tokenRows(org.orgId)).toHaveLength(0);
  });

  test("botUsername rejects: POST is 502 telegram_unreachable, GET stays 200", async () => {
    const { app, org } = await setup(async () => {
      throw new Error("down");
    });
    const warn = spyOn(console, "error").mockImplementation((): void => undefined);
    try {
      const res = await app.request("/api/channels/telegram/link", as("owner", { method: "POST", body: VALID }));
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: "telegram_unreachable" });
    } finally {
      warn.mockRestore();
    }
    expect(await tokenRows(org.orgId)).toHaveLength(0);
    const get = await app.request("/api/channels/telegram", as("owner"));
    expect(get.status).toBe(200);
    expect(telegramStateSchema.parse(await get.json())).toEqual({
      available: true,
      linked: false,
      linkedAt: null,
      botUsername: null,
    });
  });

  test("the owner of another organization cannot unlink this organization's chat", async () => {
    const { app, org } = await setup();
    const res = await app.request("/api/channels/telegram/link", as("owner", { method: "POST", body: VALID }));
    const token = new URL(telegramLinkSchema.parse(await res.json()).url).searchParams.get("start") ?? "";
    await consumeLinkToken(db, { token, chatId: randomChatId(), now: NOW });

    const del = await app.request("/api/channels/telegram/link", as("other-owner", { method: "DELETE" }));
    expect(del.status).toBe(204);
    const links = await db.selectFrom("chat_links").selectAll().where("org_id", "=", org.orgId).execute();
    expect(links).toHaveLength(1);
  });

  test("the link flow logs neither the token nor the start parameter", async () => {
    const { app } = await setup();
    const logSpy = spyOn(console, "log").mockImplementation((): void => undefined);
    const errorSpy = spyOn(console, "error").mockImplementation((): void => undefined);
    setLogLevel("debug");
    let lines: string[] = [];
    let token = "";
    try {
      const res = await app.request("/api/channels/telegram/link", as("owner", { method: "POST", body: VALID }));
      token = new URL(telegramLinkSchema.parse(await res.json()).url).searchParams.get("start") ?? "";
      await app.request("/api/channels/telegram", as("owner"));
      await app.request("/api/channels/telegram/link", as("owner", { method: "DELETE" }));
      lines = [...logSpy.mock.calls, ...errorSpy.mock.calls].map((call) => call.join(" "));
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
    expect(token).toHaveLength(43);
    expect(lines.some((line) => line.includes("web: telegram link made for user"))).toBe(true);
    for (const line of lines) {
      expect(line).not.toContain(token);
      expect(line).not.toContain("start=");
    }
  });
});

const consentRows = (orgId: string) =>
  db
    .selectFrom("audit_log")
    .selectAll()
    .where("org_id", "=", orgId)
    .where("event", "=", "web.telegram_consent")
    .execute();

describe("telegram link consent", () => {
  const LINK = "/api/channels/telegram/link";

  test("a request with no body, a bad body or an old version is refused and leaves no token or consent row", async () => {
    const { app, org } = await setup();
    const none = await app.request(LINK, as("owner", { method: "POST" }));
    expect(none.status).toBe(400);
    for (const body of [{}, { consentVersion: "" }]) {
      const res = await app.request(LINK, as("owner", { method: "POST", body }));
      expect(res.status).toBe(400);
    }
    const old = await app.request(LINK, as("owner", { method: "POST", body: { consentVersion: "2000-01-01" } }));
    expect(old.status).toBe(409);
    expect(await old.json()).toEqual({ error: "telegram_consent_outdated" });
    expect(await tokenRows(org.orgId)).toHaveLength(0);
    expect(await consentRows(org.orgId)).toHaveLength(0);
  });

  test("the current version makes one token and one consent row", async () => {
    const { app, org } = await setup();
    const res = await app.request(LINK, as("owner", { method: "POST", body: VALID }));
    expect(res.status).toBe(200);
    expect(telegramLinkSchema.parse(await res.json()).url).toStartWith("https://t.me/");
    const tokens = await tokenRows(org.orgId);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.user_id).toBe(org.ownerId);
    const consents = await consentRows(org.orgId);
    expect(consents).toHaveLength(1);
    expect(consents[0]?.actor).toBe(org.ownerId);
    expect(consents[0]?.data).toEqual({ via: "web", version: TELEGRAM_CONSENT_VERSION });
  });

  test("a second accepted request makes a second consent row and the first token stops working", async () => {
    const { app, org } = await setup();
    const tokenOf = async () =>
      new URL(
        telegramLinkSchema.parse(
          await (await app.request(LINK, as("owner", { method: "POST", body: VALID }))).json()
        ).url
      ).searchParams.get("start") ?? "";
    const first = await tokenOf();
    await tokenOf();
    expect(await consentRows(org.orgId)).toHaveLength(2);
    expect(await consumeLinkToken(db, { token: first, chatId: randomChatId(), now: NOW })).toEqual({ kind: "unknown" });
  });

  test("when Telegram does not answer, a valid body makes no token and no consent row", async () => {
    const { app, org } = await setup(async () => {
      throw new Error("down");
    });
    const warn = spyOn(console, "error").mockImplementation((): void => undefined);
    try {
      const res = await app.request(LINK, as("owner", { method: "POST", body: VALID }));
      expect(res.status).toBe(502);
    } finally {
      warn.mockRestore();
    }
    expect(await tokenRows(org.orgId)).toHaveLength(0);
    expect(await consentRows(org.orgId)).toHaveLength(0);
  });

  test("Telegram off is 409 telegram_off before the body is read", async () => {
    const { app } = await setup(null);
    const res = await app.request(LINK, as("owner", { method: "POST" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "telegram_off" });
  });

  test("an assistant with a valid body is the actor of the consent row", async () => {
    const { app, org } = await setup();
    const res = await app.request(LINK, as("assistant", { method: "POST", body: VALID }));
    expect(res.status).toBe(200);
    const consents = await consentRows(org.orgId);
    expect(consents).toHaveLength(1);
    expect(consents[0]?.actor).toBe(org.assistantId);
  });
});
