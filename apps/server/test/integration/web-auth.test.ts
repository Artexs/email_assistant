import { randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import { sql } from "kysely";

import { createOrganizationWithOwner } from "../../src/modules/tenancy";
import { insertUser } from "../../src/modules/tenancy/repo";
import { createAuth, type AuthHandle } from "../../src/platform/auth";
import { setLogLevel } from "../../src/platform/log";
import { auditWebEvent } from "../../src/web";

import { testDb } from "./helpers";

const db = testDb();

const BASE_URL = "http://127.0.0.1:8080";
const PASSWORD = "correct-horse-battery-staple";
const OTHER_PASSWORD = "another-long-passphrase-42";

interface ResetMail {
  userId: string;
  url: string;
}

const resets: ResetMail[] = [];
const handle = createAuth({
  databaseUrl: process.env.DATABASE_URL ?? "",
  baseUrl: BASE_URL,
  secret: "x".repeat(40),
  trustedOrigins: [],
  onEvent: auditWebEvent(db),
  sendResetPassword: async (input) => {
    resets.push(input);
  },
});
const { auth } = handle;
const extraHandles: AuthHandle[] = [];

const orgIds: string[] = [];
const userIds: string[] = [];
const tokens: string[] = [];

afterEach(async () => {
  setLogLevel("info");
  if (tokens.length > 0) {
    await sql`DELETE FROM auth_verifications WHERE value IN (${sql.join(tokens)})`.execute(db);
  }
  for (const orgId of orgIds) {
    await db.deleteFrom("organizations").where("id", "=", orgId).execute();
  }
  if (userIds.length > 0) {
    await db.deleteFrom("users").where("id", "in", userIds).execute();
  }
  orgIds.length = 0;
  userIds.length = 0;
  tokens.length = 0;
  resets.length = 0;
});

afterAll(async () => {
  await handle.close();
  for (const extra of extraHandles) {
    await extra.close();
  }
  await db.destroy();
});

async function createOwner() {
  const email = `web-auth-${randomUUID()}@x.test`;
  const { orgId, userId } = await createOrganizationWithOwner(db, {
    orgName: "Web auth",
    timezone: "Europe/Warsaw",
    email,
    displayName: "Owner",
  });
  orgIds.push(orgId);
  userIds.push(userId);
  return { email, orgId, userId };
}

async function requestReset(authInstance: typeof auth, email: string): Promise<{ userId: string; token: string }> {
  resets.length = 0;
  await authInstance.api.requestPasswordReset({
    body: { email: email.toUpperCase(), redirectTo: `${BASE_URL}/setup` },
  });
  const mail = resets[0];
  if (!mail) {
    throw new Error("no reset mail captured");
  }
  expect(mail.url.startsWith(`${BASE_URL}/api/auth/reset-password/`)).toBe(true);
  const token = new URL(mail.url).pathname.split("/").pop() ?? "";
  tokens.push(token);
  return { userId: mail.userId, token };
}

async function setPassword(email: string, password: string): Promise<{ userId: string; token: string }> {
  const reset = await requestReset(auth, email);
  await auth.api.resetPassword({ body: { newPassword: password, token: reset.token } });
  return reset;
}

async function signIn(email: string, password: string) {
  return auth.api.signInEmail({ body: { email: email.toUpperCase(), password }, returnHeaders: true });
}

async function auditRows(orgId: string, event: string) {
  return db.selectFrom("audit_log").selectAll().where("org_id", "=", orgId).where("event", "=", event).execute();
}

async function countRows(table: "auth_sessions" | "auth_accounts", userId: string): Promise<number> {
  const result = await sql<{
    n: string;
  }>`SELECT count(*) AS n FROM ${sql.table(table)} WHERE user_id = ${userId}`.execute(db);
  return Number(result.rows[0]?.n);
}

async function errorCode(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return (error as { body?: { code?: unknown } }).body?.code;
  }
  throw new Error("did not throw");
}

