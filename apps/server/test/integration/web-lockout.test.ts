import { randomInt, randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { sql } from "kysely";

import { createOrganizationWithOwner } from "../../src/modules/tenancy";
import { createAuth, type AuthHandle } from "../../src/platform/auth";
import { createLockoutStore } from "../../src/platform/auth-lockout";
import { setLogLevel } from "../../src/platform/log";
import { auditWebEvent } from "../../src/web";

import { testDb } from "./helpers";

const db = testDb();

const BASE_URL = "http://127.0.0.1:8080";
const PASSWORD = "correct-horse-battery-staple";
const NEW_PASSWORD = "another-long-passphrase-42";
const WRONG_PASSWORD = "wrong-horse-battery-staple";
const START = new Date("2026-11-20T10:00:00Z");

let clock = START;
const resets: { userId: string; url: string }[] = [];
const lockoutMails: { userId: string; email: string }[] = [];

const makeHandle = (withLockout: boolean): AuthHandle =>
  createAuth({
    databaseUrl: process.env.DATABASE_URL ?? "",
    baseUrl: BASE_URL,
    secret: "x".repeat(40),
    trustedOrigins: [BASE_URL],
    onEvent: auditWebEvent(db),
    resetLinkTtlSeconds: 86_400,
    now: () => clock,
    sendResetPassword: async (input) => {
      resets.push(input);
    },
    ...(withLockout
      ? {
          lockout: createLockoutStore(db),
          sendLockoutMail: (input: { userId: string; email: string }) => {
            lockoutMails.push(input);
          },
        }
      : {}),
  });

const handle = makeHandle(true);
const plainHandle = makeHandle(false);
const { auth } = handle;

const orgIds: string[] = [];
const userIds: string[] = [];
const emails: string[] = [];
const tokens: string[] = [];

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
  clock = START;
  lockoutMails.length = 0;
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
  await plainHandle.close();
  await db.destroy();
});

// A fresh client address per request, so the Better Auth rate limit never answers.
const nextIp = () => `10.${randomInt(1, 250)}.${randomInt(1, 250)}.${randomInt(1, 250)}`;

async function createOwner() {
  const email = `lockout-${randomUUID()}@x.test`;
  const { orgId, userId } = await createOrganizationWithOwner(db, {
    orgName: "Lockout",
    timezone: "Europe/Warsaw",
    email,
    displayName: "Owner",
  });
  orgIds.push(orgId);
  userIds.push(userId);
  emails.push(email);
  await setPassword(email, PASSWORD);
  return { email, orgId, userId };
}

async function setPassword(email: string, password: string): Promise<void> {
  resets.length = 0;
  await auth.api.requestPasswordReset({ body: { email, redirectTo: `${BASE_URL}/setup` } });
  const mail = resets[0];
  if (!mail) throw new Error("no reset mail captured");
  const token = new URL(mail.url).pathname.split("/").pop() ?? "";
  tokens.push(token);
  await auth.api.resetPassword({ body: { newPassword: password, token } });
}

function signIn(
  email: string,
  password: string,
  via: AuthHandle = handle,
  extra: Record<string, unknown> = {}
): Promise<Response> {
  return via.auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { origin: BASE_URL, "content-type": "application/json", "x-client-ip": nextIp() },
      body: JSON.stringify({ email, password, ...extra }),
    })
  );
}

async function wrong(email: string, times: number): Promise<Response[]> {
  const answers: Response[] = [];
  for (let i = 0; i < times; i += 1) answers.push(await signIn(email, WRONG_PASSWORD));
  return answers;
}

async function row(userId: string) {
  const result = await sql<{ failed_count: number; locked_until: Date | null }>`
    SELECT failed_count, locked_until FROM auth_lockouts WHERE user_id = ${userId}
  `.execute(db);
  return result.rows[0];
}

