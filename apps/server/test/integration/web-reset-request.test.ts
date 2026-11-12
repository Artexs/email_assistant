import { randomInt, randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import { sql } from "kysely";

import { createOrganizationWithOwner } from "../../src/modules/tenancy";
import { createAuth, RESET_REQUEST_ANSWER, type AuthHandle } from "../../src/platform/auth";
import { createAuthMailTasks, type AuthMail, type AuthMailer, type AuthMailResult } from "../../src/platform/auth-mail";
import { setLogLevel } from "../../src/platform/log";
import { auditWebEvent, authMailFailedHandler, termsAcceptedHandler } from "../../src/web";

import { testDb } from "./helpers";

const db = testDb();

const BASE_URL = "http://127.0.0.1:8080";
const ANSWER = JSON.stringify(RESET_REQUEST_ANSWER);

const orgIds: string[] = [];
const userIds: string[] = [];
const handles: AuthHandle[] = [];

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
  for (const handle of handles) await handle.close();
  await db.destroy();
});

// A fresh client address per call (the per-client limit is in memory and shared by the process).
const nextIp = () => `10.${randomInt(1, 250)}.${randomInt(1, 250)}.${randomInt(1, 250)}`;

async function waitFor(done: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !done(); i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
}

async function createOwner() {
  const email = `reset-req-${randomUUID()}@x.test`;
  const { orgId, userId } = await createOrganizationWithOwner(db, {
    orgName: "Reset request",
    timezone: "Europe/Warsaw",
    email,
    displayName: "Owner",
  });
  orgIds.push(orgId);
  userIds.push(userId);
  return { email, orgId, userId };
}

function fakeMailer(delayMs = 0, result: AuthMailResult = { ok: true }) {
  const sent: AuthMail[] = [];
  const mailer: AuthMailer = {
    send: async (mail) => {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      sent.push(mail);
      return result;
    },
  };
  return { mailer, sent };
}

function makeAuth(options: {
  mailer: AuthMailer;
  onFailed?: Parameters<typeof createAuthMailTasks>[0]["onFailed"];
  ttl?: number;
}) {
  const tasks = createAuthMailTasks({
    mailer: options.mailer,
    localeOf: async () => "en",
    onFailed: options.onFailed ?? (() => undefined),
  });
  const handle = createAuth({
    databaseUrl: process.env.DATABASE_URL ?? "",
    baseUrl: BASE_URL,
    secret: "x".repeat(40),
    trustedOrigins: [BASE_URL],
    onEvent: auditWebEvent(db),
    onTermsAccepted: termsAcceptedHandler(db, () => new Date()),
    resetLinkTtlSeconds: options.ttl ?? 3_600,
    sendResetPassword: async ({ userId, email, url }) => {
      tasks.start({ kind: "reset", userId, to: email, url });
    },
  });
  handles.push(handle);
  return { handle, tasks };
}

function request(handle: AuthHandle, email: string, ip: string = nextIp()): Promise<Response> {
  return handle.auth.handler(
    new Request(`${BASE_URL}/api/auth/request-password-reset`, {
      method: "POST",
      headers: { origin: BASE_URL, "content-type": "application/json", "x-client-ip": ip },
      body: JSON.stringify({ email, redirectTo: `${BASE_URL}/setup` }),
    })
  );
}

