import { randomBytes, randomUUID } from "node:crypto";

import {
  organizationSettingsSchema,
  TELEGRAM_CONSENT_VERSION,
  telegramDetailAnswerSchema,
  telegramLinkSchema,
  telegramLockAnswerSchema,
  telegramStateSchema,
  DAY_MS,
} from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { sql } from "kysely";

import { createOutboxSender, queueNotice } from "../../src/modules/channels";
import { createFakeChannel } from "../../src/modules/channels/fake/channel";
import { changeTelegramDetail, changeTelegramLock } from "../../src/modules/channels/telegram-detail";
import { insertMailbox } from "../../src/modules/mail/repo";
import {
  insertMembership,
  isOrgSuspended,
  setMemberTelegramDetail,
  setTelegramMinimalLocked,
  upsertOrgFeature,
} from "../../src/modules/tenancy";
import { loadConfig } from "../../src/platform/config";
import { createSecretBox } from "../../src/platform/crypto";
import { apiRouters } from "../../src/web";

import { insertTestEmail, randomChatId, testCapabilities, testNoticeView } from "./fixtures";
import { testDb } from "./helpers";
import { as, noBackupCodes, noPrivacy, TEST_ORIGIN, webOrg, webTestApp, type WebOrg } from "./web-helpers";

// The Telegram detail level and the organization lock (ADR 0032 point 5, plan decisions 13 and 14): the link step, the member route,
// the owner route, the flag, the own-row rule, the audit rows. Committed rows: the link route opens its own transaction.
const db = testDb();
const key = randomBytes(32).toString("base64");
const config = loadConfig({
  DATABASE_URL: process.env.DATABASE_URL,
  CREDENTIALS_KEY: key,
  WEB_BASE_URL: TEST_ORIGIN,
  WEB_AUTH_SECRET: "x".repeat(32),
});
const extras = {
  secrets: createSecretBox(key, 1),
  actionsScope: { kind: "off" } as const,
  sendScope: { kind: "off" } as const,
  botUsername: async () => "fake_ea_bot",
};
const NOW = new Date("2026-11-20T10:00:00.000Z");

let org: WebOrg;
let spies: ReturnType<typeof spyOn>[] = [];
const sessions = () => ({
  owner: org.ownerId,
  assistant: org.assistantId,
  "other-owner": org.otherOwnerId,
});
const app = (opts: { suspended?: boolean } = {}) =>
  webTestApp({
    db,
    sessions: sessions(),
    routers: apiRouters(
      config,
      db,
      extras,
      () => NOW,
      async () => [],
      noBackupCodes,
      noPrivacy
    ),
    ...(opts.suspended === true ? { isOrgSuspended: (id: string) => isOrgSuspended(db, { orgId: id }) } : {}),
  });

beforeEach(async () => {
  spies = [spyOn(console, "log").mockImplementation((): void => undefined)];
  org = await webOrg(db);
});
afterEach(async () => {
  for (const spy of spies) spy.mockRestore();
  await org.cleanup();
});
afterAll(async () => {
  await db.destroy();
});

const patch = (who: string, body: unknown) => as(who, { method: "PATCH", body });
const post = (who: string, body: unknown) => as(who, { method: "POST", body });
const CURRENT = { consentVersion: TELEGRAM_CONSENT_VERSION };
const flag = (orgId: string, enabled: boolean) =>
  upsertOrgFeature(db, { orgId }, { flag: "telegram_minimal", enabled, setBy: org.ownerId, setAt: NOW });
const detailOf = async (userId: string, orgId = org.orgId) =>
  (
    await db
      .selectFrom("memberships")
      .select("telegram_detail")
      .where("org_id", "=", orgId)
      .where("user_id", "=", userId)
      .executeTakeFirstOrThrow()
  ).telegram_detail;
const setDetail = (userId: string, detail: "full" | "minimal", orgId = org.orgId) =>
  db
    .updateTable("memberships")
    .set({ telegram_detail: detail })
    .where("org_id", "=", orgId)
    .where("user_id", "=", userId)
    .execute();