describe("web auth", () => {
  test("the first password comes from a reset link and is audited once", async () => {
    const { email, orgId, userId } = await createOwner();
    const reset = await requestReset(auth, email);
    expect(reset.userId).toBe(userId);

    await auth.api.resetPassword({ body: { newPassword: PASSWORD, token: reset.token } });

    const accounts = await sql<{ provider_id: string; password: string | null }>`
      SELECT provider_id, password FROM auth_accounts WHERE user_id = ${userId}`.execute(db);
    expect(accounts.rows).toHaveLength(1);
    expect(accounts.rows[0]?.provider_id).toBe("credential");
    expect(accounts.rows[0]?.password).toBeTruthy();

    const rows = await auditRows(orgId, "web.password_set");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor).toBe(userId);
    expect(rows[0]?.data).toEqual({ via: "web" });

    expect(await errorCode(auth.api.resetPassword({ body: { newPassword: PASSWORD, token: reset.token } }))).toBe(
      "INVALID_TOKEN"
    );
  });

  test("sign-in sets the session cookie and writes web.login", async () => {
    const { email, orgId, userId } = await createOwner();
    await setPassword(email, PASSWORD);

    const { headers, response } = await signIn(email, PASSWORD);
    expect(response.user.id).toBe(userId);
    const cookie = headers.get("set-cookie") ?? "";
    expect(cookie).toContain("ea.session_token=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain("Secure");
    expect(await auditRows(orgId, "web.login")).toHaveLength(1);

    expect(await errorCode(signIn(email, "wrong-password-123456"))).toBe("INVALID_EMAIL_OR_PASSWORD");
    expect(await errorCode(signIn(`nobody-${randomUUID()}@x.test`, PASSWORD))).toBe("INVALID_EMAIL_OR_PASSWORD");
    expect(await auditRows(orgId, "web.login")).toHaveLength(1);
  });

  test("a password change ends the other sessions and writes one web.password_changed", async () => {
    const { email, orgId, userId } = await createOwner();
    await setPassword(email, PASSWORD);
    const first = await signIn(email, PASSWORD);
    await signIn(email, PASSWORD);
    expect(await countRows("auth_sessions", userId)).toBe(2);

    const cookie = (first.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    await auth.api.changePassword({
      body: { currentPassword: PASSWORD, newPassword: OTHER_PASSWORD, revokeOtherSessions: true },
      headers: new Headers({ cookie }),
    });

    expect(await countRows("auth_sessions", userId)).toBe(1);
    expect(await auditRows(orgId, "web.password_changed")).toHaveLength(1);
    expect(await auditRows(orgId, "web.login")).toHaveLength(2);
  });

  test("a later reset ends every session", async () => {
    const { email, orgId, userId } = await createOwner();
    await setPassword(email, PASSWORD);
    await signIn(email, PASSWORD);
    expect(await countRows("auth_sessions", userId)).toBe(1);

    await setPassword(email, OTHER_PASSWORD);

    expect(await countRows("auth_sessions", userId)).toBe(0);
    expect(await auditRows(orgId, "web.password_set")).toHaveLength(2);
    expect(await countRows("auth_accounts", userId)).toBe(1);
  });

  test("sign-up is closed", async () => {
    const email = `nope-${randomUUID()}@x.test`;
    expect(await errorCode(auth.api.signUpEmail({ body: { email, password: PASSWORD, name: "N" } }))).toBe(
      "EMAIL_PASSWORD_SIGN_UP_DISABLED"
    );
    const rows = await db.selectFrom("users").select("id").where("email", "=", email).execute();
    expect(rows).toHaveLength(0);
  });

  test("a user without an organization resets the password and gets a log line but no audit row", async () => {
    const email = `web-auth-${randomUUID()}@x.test`;
    const { id: userId } = await insertUser(db, { email, displayName: "Loner" });
    userIds.push(userId);
    const errorSpy = spyOn(console, "error").mockImplementation((): void => undefined);
    try {
      await setPassword(email, PASSWORD);
      const lines = errorSpy.mock.calls.map((call) => call.join(" "));
      expect(lines.some((line) => line.includes(`web: no organization for user ${userId}`))).toBe(true);
    } finally {
      errorSpy.mockRestore();
    }
    const rows = await db.selectFrom("audit_log").select("id").where("actor", "=", userId).execute();
    expect(rows).toHaveLength(0);
  });

  test("the password length is checked", async () => {
    const { email } = await createOwner();
    const reset = await requestReset(auth, email);
    expect(await errorCode(auth.api.resetPassword({ body: { newPassword: "short", token: reset.token } }))).toBe(
      "PASSWORD_TOO_SHORT"
    );
    expect(
      await errorCode(auth.api.resetPassword({ body: { newPassword: "x".repeat(129), token: reset.token } }))
    ).toBe("PASSWORD_TOO_LONG");
  });

  test("an onEvent failure does not fail the login", async () => {
    const { email } = await createOwner();
    await setPassword(email, PASSWORD);
    const failing = createAuth({
      databaseUrl: process.env.DATABASE_URL ?? "",
      baseUrl: BASE_URL,
      secret: "x".repeat(40),
      trustedOrigins: [],
      onEvent: async () => {
        throw new Error("boom");
      },
    });
    extraHandles.push(failing);
    const errorSpy = spyOn(console, "error").mockImplementation((): void => undefined);
    try {
      const { response } = await failing.auth.api.signInEmail({
        body: { email: email.toUpperCase(), password: PASSWORD },
        returnHeaders: true,
      });
      expect(response.user.email).toBe(email);
      const lines = errorSpy.mock.calls.map((call) => call.join(" "));
      expect(lines.some((line) => line.includes("web: onEvent login failed: Error"))).toBe(true);
      expect(lines.some((line) => line.includes("boom"))).toBe(false);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
