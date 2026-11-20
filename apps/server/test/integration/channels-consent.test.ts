import { format } from "node:util";

import { OPEN_LOOPS_CONSENT_SINCE, TELEGRAM_CONSENT_VERSION, consentCovers, MINUTE_MS } from "@ea/core";
import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import type { Hono } from "hono";
import type { Transaction } from "kysely";

import { auditEvents, recordAudit } from "../../src/modules/audit";
import { channelRoutes, consentVersionsOf } from "../../src/modules/channels";
import type { Db, DB } from "../../src/platform/db";
import type { ApiEnv } from "../../src/platform/http";
import { setLogLevel } from "../../src/platform/log";

import { createOrgWithMailbox, randomChatId } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { as, webOrg, webTestApp, type WebOrg } from "./web-helpers";

// The consent gate of the open loops. The repo tests run without `app.org_id`: only the `org_id`
// filter of the query separates the organizations.
const db = testDb();
const NOW = new Date("2026-11-15T12:00:00.000Z");
const F109_VERSION = "2026-11-15";
const OLD_AT = new Date("2026-11-14T08:00:00.000Z");
const NO_USER = "00000000-0000-4000-8000-000000000000";

const orgs: WebOrg[] = [];

afterEach(async () => {
  setLogLevel("info");
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
    sessions: { owner: org.ownerId, assistant: org.assistantId, "other-owner": org.otherOwnerId },
    routers: (api: Hono<ApiEnv>) =>
      api.route("/", channelRoutes({ db, now: () => NOW, botUsername: async () => "fake_ea_bot" })),
  });
  return { org, app };
}

const CONSENT = "/api/telegram/consent";

async function consentRow(
  conn: Db | Transaction<DB>,
  orgId: string,
  actor: string,
  version: string | null,
  at: Date
): Promise<void> {
  await recordAudit(
    conn,
    { orgId },
    {
      event: auditEvents.webTelegramConsent,
      actor,
      data: version === null ? { via: "web" } : { via: "web", version },
      at,
    }
  );
}

const covered = (version: string | undefined): boolean => consentCovers(version ?? null, OPEN_LOOPS_CONSENT_SINCE);