const lockOf = async (orgId = org.orgId) =>
  (
    await db
      .selectFrom("organizations")
      .select("telegram_minimal_locked")
      .where("id", "=", orgId)
      .executeTakeFirstOrThrow()
  ).telegram_minimal_locked;
const setLock = (locked: boolean, orgId = org.orgId) =>
  db.updateTable("organizations").set({ telegram_minimal_locked: locked }).where("id", "=", orgId).execute();
const auditOf = (event: string, orgId = org.orgId) =>
  db
    .selectFrom("audit_log")
    .select(["actor", "data"])
    .where("org_id", "=", orgId)
    .where("event", "=", event)
    .orderBy("id")
    .execute();
const tokens = (orgId = org.orgId) =>
  db.selectFrom("chat_link_tokens").select("user_id").where("org_id", "=", orgId).execute();

describe("the link step stores the detail level", () => {
  test("1. a link with no detail keeps the stored level (full stays full, a new member is minimal) and writes no audit row", async () => {
    await flag(org.orgId, true);
    await setDetail(org.ownerId, "full");
    const res = await app().request("/api/channels/telegram/link", post("owner", CURRENT));
    expect(res.status).toBe(200);
    telegramLinkSchema.parse(await res.json());
    expect(await detailOf(org.ownerId)).toBe("full");
    expect(await tokens()).toHaveLength(1);
    expect(await auditOf("member.telegram_detail_changed")).toEqual([]);
    // The column default: a member that never chose has `minimal`, and a link without `detail` leaves it.
    expect(await detailOf(org.assistantId)).toBe("minimal");
    expect((await app().request("/api/channels/telegram/link", post("assistant", CURRENT))).status).toBe(200);
    expect(await detailOf(org.assistantId)).toBe("minimal");
    expect(await auditOf("member.telegram_detail_changed")).toEqual([]);
  });

  test("2. full with the current consent stores full; full with an old consent is 409 and stores nothing", async () => {
    await flag(org.orgId, true);
    const ok = await app().request("/api/channels/telegram/link", post("owner", { ...CURRENT, detail: "full" }));
    expect(ok.status).toBe(200);
    expect(await detailOf(org.ownerId)).toBe("full");
    expect(await auditOf("web.telegram_consent")).toHaveLength(1);

    await setDetail(org.assistantId, "minimal");
    const old = await app().request(
      "/api/channels/telegram/link",
      post("assistant", { consentVersion: "2020-01-01", detail: "full" })
    );
    expect({ status: old.status, body: await old.json() }).toEqual({
      status: 409,
      body: { error: "telegram_consent_outdated" },
    });
    expect(await detailOf(org.assistantId)).toBe("minimal");
    expect(await tokens()).toHaveLength(1);
    expect(await auditOf("web.telegram_consent")).toHaveLength(1);
  });

  test("3. the lock refuses full at the link: 409, no token, no consent row, nothing stored; minimal still links", async () => {
    await flag(org.orgId, true);
    await setLock(true);
    await setDetail(org.assistantId, "minimal");
    const res = await app().request("/api/channels/telegram/link", post("assistant", { ...CURRENT, detail: "full" }));
    expect({ status: res.status, body: await res.json() }).toEqual({
      status: 409,
      body: { error: "telegram_detail_locked" },
    });
    expect(await tokens()).toEqual([]);
    expect(await auditOf("web.telegram_consent")).toEqual([]);
    expect(await detailOf(org.assistantId)).toBe("minimal");

    const minimal = await app().request(
      "/api/channels/telegram/link",
      post("assistant", { ...CURRENT, detail: "minimal" })
    );
    expect(minimal.status).toBe(200);
    expect(await tokens()).toHaveLength(1);
  });

  test("3b. the order of the checks is the one of the PATCH route: locked full with an old consent answers the lock, in both routes", async () => {
    await flag(org.orgId, true);
    await setLock(true);
    const old = { consentVersion: "2020-01-01", detail: "full" };
    const link = await app().request("/api/channels/telegram/link", post("assistant", old));
    const change = await app().request("/api/me/telegram-detail", patch("assistant", old));
    expect([
      { status: link.status, body: await link.json() },
      { status: change.status, body: await change.json() },
    ]).toEqual([
      { status: 409, body: { error: "telegram_detail_locked" } },
      { status: 409, body: { error: "telegram_detail_locked" } },
    ]);
    // Not locked: both answer the old consent.
    await setLock(false);
    for (const res of [
      await app().request("/api/channels/telegram/link", post("assistant", old)),
      await app().request("/api/me/telegram-detail", patch("assistant", old)),
    ]) {
      expect({ status: res.status, body: await res.json() }).toEqual({
        status: 409,
        body: { error: "telegram_consent_outdated" },
      });
    }
  });

  test("4. flag off: the link ignores detail (full is linked), the column stays, GET holds no detail key", async () => {
    await setDetail(org.ownerId, "full");
    await setLock(true);
    const res = await app().request("/api/channels/telegram/link", post("owner", { ...CURRENT, detail: "minimal" }));
    expect(res.status).toBe(200);
    expect(await detailOf(org.ownerId)).toBe("full");
    await setDetail(org.assistantId, "minimal");
    const locked = await app().request(
      "/api/channels/telegram/link",
      post("assistant", { ...CURRENT, detail: "full" })
    );
    expect(locked.status).toBe(200);
    expect(await detailOf(org.assistantId)).toBe("minimal");
    expect(await tokens()).toHaveLength(2);
    expect(await auditOf("member.telegram_detail_changed")).toEqual([]);
    // A value that the schema refuses is ignored as well: the feature is off, the old behaviour stays.
    for (const detail of ["everything", 1, null]) {
      const bad = await app().request("/api/channels/telegram/link", post("owner", { ...CURRENT, detail }));
      expect({ detail, status: bad.status }).toEqual({ detail, status: 200 });
    }
    expect(await tokens()).toHaveLength(2); // a new token replaces the one of the same user
    expect(await detailOf(org.ownerId)).toBe("full");

    const state = (await (await app().request("/api/channels/telegram", as("owner"))).json()) as Record<
      string,
      unknown
    >;
    expect(Object.keys(state).sort()).toEqual(["available", "botUsername", "consentVersion", "linked", "linkedAt"]);
  });

  test("5. a bad detail value is 400 and stores nothing", async () => {
    await flag(org.orgId, true);
    for (const body of [
      { ...CURRENT, detail: "everything" },
      { ...CURRENT, detail: 1 },
      { ...CURRENT, detail: null },
    ]) {
      const res = await app().request("/api/channels/telegram/link", post("owner", body));
      expect(res.status).toBe(400);
    }
    expect(await tokens()).toEqual([]);
  });
});

