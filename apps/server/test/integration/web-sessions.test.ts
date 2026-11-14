import { randomUUID } from "node:crypto";

import { sessionsSchema } from "@ea/core";
import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";

import { createOrganizationWithOwner, tenancyRoutes } from "../../src/modules/tenancy";
import { createAuth, listUserSessions, type AuthSessionRow } from "../../src/platform/auth";
import { setLogLevel } from "../../src/platform/log";
import { auditWebEvent, onboardingDeps, termsAcceptedHandler } from "../../src/web";

import { testDb } from "./helpers";
import { as, noBackupCodes, resetBody, webOrg, webTestApp, type WebOrg } from "./web-helpers";

const db = testDb();

const BASE_URL = "http://127.0.0.1:8080";
const PASSWORD = "correct-horse-battery-staple";
const off = { kind: "off", reason: "env_off" } as const;
const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0";

const resets: { userId: string; url: string }[] = [];
const handle = createAuth({
  databaseUrl: process.env.DATABASE_URL ?? "",
  baseUrl: BASE_URL,
  secret: "x".repeat(40),
  trustedOrigins: [BASE_URL],
  onEvent: auditWebEvent(db),
  onTermsAccepted: termsAcceptedHandler(db, () => new Date()),
  resetLinkTtlSeconds: 86_400,
  sendResetPassword: async (input) => {
    resets.push(input);
  },
});

const orgIds: string[] = [];
const userIds: string[] = [];
const orgs: WebOrg[] = [];

let logSpy: ReturnType<typeof spyOn>;
let errorSpy: ReturnType<typeof spyOn>;
let warnSpy: ReturnType<typeof spyOn>;

beforeAll(() => {
  logSpy = spyOn(console, "log").mockImplementation((): void => undefined);
  errorSpy = spyOn(console, "error").mockImplementation((): void => undefined);
  warnSpy = spyOn(console, "warn").mockImplementation((): void => undefined);
});

afterEach(async () => {
  setLogLevel("info");
  for (const orgId of orgIds) await db.deleteFrom("organizations").where("id", "=", orgId).execute();
  if (userIds.length > 0) await db.deleteFrom("users").where("id", "in", userIds).execute();
  orgIds.length = 0;
  userIds.length = 0;
  for (const org of orgs) await org.cleanup();
  orgs.length = 0;
});

afterAll(async () => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
  warnSpy.mockRestore();
  await handle.close();
  await db.destroy();
});

