import { randomBytes, randomInt, randomUUID } from "node:crypto";

import { symmetricDecrypt } from "better-auth/crypto";
import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { sql } from "kysely";

import {
  clearBreakGlassOwner,
  createOrganizationWithOwner,
  isBreakGlassOwner,
  setBreakGlassOwner,
} from "../../src/modules/tenancy";
import { createAuth, type AuthHandle } from "../../src/platform/auth";
import { createLockoutStore } from "../../src/platform/auth-lockout";
import { backupCodesLeft } from "../../src/platform/auth-two-factor";
import { loadConfig } from "../../src/platform/config";
import { createSecretBox } from "../../src/platform/crypto";
import { createApp } from "../../src/platform/http";
import { setLogLevel } from "../../src/platform/log";
import { auditWebEvent, termsAcceptedHandler, webDeps } from "../../src/web";
import { base32Decode, holdsToken, secretOfUri, totpCode } from "../totp";

import { testDb } from "./helpers";
import { resetBody } from "./web-helpers";

const db = testDb();

const BASE_URL = "http://127.0.0.1:8080";
const SECRET = "x".repeat(40);
const PASSWORD = "correct-horse-battery-staple";
const NEW_PASSWORD = "another-long-passphrase-42";
const WRONG_PASSWORD = "wrong-horse-battery-staple";
const BACKUP_CODE = /^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/;

const resets: { userId: string; url: string }[] = [];

const makeHandle = (withLockout: boolean, keepsTwoFactor = false): AuthHandle =>
  createAuth({
    databaseUrl: process.env.DATABASE_URL ?? "",
    baseUrl: BASE_URL,
    secret: SECRET,
    trustedOrigins: [BASE_URL],
    onEvent: auditWebEvent(db),
    onTermsAccepted: termsAcceptedHandler(db, () => new Date()),
    resetLinkTtlSeconds: 86_400,
    now: () => new Date(),
    sendResetPassword: async (input) => {
      resets.push(input);
    },
    ...(withLockout ? { lockout: createLockoutStore(db) } : {}),
    ...(keepsTwoFactor ? { keepsTwoFactor: (userId: string) => isBreakGlassOwner(db, userId) } : {}),
  });

const handle = makeHandle(false);
const lockHandle = makeHandle(true);
const keepHandle = makeHandle(false, true);
const { auth } = handle;

const orgIds: string[] = [];
const userIds: string[] = [];

// Everything that must never reach a console line: secrets, URIs and codes.
const secrets: string[] = [];

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
  resets.length = 0;
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
  logSpy.mockRestore();
  errorSpy.mockRestore();
  warnSpy.mockRestore();
  await handle.close();
  await lockHandle.close();
  await keepHandle.close();
  await db.destroy();
});

// A fresh client address per request, so the Better Auth rate limit never answers.
const nextIp = () => `10.${randomInt(1, 250)}.${randomInt(1, 250)}.${randomInt(1, 250)}`;

// One browser: it keeps the cookies of the answers (a cookie with Max-Age=0 is dropped).
class Client {
  readonly jar = new Map<string, string>();