async function lockedAudit(orgId: string) {
  return db
    .selectFrom("audit_log")
    .selectAll()
    .where("org_id", "=", orgId)
    .where("event", "=", "web.login_locked")
    .execute();
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

async function lockUser(email: string): Promise<void> {
  await wrong(email, 10);
}

describe("lockout", () => {
  test("10 wrong passwords lock; the 10th answers like the 1st; one audit row and one mail", async () => {
    const { email, orgId, userId } = await createOwner();
    const answers = await wrong(email, 10);
    const first = await answers[0]?.text();
    expect(answers[0]?.status).toBe(401);
    expect(answers[9]?.status).toBe(401);
    expect(await answers[9]?.text()).toBe(first);
    expect((await row(userId))?.locked_until?.toISOString()).toBe("2026-11-20T10:15:00.000Z");
    const audit = await lockedAudit(orgId);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.data).toEqual({ via: "web", locked_until: "2026-11-20T10:15:00.000Z" });
    expect(lockoutMails).toEqual([{ userId, email }]);
  });

  test("locked: the correct password fails like a wrong one, and failures during the lock are not counted", async () => {
    const { email, userId } = await createOwner();
    const [firstWrong] = await wrong(email, 1);
    const wrongBody = (await firstWrong?.text()) ?? "";
    await wrong(email, 9);
    const locked = await signIn(email, PASSWORD);
    expect(locked.status).toBe(401);
    expect(await locked.text()).toBe(wrongBody);
    expect(locked.headers.get("set-cookie")).toBeNull();
    await signIn(email, WRONG_PASSWORD);
    expect((await row(userId))?.failed_count).toBe(0);
  });

  test("after the lock the correct password signs in", async () => {
    const { email } = await createOwner();
    await lockUser(email);
    clock = new Date("2026-11-20T10:15:01Z");
    const answer = await signIn(email, PASSWORD);
    expect(answer.status).toBe(200);
    expect(answer.headers.get("set-cookie")).toContain("ea.session_token");
  });

  test("a password reset ends the lock", async () => {
    const { email, userId } = await createOwner();
    await lockUser(email);
    expect((await row(userId))?.locked_until).not.toBeNull();
    await setPassword(email, NEW_PASSWORD);
    expect((await row(userId))?.locked_until).toBeNull();
    expect((await signIn(email, NEW_PASSWORD)).status).toBe(200);
  });

  test("at most 3 lockout mails per UTC day", async () => {
    const { email } = await createOwner();
    for (let round = 0; round < 4; round += 1) {
      clock = new Date(START.getTime() + round * 16 * 60_000);
      await lockUser(email);
    }
    expect(lockoutMails).toHaveLength(3);
    clock = new Date("2026-11-21T00:10:00Z");
    await lockUser(email);
    expect(lockoutMails).toHaveLength(4);
  });

  test("failures older than the window do not count", async () => {
    const { email, userId } = await createOwner();
    await wrong(email, 9);
    clock = new Date(START.getTime() + 16 * 60_000);
    await wrong(email, 1);
    expect(await row(userId)).toMatchObject({ failed_count: 1, locked_until: null });
  });

  test("a success resets the count", async () => {
    const { email, userId } = await createOwner();
    await wrong(email, 9);
    expect((await signIn(email, PASSWORD)).status).toBe(200);
    await wrong(email, 1);
    expect(await row(userId)).toMatchObject({ failed_count: 1, locked_until: null });
  });

  test("an unknown address: the same 401 and no row", async () => {
    const { email } = await createOwner();
    const [reference] = await wrong(email, 1);
    const referenceBody = (await reference?.text()) ?? "";
    const before = await sql<{ n: string }>`SELECT count(*) AS n FROM auth_lockouts`.execute(db);
    const answers = await Promise.all(
      Array.from({ length: 12 }, () => signIn(`nobody-${randomUUID()}@x.test`, WRONG_PASSWORD))
    );
    for (const answer of answers) {
      expect(answer.status).toBe(401);
      expect(await answer.text()).toBe(referenceBody);
    }
    const after = await sql<{ n: string }>`SELECT count(*) AS n FROM auth_lockouts`.execute(db);
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });

  test("median time of a locked sign-in is near a wrong password", async () => {
    const fresh = await createOwner();
    const locked = await createOwner();
    await lockUser(locked.email);
    const time = async (email: string, password: string) => {
      const started = performance.now();
      await signIn(email, password);
      return performance.now() - started;
    };
    const wrongTimes: number[] = [];
    const lockedTimes: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      wrongTimes.push(await time(fresh.email, WRONG_PASSWORD));
      lockedTimes.push(await time(locked.email, PASSWORD));
    }
    const ratio = median(lockedTimes) / median(wrongTimes);
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(2);
  });

  test("two parallel 10th failures lock once", async () => {
    const { email, orgId, userId } = await createOwner();
    await wrong(email, 9);
    expect((await row(userId))?.failed_count).toBe(9);
    await Promise.all([signIn(email, WRONG_PASSWORD), signIn(email, WRONG_PASSWORD)]);
    expect(await lockedAudit(orgId)).toHaveLength(1);
    expect(lockoutMails).toHaveLength(1);
  });

  test("without a lockout store 11 wrong passwords do not lock", async () => {
    const { email } = await createOwner();
    for (let i = 0; i < 11; i += 1) await signIn(email, WRONG_PASSWORD, plainHandle);
    expect((await signIn(email, PASSWORD, plainHandle)).status).toBe(200);
  });

  test("no log line holds the password or an address", () => {
    const lines = [...logSpy.mock.calls, ...errorSpy.mock.calls, ...warnSpy.mock.calls].map((call) => call.join(" "));
    expect(lines.length).toBeGreaterThan(0);
    expect(emails.length).toBeGreaterThan(0);
    expect(tokens.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toContain("reset-password/");
      for (const secret of [PASSWORD, WRONG_PASSWORD, NEW_PASSWORD, ...emails, ...tokens]) {
        expect(line).not.toContain(secret);
      }
    }
  });

  test("a bad address or a long password answers 400 for any user and does not count", async () => {
    const locked = await createOwner();
    const open = await createOwner();
    await lockUser(locked.email);
    await wrong(open.email, 2);
    const answers = async (email: string) => {
      const space = await signIn(` ${email}`, PASSWORD);
      const long = await signIn(email, "x".repeat(129));
      return { space: [space.status, await space.text()], long: [long.status, await long.text()] };
    };
    const lockedAnswers = await answers(locked.email);
    const openAnswers = await answers(open.email);
    expect(lockedAnswers).toEqual(openAnswers);
    expect(lockedAnswers.space[0]).toBe(400);
    expect(lockedAnswers.space[1]).toContain("INVALID_EMAIL");
    expect(lockedAnswers.long[0]).toBe(400);
    expect(lockedAnswers.long[1]).toContain("PASSWORD_TOO_LONG");
    expect((await row(locked.userId))?.failed_count).toBe(0);
    expect((await row(open.userId))?.failed_count).toBe(2);
  });

  test("a body the endpoint refuses answers the same 400 for a locked user, a free user and an unknown address", async () => {
    const locked = await createOwner();
    const open = await createOwner();
    await lockUser(locked.email);
    await wrong(open.email, 2);
    const unknown = `nobody-${randomUUID()}@x.test`;
    for (const extra of [{ rememberMe: "x" }, { callbackURL: 5 }]) {
      const answers: [number, string][] = [];
      for (const email of [locked.email, open.email, unknown]) {
        const answer = await signIn(email, PASSWORD, handle, extra);
        answers.push([answer.status, await answer.text()]);
      }
      expect(answers[0]?.[0]).toBe(400);
      expect(answers[1]).toEqual(answers[0]);
      expect(answers[2]).toEqual(answers[0]);
    }
    expect((await row(locked.userId))?.failed_count).toBe(0);
    expect((await row(open.userId))?.failed_count).toBe(2);
  });
});
