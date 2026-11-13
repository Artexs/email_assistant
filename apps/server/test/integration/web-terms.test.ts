import { randomInt, randomUUID } from "node:crypto";

import { TERMS_VERSION } from "@ea/core";
import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { sql } from "kysely";

import { createOrganizationWithOwner, isOrgSuspended, tenancyRoutes } from "../../src/modules/tenancy";
import { createAuth, type AuthHandle } from "../../src/platform/auth";
import { setLogLevel } from "../../src/platform/log";
import { auditWebEvent, countMailboxes, onboardingDeps, termsAcceptedHandler } from "../../src/web";

import { testDb } from "./helpers";
import { as, resetBody, webOrg, webTestApp, type WebOrg } from "./web-helpers";

const db = testDb();

const BASE_URL = "http://127.0.0.1:8080";
const PASSWORD = "correct-horse-battery-staple";
const NEW_PASSWORD = "another-long-passphrase-42";
const off = { kind: "off", reason: "env_off" } as const;

const resets: { userId: string; url: string }[] = [];
const checked: string[] = [];

const makeHandle = (overrides: Partial<Parameters<typeof createAuth>[0]> = {}): AuthHandle =>
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
    pwnedCheck: async (password: string) => {
      checked.push(password);
      return "ok";
    },
    ...overrides,
  });

const handles: AuthHandle[] = [];
const track = (made: AuthHandle): AuthHandle => {
  handles.push(made);
  return made;
};
const handle = track(makeHandle());

const orgIds: string[] = [];
const userIds: string[] = [];
const webOrgs: WebOrg[] = [];
let logSpies: ReturnType<typeof spyOn>[] = [];
let errorSpy: ReturnType<typeof spyOn<Console, "error">>;
// N-b: every console line of the file, and every address and token it used, for the sweep at the end.
const lines: string[] = [];
const emails: string[] = [];
const tokens: string[] = [];
const capture = (...args: unknown[]): void => {
  lines.push(args.map(String).join(" "));
};

beforeAll(() => {
  errorSpy = spyOn(console, "error").mockImplementation(capture);
  logSpies = [
    errorSpy,
    spyOn(console, "log").mockImplementation(capture),
    spyOn(console, "warn").mockImplementation(capture),
  ];
});

afterEach(async () => {
  setLogLevel("info");
  resets.length = 0;
  checked.length = 0;
  errorSpy.mockClear();
  if (userIds.length > 0) {
    await sql`DELETE FROM auth_verifications WHERE value IN (${sql.join(userIds)})`.execute(db);
  }
  for (const orgId of orgIds) {
    await db.deleteFrom("organizations").where("id", "=", orgId).execute();
  }
  if (userIds.length > 0) {
    await db.deleteFrom("users").where("id", "in", userIds).execute();
  }
  for (const org of webOrgs) await org.cleanup();
  orgIds.length = 0;
  userIds.length = 0;
  webOrgs.length = 0;
});

afterAll(async () => {
  for (const spy of logSpies) spy.mockRestore();
  for (const each of handles) await each.close();
  await db.destroy();
});

// A fresh client address per request, so the Better Auth rate limit never answers.
const nextIp = () => `10.${randomInt(1, 250)}.${randomInt(1, 250)}.${randomInt(1, 250)}`;

function post(via: AuthHandle, path: string, body: unknown): Promise<Response> {
  return via.auth.handler(
    new Request(`${BASE_URL}/api/auth/${path}`, {
      method: "POST",
      headers: { origin: BASE_URL, "content-type": "application/json", "x-client-ip": nextIp() },
      body: JSON.stringify(body),
    })
  );
}

async function code(response: Response): Promise<unknown> {
  return ((await response.json()) as { code?: unknown }).code;
}

async function createUser() {
  const email = `terms-${randomUUID()}@x.test`;
  const { orgId, userId } = await createOrganizationWithOwner(db, {
    orgName: "Terms",
    timezone: "Europe/Warsaw",
    email,
    displayName: "Owner",
  });
  orgIds.push(orgId);
  userIds.push(userId);
  return { email, orgId, userId };
}

async function resetToken(via: AuthHandle, email: string): Promise<string> {
  resets.length = 0;
  await via.auth.api.requestPasswordReset({ body: { email, redirectTo: `${BASE_URL}/setup` } });
  const mail = resets[0];
  if (!mail) throw new Error("no reset mail captured");
  const token = new URL(mail.url).pathname.split("/").pop() ?? "";
  emails.push(email);
  tokens.push(token);
  return token;
}

