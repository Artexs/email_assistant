import { randomBytes, randomInt, randomUUID } from "node:crypto";

import { orgDeleteResponseSchema } from "@ea/core";
import { hashPassword } from "better-auth/crypto";
import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { sql } from "kysely";

import { insertMailbox } from "../../src/modules/mail/repo";
import { createOrganizationWithOwner, upsertOrgFeature } from "../../src/modules/tenancy";
import { insertMembership, insertUser } from "../../src/modules/tenancy/repo";
import { LOCKOUT_MAX_FAILURES } from "../../src/platform/auth-lockout";
import { loadConfig } from "../../src/platform/config";
import { createSecretBox } from "../../src/platform/crypto";
import { createApp } from "../../src/platform/http";
import { setLogLevel } from "../../src/platform/log";
import { webDeps, type WebRuntime } from "../../src/web";

import { testCapabilities } from "./fixtures";
import { testDb } from "./helpers";
import { TEST_ORIGIN } from "./web-helpers";

const db = testDb();
const run = randomUUID();

const ORG_NAME = "Acme Test";
const PASSWORD = `MARKER-PASSWORD-${run}-long`;
const WRONG_PASSWORD = `MARKER-WRONG-PASSWORD-${run}`;
const WRONG_NAME = `MARKER-WRONG-NAME-${run}`;
// Strings that must stay out of every log line, error body and audit row (D17), except the 200 body of test 1.
const FORBIDDEN = [PASSWORD, WRONG_PASSWORD, WRONG_NAME, "Acme", "acme test", "@x.test"];

let web: WebRuntime;
let app: ReturnType<typeof createApp>;

// Everything the other tests print, answer or write to the audit log, for test 10. A recorder starts after the rows are seeded.
let recording = false;
const lines: string[] = [];
const answers: string[] = [];
const spies: { mockRestore(): void }[] = [];

const orgIds: string[] = [];
const userIds: string[] = [];

beforeAll(() => {
  const record =
    (): ((...args: unknown[]) => void) =>
    (...args) => {
      if (recording) lines.push(args.map(String).join(" "));
    };
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    spies.push(spyOn(console, method).mockImplementation(record()));
  }
  const key = randomBytes(32).toString("base64");
  const opened = webDeps(
    loadConfig({
      ...process.env,
      WEB_BASE_URL: TEST_ORIGIN,
      WEB_AUTH_SECRET: "x".repeat(40),
      WEB_DIST: "/nonexistent/dist",
    }),
    db,
    { secrets: createSecretBox(key, 1), actionsScope: { kind: "off" }, botUsername: null }
  );
  if (opened === null) throw new Error("webDeps returned null");
  web = opened;
  // A fresh client address per request, so the Better Auth rate limit never answers.
  app = createApp({
    checkDb: async () => true,
    web: { ...web, connInfo: () => `10.${randomInt(1, 250)}.${randomInt(1, 250)}.${randomInt(1, 250)}` },
  });
  setLogLevel("debug");
});

afterEach(async () => {
  recording = false;
  for (const orgId of orgIds) await db.deleteFrom("organizations").where("id", "=", orgId).execute();
  if (userIds.length > 0) {
    await sql`DELETE FROM auth_verifications WHERE value IN (${sql.join(userIds)})`.execute(db);
    await db.deleteFrom("users").where("id", "in", userIds).execute();
  }
  orgIds.length = 0;
  userIds.length = 0;
});

afterAll(async () => {
  setLogLevel("info");
  for (const spy of spies) spy.mockRestore();
  await web.close();
  await db.destroy();
});

async function givePassword(userId: string): Promise<void> {
  await db
    .insertInto("auth_accounts")
    .values({
      account_id: userId,
      provider_id: "credential",
      user_id: userId,
      password: await hashPassword(PASSWORD),
      access_token: null,
      access_token_expires_at: null,
      id_token: null,
      refresh_token: null,
      refresh_token_expires_at: null,
      scope: null,
    })
    .execute();
}

