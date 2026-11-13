import { randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import { sql } from "kysely";

import { createOrganizationWithOwner } from "../../src/modules/tenancy";
import { createAuth } from "../../src/platform/auth";
import { setLogLevel } from "../../src/platform/log";
import { auditWebEvent, termsAcceptedHandler } from "../../src/web";

import { testDb } from "./helpers";
import { resetBody } from "./web-helpers";

const db = testDb();

const BASE_URL = "http://127.0.0.1:8080";

const run = randomUUID();
const MARKERS = {
  email: `marker-${run}@x.test`,
  password: `MARKER-PASSWORD-${run}-long`,
  newPassword: `MARKER-NEWPASS-${run}-long`,
  secret: `MARKER-SECRET-${run}-padded-to-forty-chars`,
};

const orgIds: string[] = [];
const userIds: string[] = [];
const closers: (() => Promise<void>)[] = [];

afterEach(async () => {
  setLogLevel("info");
  if (userIds.length > 0) {
    await sql`DELETE FROM auth_verifications WHERE value IN (${sql.join(userIds)})`.execute(db);
  }
  for (const orgId of orgIds) {
    await db.deleteFrom("organizations").where("id", "=", orgId).execute();
  }
  if (userIds.length > 0) {
    await db.deleteFrom("users").where("id", "in", userIds).execute();
  }
  orgIds.length = 0;
  userIds.length = 0;
});

afterAll(async () => {
  for (const close of closers) {
    await close();
  }
  await db.destroy();
});

function make(sendResetPassword?: (input: { userId: string; url: string }) => Promise<void>) {
  const handle = createAuth({
    databaseUrl: process.env.DATABASE_URL ?? "",
    baseUrl: BASE_URL,
    secret: MARKERS.secret,
    trustedOrigins: [BASE_URL],
    onEvent: auditWebEvent(db),
    onTermsAccepted: termsAcceptedHandler(db, () => new Date()),
    resetLinkTtlSeconds: 86_400,
    ...(sendResetPassword ? { sendResetPassword } : {}),
  });
  closers.push(handle.close);
  return handle.auth;
}

async function createOwner() {
  const { orgId, userId } = await createOrganizationWithOwner(db, {
    orgName: "Web auth logs",
    timezone: "Europe/Warsaw",
    email: MARKERS.email,
    displayName: "Owner",
  });
  orgIds.push(orgId);
  userIds.push(userId);
  return userId;
}

function tokenOf(url: string): string {
  return new URL(url).pathname.split("/").pop() ?? "";
}

describe("web auth logs", () => {
  test("no log line holds an address, a password, the secret, a token, a cookie or a link", async () => {
    const logSpy = spyOn(console, "log").mockImplementation((): void => undefined);
    const errorSpy = spyOn(console, "error").mockImplementation((): void => undefined);
    setLogLevel("debug");
    const forbidden: string[] = [
      MARKERS.email,
      MARKERS.email.toUpperCase(),
      MARKERS.password,
      MARKERS.newPassword,
      MARKERS.secret,
      "reset-password/",
      "callbackURL",
    ];
    let lines: string[] = [];
    let userId = "";
    try {
      userId = await createOwner();
      const captured: string[] = [];
      const auth = make(async ({ url }) => {
        captured.push(url);
      });
      const redirectTo = `${BASE_URL}/setup`;

      // The CLI path: the callback captures the link.
      await auth.api.requestPasswordReset({ body: { email: MARKERS.email, redirectTo } });
      const token = tokenOf(captured[0] ?? "");
      forbidden.push(token);
      await auth.api.resetPassword({ body: resetBody(MARKERS.password, token) });

      const { headers } = await auth.api.signInEmail({
        body: { email: MARKERS.email.toUpperCase(), password: MARKERS.password },
        returnHeaders: true,
      });
      const cookieValue = decodeURIComponent((headers.get("set-cookie") ?? "").split(";")[0]?.split("=")[1] ?? "");
      expect(cookieValue.length).toBeGreaterThan(10);
      forbidden.push(cookieValue, cookieValue.split(".")[0] ?? "");

      // A second session, then the password change: the only call with two passwords in one body.
      const second = await auth.api.signInEmail({
        body: { email: MARKERS.email, password: MARKERS.password },
        returnHeaders: true,
      });
      const secondCookie = decodeURIComponent(
        (second.headers.get("set-cookie") ?? "").split(";")[0]?.split("=")[1] ?? ""
      );
      expect(secondCookie.length).toBeGreaterThan(10);
      forbidden.push(secondCookie, secondCookie.split(".")[0] ?? "");
      if (second.response.token) {
        forbidden.push(second.response.token);
      }
      const cookiePair = (headers.get("set-cookie") ?? "").split(";")[0] ?? "";
      const changed = await auth.api.changePassword({
        body: { currentPassword: MARKERS.password, newPassword: MARKERS.newPassword, revokeOtherSessions: true },
        headers: new Headers({ cookie: cookiePair }),
      });
      expect(changed.token).toBeTruthy();
      forbidden.push(changed.token ?? "");

      await auth.api.signInEmail({ body: { email: MARKERS.email, password: `wrong-${MARKERS.password}` } }).then(
        () => {
          throw new Error("the wrong password signed in");
        },
        () => undefined
      );

      // The default sender: no callback, so the server logs its own line.
      const defaultAuth = make();
      await defaultAuth.api.requestPasswordReset({ body: { email: MARKERS.email, redirectTo } });
      lines = [...logSpy.mock.calls, ...errorSpy.mock.calls].map((call) => call.join(" "));
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      for (const value of forbidden) {
        expect(line).not.toContain(value);
      }
    }
    expect(lines.some((line) => line.includes(`password_reset_requested user_id=${userId}`))).toBe(true);
    // This line comes from the sign-in route (`logger.warn`), not from the onAPIError hook, which stays silent on a 4xx.
    expect(lines.some((line) => line.includes("better_auth_log reason=invalid_password"))).toBe(true);

    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    let found = 0;
    for (const line of lines) {
      for (const match of line.matchAll(/user_id=(\S+)/g)) {
        expect(match[1]).toMatch(uuid);
        found += 1;
      }
    }
    expect(found).toBeGreaterThan(0);
  });
});
