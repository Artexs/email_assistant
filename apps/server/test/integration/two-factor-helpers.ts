import { randomInt, randomUUID } from "node:crypto";

import { expect, spyOn } from "bun:test";
import { sql } from "kysely";

import { createOrganizationWithOwner, isBreakGlassOwner } from "../../src/modules/tenancy";
import { createAuth, type AuthHandle } from "../../src/platform/auth";
import { createLockoutStore } from "../../src/platform/auth-lockout";
import type { Db } from "../../src/platform/db";
import { setLogLevel } from "../../src/platform/log";
import { auditWebEvent, termsAcceptedHandler } from "../../src/web";
import { holdsToken, secretOfUri, totpCode } from "../totp";

import { resetBody } from "./web-helpers";

export const BASE_URL = "http://127.0.0.1:8080";
export const PASSWORD = "correct-horse-battery-staple";

// A fresh client address per request, so the Better Auth rate limit never answers.
const nextIp = () => `10.${randomInt(1, 250)}.${randomInt(1, 250)}.${randomInt(1, 250)}`;

// A trimmed copy of makeWebTwoFactorKit below: a real Better Auth handle, one browser, one enrolled owner.
export function makeTwoFactorKit(db: Db) {
  const resets: { userId: string; url: string }[] = [];
  const handle: AuthHandle = createAuth({
    databaseUrl: process.env.DATABASE_URL ?? "",
    baseUrl: BASE_URL,
    secret: "x".repeat(40),
    trustedOrigins: [BASE_URL],
    onEvent: auditWebEvent(db),
    onTermsAccepted: termsAcceptedHandler(db, () => new Date()),
    resetLinkTtlSeconds: 86_400,
    now: () => new Date(),
    sendResetPassword: async (input) => {
      resets.push(input);
    },
  });

  // Everything that must never reach a console line: secrets, URIs and codes.
  const secrets: string[] = [];
  const orgIds: string[] = [];
  const userIds: string[] = [];
  const emails: string[] = [];

  class Client {
    readonly jar = new Map<string, string>();

    async call(
      method: "GET" | "POST",
      path: string,
      body?: Record<string, unknown>
    ): Promise<{ status: number; json: Record<string, unknown> | null }> {
      const cookie = [...this.jar].map(([name, value]) => `${name}=${value}`).join("; ");
      const response = await handle.auth.handler(
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

    post(path: string, body: Record<string, unknown>) {
      return this.call("POST", path, body);
    }

    signIn(email: string) {
      return this.post("/sign-in/email", { email, password: PASSWORD });
    }
  }

  // The code of this moment; the last test checks that no log line holds it.
  function typedCode(secret: string): string {
    const code = totpCode(secret);
    secrets.push(code);
    return code;
  }

  async function createOwner() {
    const email = `reset-${randomUUID()}@x.test`;
    const { orgId, userId } = await createOrganizationWithOwner(db, {
      orgName: "Reset",
      timezone: "Europe/Warsaw",
      email,
      displayName: "Owner",
    });
    orgIds.push(orgId);
    userIds.push(userId);
    emails.push(email);
    resets.length = 0;
    await handle.auth.api.requestPasswordReset({ body: { email, redirectTo: `${BASE_URL}/setup` } });
    const token = new URL(resets[0]?.url ?? BASE_URL).pathname.split("/").pop() ?? "";
    await handle.auth.api.resetPassword({ body: resetBody(PASSWORD, token) });
    return { email, orgId, userId };
  }

  // Sign in, enable, confirm with the current code.
  async function createEnrolled() {
    const owner = await createOwner();
    const client = new Client();
    expect((await client.signIn(owner.email)).status).toBe(200);
    const enabled = await client.post("/two-factor/enable", { password: PASSWORD });
    expect(enabled.status).toBe(200);
    const uri = String(enabled.json?.totpURI);
    const codes = enabled.json?.backupCodes as string[];
    const secret = secretOfUri(uri);
    secrets.push(secret, uri, ...codes);
    expect((await client.post("/two-factor/verify-totp", { code: typedCode(secret) })).status).toBe(200);
    return { ...owner, client, secret };
  }

  async function cleanup(): Promise<void> {
    if (userIds.length > 0) {
      await sql`DELETE FROM auth_verifications WHERE value IN (${sql.join(userIds)})`.execute(db);
    }
    for (const orgId of orgIds) await db.deleteFrom("organizations").where("id", "=", orgId).execute();
    if (userIds.length > 0) await db.deleteFrom("users").where("id", "in", userIds).execute();
    orgIds.length = 0;
    userIds.length = 0;
  }

  return { handle, Client, secrets, emails, typedCode, createOwner, createEnrolled, cleanup };
}

export const SECRET = "x".repeat(40);
export const NEW_PASSWORD = "another-long-passphrase-42";
export const WRONG_PASSWORD = "wrong-horse-battery-staple";
export const BACKUP_CODE = /^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/;

// The helpers of the web-two-factor test files: three real Better Auth handles, one browser, one enrolled owner.
// Each test file builds its own kit and registers its hooks: `silenceConsole` before all, `cleanup` after each, `close` after all.
export function makeWebTwoFactorKit(db: Db) {
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

  const spies = {
    log: undefined as unknown as ReturnType<typeof spyOn>,
    error: undefined as unknown as ReturnType<typeof spyOn>,
    warn: undefined as unknown as ReturnType<typeof spyOn>,
  };

  const silenceConsole = (): void => {
    spies.log = spyOn(console, "log").mockImplementation((): void => undefined);
    spies.error = spyOn(console, "error").mockImplementation((): void => undefined);
    spies.warn = spyOn(console, "warn").mockImplementation((): void => undefined);
  };

  const cleanup = async (): Promise<void> => {
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
  };

  const close = async (): Promise<void> => {
    spies.log.mockRestore();
    spies.error.mockRestore();
    spies.warn.mockRestore();
    await handle.close();
    await lockHandle.close();
    await keepHandle.close();
    await db.destroy();
  };

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

  // The last case of each web-two-factor part: no console line of the part holds a secret, a code or otpauth.
  const expectNoSecretInConsole = (): void => {
    const lines = [...spies.log.mock.calls, ...spies.warn.mock.calls, ...spies.error.mock.calls].map((call) =>
      call.map((part: unknown) => (part instanceof Error ? `${part.message}\n${part.stack}` : String(part))).join(" ")
    );
    expect(secrets.length).toBeGreaterThan(20);
    for (const line of lines) {
      expect(holdsToken(line, "otpauth")).toBe(false);
      for (const secret of secrets) expect(holdsToken(line, secret)).toBe(false);
    }
  };

  return {
    handle,
    lockHandle,
    keepHandle,
    auth,
    secrets,
    spies,
    expectNoSecretInConsole,
    silenceConsole,
    cleanup,
    close,
    Client,
    createOwner,
    requestResetLink,
    createEnrolled,
    challenge,
    typedCode,
    wrongCode,
    twoFactorRow,
    twoFactorFlag,
    countSessions,
    loginRows,
    auditRows,
    trustRows,
    enrol,
  };
}

export type WebTwoFactorKit = ReturnType<typeof makeWebTwoFactorKit>;
export type Enrolment = Awaited<ReturnType<WebTwoFactorKit["createEnrolled"]>>;
