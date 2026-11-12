import { randomInt, randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { sql } from "kysely";

import { createOrganizationWithOwner } from "../../src/modules/tenancy";
import { createAuth, type AuthHandle } from "../../src/platform/auth";
import { setLogLevel } from "../../src/platform/log";
import type { PwnedResult } from "../../src/platform/pwned";
import { auditWebEvent, termsAcceptedHandler } from "../../src/web";

import { testDb } from "./helpers";
import { resetBody } from "./web-helpers";

const db = testDb();

const BASE_URL = "http://127.0.0.1:8080";
const PASSWORD = "correct-horse-battery-staple";
const LISTED = "password1234";
const GOOD = "another-long-passphrase-42";

const resets: { userId: string; url: string }[] = [];
const checked: string[] = [];
let verdict: (password: string) => PwnedResult = (password) => (password === LISTED ? "pwned" : "ok");

const makeHandle = (withCheck: boolean): AuthHandle =>
  createAuth({
    databaseUrl: process.env.DATABASE_URL ?? "",
    baseUrl: BASE_URL,
    secret: "x".repeat(40),
    trustedOrigins: [BASE_URL],
    onEvent: auditWebEvent(db),
    onTermsAccepted: termsAcceptedHandler(db, () => new Date()),
    resetLinkTtlSeconds: 3_600,
    sendResetPassword: async (input) => {
      resets.push(input);
    },
    ...(withCheck
      ? {
          pwnedCheck: async (password: string) => {
            checked.push(password);
            return verdict(password);
          },
        }
      : {}),
  });

const handle = makeHandle(true);
const plainHandle = makeHandle(false);

const orgIds: string[] = [];
const userIds: string[] = [];

let logSpies: ReturnType<typeof spyOn>[] = [];

beforeAll(() => {
  logSpies = [
    spyOn(console, "log").mockImplementation((): void => undefined),
    spyOn(console, "error").mockImplementation((): void => undefined),
    spyOn(console, "warn").mockImplementation((): void => undefined),
  ];
});

afterEach(async () => {
  setLogLevel("info");
  resets.length = 0;
  checked.length = 0;
  verdict = (password) => (password === LISTED ? "pwned" : "ok");
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
  for (const spy of logSpies) spy.mockRestore();
  await handle.close();
  await plainHandle.close();
  await db.destroy();
});

// A fresh client address per request, so the Better Auth rate limit never answers.
const nextIp = () => `10.${randomInt(1, 250)}.${randomInt(1, 250)}.${randomInt(1, 250)}`;

function post(via: AuthHandle, path: string, body: unknown, cookie?: string): Promise<Response> {
  return via.auth.handler(
    new Request(`${BASE_URL}/api/auth/${path}`, {
      method: "POST",
      headers: {
        origin: BASE_URL,
        "content-type": "application/json",
        "x-client-ip": nextIp(),
        ...(cookie === undefined ? {} : { cookie }),
      },
      body: JSON.stringify(body),
    })
  );
}

async function resetToken(email: string): Promise<string> {
  resets.length = 0;
  await handle.auth.api.requestPasswordReset({ body: { email, redirectTo: `${BASE_URL}/setup` } });
  const mail = resets[0];
  if (!mail) throw new Error("no reset mail captured");
  return new URL(mail.url).pathname.split("/").pop() ?? "";
}

// A user whose password is PASSWORD (set through the handle without a check on a good password).
async function createOwner() {
  const email = `pwned-${randomUUID()}@x.test`;
  const { orgId, userId } = await createOrganizationWithOwner(db, {
    orgName: "Pwned",
    timezone: "Europe/Warsaw",
    email,
    displayName: "Owner",
  });
  orgIds.push(orgId);
  userIds.push(userId);
  const token = await resetToken(email);
  await handle.auth.api.resetPassword({ body: resetBody(PASSWORD, token) });
  checked.length = 0;
  return { email, userId };
}

const signIn = (email: string, password: string, via: AuthHandle = handle) =>
  post(via, "sign-in/email", { email, password });

async function code(response: Response): Promise<unknown> {
  return ((await response.json()) as { code?: unknown }).code;
}

describe("leaked-password check", () => {
  test("a reset with a listed password is refused; the old password works; the token still works", async () => {
    const { email } = await createOwner();
    const token = await resetToken(email);
    const refused = await post(handle, "reset-password", resetBody(LISTED, token));
    expect(refused.status).toBe(400);
    expect(await code(refused)).toBe("PASSWORD_COMPROMISED");
    expect((await signIn(email, PASSWORD)).status).toBe(200);
    expect((await signIn(email, LISTED)).status).toBe(401);
    const accepted = await post(handle, "reset-password", resetBody(GOOD, token));
    expect(accepted.status).toBe(200);
    expect((await signIn(email, GOOD)).status).toBe(200);
  });

  test("change password with a listed password is refused; the old password works", async () => {
    const { email } = await createOwner();
    const session = await signIn(email, PASSWORD);
    const cookie = (session.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    expect(cookie).toContain("ea.session_token");
    const refused = await post(handle, "change-password", { currentPassword: PASSWORD, newPassword: LISTED }, cookie);
    expect(refused.status).toBe(400);
    expect(await code(refused)).toBe("PASSWORD_COMPROMISED");
    expect((await signIn(email, PASSWORD)).status).toBe(200);
    expect((await signIn(email, LISTED)).status).toBe(401);
    const accepted = await post(handle, "change-password", { currentPassword: PASSWORD, newPassword: GOOD }, cookie);
    expect(accepted.status).toBe(200);
  });

  test("an unavailable check answers 503 and changes nothing", async () => {
    const { email } = await createOwner();
    const token = await resetToken(email);
    verdict = () => "unavailable";
    const answer = await post(handle, "reset-password", resetBody(GOOD, token));
    expect(answer.status).toBe(503);
    expect(await code(answer)).toBe("PASSWORD_CHECK_UNAVAILABLE");
    expect((await signIn(email, PASSWORD)).status).toBe(200);
    expect((await signIn(email, GOOD)).status).toBe(401);
  });

  test("a 5-character password is refused as too short and the check is not called", async () => {
    const { email } = await createOwner();
    const token = await resetToken(email);
    const answer = await post(handle, "reset-password", resetBody("short", token));
    expect(answer.status).toBe(400);
    expect(await code(answer)).toBe("PASSWORD_TOO_SHORT");
    expect(checked).toEqual([]);
  });

  test("a good password reaches the check once and is accepted", async () => {
    const { email } = await createOwner();
    const token = await resetToken(email);
    const answer = await post(handle, "reset-password", resetBody(GOOD, token));
    expect(answer.status).toBe(200);
    expect(checked).toEqual([GOOD]);
  });

  // N-c: no outside call for a request that the endpoint refuses anyway.
  test("an anonymous change-password and a reset with an invalid or expired token make no check call", async () => {
    const { email } = await createOwner();
    const anonymous = await post(handle, "change-password", { currentPassword: PASSWORD, newPassword: GOOD });
    expect(anonymous.status).toBe(401);
    const invalid = await post(handle, "reset-password", resetBody(GOOD, "not-a-token"));
    expect(invalid.status).toBe(400);
    expect(await code(invalid)).toBe("INVALID_TOKEN");
    const noToken = await post(handle, "reset-password", {
      newPassword: GOOD,
      termsVersion: resetBody(GOOD, "x").termsVersion,
    });
    expect(noToken.status).toBe(400);
    expect(await code(noToken)).toBe("INVALID_TOKEN");
    const expired = await resetToken(email);
    await sql`UPDATE auth_verifications SET expires_at = now() - interval '1 minute' WHERE value = ${userIds[0]}`.execute(
      db
    );
    const late = await post(handle, "reset-password", resetBody(GOOD, expired));
    expect(late.status).toBe(400);
    expect(await code(late)).toBe("INVALID_TOKEN");
    expect(checked).toEqual([]);
    // The same requests with a session and a live token still reach the check.
    const session = await signIn(email, PASSWORD);
    const cookie = (session.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    await post(handle, "change-password", { currentPassword: PASSWORD, newPassword: GOOD }, cookie);
    await post(handle, "reset-password", resetBody(GOOD, await resetToken(email)));
    expect(checked).toEqual([GOOD, GOOD]);
  });

  test("without pwnedCheck a listed 12+ character password is accepted (old behaviour)", async () => {
    const { email } = await createOwner();
    const token = await resetToken(email);
    const answer = await post(plainHandle, "reset-password", resetBody(LISTED, token));
    expect(answer.status).toBe(200);
    expect(checked).toEqual([]);
    expect((await signIn(email, LISTED, plainHandle)).status).toBe(200);
  });
});