const termsOf = (userId: string) =>
  db
    .selectFrom("users")
    .select(["terms_version", "terms_accepted_at"])
    .where("id", "=", userId)
    .executeTakeFirstOrThrow();

const termsRows = (orgId: string) =>
  db
    .selectFrom("audit_log")
    .selectAll()
    .where("org_id", "=", orgId)
    .where("event", "=", "web.terms_accepted")
    .execute();

const signIn = (email: string, password: string) => post(handle, "sign-in/email", { email, password });

describe("terms on the password reset", () => {
  test("a reset without termsVersion is refused; nothing changes; the same token then works with the field", async () => {
    const { email, userId } = await createUser();
    const token = await resetToken(handle, email);
    const first = await post(handle, "reset-password", { newPassword: PASSWORD, token });
    expect(first.status).toBe(400);
    expect(await code(first)).toBe("TERMS_REQUIRED");
    expect((await signIn(email, PASSWORD)).status).toBe(401);
    expect((await termsOf(userId)).terms_version).toBeNull();
    const second = await post(handle, "reset-password", resetBody(PASSWORD, token));
    expect(second.status).toBe(200);
    expect((await signIn(email, PASSWORD)).status).toBe(200);
  });

  test("a refused reset leaves the old password working", async () => {
    const { email } = await createUser();
    const token = await resetToken(handle, email);
    expect((await post(handle, "reset-password", resetBody(PASSWORD, token))).status).toBe(200);
    const again = await resetToken(handle, email);
    const refused = await post(handle, "reset-password", { newPassword: NEW_PASSWORD, token: again });
    expect(refused.status).toBe(400);
    expect((await signIn(email, PASSWORD)).status).toBe(200);
    expect((await signIn(email, NEW_PASSWORD)).status).toBe(401);
  });

  test("an old termsVersion is refused", async () => {
    const { email, userId } = await createUser();
    const token = await resetToken(handle, email);
    const answer = await post(handle, "reset-password", { newPassword: PASSWORD, token, termsVersion: "2000-01-01" });
    expect(answer.status).toBe(400);
    expect(await code(answer)).toBe("TERMS_REQUIRED");
    expect((await termsOf(userId)).terms_version).toBeNull();
  });

  test("the current termsVersion sets the columns and writes one audit row", async () => {
    const { email, orgId, userId } = await createUser();
    const token = await resetToken(handle, email);
    expect((await post(handle, "reset-password", resetBody(PASSWORD, token))).status).toBe(200);
    const terms = await termsOf(userId);
    expect(terms.terms_version).toBe(TERMS_VERSION);
    expect(terms.terms_accepted_at).not.toBeNull();
    const rows = await termsRows(orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor).toBe(userId);
    expect(rows[0]?.data).toMatchObject({ via: "web", version: TERMS_VERSION });
  });

  test("without the field the pwned check is not called", async () => {
    const { email } = await createUser();
    const token = await resetToken(handle, email);
    expect((await post(handle, "reset-password", { newPassword: PASSWORD, token })).status).toBe(400);
    expect(checked).toEqual([]);
    expect((await post(handle, "reset-password", resetBody(PASSWORD, token))).status).toBe(200);
    expect(checked).toEqual([PASSWORD]);
  });

  test("an onTermsAccepted that throws does not fail the reset; the log holds the user id and no address", async () => {
    const { email, userId } = await createUser();
    const failing = track(
      makeHandle({
        onTermsAccepted: async () => {
          throw new Error(`boom ${email}`);
        },
      })
    );
    const token = await resetToken(failing, email);
    const answer = await post(failing, "reset-password", resetBody(PASSWORD, token));
    expect(answer.status).toBe(200);
    const lines = errorSpy.mock.calls
      .map((call) => call.join(" "))
      .filter((line) => line.includes("terms_record_failed"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(userId);
    expect(lines[0]).not.toContain(email);
    expect(lines[0]).not.toContain("@");
  });
});

describe("terms in the panel", () => {
  const appFor = (org: WebOrg) =>
    webTestApp({
      db,
      sessions: { owner: org.ownerId, assistant: org.assistantId },
      isOrgSuspended: (orgId) => isOrgSuspended(db, { orgId }),
      routers: (api) =>
        api.route(
          "/",
          tenancyRoutes({
            db,
            now: () => new Date(),
            scopes: { triage: off, actions: off, send: off },
            countMailboxes: countMailboxes(db),
            operatorContact: null,
            sessions: async () => [],
            ...onboardingDeps(db, async () => "fake_ea_bot"),
          })
        ),
    });

  const setup = async () => {
    const org = await webOrg(db);
    webOrgs.push(org);
    return org;
  };

  const meTerms = async (app: ReturnType<typeof appFor>, cookie: string) => {
    const res = await app.request("/api/me", as(cookie));
    expect(res.status).toBe(200);
    return ((await res.json()) as { terms: unknown }).terms;
  };

  test("GET /api/me shows accepted false for a NULL terms_version, true after the post", async () => {
    const org = await setup();
    const app = appFor(org);
    expect(await meTerms(app, "owner")).toEqual({ accepted: false, current: TERMS_VERSION });
    const res = await app.request("/api/me/terms", as("owner", { method: "POST", body: { version: TERMS_VERSION } }));
    expect(res.status).toBe(204);
    expect(await meTerms(app, "owner")).toEqual({ accepted: true, current: TERMS_VERSION });
  });

  test("POST /api/me/terms sets the columns and one audit row; an old version is 409; {} is 400; no session is 401", async () => {
    const org = await setup();
    const app = appFor(org);
    const old = await app.request(
      "/api/me/terms",
      as("assistant", { method: "POST", body: { version: "2000-01-01" } })
    );
    expect(old.status).toBe(409);
    expect(await old.json()).toEqual({ error: "terms_outdated" });
    expect((await termsOf(org.assistantId)).terms_version).toBeNull();
    expect(await termsRows(org.orgId)).toHaveLength(0);

    const empty = await app.request("/api/me/terms", as("assistant", { method: "POST", body: {} }));
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as { error: string }).error).toBe("validation");

    const none = await app.request("/api/me/terms", as("nobody", { method: "POST", body: { version: TERMS_VERSION } }));
    expect(none.status).toBe(401);

    const ok = await app.request(
      "/api/me/terms",
      as("assistant", { method: "POST", body: { version: TERMS_VERSION } })
    );
    expect(ok.status).toBe(204);
    const terms = await termsOf(org.assistantId);
    expect(terms.terms_version).toBe(TERMS_VERSION);
    expect(terms.terms_accepted_at).not.toBeNull();
    const rows = await termsRows(org.orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor).toBe(org.assistantId);
    expect(rows[0]?.data).toMatchObject({ via: "web", version: TERMS_VERSION });
  });

  test("a second POST /api/me/terms answers 204 and changes nothing: one audit row, the same time", async () => {
    const org = await setup();
    const app = appFor(org);
    const send = () => app.request("/api/me/terms", as("owner", { method: "POST", body: { version: TERMS_VERSION } }));
    expect((await send()).status).toBe(204);
    const first = await termsOf(org.ownerId);
    expect((await send()).status).toBe(204);
    expect(await termsOf(org.ownerId)).toEqual(first);
    expect(await termsRows(org.orgId)).toHaveLength(1);
  });

  test("a suspended organization still takes the terms, and still refuses other writes", async () => {
    const org = await setup();
    await db.updateTable("organizations").set({ plan: "suspended" }).where("id", "=", org.orgId).execute();
    const app = appFor(org);
    const ok = await app.request("/api/me/terms", as("owner", { method: "POST", body: { version: TERMS_VERSION } }));
    expect(ok.status).toBe(204);
    const patch = await app.request(
      "/api/organization",
      as("owner", { method: "PATCH", body: { timezone: "Europe/Paris" } })
    );
    expect(patch.status).toBe(403);
    expect(await patch.json()).toEqual({ error: "org_suspended" });
  });
});

describe("log", () => {
  test("no log line holds a password, an address, a token or a reset link", () => {
    expect(lines.length).toBeGreaterThan(0);
    expect(emails.length).toBeGreaterThan(0);
    expect(tokens.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toContain("reset-password/");
      for (const secret of [PASSWORD, NEW_PASSWORD, ...emails, ...tokens]) {
        expect(line).not.toContain(secret);
      }
    }
  });
});