describe("consentVersionsOf (repo)", () => {
  test("T1 an F109 consent is not covered; the confirm route covers it", async () => {
    const { org, app } = await setup();
    await consentRow(db, org.orgId, org.ownerId, F109_VERSION, OLD_AT);
    const before = await consentVersionsOf(db, { orgId: org.orgId }, [org.ownerId]);
    expect(before.get(org.ownerId)).toBe(F109_VERSION);
    expect(covered(before.get(org.ownerId) ?? undefined)).toBe(false);

    const res = await app.request(
      CONSENT,
      as("owner", { method: "POST", body: { version: TELEGRAM_CONSENT_VERSION } })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: TELEGRAM_CONSENT_VERSION });

    const after = await consentVersionsOf(db, { orgId: org.orgId }, [org.ownerId]);
    expect(after.get(org.ownerId)).toBe(TELEGRAM_CONSENT_VERSION);
    expect(covered(after.get(org.ownerId) ?? undefined)).toBe(true);
    const rows = await db
      .selectFrom("audit_log")
      .selectAll()
      .where("org_id", "=", org.orgId)
      .where("event", "=", "web.telegram_consent")
      .execute();
    expect(rows).toHaveLength(2);
    const newest = rows.find((row) => (row.data as { version: string }).version === TELEGRAM_CONSENT_VERSION);
    expect(newest?.actor).toBe(org.ownerId);
    expect(newest?.data).toEqual({ via: "web", version: TELEGRAM_CONSENT_VERSION });
  });

  test("T3 a user with no consent row, or a row with no version, is null and not covered", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const ctx = { orgId: a.orgId };
      const noRow = await consentVersionsOf(trx, ctx, [a.userId]);
      expect(noRow.get(a.userId)).toBeNull();
      expect(covered(noRow.get(a.userId) ?? undefined)).toBe(false);
      await consentRow(trx, a.orgId, a.userId, null, OLD_AT);
      expect((await consentVersionsOf(trx, ctx, [a.userId])).get(a.userId)).toBeNull();
      expect((await consentVersionsOf(trx, ctx, [])).size).toBe(0);
    });
  });

  test("the newest row wins, also when an older row has a later version; each user gets their own", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const ctx = { orgId: a.orgId };
      await consentRow(trx, a.orgId, a.userId, "2026-11-20", new Date("2026-11-01T00:00:00Z"));
      await consentRow(trx, a.orgId, a.userId, F109_VERSION, new Date("2026-11-02T00:00:00Z"));
      const versions = await consentVersionsOf(trx, ctx, [a.userId, NO_USER]);
      expect(versions.get(a.userId)).toBe(F109_VERSION);
      expect(versions.get(NO_USER)).toBeNull();
      // A later row of another event with a version in its data is ignored.
      await recordAudit(trx, ctx, {
        event: auditEvents.webLogin,
        actor: a.userId,
        data: { version: "2099-01-01" },
        at: new Date("2026-11-03T00:00:00Z"),
      });
      expect((await consentVersionsOf(trx, ctx, [a.userId])).get(a.userId)).toBe(F109_VERSION);
    });
  });

  test("a row of another organization is never read", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      // B holds current rows for its own user and for A's user id; A holds none.
      await consentRow(trx, b.orgId, b.userId, TELEGRAM_CONSENT_VERSION, OLD_AT);
      await consentRow(trx, b.orgId, a.userId, TELEGRAM_CONSENT_VERSION, OLD_AT);
      const inA = await consentVersionsOf(trx, { orgId: a.orgId }, [a.userId, b.userId]);
      expect(inA.get(a.userId)).toBeNull();
      expect(inA.get(b.userId)).toBeNull();
      const inB = await consentVersionsOf(trx, { orgId: b.orgId }, [b.userId]);
      expect(inB.get(b.userId)).toBe(TELEGRAM_CONSENT_VERSION);
    });
  });
});

describe("POST /api/telegram/consent", () => {
  test("T2 an old, empty or missing version is refused and writes no row", async () => {
    const { org, app } = await setup();
    // Older, newer and garbage versions: only the current version is accepted.
    for (const version of [F109_VERSION, "2000-01-01", "2026-11-15.1", "2099-01-01", "2026-11-15.3", "zzzz"]) {
      const res = await app.request(CONSENT, as("owner", { method: "POST", body: { version } }));
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "telegram_consent_outdated" });
    }
    for (const body of [{}, { version: "" }, { version: "x".repeat(33) }]) {
      expect((await app.request(CONSENT, as("owner", { method: "POST", body }))).status).toBe(400);
    }
    expect((await app.request(CONSENT, as("owner", { method: "POST" }))).status).toBe(400);
    const rows = await db
      .selectFrom("audit_log")
      .select("id")
      .where("org_id", "=", org.orgId)
      .where("event", "=", "web.telegram_consent")
      .execute();
    expect(rows).toHaveLength(0);
  });

  test("T4 the row belongs to the session user; a user id in the body is ignored; another org stays apart", async () => {
    const { org, app } = await setup();
    const res = await app.request(
      CONSENT,
      as("assistant", { method: "POST", body: { version: TELEGRAM_CONSENT_VERSION, userId: org.ownerId } })
    );
    expect(res.status).toBe(200);
    const ctx = { orgId: org.orgId };
    const versions = await consentVersionsOf(db, ctx, [org.ownerId, org.assistantId]);
    expect(versions.get(org.assistantId)).toBe(TELEGRAM_CONSENT_VERSION);
    expect(versions.get(org.ownerId)).toBeNull();
    // The owner of the other organization confirms: nothing appears in the first organization.
    const other = await app.request(
      CONSENT,
      as("other-owner", { method: "POST", body: { version: TELEGRAM_CONSENT_VERSION } })
    );
    expect(other.status).toBe(200);
    expect((await consentVersionsOf(db, ctx, [org.otherOwnerId])).get(org.otherOwnerId)).toBeNull();
    const inSecond = await consentVersionsOf(db, { orgId: org.otherOrgId }, [org.otherOwnerId]);
    expect(inSecond.get(org.otherOwnerId)).toBe(TELEGRAM_CONSENT_VERSION);
  });

  test("needs a session and an Origin", async () => {
    const { app } = await setup();
    const body = JSON.stringify({ version: TELEGRAM_CONSENT_VERSION });
    const noCookie = await app.request(CONSENT, {
      method: "POST",
      headers: { origin: "http://127.0.0.1:8080", "content-type": "application/json" },
      body,
    });
    expect(noCookie.status).toBe(401);
    const noOrigin = await app.request(CONSENT, {
      method: "POST",
      headers: { cookie: "ea.session_token=owner", "content-type": "application/json" },
      body,
    });
    expect(noOrigin.status).toBe(403);
  });

  test("the log line holds the user id and nothing else", async () => {
    const { org, app } = await setup();
    const logSpy = spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
    let lines: string[];
    try {
      await app.request(CONSENT, as("owner", { method: "POST", body: { version: TELEGRAM_CONSENT_VERSION } }));
      lines = [...logSpy.mock.calls, ...errorSpy.mock.calls].map((call) => format(...call));
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
    const line = lines.find((l) => l.includes("telegram_consent_confirmed"));
    expect(line).toMatch(
      new RegExp(`^\\[channels\\] telegram_consent_confirmed request_id=\\S+ user_id=${org.ownerId}$`)
    );
  });
});