describe("the link under the lock keeps the stored level", () => {
  test("26. a link without detail while the organization locks minimal keeps a stored full; the unlock gives full again", async () => {
    await flag(org.orgId, true);
    await setDetail(org.assistantId, "full");
    await setLock(true);
    const res = await app().request("/api/channels/telegram/link", post("assistant", CURRENT));
    expect(res.status).toBe(200);
    expect(await detailOf(org.assistantId)).toBe("full");
    expect(await tokens()).toHaveLength(1);
    expect(await auditOf("member.telegram_detail_changed")).toEqual([]);
    const read = async () =>
      telegramStateSchema.parse(await (await app().request("/api/channels/telegram", as("assistant"))).json());
    expect(await read()).toMatchObject({ detail: "full", effectiveDetail: "minimal", locked: true });
    expect((await app().request("/api/organization/telegram-lock", patch("owner", { locked: false }))).status).toBe(
      200
    );
    expect(await read()).toMatchObject({ detail: "full", effectiveDetail: "full", locked: false });
  });
});

describe("GET /api/channels/telegram", () => {
  test("6. flag on: the stored level, the effective level and the lock; the lock wins over full and keeps the stored level", async () => {
    await flag(org.orgId, true);
    await setDetail(org.ownerId, "full");
    const read = async () =>
      telegramStateSchema.parse(await (await app().request("/api/channels/telegram", as("owner"))).json());
    expect(await read()).toMatchObject({ detail: "full", effectiveDetail: "full", locked: false });
    await setLock(true);
    expect(await read()).toMatchObject({ detail: "full", effectiveDetail: "minimal", locked: true });
    await setDetail(org.ownerId, "minimal");
    await setLock(false);
    expect(await read()).toMatchObject({ detail: "minimal", effectiveDetail: "minimal", locked: false });
  });
});