describe("reset request", () => {
  test("a known and an unknown address get the same answer", async () => {
    const { email } = await createOwner();
    const { mailer } = fakeMailer();
    const { handle, tasks } = makeAuth({ mailer });
    const known = await request(handle, email);
    const unknown = await request(handle, `nobody-${randomUUID()}@x.test`);
    await tasks.idle();
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    const [knownBody, unknownBody] = [await known.text(), await unknown.text()];
    expect(knownBody).toBe(unknownBody);
    expect(knownBody).toBe(ANSWER);
  });

  test("the request does not wait for the mail", async () => {
    const { email, userId } = await createOwner();
    const { mailer, sent } = fakeMailer(3000);
    const { handle, tasks } = makeAuth({ mailer });
    const started = performance.now();
    const response = await request(handle, email);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(response.status).toBe(200);
    expect(sent).toHaveLength(0);
    await tasks.idle();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: "reset", userId, to: email, locale: "en" });
    expect(sent[0]?.url).toContain("/api/auth/reset-password/");
  });

  test("at most three mails per address and hour, with the same answer", async () => {
    const { email } = await createOwner();
    const { mailer, sent } = fakeMailer();
    const { handle, tasks } = makeAuth({ mailer });
    const bodies: string[] = [];
    for (const address of [email, email, email, email.toUpperCase()]) {
      const response = await request(handle, address);
      expect(response.status).toBe(200);
      bodies.push(await response.text());
    }
    await tasks.idle();
    expect(new Set(bodies)).toEqual(new Set([ANSWER]));
    expect(sent).toHaveLength(3);
  });

  test("the fourth request from one client address answers 429", async () => {
    const { mailer } = fakeMailer();
    const { handle } = makeAuth({ mailer });
    const ip = nextIp();
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      statuses.push((await request(handle, `nobody-${randomUUID()}@x.test`, ip)).status);
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  test("the server link lives one hour", async () => {
    const { email, userId } = await createOwner();
    const { mailer } = fakeMailer();
    const { handle, tasks } = makeAuth({ mailer, ttl: 3_600 });
    expect((await request(handle, email)).status).toBe(200);
    await tasks.idle();
    const { rows } = await sql<{ seconds: number }>`
      SELECT EXTRACT(EPOCH FROM (expires_at - created_at))::float8 AS seconds
      FROM auth_verifications WHERE value = ${userId}
    `.execute(db);
    expect(rows).toHaveLength(1);
    const seconds = rows[0]?.seconds ?? 0;
    expect(seconds).toBeGreaterThanOrEqual(3595);
    expect(seconds).toBeLessThanOrEqual(3605);
  });

  test("a failed send reports once with the code", async () => {
    const { email, userId } = await createOwner();
    const { mailer } = fakeMailer(0, { ok: false, code: "EAUTH" });
    const failed: [string, string, string][] = [];
    const { handle, tasks } = makeAuth({
      mailer,
      onFailed: (id, kind, code) => failed.push([id, kind, code]),
    });
    expect((await request(handle, email)).status).toBe(200);
    await tasks.idle();
    expect(failed).toEqual([[userId, "reset", "EAUTH"]]);
  });

  test("the log holds no address, reset link or token", async () => {
    const { email } = await createOwner();
    const lines: string[] = [];
    const logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]): void => {
      lines.push(args.join(" "));
    });
    const errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]): void => {
      lines.push(args.join(" "));
    });
    try {
      setLogLevel("debug");
      const known = fakeMailer(0, { ok: false, code: "EAUTH" });
      const { handle, tasks } = makeAuth({ mailer: known.mailer });
      for (let i = 0; i < 5; i += 1) await request(handle, email);
      await request(handle, `nobody-${randomUUID()}@x.test`);
      await tasks.idle();
      const mails = known.sent.map((mail) => mail.url);
      expect(mails.length).toBe(3);
      const tokens = mails.map((url) => new URL(url).pathname.split("/").pop() ?? "");
      expect(lines.some((line) => line.includes("over the address limit"))).toBe(true);
      for (const line of lines) {
        expect(line).not.toContain(email);
        expect(line).not.toContain("reset-password/");
        for (const token of tokens) expect(line).not.toContain(token);
      }
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});

describe("authMailFailedHandler", () => {
  test("calls notify with the oldest organization", async () => {
    const { orgId, userId } = await createOwner();
    const calls: unknown[][] = [];
    authMailFailedHandler(db, (...args) => calls.push(args))(userId, "reset", "EAUTH");
    await waitFor(() => calls.length > 0);
    expect(calls).toEqual([[{ orgId }, userId, "reset", "EAUTH"]]);
  });

  test("a user without a membership gives no call and no throw", async () => {
    const calls: unknown[][] = [];
    expect(() =>
      authMailFailedHandler(db, (...args) => calls.push(args))(randomUUID(), "reset", "EAUTH")
    ).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(calls).toHaveLength(0);
  });
});