// A member with a password; returns a signed-in cookie per call of `signIn`.
async function createMember() {
  const email = `web-sessions-${randomUUID()}@x.test`;
  const { orgId, userId } = await createOrganizationWithOwner(db, {
    orgName: "Web sessions",
    timezone: "Europe/Warsaw",
    email,
    displayName: "Owner",
  });
  orgIds.push(orgId);
  userIds.push(userId);
  resets.length = 0;
  await handle.auth.api.requestPasswordReset({ body: { email, redirectTo: `${BASE_URL}/setup` } });
  const token = new URL(resets[0]?.url ?? "").pathname.split("/").pop() ?? "";
  await handle.auth.api.resetPassword({ body: resetBody(PASSWORD, token) });
  const signIn = async (headers: Record<string, string> = {}): Promise<string> => {
    const res = await handle.auth.api.signInEmail({
      body: { email, password: PASSWORD },
      headers: new Headers(headers),
      returnHeaders: true,
    });
    return (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  };
  return { email, orgId, userId, signIn };
}

async function auditRows(orgId: string, event: string) {
  return db.selectFrom("audit_log").selectAll().where("org_id", "=", orgId).where("event", "=", event).execute();
}

function authPost(path: string, cookie?: string): Promise<Response> {
  return handle.auth.handler(
    new Request(`${BASE_URL}/api/auth${path}`, {
      method: "POST",
      headers: { origin: BASE_URL, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: "{}",
    })
  );
}

describe("listUserSessions", () => {
  test("lists the live sessions of one user, with no token", async () => {
    const member = await createMember();
    const other = await createMember();
    await member.signIn({ "user-agent": FIREFOX_LINUX, "x-client-ip": "203.0.113.7" });
    await member.signIn();
    await other.signIn();

    const rows = await listUserSessions(handle, member.userId);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(
        ["createdAt", "expiresAt", "id", "ipAddress", "updatedAt", "userAgent"].sort()
      );
      expect(row).not.toHaveProperty("token");
    }
    const known = rows.find((row) => row.userAgent === FIREFOX_LINUX);
    expect(known?.ipAddress).toBe("203.0.113.7");
    // Better Auth stores "" for an unknown value: the list answers null.
    expect(rows.find((row) => row.userAgent === null)?.userAgent).toBeNull();

    const otherRows = await listUserSessions(handle, other.userId);
    expect(otherRows).toHaveLength(1);
    expect(rows.map((row) => row.id)).not.toContain(otherRows[0]?.id);
  });
});

describe("GET /api/me/sessions", () => {
  const NOW = new Date("2026-11-13T12:00:00.000Z");
  const row = (id: string, updatedAt: string, expiresAt: string): AuthSessionRow => ({
    id,
    userAgent: FIREFOX_LINUX,
    ipAddress: id === "old" ? null : "203.0.113.7",
    createdAt: new Date("2026-11-01T00:00:00.000Z"),
    updatedAt: new Date(updatedAt),
    expiresAt: new Date(expiresAt),
  });

  function appWith(sessions: (userId: string) => Promise<AuthSessionRow[]>, ownerId: string) {
    return webTestApp({
      db,
      sessions: { current: ownerId },
      routers: (api) =>
        api.route(
          "/",
          tenancyRoutes({
            db,
            now: () => NOW,
            scopes: { triage: off, actions: off, send: off },
            countMailboxes: async () => ({ total: 0, inAuthError: 0 }),
            operatorContact: null,
            sessions,
            backupCodesLeft: noBackupCodes,
            ...onboardingDeps(db, null),
          })
        ),
    });
  }

  test("drops an expired session, sorts newest first and marks the current one", async () => {
    const org = await webOrg(db);
    orgs.push(org);
    const asked: string[] = [];
    const app = appWith(async (userId) => {
      asked.push(userId);
      return [
        row("old", "2026-11-05T00:00:00.000Z", "2026-12-05T00:00:00.000Z"),
        row("expired", "2026-11-12T00:00:00.000Z", "2026-11-13T11:59:59.000Z"),
        row("current", "2026-11-13T08:00:00.000Z", "2026-12-13T00:00:00.000Z"),
      ];
    }, org.ownerId);

    const res = await app.request("/api/me/sessions", as("current"));
    expect(res.status).toBe(200);
    const body = sessionsSchema.parse(await res.json());
    expect(asked).toEqual([org.ownerId]);
    expect(body.sessions.map((s) => s.id)).toEqual(["current", "old"]);
    expect(body.sessions.map((s) => s.current)).toEqual([true, false]);
    expect(body.sessions[0]?.device).toEqual({ browser: "firefox", os: "linux" });
    expect(body.sessions[0]?.address).toBe("203.0.113.7");
    expect(body.sessions[1]?.address).toBeNull();
    expect(body.sessions[0]?.lastUsedAt).toBe("2026-11-13T08:00:00.000Z");
    expect(JSON.stringify(body)).not.toContain("token");
  });

  test("answers 401 with no session", async () => {
    const org = await webOrg(db);
    orgs.push(org);
    const res = await appWith(async () => [], org.ownerId).request("/api/me/sessions", as("nobody"));
    expect(res.status).toBe(401);
  });
});

describe("sign out everywhere: the audit rows", () => {
  test("/revoke-sessions writes one web.sessions_revoked row", async () => {
    const member = await createMember();
    const cookie = await member.signIn();
    await member.signIn();

    const res = await authPost("/revoke-sessions", cookie);
    expect(res.status).toBe(200);
    const rows = await auditRows(member.orgId, "web.sessions_revoked");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor).toBe(member.userId);
    expect(rows[0]?.data).toEqual({ via: "web" });
    expect(await listUserSessions(handle, member.userId)).toHaveLength(0);
  });

  test("/revoke-other-sessions writes one web.other_sessions_revoked row and keeps the caller's session", async () => {
    const member = await createMember();
    const cookie = await member.signIn();
    await member.signIn();

    const res = await authPost("/revoke-other-sessions", cookie);
    expect(res.status).toBe(200);
    const rows = await auditRows(member.orgId, "web.other_sessions_revoked");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor).toBe(member.userId);
    expect(rows[0]?.data).toEqual({ via: "web" });
    expect(await listUserSessions(handle, member.userId)).toHaveLength(1);
    expect(await auditRows(member.orgId, "web.sessions_revoked")).toHaveLength(0);
  });

  test("without a cookie both routes answer 401 and write no row", async () => {
    const member = await createMember();
    await member.signIn();

    expect((await authPost("/revoke-sessions")).status).toBe(401);
    expect((await authPost("/revoke-other-sessions")).status).toBe(401);
    expect(await auditRows(member.orgId, "web.sessions_revoked")).toHaveLength(0);
    expect(await auditRows(member.orgId, "web.other_sessions_revoked")).toHaveLength(0);
    expect(await listUserSessions(handle, member.userId)).toHaveLength(1);
  });
});

describe("logs", () => {
  test("sign-in, reset and the revoke routes put no password, token or reset link in a log line", async () => {
    logSpy.mockClear();
    errorSpy.mockClear();
    warnSpy.mockClear();

    const member = await createMember();
    const resetToken = new URL(resets[0]?.url ?? "").pathname.split("/").pop() ?? "";
    const cookie = await member.signIn();
    const otherCookie = await member.signIn();
    // A wrong password makes Better Auth log a warning: the capture sees real lines.
    await handle.auth.handler(
      new Request(`${BASE_URL}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { origin: BASE_URL, "content-type": "application/json" },
        body: JSON.stringify({ email: member.email, password: `wrong-${PASSWORD}` }),
      })
    );
    expect((await authPost("/revoke-other-sessions", cookie)).status).toBe(200);
    expect((await authPost("/revoke-sessions", cookie)).status).toBe(200);

    // The session token is the cookie value before the signature dot.
    const sessionTokens = [cookie, otherCookie].map(
      (value) => decodeURIComponent(value.split("=")[1] ?? "").split(".")[0] ?? ""
    );
    const secrets = [PASSWORD, `wrong-${PASSWORD}`, resetToken, ...sessionTokens, member.email];
    for (const secret of secrets) expect(secret.length).toBeGreaterThan(10);

    const lines = [...logSpy.mock.calls, ...errorSpy.mock.calls, ...warnSpy.mock.calls].map((call) => call.join(" "));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toContain("reset-password/");
      for (const secret of secrets) expect(line).not.toContain(secret);
    }
  });
});