describe("PATCH /api/me/telegram-detail", () => {
  test("7. minimal needs no consent; full without consent is 409; full with an old consent is 409; nothing is stored then", async () => {
    await flag(org.orgId, true);
    await setDetail(org.ownerId, "full");
    const minimal = await app().request("/api/me/telegram-detail", patch("owner", { detail: "minimal" }));
    expect(minimal.status).toBe(200);
    expect(telegramDetailAnswerSchema.parse(await minimal.json())).toEqual({
      detail: "minimal",
      effectiveDetail: "minimal",
      locked: false,
    });
    expect(await detailOf(org.ownerId)).toBe("minimal");
    expect(await auditOf("web.telegram_consent")).toEqual([]);

    for (const body of [{ detail: "full" }, { detail: "full", consentVersion: "2020-01-01" }]) {
      const res = await app().request("/api/me/telegram-detail", patch("owner", body));
      expect({ status: res.status, body: await res.json() }).toEqual({
        status: 409,
        body: { error: "telegram_consent_outdated" },
      });
    }
    expect(await detailOf(org.ownerId)).toBe("minimal");
    expect(await auditOf("web.telegram_consent")).toEqual([]);
  });

  test("8. full with the current consent stores full and records the consent in the same call", async () => {
    await flag(org.orgId, true);
    await setDetail(org.assistantId, "minimal");
    const res = await app().request("/api/me/telegram-detail", patch("assistant", { detail: "full", ...CURRENT }));
    expect(res.status).toBe(200);
    expect(telegramDetailAnswerSchema.parse(await res.json())).toEqual({
      detail: "full",
      effectiveDetail: "full",
      locked: false,
    });
    expect(await detailOf(org.assistantId)).toBe("full");
    expect(await auditOf("web.telegram_consent")).toEqual([
      { actor: org.assistantId, data: { via: "web", version: TELEGRAM_CONSENT_VERSION } },
    ]);
  });

  test("9. the lock refuses full with 409 telegram_detail_locked, also with the current consent; minimal still works", async () => {
    await flag(org.orgId, true);
    await setLock(true);
    await setDetail(org.ownerId, "minimal");
    const full = await app().request("/api/me/telegram-detail", patch("owner", { detail: "full", ...CURRENT }));
    expect({ status: full.status, body: await full.json() }).toEqual({
      status: 409,
      body: { error: "telegram_detail_locked" },
    });
    expect(await detailOf(org.ownerId)).toBe("minimal");
    expect(await auditOf("web.telegram_consent")).toEqual([]);
    const minimal = await app().request("/api/me/telegram-detail", patch("owner", { detail: "minimal" }));
    expect(minimal.status).toBe(200);
  });

  test("10. flag off: 404 not_found for the owner and the assistant, and the column stays", async () => {
    await setDetail(org.ownerId, "full");
    for (const who of ["owner", "assistant"]) {
      for (const body of [{ detail: "minimal" }, { detail: "full", ...CURRENT }]) {
        const res = await app().request("/api/me/telegram-detail", patch(who, body));
        expect({ status: res.status, body: await res.json() }).toEqual({ status: 404, body: { error: "not_found" } });
      }
    }
    expect(await detailOf(org.ownerId)).toBe("full");
    expect(await auditOf("member.telegram_detail_changed")).toEqual([]);
  });

  test("11. the row is the one of the session user: a member of another organization changes only their own row", async () => {
    await flag(org.orgId, true);
    await flag(org.otherOrgId, true);
    await setDetail(org.ownerId, "full");
    await setDetail(org.assistantId, "full");
    await setDetail(org.otherOwnerId, "full", org.otherOrgId);
    const res = await app().request(
      "/api/me/telegram-detail",
      patch("other-owner", { detail: "minimal", userId: org.ownerId, orgId: org.orgId })
    );
    expect(res.status).toBe(200);
    expect(await detailOf(org.otherOwnerId, org.otherOrgId)).toBe("minimal");
    expect(await detailOf(org.ownerId)).toBe("full");
    expect(await detailOf(org.assistantId)).toBe("full");
    expect(await auditOf("member.telegram_detail_changed")).toEqual([]);
    // In one organization the assistant changes the own row only, not the owner's.
    const own = await app().request("/api/me/telegram-detail", patch("assistant", { detail: "minimal" }));
    expect(own.status).toBe(200);
    expect(await detailOf(org.assistantId)).toBe("minimal");
    expect(await detailOf(org.ownerId)).toBe("full");
    expect(await auditOf("member.telegram_detail_changed", org.otherOrgId)).toEqual([
      { actor: org.otherOwnerId, data: { detail: "minimal" } },
    ]);
  });

  test("12. the audit row holds the value and nothing else, and only when the value changes", async () => {
    await flag(org.orgId, true);
    await setDetail(org.ownerId, "minimal");
    await app().request("/api/me/telegram-detail", patch("owner", { detail: "minimal" }));
    expect(await auditOf("member.telegram_detail_changed")).toEqual([]);
    await app().request("/api/me/telegram-detail", patch("owner", { detail: "full", ...CURRENT }));
    await app().request("/api/me/telegram-detail", patch("owner", { detail: "full", ...CURRENT }));
    await app().request("/api/me/telegram-detail", patch("owner", { detail: "minimal" }));
    expect(await auditOf("member.telegram_detail_changed")).toEqual([
      { actor: org.ownerId, data: { detail: "full" } },
      { actor: org.ownerId, data: { detail: "minimal" } },
    ]);
  });

  test("13. no cookie is 401, no trusted Origin is 403, a bad body is 400, a suspended organization is 403", async () => {
    await flag(org.orgId, true);
    const anonymous = await app().request("/api/me/telegram-detail", {
      method: "PATCH",
      headers: { origin: TEST_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ detail: "minimal" }),
    });
    expect(anonymous.status).toBe(401);
    const noOrigin = await app().request("/api/me/telegram-detail", {
      method: "PATCH",
      headers: { cookie: "ea.session_token=owner", "content-type": "application/json" },
      body: JSON.stringify({ detail: "minimal" }),
    });
    expect({ status: noOrigin.status, body: await noOrigin.json() }).toEqual({
      status: 403,
      body: { error: "bad_origin" },
    });
    for (const body of [{}, { detail: "all" }, { detail: "full", consentVersion: 5 }]) {
      expect((await app().request("/api/me/telegram-detail", patch("owner", body))).status).toBe(400);
    }
    await setDetail(org.ownerId, "full");
    await sql`UPDATE organizations SET plan = 'suspended' WHERE id = ${org.orgId}`.execute(db);
    const suspended = await app({ suspended: true }).request(
      "/api/me/telegram-detail",
      patch("owner", { detail: "minimal" })
    );
    expect({ status: suspended.status, body: await suspended.json() }).toEqual({
      status: 403,
      body: { error: "org_suspended" },
    });
    expect(await detailOf(org.ownerId)).toBe("full");
  });
});