async function signIn(email: string): Promise<string> {
  const res = await app.request("/api/auth/sign-in/email", {
    method: "POST",
    headers: { origin: TEST_ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(res.status).toBe(200);
  return (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

interface Seed {
  orgId: string;
  ownerId: string;
  ownerCookie: string;
  assistantCookie: string;
  addresses: string[];
}

// An organization "Acme Test" with an owner and an assistant (both can sign in), two mailboxes and the flag `org_delete`.
async function seed(opts: { flag?: boolean; plan?: "suspended" } = {}): Promise<Seed> {
  const id = randomUUID();
  const ownerEmail = `owner-${id}@x.test`;
  const { orgId, userId: ownerId } = await createOrganizationWithOwner(db, {
    orgName: ORG_NAME,
    timezone: "Europe/Warsaw",
    email: ownerEmail,
    displayName: "Owner",
  });
  orgIds.push(orgId);
  userIds.push(ownerId);
  const assistantEmail = `assistant-${id}@x.test`;
  const { id: assistantId } = await insertUser(db, { email: assistantEmail, displayName: "Assistant" });
  userIds.push(assistantId);
  await insertMembership(db, { orgId }, { userId: assistantId, role: "assistant" });
  await givePassword(ownerId);
  await givePassword(assistantId);

  const addresses = [`zeta-${id}@x.test`, `alpha-${id}@x.test`];
  for (const address of addresses) {
    await insertMailbox(
      db,
      { orgId },
      {
        id: randomUUID(),
        address,
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: testCapabilities,
        folderMap: {},
      }
    );
  }
  if (opts.flag !== false) {
    await upsertOrgFeature(db, { orgId }, { flag: "org_delete", enabled: true, setBy: ownerId, setAt: new Date() });
  }
  if (opts.plan === "suspended") await sql`UPDATE organizations SET plan = 'suspended' WHERE id = ${orgId}`.execute(db);
  const ownerCookie = await signIn(ownerEmail);
  const assistantCookie = await signIn(assistantEmail);
  recording = true;
  return { orgId, ownerId, ownerCookie, assistantCookie, addresses: [...addresses].sort() };
}

async function remove(
  cookie: string,
  body: unknown,
  opts: { keep?: boolean; origin?: boolean } = {}
): Promise<{ status: number; json: Record<string, unknown>; headers: Headers }> {
  const res = await app.request("/api/organization", {
    method: "DELETE",
    headers: {
      cookie,
      ...(opts.origin === false ? {} : { origin: TEST_ORIGIN }),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  // The 200 body of test 1 lists the mailbox addresses on purpose: the caller keeps it out of the record.
  if (opts.keep !== true) answers.push(text);
  return { status: res.status, json: text ? (JSON.parse(text) as Record<string, unknown>) : {}, headers: res.headers };
}

const right = { password: PASSWORD, confirmName: "acme test" };
const orgCount = async (orgId: string): Promise<number> =>
  (await db.selectFrom("organizations").select("id").where("id", "=", orgId).execute()).length;
async function refusedRows(orgId: string) {
  const rows = await db
    .selectFrom("audit_log")
    .select(["actor", "data"])
    .where("org_id", "=", orgId)
    .where("event", "=", "org.delete_refused")
    .execute();
  answers.push(JSON.stringify(rows));
  return rows;
}
const failedCount = async (userId: string): Promise<number | undefined> =>
  (await db.selectFrom("auth_lockouts").select("failed_count").where("user_id", "=", userId).executeTakeFirst())
    ?.failed_count;

describe("DELETE /api/organization", () => {
  test("1: the owner with the right password and name deletes the organization and ends the session", async () => {
    const s = await seed();
    const res = await remove(s.ownerCookie, right, { keep: true });
    expect(res.status).toBe(200);
    expect(orgDeleteResponseSchema.parse(res.json).mailboxAddresses).toEqual(s.addresses);
    expect(await orgCount(s.orgId)).toBe(0);
    const expired = res.headers.getSetCookie().find((line) => line.startsWith("ea.session_token="));
    expect(expired).toMatch(/^ea\.session_token=;/);
    expect(expired).toContain("Max-Age=0");
    expect(expired).toContain("Path=/");
    expect(expired).toContain("HttpOnly");
    expect(expired?.toLowerCase()).toContain("samesite=lax");
    const me = await app.request("/api/me", { headers: { cookie: s.ownerCookie } });
    expect(me.status).toBe(401);
  });

  test("2: the flag off answers 404 and the organization stays", async () => {
    const s = await seed({ flag: false });
    const res = await remove(s.ownerCookie, right);
    expect({ status: res.status, json: res.json }).toEqual({ status: 404, json: { error: "not_found" } });
    expect(await orgCount(s.orgId)).toBe(1);
  });

  test("3: an assistant gets 403 owner_only, also with the flag off; a bad body answers 400 validation", async () => {
    const s = await seed();
    const refused = await remove(s.assistantCookie, right);
    expect({ status: refused.status, json: refused.json }).toEqual({ status: 403, json: { error: "owner_only" } });
    expect(await orgCount(s.orgId)).toBe(1);
    expect(await refusedRows(s.orgId)).toEqual([]);

    const bad = await remove(s.ownerCookie, { password: "", confirmName: "acme test" });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toBe("validation");
    const noCookie = await app.request("/api/organization", {
      method: "DELETE",
      headers: { origin: TEST_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify(right),
    });
    expect(noCookie.status).toBe(401);

    await db.deleteFrom("org_features").where("org_id", "=", s.orgId).execute();
    const flagOff = await remove(s.assistantCookie, right);
    expect(flagOff.status).toBe(403);
  });

  test("4: a wrong name answers 400 wrong_name and writes no audit row and no lockout count", async () => {
    const s = await seed();
    const res = await remove(s.ownerCookie, { password: PASSWORD, confirmName: WRONG_NAME });
    expect({ status: res.status, json: res.json }).toEqual({ status: 400, json: { error: "wrong_name" } });
    expect(await refusedRows(s.orgId)).toEqual([]);
    expect(await failedCount(s.ownerId)).toBeUndefined();
    // A wrong name with a wrong password is still only a wrong name: the name check comes first.
    const both = await remove(s.ownerCookie, { password: WRONG_PASSWORD, confirmName: WRONG_NAME });
    expect(both.json).toEqual({ error: "wrong_name" });
    expect(await failedCount(s.ownerId)).toBeUndefined();
    expect(await orgCount(s.orgId)).toBe(1);
  });

  test("5: a wrong password answers 400 wrong_password, writes one audit row and counts one failure", async () => {
    const s = await seed();
    const res = await remove(s.ownerCookie, { password: WRONG_PASSWORD, confirmName: "acme test" });
    expect({ status: res.status, json: res.json }).toEqual({ status: 400, json: { error: "wrong_password" } });
    expect(await refusedRows(s.orgId)).toEqual([{ actor: s.ownerId, data: { reason: "wrong_password", via: "web" } }]);
    expect(await failedCount(s.ownerId)).toBe(1);
    expect(await orgCount(s.orgId)).toBe(1);
  });

  test("6: ten wrong passwords lock the user; the right password then answers 429 locked", async () => {
    const s = await seed();
    for (let i = 1; i <= LOCKOUT_MAX_FAILURES; i++) {
      const res = await remove(s.ownerCookie, { password: WRONG_PASSWORD, confirmName: "acme test" });
      expect({ i, status: res.status, json: res.json }).toEqual({ i, status: 400, json: { error: "wrong_password" } });
    }
    const lock = await db
      .selectFrom("auth_lockouts")
      .select("locked_until")
      .where("user_id", "=", s.ownerId)
      .executeTakeFirstOrThrow();
    expect(lock.locked_until?.getTime()).toBeGreaterThan(Date.now());
    expect(await refusedRows(s.orgId)).toHaveLength(LOCKOUT_MAX_FAILURES);
    const locked = await remove(s.ownerCookie, right);
    expect({ status: locked.status, json: locked.json }).toEqual({ status: 429, json: { error: "locked" } });
    expect(await orgCount(s.orgId)).toBe(1);
  });

  test("a right password does not reset the lockout count", async () => {
    const s = await seed();
    await remove(s.ownerCookie, { password: WRONG_PASSWORD, confirmName: "acme test" });
    // A right password with a wrong name stops at the name check and leaves the count as it is.
    await remove(s.ownerCookie, { password: PASSWORD, confirmName: WRONG_NAME });
    expect(await failedCount(s.ownerId)).toBe(1);
  });

  test("7: a suspended organization can delete itself", async () => {
    const s = await seed({ plan: "suspended" });
    const res = await remove(s.ownerCookie, right, { keep: true });
    expect(res.status).toBe(200);
    expect(await orgCount(s.orgId)).toBe(0);
  });

  test("9: a request without Origin answers 403 bad_origin", async () => {
    const s = await seed();
    const res = await remove(s.ownerCookie, right, { origin: false });
    expect({ status: res.status, json: res.json }).toEqual({ status: 403, json: { error: "bad_origin" } });
    expect(await orgCount(s.orgId)).toBe(1);
  });

  // Test 8 (the route matrix of a suspended organization) is in web-suspended.test.ts.
  test("10: no log line, answer or audit row of the other tests holds a password, a name or an address", () => {
    expect(lines.length).toBeGreaterThan(0);
    expect(answers.length).toBeGreaterThan(0);
    for (const text of [...lines, ...answers]) {
      for (const marker of FORBIDDEN)
        expect({ marker, text: text.includes(marker) ? text : "" }).toEqual({ marker, text: "" });
    }
  });
});