describe("GET /api/channels/telegram consentVersion (F116 stage 22)", () => {
  const STATE = "/api/channels/telegram";
  // `linkChat` takes a transaction; the route reads committed rows, so the chat link is written on the connection of the test.
  const link = async (orgId: string, userId: string, linkedAt: Date): Promise<void> => {
    await db
      .insertInto("chat_links")
      .values({
        org_id: orgId,
        user_id: userId,
        channel: "telegram",
        external_chat_id: randomChatId(),
        linked_at: linkedAt,
      })
      .execute();
  };
  const stateOf = async (app: Awaited<ReturnType<typeof setup>>["app"], who: "owner" | "assistant") =>
    (await (await app.request(STATE, as(who))).json()) as { linked: boolean; consentVersion: string | null };

  test("T4 an old version, the confirmed version, no row, an unlink and a CLI link", async () => {
    const { org, app } = await setup();
    // Not linked: null, also with a consent row.
    await consentRow(db, org.orgId, org.ownerId, F109_VERSION, OLD_AT);
    expect(await stateOf(app, "owner")).toMatchObject({ linked: false, consentVersion: null });

    // Linked with the old row: the old version shows.
    await link(org.orgId, org.ownerId, OLD_AT);
    expect(await stateOf(app, "owner")).toMatchObject({ linked: true, consentVersion: F109_VERSION });
    // A user linked by the CLI has no consent row: null.
    await link(org.orgId, org.assistantId, OLD_AT);
    expect(await stateOf(app, "assistant")).toMatchObject({ linked: true, consentVersion: null });

    // The confirm route moves the owner to the current version and leaves the other user alone.
    const confirm = await app.request(
      CONSENT,
      as("owner", { method: "POST", body: { version: TELEGRAM_CONSENT_VERSION } })
    );
    expect(confirm.status).toBe(200);
    expect(await stateOf(app, "owner")).toMatchObject({ consentVersion: TELEGRAM_CONSENT_VERSION });
    expect(await stateOf(app, "assistant")).toMatchObject({ consentVersion: null });

    // An unlink withdraws the consent: after a CLI link the old row does not count.
    expect((await app.request("/api/channels/telegram/link", as("owner", { method: "DELETE" }))).status).toBe(204);
    await link(org.orgId, org.ownerId, new Date(NOW.getTime() + MINUTE_MS));
    expect(await stateOf(app, "owner")).toMatchObject({ linked: true, consentVersion: null });
  });
});