describe("PATCH /api/organization/telegram-lock", () => {
  test("14. the owner locks and unlocks; GET /api/organization shows telegramMinimalLocked; the audit row holds the value only", async () => {
    await flag(org.orgId, true);
    const read = async () =>
      organizationSettingsSchema.parse(await (await app().request("/api/organization", as("owner"))).json());
    expect((await read()).telegramMinimalLocked).toBe(false);
    const lock = await app().request("/api/organization/telegram-lock", patch("owner", { locked: true }));
    expect(telegramLockAnswerSchema.parse(await lock.json())).toEqual({ locked: true });
    expect(await lockOf()).toBe(true);
    expect((await read()).telegramMinimalLocked).toBe(true);
    await app().request("/api/organization/telegram-lock", patch("owner", { locked: true }));
    await app().request("/api/organization/telegram-lock", patch("owner", { locked: false }));
    expect(await lockOf()).toBe(false);
    expect(await auditOf("org.telegram_lock_changed")).toEqual([
      { actor: org.ownerId, data: { locked: true } },
      { actor: org.ownerId, data: { locked: false } },
    ]);
  });

  test("15. an assistant gets 403 owner_only and nothing changes; with the flag off the answer is 404 for the owner and the assistant", async () => {
    await flag(org.orgId, true);
    const refused = await app().request("/api/organization/telegram-lock", patch("assistant", { locked: true }));
    expect({ status: refused.status, body: await refused.json() }).toEqual({
      status: 403,
      body: { error: "owner_only" },
    });
    expect(await lockOf()).toBe(false);

    await flag(org.orgId, false);
    for (const who of ["owner", "assistant"]) {
      const res = await app().request("/api/organization/telegram-lock", patch(who, { locked: true }));
      expect({ who, status: res.status, body: await res.json() }).toEqual({
        who,
        status: 404,
        body: { error: "not_found" },
      });
    }
    expect(await lockOf()).toBe(false);
    const settings = (await (await app().request("/api/organization", as("owner"))).json()) as Record<string, unknown>;
    expect("telegramMinimalLocked" in settings).toBe(false);
  });

  test("16. a suspended organization answers 403 org_suspended and the lock stays; a foreign owner locks only their own organization", async () => {
    await flag(org.orgId, true);
    await flag(org.otherOrgId, true);
    const other = await app().request("/api/organization/telegram-lock", patch("other-owner", { locked: true }));
    expect(other.status).toBe(200);
    expect(await lockOf(org.otherOrgId)).toBe(true);
    expect(await lockOf()).toBe(false);
    await sql`UPDATE organizations SET plan = 'suspended' WHERE id = ${org.orgId}`.execute(db);
    const res = await app({ suspended: true }).request(
      "/api/organization/telegram-lock",
      patch("owner", { locked: true })
    );
    expect({ status: res.status, body: await res.json() }).toEqual({ status: 403, body: { error: "org_suspended" } });
    expect(await lockOf()).toBe(false);
  });

  test("17. no cookie is 401, no trusted Origin is 403, a bad body is 400", async () => {
    await flag(org.orgId, true);
    const anonymous = await app().request("/api/organization/telegram-lock", {
      method: "PATCH",
      headers: { origin: TEST_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ locked: true }),
    });
    expect(anonymous.status).toBe(401);
    const noOrigin = await app().request("/api/organization/telegram-lock", {
      method: "PATCH",
      headers: { cookie: "ea.session_token=owner", "content-type": "application/json" },
      body: JSON.stringify({ locked: true }),
    });
    expect(noOrigin.status).toBe(403);
    for (const body of [{}, { locked: "yes" }, { locked: 1 }]) {
      expect((await app().request("/api/organization/telegram-lock", patch("owner", body))).status).toBe(400);
    }
    expect(await lockOf()).toBe(false);
  });

  test("18. concurrent calls of the same value change it once: one audit row (the row is locked while it is read and written)", async () => {
    await flag(org.orgId, true);
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        app().request("/api/organization/telegram-lock", patch("owner", { locked: true }))
      )
    );
    expect(results.map((res) => res.status)).toEqual(Array.from({ length: 8 }, () => 200));
    expect(await auditOf("org.telegram_lock_changed")).toHaveLength(1);

    await setDetail(org.ownerId, "minimal");
    await setLock(false);
    const members = await Promise.all(
      Array.from({ length: 8 }, () =>
        app().request("/api/me/telegram-detail", patch("owner", { detail: "full", ...CURRENT }))
      )
    );
    expect(members.map((res) => res.status)).toEqual(Array.from({ length: 8 }, () => 200));
    expect(await auditOf("member.telegram_detail_changed")).toHaveLength(1);
  });
});