  async call(
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>,
    via: AuthHandle = handle
  ): Promise<{ status: number; json: Record<string, unknown> | null }> {
    const cookie = [...this.jar].map(([name, value]) => `${name}=${value}`).join("; ");
    const response = await via.auth.handler(
      new Request(`${BASE_URL}/api/auth${path}`, {
        method,
        headers: {
          origin: BASE_URL,
          "x-client-ip": nextIp(),
          ...(body ? { "content-type": "application/json" } : {}),
          ...(cookie ? { cookie } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    );
    for (const line of response.headers.getSetCookie()) {
      const [pair = "", ...attributes] = line.split(";");
      const at = pair.indexOf("=");
      const name = pair.slice(0, at).trim();
      const value = pair.slice(at + 1).trim();
      const gone = attributes.some((attribute) => attribute.trim().toLowerCase() === "max-age=0") || value === "";
      if (gone) this.jar.delete(name);
      else this.jar.set(name, value);
    }
    const text = await response.text();
    return { status: response.status, json: text ? (JSON.parse(text) as Record<string, unknown>) : null };
  }

  post(path: string, body: Record<string, unknown>, via?: AuthHandle) {
    return this.call("POST", path, body, via);
  }

  signIn(email: string, password = PASSWORD, via?: AuthHandle) {
    return this.post("/sign-in/email", { email, password }, via);
  }

  has(name: string): boolean {
    return this.jar.has(name);
  }
}

async function createOwner() {
  const email = `two-factor-${randomUUID()}@x.test`;
  const { orgId, userId } = await createOrganizationWithOwner(db, {
    orgName: "Two factor",
    timezone: "Europe/Warsaw",
    email,
    displayName: "Owner",
  });
  orgIds.push(orgId);
  userIds.push(userId);
  await setPassword(email, PASSWORD);
  return { email, orgId, userId };
}

async function requestResetLink(email: string): Promise<string> {
  resets.length = 0;
  await auth.api.requestPasswordReset({ body: { email, redirectTo: `${BASE_URL}/setup` } });
  const mail = resets[0];
  if (!mail) throw new Error("no reset mail captured");
  return new URL(mail.url).pathname.split("/").pop() ?? "";
}

async function setPassword(email: string, password: string): Promise<void> {
  const token = await requestResetLink(email);
  await auth.api.resetPassword({ body: resetBody(password, token) });
}

interface Enrolment {
  email: string;
  orgId: string;
  userId: string;
  client: Client;
  uri: string;
  secret: string;
  codes: string[];
}

// Sign in without a second factor, enable, and confirm with the current code.
async function createEnrolled(): Promise<Enrolment> {
  const owner = await createOwner();
  const client = new Client();
  expect((await client.signIn(owner.email)).status).toBe(200);
  const enabled = await client.post("/two-factor/enable", { password: PASSWORD });
  expect(enabled.status).toBe(200);
  const uri = String(enabled.json?.totpURI);
  const codes = enabled.json?.backupCodes as string[];
  const secret = secretOfUri(uri);
  secrets.push(secret, uri, ...codes);
  const verified = await client.post("/two-factor/verify-totp", { code: typedCode(secret) });
  expect(verified.status).toBe(200);
  return { ...owner, client, uri, secret, codes };
}

// A new browser that signs in with the password and holds only the challenge cookie.
async function challenge(user: Enrolment): Promise<Client> {
  const client = new Client();
  const answer = await client.signIn(user.email);
  expect(answer.status).toBe(200);
  expect(answer.json?.twoFactorRedirect).toBe(true);
  return client;
}

// The code of this moment; it is a typed code, so the last test checks that no log line holds it.
function typedCode(secret: string): string {
  const code = totpCode(secret);
  secrets.push(code);
  return code;
}

// A code that is not the current one (the plugin reads the real clock).
function wrongCode(secret: string): string {
  const current = [-1, 0, 1].map((step) => totpCode(secret, Date.now() + step * 30_000));
  return ["000000", "111111", "222222"].find((code) => !current.includes(code)) ?? "333333";
}

async function twoFactorRow(userId: string) {
  const result = await sql<{
    secret: string;
    backup_codes: string;
    verified: boolean;
    failed_verification_count: number;
  }>`SELECT secret, backup_codes, verified, failed_verification_count FROM auth_two_factors WHERE user_id = ${userId}`.execute(
    db
  );
  return result.rows[0];
}

async function twoFactorFlag(userId: string): Promise<boolean | undefined> {
  const result = await sql<{ two_factor_enabled: boolean }>`
    SELECT two_factor_enabled FROM users WHERE id = ${userId}`.execute(db);
  return result.rows[0]?.two_factor_enabled;
}

async function countSessions(userId: string): Promise<number> {
  const result = await sql<{ n: string }>`SELECT count(*) AS n FROM auth_sessions WHERE user_id = ${userId}`.execute(
    db
  );
  return Number(result.rows[0]?.n);
}

async function loginRows(orgId: string) {
  const result = await sql<{ data: Record<string, unknown> }>`
    SELECT data FROM audit_log WHERE org_id = ${orgId} AND event = 'web.login' ORDER BY id`.execute(db);
  return result.rows.map((row) => row.data);
}

async function auditRows(orgId: string, event: string) {
  const result = await sql<{ actor: string; data: Record<string, unknown> }>`
    SELECT actor, data FROM audit_log WHERE org_id = ${orgId} AND event = ${event} ORDER BY id`.execute(db);
  return result.rows;
}

async function trustRows(userId: string): Promise<{ expires_at: Date }[]> {
  const result = await sql<{ expires_at: Date }>`
    SELECT expires_at FROM auth_verifications WHERE value = ${userId}`.execute(db);
  return result.rows;
}

// Enable and confirm with the current code; the jar holds a session of a user without TOTP.
async function enrol(jar: Client): Promise<{ secret: string; codes: string[] }> {
  const enabled = await jar.post("/two-factor/enable", { password: PASSWORD });
  expect(enabled.status).toBe(200);
  const uri = String(enabled.json?.totpURI);
  const codes = enabled.json?.backupCodes as string[];
  const secret = secretOfUri(uri);
  secrets.push(secret, uri, ...codes);
  const verified = await jar.post("/two-factor/verify-totp", { code: typedCode(secret) });
  expect(verified.status).toBe(200);
  return { secret, codes };
}

describe("two-factor sign-in", () => {
  test("enrolment: the plugin returns the URI and ten codes and turns on only after the first code", async () => {
    const owner = await createOwner();
    const client = new Client();
    await client.signIn(owner.email);
    const oldSession = client.jar.get("ea.session_token");

    const enabled = await client.post("/two-factor/enable", { password: PASSWORD });
    expect(enabled.status).toBe(200);
    const uri = String(enabled.json?.totpURI);
    const codes = enabled.json?.backupCodes as string[];
    expect(codes).toHaveLength(10);
    for (const code of codes) expect(code).toMatch(BACKUP_CODE);
    const secret = secretOfUri(uri);
    secrets.push(secret, uri, ...codes);

    const before = await twoFactorRow(owner.userId);
    expect(before?.verified).toBe(false);
    expect(await twoFactorFlag(owner.userId)).toBe(false);

    // Stored encrypted: neither the secret nor a backup code is in the row in plain text.
    // The URI holds the base32 form of the raw secret; the row holds the encrypted raw secret.
    const raw = base32Decode(secret).toString("utf8");
    expect(before?.secret).not.toContain(raw);
    expect(before?.secret).not.toContain(secret);
    expect(before?.secret).not.toBe(raw);
    for (const code of codes) expect(before?.backup_codes).not.toContain(code);
    expect(await symmetricDecrypt({ key: SECRET, data: before?.secret ?? "" })).toBe(raw);
    expect(JSON.parse(await symmetricDecrypt({ key: SECRET, data: before?.backup_codes ?? "" }))).toEqual(codes);

    const verified = await client.post("/two-factor/verify-totp", { code: typedCode(secret) });
    expect(verified.status).toBe(200);
    const after = await twoFactorRow(owner.userId);
    expect(after?.verified).toBe(true);
    expect(await twoFactorFlag(owner.userId)).toBe(true);
    expect(client.jar.get("ea.session_token")).not.toBe(oldSession);
    expect(await countSessions(owner.userId)).toBe(1);
  });

  test("enable refuses a wrong password and the e-mail method", async () => {
    const owner = await createOwner();
    const client = new Client();
    await client.signIn(owner.email);
    const wrong = await client.post("/two-factor/enable", { password: WRONG_PASSWORD });
    expect(wrong.status).toBe(400);
    expect(wrong.json?.code).toBe("INVALID_PASSWORD");
    expect(await twoFactorRow(owner.userId)).toBeUndefined();
    const otp = await client.post("/two-factor/enable", { password: PASSWORD, method: "otp" });
    expect(otp.status).toBe(400);
    expect(otp.json?.code).toBe("OTP_NOT_CONFIGURED");
    expect(await twoFactorRow(owner.userId)).toBeUndefined();
  });

  test("a member with TOTP gets a challenge, no session and no web.login row", async () => {
    const user = await createEnrolled();
    const before = (await loginRows(user.orgId)).length;
    const client = new Client();
    const answer = await client.signIn(user.email);
    expect(answer.status).toBe(200);
    expect(answer.json).toEqual({ twoFactorRedirect: true, twoFactorMethods: ["totp"] });
    expect(client.has("ea.two_factor")).toBe(true);
    expect(client.has("ea.session_token")).toBe(false);
    // The enrolling session of createEnrolled is the only session of the user.
    expect(await countSessions(user.userId)).toBe(1);
    expect((await loginRows(user.orgId)).length).toBe(before);
  });

  test("the right code makes the session and one web.login row with second_factor totp", async () => {
    const user = await createEnrolled();
    const before = (await loginRows(user.orgId)).length;
    const client = await challenge(user);
    const code = typedCode(user.secret);
    const verified = await client.post("/two-factor/verify-totp", { code });
    expect(verified.status).toBe(200);
    expect(client.has("ea.session_token")).toBe(true);
    const session = await client.call("GET", "/get-session");
    expect((session.json?.user as { id?: string } | undefined)?.id).toBe(user.userId);
    const rows = await loginRows(user.orgId);
    expect(rows).toHaveLength(before + 1);
    expect(rows[rows.length - 1]).toEqual({ via: "web", second_factor: "totp" });
  });

  test("a backup code works once", async () => {
    const user = await createEnrolled();
    const first = await challenge(user);
    const code = user.codes[0] ?? "";
    const used = await first.post("/two-factor/verify-backup-code", { code });
    expect(used.status).toBe(200);
    expect(first.has("ea.session_token")).toBe(true);
    const rows = await loginRows(user.orgId);
    expect(rows[rows.length - 1]).toEqual({ via: "web", second_factor: "backup_code" });

    const second = await challenge(user);
    const again = await second.post("/two-factor/verify-backup-code", { code });
    expect(again.status).toBe(401);
    expect(again.json?.code).toBe("INVALID_BACKUP_CODE");
    expect(second.has("ea.session_token")).toBe(false);
  });

  test("five wrong codes end the challenge", async () => {
    const user = await createEnrolled();
    const client = await challenge(user);
    const code = wrongCode(user.secret);
    secrets.push(code);
    for (let i = 0; i < 5; i += 1) {
      const answer = await client.post("/two-factor/verify-totp", { code });
      expect(answer.status).toBe(401);
      expect(answer.json?.code).toBe("INVALID_CODE");
    }
    const sixth = await client.post("/two-factor/verify-totp", { code });
    expect(sixth.status).toBe(400);
    expect(sixth.json?.code).toBe("TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE");
    expect(client.has("ea.session_token")).toBe(false);
    // The count belongs to the account lock of stage 03.
    await sql`UPDATE auth_two_factors SET failed_verification_count = 0 WHERE user_id = ${user.userId}`.execute(db);
  });

  test("a code without a challenge or a session is refused", async () => {
    const user = await createEnrolled();
    const client = new Client();
    const answer = await client.post("/two-factor/verify-totp", { code: typedCode(user.secret) });
    expect(answer.status).toBe(401);
    expect(answer.json?.code).toBe("INVALID_TWO_FACTOR_COOKIE");
    expect(client.has("ea.session_token")).toBe(false);
  });

  test("a trusted device skips the code and writes second_factor trusted_device", async () => {
    const user = await createEnrolled();
    const first = await challenge(user);
    const verified = await first.post("/two-factor/verify-totp", { code: typedCode(user.secret), trustDevice: true });
    expect(verified.status).toBe(200);
    expect(first.has("ea.trust_device")).toBe(true);
    const trust = first.jar.get("ea.trust_device") ?? "";

    const before = (await loginRows(user.orgId)).length;
    const device = new Client();
    device.jar.set("ea.trust_device", trust);
    const answer = await device.signIn(user.email);
    expect(answer.status).toBe(200);
    expect(answer.json?.twoFactorRedirect).toBeUndefined();
    expect(device.has("ea.session_token")).toBe(true);
    const rows = await loginRows(user.orgId);
    expect(rows).toHaveLength(before + 1);
    expect(rows[rows.length - 1]).toEqual({ via: "web", second_factor: "trusted_device" });
  });

  test("a user without TOTP signs in with second_factor none", async () => {
    const owner = await createOwner();
    const client = new Client();
    expect((await client.signIn(owner.email)).status).toBe(200);
    expect(client.has("ea.session_token")).toBe(true);
    expect(await loginRows(owner.orgId)).toEqual([{ via: "web", second_factor: "none" }]);
  });

  test("a password reset does not skip the code", async () => {
    const user = await createEnrolled();
    const token = await requestResetLink(user.email);
    await auth.api.resetPassword({ body: resetBody(NEW_PASSWORD, token) });
    const client = new Client();
    const answer = await client.signIn(user.email, NEW_PASSWORD);
    expect(answer.status).toBe(200);
    expect(answer.json?.twoFactorRedirect).toBe(true);
    expect(client.has("ea.session_token")).toBe(false);
  });

  test("two parallel enrolments leave one row and no secret in the log", async () => {
    const owner = await createOwner();
    const client = new Client();
    await client.signIn(owner.email);
    const answers = await Promise.all([
      client.post("/two-factor/enable", { password: PASSWORD }),
      client.post("/two-factor/enable", { password: PASSWORD }),
    ]);
    for (const answer of answers) {
      if (answer.status === 200) {
        secrets.push(String(answer.json?.totpURI), secretOfUri(String(answer.json?.totpURI)));
        secrets.push(...(answer.json?.backupCodes as string[]));
      }
    }
    expect(answers.some((answer) => answer.status === 200)).toBe(true);
    for (const answer of answers) expect([200, 500]).toContain(answer.status);
    const count = await sql<{ n: string }>`
      SELECT count(*) AS n FROM auth_two_factors WHERE user_id = ${owner.userId}`.execute(db);
    expect(Number(count.rows[0]?.n)).toBe(1);
  });

  test("a user locked by the password lockout never reaches the code step", async () => {
    const user = await createEnrolled();
    for (let i = 0; i < 10; i += 1) {
      await new Client().signIn(user.email, WRONG_PASSWORD, lockHandle);
    }
    const client = new Client();
    const answer = await client.signIn(user.email, PASSWORD, lockHandle);
    expect(answer.status).toBe(401);
    expect(answer.json?.code).toBe("INVALID_EMAIL_OR_PASSWORD");
    expect(client.has("ea.two_factor")).toBe(false);
    await sql`DELETE FROM auth_lockouts WHERE user_id = ${user.userId}`.execute(db);
  });
});

describe("two-factor events", () => {
  test("1, 1a: enrolment writes one two_factor_enabled row, no login row, and ends the other sessions", async () => {
    const owner = await createOwner();
    const jarA = new Client();
    const jarB = new Client();
    await jarA.signIn(owner.email);
    await jarB.signIn(owner.email);
    expect(await countSessions(owner.userId)).toBe(2);
    const loginsBefore = (await loginRows(owner.orgId)).length;
    await enrol(jarA);
    const enabled = await auditRows(owner.orgId, "web.two_factor_enabled");
    expect(enabled).toHaveLength(1);
    expect(enabled[0]?.data).toEqual({ via: "web" });
    expect(enabled[0]?.actor).toBe(owner.userId);
    expect((await loginRows(owner.orgId)).length).toBe(loginsBefore);
    expect((await jarB.call("GET", "/get-session")).json).toBeNull();
    expect(await countSessions(owner.userId)).toBe(1);
    const mine = await jarA.call("GET", "/get-session");
    expect((mine.json?.user as { id?: string } | undefined)?.id).toBe(owner.userId);
  });

  test("2: a code check of a user who already has TOTP writes no new enabled row", async () => {
    const user = await createEnrolled();
    expect(await auditRows(user.orgId, "web.two_factor_enabled")).toHaveLength(1);
    const checked = await user.client.post("/two-factor/verify-totp", { code: typedCode(user.secret) });
    expect(checked.status).toBe(200);
    expect(await auditRows(user.orgId, "web.two_factor_enabled")).toHaveLength(1);
  });

  test("3: enrolling again ends an old trusted device", async () => {
    const user = await createEnrolled();
    const jarA = await challenge(user);
    expect(
      (await jarA.post("/two-factor/verify-totp", { code: typedCode(user.secret), trustDevice: true })).status
    ).toBe(200);
    const trust = jarA.jar.get("ea.trust_device") ?? "";
    expect(trust).not.toBe("");

    const jarB = await challenge(user);
    expect((await jarB.post("/two-factor/verify-backup-code", { code: user.codes[0] ?? "" })).status).toBe(200);
    expect((await jarB.post("/two-factor/disable", { password: PASSWORD })).status).toBe(200);
    const again = await jarB.post("/two-factor/enable", { password: PASSWORD });
    expect(again.status).toBe(200);
    const secret = secretOfUri(String(again.json?.totpURI));
    secrets.push(secret, String(again.json?.totpURI), ...(again.json?.backupCodes as string[]));
    // The device of jar A is still trusted before the second enrolment.
    const rows = await trustRows(user.userId);
    expect(rows).toHaveLength(1);
    const days = ((rows[0]?.expires_at.getTime() ?? 0) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);

    expect((await jarB.post("/two-factor/verify-totp", { code: typedCode(secret) })).status).toBe(200);
    expect(await trustRows(user.userId)).toHaveLength(0);

    const old = new Client();
    old.jar.set("ea.trust_device", trust);
    const answer = await old.signIn(user.email);
    expect(answer.status).toBe(200);
    expect(answer.json?.twoFactorRedirect).toBe(true);
    expect(old.has("ea.session_token")).toBe(false);
  });

  test("4: a backup-code sign-in writes web.login and one backup_code_used", async () => {
    const user = await createEnrolled();
    const client = await challenge(user);
    const before = (await auditRows(user.orgId, "web.backup_code_used")).length;
    expect((await client.post("/two-factor/verify-backup-code", { code: user.codes[0] ?? "" })).status).toBe(200);
    const logins = await loginRows(user.orgId);
    expect(logins[logins.length - 1]).toEqual({ via: "web", second_factor: "backup_code" });
    const used = await auditRows(user.orgId, "web.backup_code_used");
    expect(used).toHaveLength(before + 1);
    expect(used[used.length - 1]?.data).toEqual({ via: "web" });
    expect(used[used.length - 1]?.actor).toBe(user.userId);
  });

  test("4a: a signed-in user checks a backup code: one row, no login row", async () => {
    const user = await createEnrolled();
    const loginsBefore = (await loginRows(user.orgId)).length;
    const view = (await auth.api.viewBackupCodes({ body: { userId: user.userId } })) as { backupCodes: string[] };
    expect(view.backupCodes).toHaveLength(10);
    const answer = await user.client.post("/two-factor/verify-backup-code", { code: user.codes[1] ?? "" });
    expect(answer.status).toBe(200);
    const used = await auditRows(user.orgId, "web.backup_code_used");
    expect(used).toHaveLength(1);
    expect(used[0]?.actor).toBe(user.userId);
    expect((await loginRows(user.orgId)).length).toBe(loginsBefore);
    const after = (await auth.api.viewBackupCodes({ body: { userId: user.userId } })) as { backupCodes: string[] };
    expect(after.backupCodes).toHaveLength(9);
  });

  test("4b: disableSession is refused with and without a session", async () => {
    const user = await createEnrolled();
    const client = await challenge(user);
    const refused = await client.post("/two-factor/verify-backup-code", {
      code: user.codes[0] ?? "",
      disableSession: true,
    });
    expect(refused.status).toBe(400);
    expect(refused.json?.code).toBe("DISABLE_SESSION_REFUSED");
    expect(client.has("ea.session_token")).toBe(false);
    const withSession = await user.client.post("/two-factor/verify-backup-code", {
      code: user.codes[0] ?? "",
      disableSession: true,
    });
    expect(withSession.status).toBe(400);
    expect(withSession.json?.code).toBe("DISABLE_SESSION_REFUSED");
    const view = (await auth.api.viewBackupCodes({ body: { userId: user.userId } })) as { backupCodes: string[] };
    expect(view.backupCodes).toHaveLength(10);
    expect(await auditRows(user.orgId, "web.backup_code_used")).toHaveLength(0);
  });

  test("5: disable writes one row; a wrong password writes none", async () => {
    const user = await createEnrolled();
    const wrong = await user.client.post("/two-factor/disable", { password: WRONG_PASSWORD });
    expect(wrong.status).toBe(400);
    expect(wrong.json?.code).toBe("INVALID_PASSWORD");
    expect(await auditRows(user.orgId, "web.two_factor_disabled")).toHaveLength(0);
    expect((await user.client.post("/two-factor/disable", { password: PASSWORD })).status).toBe(200);
    const rows = await auditRows(user.orgId, "web.two_factor_disabled");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.data).toEqual({ via: "web" });
    expect(rows[0]?.actor).toBe(user.userId);
  });

  describe("F105 stage 06: the break-glass owner keeps TOTP", () => {
    const mark = async (user: Enrolment) => {
      await setBreakGlassOwner(db, { orgId: user.orgId }, { userId: user.userId, actor: "cli", now: new Date() });
    };

    test("1, 2: the marked owner cannot turn TOTP off; after the mark is cleared the same call works", async () => {
      const user = await createEnrolled();
      await mark(user);
      expect(await isBreakGlassOwner(db, user.userId)).toBe(true);
      const refused = await user.client.post("/two-factor/disable", { password: PASSWORD }, keepHandle);
      expect(refused.status).toBe(403);
      expect(refused.json?.code).toBe("BREAK_GLASS_NEEDS_TWO_FACTOR");
      expect(await twoFactorFlag(user.userId)).toBe(true);
      expect(await twoFactorRow(user.userId)).toBeDefined();
      expect(await auditRows(user.orgId, "web.two_factor_disabled")).toHaveLength(0);
      await clearBreakGlassOwner(db, { orgId: user.orgId }, { actor: "cli", now: new Date(), reason: "cli" });
      expect((await user.client.post("/two-factor/disable", { password: PASSWORD }, keepHandle)).status).toBe(200);
      expect(await twoFactorFlag(user.userId)).toBe(false);
      expect(await twoFactorRow(user.userId)).toBeUndefined();
    });

    test("3: a handle without keepsTwoFactor lets a marked user turn TOTP off", async () => {
      const user = await createEnrolled();
      await mark(user);
      expect(await isBreakGlassOwner(db, user.userId)).toBe(true);
      expect((await user.client.post("/two-factor/disable", { password: PASSWORD })).status).toBe(200);
      expect(await twoFactorFlag(user.userId)).toBe(false);
    });

    test("4: with a session two days old the marked owner still gets 403; after the clear it gets 200", async () => {
      const user = await createEnrolled();
      await mark(user);
      expect(await isBreakGlassOwner(db, user.userId)).toBe(true);
      await sql`UPDATE auth_sessions SET created_at = now() - interval '2 days' WHERE user_id = ${user.userId}`.execute(
        db
      );
      const refused = await user.client.post("/two-factor/disable", { password: PASSWORD }, keepHandle);
      expect(refused.status).toBe(403);
      expect(refused.json?.code).toBe("BREAK_GLASS_NEEDS_TWO_FACTOR");
      expect(await twoFactorFlag(user.userId)).toBe(true);
      await clearBreakGlassOwner(db, { orgId: user.orgId }, { actor: "cli", now: new Date(), reason: "cli" });
      const allowed = await user.client.post("/two-factor/disable", { password: PASSWORD }, keepHandle);
      expect(allowed.status).toBe(200);
      expect(await twoFactorFlag(user.userId)).toBe(false);
    });

    test("5: no session cookie gets 401 and nothing changes", async () => {
      const user = await createEnrolled();
      await mark(user);
      const answer = await new Client().post("/two-factor/disable", { password: PASSWORD }, keepHandle);
      expect(answer.status).toBe(401);
      expect(await twoFactorFlag(user.userId)).toBe(true);
      expect(await twoFactorRow(user.userId)).toBeDefined();
      expect(await auditRows(user.orgId, "web.two_factor_disabled")).toHaveLength(0);
    });

    test("6: a failed session read in the hook does not let the disable through", async () => {
      const user = await createEnrolled();
      await mark(user);
      // The first read (the hook's) fails once; Better Auth's own later read would work.
      const context = await keepHandle.auth.$context;
      const original = context.internalAdapter.findSession;
      let failed = 0;
      context.internalAdapter.findSession = (async (...args: Parameters<typeof original>) => {
        if (failed === 0) {
          failed += 1;
          throw new Error("session read failed (test)");
        }
        return original(...args);
      }) as typeof original;
      try {
        const answer = await user.client.post("/two-factor/disable", { password: PASSWORD }, keepHandle);
        expect(failed).toBe(1);
        expect(answer.status).toBeGreaterThanOrEqual(400);
      } finally {
        context.internalAdapter.findSession = original;
      }
      expect(await twoFactorFlag(user.userId)).toBe(true);
      expect(await twoFactorRow(user.userId)).toBeDefined();
      expect(await auditRows(user.orgId, "web.two_factor_disabled")).toHaveLength(0);
    });

    test("7: the production web wiring (webDeps) refuses the marked owner", async () => {
      const user = await createEnrolled();
      await mark(user);
      const web = webDeps(
        loadConfig({
          ...process.env,
          WEB_BASE_URL: BASE_URL,
          WEB_AUTH_SECRET: SECRET,
          WEB_DIST: "/nonexistent/dist",
        }),
        db,
        {
          secrets: createSecretBox(randomBytes(32).toString("base64"), 1),
          actionsScope: { kind: "off" },
          botUsername: null,
        }
      );
      if (web === null) throw new Error("webDeps returned null");
      try {
        const app = createApp({ checkDb: async () => true, web });
        const cookie = [...user.client.jar].map(([name, value]) => `${name}=${value}`).join("; ");
        const refused = await app.request("/api/auth/two-factor/disable", {
          method: "POST",
          headers: { origin: BASE_URL, "content-type": "application/json", cookie },
          body: JSON.stringify({ password: PASSWORD }),
        });
        expect(refused.status).toBe(403);
        expect(((await refused.json()) as { code?: string }).code).toBe("BREAK_GLASS_NEEDS_TWO_FACTOR");
        expect(await twoFactorFlag(user.userId)).toBe(true);
      } finally {
        await web.close();
      }
    });
  });

  test("6: new backup codes write one row and the old codes stop working", async () => {
    const user = await createEnrolled();
    const made = await user.client.post("/two-factor/generate-backup-codes", { password: PASSWORD });
    expect(made.status).toBe(200);
    const fresh = made.json?.backupCodes as string[];
    expect(fresh).toHaveLength(10);
    secrets.push(...fresh);
    const rows = await auditRows(user.orgId, "web.backup_codes_generated");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.data).toEqual({ via: "web" });
    const client = await challenge(user);
    const old = await client.post("/two-factor/verify-backup-code", { code: user.codes[0] ?? "" });
    expect(old.status).toBe(401);
    expect(old.json?.code).toBe("INVALID_BACKUP_CODE");
  });

  test("7, 8: ten wrong codes write one lock row; an expired lock clears", async () => {
    const user = await createEnrolled();
    const code = wrongCode(user.secret);
    secrets.push(code);
    let last: { status: number; json: Record<string, unknown> | null } | undefined;
    for (let round = 0; round < 2; round += 1) {
      const client = await challenge(user);
      for (let i = 0; i < 5; i += 1) last = await client.post("/two-factor/verify-totp", { code });
    }
    expect(last?.status).toBe(401);
    expect(last?.json?.code).toBe("INVALID_CODE");
    const row = await sql<{ locked_until: Date }>`
      SELECT locked_until FROM auth_two_factors WHERE user_id = ${user.userId}`.execute(db);
    const lockedUntil = row.rows[0]?.locked_until;
    expect(lockedUntil && lockedUntil.getTime() > Date.now()).toBe(true);
    const locks = await auditRows(user.orgId, "web.two_factor_locked");
    expect(locks).toHaveLength(1);
    expect(locks[0]?.data).toEqual({ via: "web", locked_until: lockedUntil?.toISOString() });

    const blocked = await challenge(user);
    const refused = await blocked.post("/two-factor/verify-totp", { code: typedCode(user.secret) });
    expect(refused.status).toBe(429);
    expect(refused.json?.code).toBe("ACCOUNT_TEMPORARILY_LOCKED");
    expect(await auditRows(user.orgId, "web.two_factor_locked")).toHaveLength(1);

    await sql`UPDATE auth_two_factors SET locked_until = now() - interval '1 minute' WHERE user_id = ${user.userId}`.execute(
      db
    );
    const again = await challenge(user);
    const ok = await again.post("/two-factor/verify-totp", { code: typedCode(user.secret) });
    expect(ok.status).toBe(200);
    expect(again.has("ea.session_token")).toBe(true);
    expect(await auditRows(user.orgId, "web.two_factor_locked")).toHaveLength(1);
  });

  test("9: every 2FA audit row holds only via, second_factor and locked_until", async () => {
    const user = await createEnrolled();
    await user.client.post("/two-factor/generate-backup-codes", { password: PASSWORD });
    const result = await sql<{ data: Record<string, unknown> }>`
      SELECT data FROM audit_log WHERE org_id = ${user.orgId} AND event IN ('web.login', 'web.two_factor_enabled', 'web.two_factor_disabled', 'web.backup_codes_generated', 'web.backup_code_used', 'web.two_factor_locked')`.execute(
      db
    );
    expect(result.rows.length).toBeGreaterThan(0);
    for (const row of result.rows) {
      for (const key of Object.keys(row.data)) expect(["via", "second_factor", "locked_until"]).toContain(key);
    }
  });
});

describe("backupCodesLeft", () => {
  test("8: counts the unused codes: 10, then 9 after a backup-code sign-in", async () => {
    const user = await createEnrolled();
    expect(await backupCodesLeft(handle, user.userId)).toBe(10);
    const client = await challenge(user);
    expect((await client.post("/two-factor/verify-backup-code", { code: user.codes[0] ?? "" })).status).toBe(200);
    expect(await backupCodesLeft(handle, user.userId)).toBe(9);
  });

  test("8: a user without TOTP gives null and one log line with the user id and no code", async () => {
    const owner = await createOwner();
    const before = errorSpy.mock.calls.length;
    expect(await backupCodesLeft(handle, owner.userId)).toBeNull();
    const lines = errorSpy.mock.calls
      .slice(before)
      .map((call: unknown[]) => call.map((part: unknown) => String(part)).join(" "))
      .filter((line: string) => line.includes("two_factor_codes_unreadable"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(owner.userId);
    expect(lines[0]).not.toMatch(BACKUP_CODE);
  });
});

describe("two-factor enrolment edge cases", () => {
  const errorLines = (): string[] =>
    (errorSpy.mock.calls as unknown[][]).map((call) => call.map((part) => String(part)).join(" "));

  // One user with a second session (jar B) and one trusted-device row; TOTP is off.
  async function plant() {
    const owner = await createOwner();
    const jarA = new Client();
    const jarB = new Client();
    await jarA.signIn(owner.email);
    await jarB.signIn(owner.email);
    await sql`
      INSERT INTO auth_verifications (identifier, value, expires_at)
      VALUES (${`trust-${randomUUID()}`}, ${owner.userId}, now() + interval '30 days')`.execute(db);
    return { ...owner, jarA, jarB };
  }

  test("D9 fail closed: a failed purge takes the enrolment back, then a retry works", async () => {
    const user = await plant();
    const context = await handle.auth.$context;
    const enabled = await user.jarA.post("/two-factor/enable", { password: PASSWORD });
    expect(enabled.status).toBe(200);
    const uri = String(enabled.json?.totpURI);
    secrets.push(uri, secretOfUri(uri), ...(enabled.json?.backupCodes as string[]));

    const failing = spyOn(context.internalAdapter, "listSessions").mockRejectedValueOnce(new Error("purge down"));
    const warnsBefore = errorLines().length;
    const failed = await user.jarA.post("/two-factor/verify-totp", { code: typedCode(secretOfUri(uri)) });
    failing.mockRestore();
    expect(failed.status).toBe(500);
    expect(await twoFactorFlag(user.userId)).toBe(false);
    expect(await twoFactorRow(user.userId)).toBeUndefined();
    expect(await trustRows(user.userId)).toHaveLength(1);
    expect((await user.jarB.call("GET", "/get-session")).json).not.toBeNull();
    expect(await auditRows(user.orgId, "web.two_factor_enabled")).toHaveLength(0);
    const rollback = errorLines()
      .slice(warnsBefore)
      .filter((line: string) => line.includes("two_factor_enrol_rollback"));
    expect(rollback).toHaveLength(1);
    expect(rollback[0]).toContain(user.userId);
    expect(rollback[0]).not.toContain("two_factor_enrol_rollback_failed");

    // The retry: a new sign-in (the 500 dropped the cookie of the enrolling device), then a full enrolment.
    const retry = new Client();
    expect((await retry.signIn(user.email)).status).toBe(200);
    const again = await retry.post("/two-factor/enable", { password: PASSWORD });
    expect(again.status).toBe(200);
    const secret = secretOfUri(String(again.json?.totpURI));
    secrets.push(secret, String(again.json?.totpURI), ...(again.json?.backupCodes as string[]));
    expect((await retry.post("/two-factor/verify-totp", { code: typedCode(secret) })).status).toBe(200);
    expect(await twoFactorFlag(user.userId)).toBe(true);
    expect(await auditRows(user.orgId, "web.two_factor_enabled")).toHaveLength(1);
    expect(await trustRows(user.userId)).toHaveLength(0);
    expect((await user.jarB.call("GET", "/get-session")).json).toBeNull();
    expect(await countSessions(user.userId)).toBe(1);
  });

  test("D9 fail closed: a failed compensation logs the failure and the answer stays a 500", async () => {
    const user = await plant();
    const context = await handle.auth.$context;
    const enabled = await user.jarA.post("/two-factor/enable", { password: PASSWORD });
    const uri = String(enabled.json?.totpURI);
    secrets.push(uri, secretOfUri(uri), ...(enabled.json?.backupCodes as string[]));

    const purge = spyOn(context.internalAdapter, "listSessions").mockRejectedValueOnce(new Error("purge down"));
    const compensation = spyOn(context.adapter, "transaction").mockRejectedValueOnce(new Error("rollback down"));
    const linesBefore = errorLines().length;
    const failed = await user.jarA.post("/two-factor/verify-totp", { code: typedCode(secretOfUri(uri)) });
    purge.mockRestore();
    compensation.mockRestore();
    expect(failed.status).toBe(500);
    const lines = errorLines()
      .slice(linesBefore)
      .filter((line: string) => line.includes("two_factor_enrol_rollback_failed"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(user.userId);
    expect(await auditRows(user.orgId, "web.two_factor_enabled")).toHaveLength(0);
  });

  test("N3: an enrolled user's session past updateAge verifying a code is not an enrolment", async () => {
    const user = await createEnrolled();
    const other = await challenge(user);
    expect((await other.post("/two-factor/verify-totp", { code: typedCode(user.secret) })).status).toBe(200);
    // updateAge is one day: a session that expires in 28 of its 30 days is refreshed by the next request.
    await sql`UPDATE auth_sessions SET expires_at = now() + interval '28 days' WHERE user_id = ${user.userId}`.execute(
      db
    );
    const answer = await user.client.post("/two-factor/verify-totp", { code: typedCode(user.secret) });
    expect(answer.status).toBe(200);
    expect(await auditRows(user.orgId, "web.two_factor_enabled")).toHaveLength(1);
    expect((await other.call("GET", "/get-session")).json).not.toBeNull();
    expect(await countSessions(user.userId)).toBe(2);
  });

  test("N5: on the backup-code path the login row comes before the backup_code_used row", async () => {
    const user = await createEnrolled();
    const client = await challenge(user);
    expect((await client.post("/two-factor/verify-backup-code", { code: user.codes[0] ?? "" })).status).toBe(200);
    const rows = await sql<{ event: string }>`
      SELECT event FROM audit_log
      WHERE org_id = ${user.orgId} AND event IN ('web.login', 'web.backup_code_used') ORDER BY id`.execute(db);
    expect(rows.rows.slice(-2).map((row) => row.event)).toEqual(["web.login", "web.backup_code_used"]);
  });
});

// The last test of the file: it checks every console line of the run above.
describe("secrets", () => {
  test("no console line holds a secret, a code or otpauth", () => {
    const lines = [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls].map((call) =>
      call.map((part: unknown) => (part instanceof Error ? `${part.message}\n${part.stack}` : String(part))).join(" ")
    );
    expect(secrets.length).toBeGreaterThan(20);
    for (const line of lines) {
      expect(holdsToken(line, "otpauth")).toBe(false);
      for (const secret of secrets) expect(holdsToken(line, secret)).toBe(false);
    }
  });
});