describe("two writers of one row", () => {
  // Writer A holds the row in an open transaction; writer B must wait for it and then see the value that A stored: B changes nothing,
  // so it writes no audit row. Without the row lock B reads the old value, passes, and writes a second audit row.
  test("20. a writer of the lock waits for the open writer of the same row, then sees its value", async () => {
    await flag(org.orgId, true);
    const first = await db.transaction().execute(async (trx) => {
      await setTelegramMinimalLocked(trx, { orgId: org.orgId }, true);
      const second = changeTelegramLock(db, { orgId: org.orgId }, org.ownerId, true, NOW);
      const early = await Promise.race([
        second.then(() => "done"),
        new Promise((done) => setTimeout(done, 80, "waiting")),
      ]);
      expect(early).toBe("waiting");
      return { second };
    });
    expect(await first.second).toEqual({ locked: true });
    expect(await auditOf("org.telegram_lock_changed")).toEqual([]);
  });

  test("21. a writer of the member level waits for the open writer of the same row, then sees its value", async () => {
    await flag(org.orgId, true);
    await setDetail(org.ownerId, "minimal");
    const result = await db.transaction().execute(async (trx) => {
      await setMemberTelegramDetail(trx, { orgId: org.orgId }, org.ownerId, "full");
      const second = changeTelegramDetail(db, { orgId: org.orgId }, org.ownerId, { detail: "full", ...CURRENT }, NOW);
      const early = await Promise.race([
        second.then(() => "done"),
        new Promise((done) => setTimeout(done, 80, "waiting")),
      ]);
      expect(early).toBe("waiting");
      return { second };
    });
    expect((await result.second).kind).toBe("ok");
    expect(await auditOf("member.telegram_detail_changed")).toEqual([]);
  });
});

describe("a user in two organizations", () => {
  // The assistant is a member of the organization of the session (first membership) and the owner of the other one.
  const inTwoOrgs = async () => {
    await insertMembership(db, { orgId: org.otherOrgId }, { userId: org.assistantId, role: "owner" });
    await flag(org.orgId, true);
    await flag(org.otherOrgId, true);
    await setDetail(org.assistantId, "full");
    await setDetail(org.assistantId, "full", org.otherOrgId);
  };

  test("22. PATCH changes only the row of the session organization; the lock route answers 403 where the user is no owner", async () => {
    await inTwoOrgs();
    const res = await app().request("/api/me/telegram-detail", patch("assistant", { detail: "minimal" }));
    expect(res.status).toBe(200);
    expect(await detailOf(org.assistantId)).toBe("minimal");
    expect(await detailOf(org.assistantId, org.otherOrgId)).toBe("full");
    expect(await auditOf("member.telegram_detail_changed", org.otherOrgId)).toEqual([]);

    const lock = await app().request("/api/organization/telegram-lock", patch("assistant", { locked: true }));
    expect({ status: lock.status, body: await lock.json() }).toEqual({ status: 403, body: { error: "owner_only" } });
    expect(await lockOf()).toBe(false);
    expect(await lockOf(org.otherOrgId)).toBe(false);
  });

  test("23. the repo writers filter by organization themselves: a scope-free db changes one row of a user in two organizations", async () => {
    await inTwoOrgs();
    expect(await setMemberTelegramDetail(db, { orgId: org.orgId }, org.assistantId, "minimal")).toBe("full");
    expect(await detailOf(org.assistantId)).toBe("minimal");
    expect(await detailOf(org.assistantId, org.otherOrgId)).toBe("full");
    expect(await setTelegramMinimalLocked(db, { orgId: org.orgId }, true)).toBe(false);
    expect(await lockOf()).toBe(true);
    expect(await lockOf(org.otherOrgId)).toBe(false);
  });
});

describe("the lock is read under a share lock", () => {
  // The owner's write holds the organization row in an open transaction. A link or a change that reads the lock without the share
  // lock sees the old value (not locked) and stores `full` after the owner has locked; with `FOR SHARE` it waits and sees the lock.
  const raceWithOpenLock = async <T>(run: () => Promise<T>): Promise<T> => {
    const pending = await db.transaction().execute(async (trx) => {
      await setTelegramMinimalLocked(trx, { orgId: org.orgId }, true);
      const result = run();
      const early = await Promise.race([
        result.then(() => "done"),
        new Promise((done) => setTimeout(done, 150, "waiting")),
      ]);
      expect(early).toBe("waiting");
      return { result };
    });
    return pending.result;
  };

  test("24. a link with full that meets the owner's open lock answers 409 and makes no token and no consent row", async () => {
    await flag(org.orgId, true);
    await setDetail(org.assistantId, "minimal");
    const res = await raceWithOpenLock(async () =>
      app().request("/api/channels/telegram/link", post("assistant", { ...CURRENT, detail: "full" }))
    );
    expect({ status: res.status, body: await res.json() }).toEqual({
      status: 409,
      body: { error: "telegram_detail_locked" },
    });
    expect(await tokens()).toEqual([]);
    expect(await auditOf("web.telegram_consent")).toEqual([]);
    expect(await detailOf(org.assistantId)).toBe("minimal");
  });

  test("25. a change to full that meets the owner's open lock is refused and stores nothing", async () => {
    await flag(org.orgId, true);
    await setDetail(org.assistantId, "minimal");
    const result = await raceWithOpenLock(() =>
      changeTelegramDetail(db, { orgId: org.orgId }, org.assistantId, { detail: "full", ...CURRENT }, NOW)
    );
    expect(result).toEqual({ kind: "locked" });
    expect(await detailOf(org.assistantId)).toBe("minimal");
    expect(await auditOf("web.telegram_consent")).toEqual([]);
  });
});

describe("the lock and the next notice", () => {
  test("19. locked: the next notice renders minimal while the member column stays full; unlocked: full again", async () => {
    await flag(org.orgId, true);
    await setDetail(org.ownerId, "full");
    const chatId = randomChatId();
    await db
      .insertInto("chat_links")
      .values({
        org_id: org.orgId,
        user_id: org.ownerId,
        channel: "telegram",
        external_chat_id: chatId,
        linked_at: new Date(NOW.getTime() - 30 * DAY_MS),
      })
      .execute();
    const ctx = { orgId: org.orgId };
    const mailboxId = randomUUID();
    const emailId = await db.transaction().execute(async (trx) => {
      await insertMailbox(trx, ctx, {
        id: mailboxId,
        address: `box-${mailboxId}@x.test`,
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: testCapabilities,
        folderMap: {},
      });
      return insertTestEmail(trx, ctx, mailboxId);
    });
    const noticeAfter = async (): Promise<{ text: string; buttons: number }> => {
      const id = await queueNotice(db, ctx, {
        userId: org.ownerId,
        locale: "en",
        kind: "urgent",
        dedupKey: `urgent:${randomUUID()}`,
        emailId,
        mailboxId,
        view: testNoticeView("urgent", { marker: "CANARY-LOCK-77", emailId, at: NOW }) as never,
        eventAt: NOW,
        now: NOW,
      });
      expect(id).toBeString();
      const channel = createFakeChannel();
      await createOutboxSender({ db, channel, now: () => NOW, webBaseUrl: TEST_ORIGIN }).run();
      const sent = channel.sent.find((entry) => entry.chatId === chatId)?.message;
      return { text: sent?.text ?? "", buttons: sent?.buttons.flat().length ?? -1 };
    };

    const before = await noticeAfter();
    expect(before.text).toContain("CANARY-LOCK-77");
    expect(before.buttons).toBeGreaterThan(0);

    expect((await app().request("/api/organization/telegram-lock", patch("owner", { locked: true }))).status).toBe(200);
    const locked = await noticeAfter();
    expect(locked.text).not.toContain("CANARY-LOCK-77");
    expect(locked.buttons).toBe(0);
    expect(await detailOf(org.ownerId)).toBe("full");

    expect((await app().request("/api/organization/telegram-lock", patch("owner", { locked: false }))).status).toBe(
      200
    );
    const unlocked = await noticeAfter();
    expect(unlocked.text).toContain("CANARY-LOCK-77");
    expect(unlocked.buttons).toBeGreaterThan(0);
  });
});
