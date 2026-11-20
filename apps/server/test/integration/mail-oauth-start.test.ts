import { randomBytes, randomUUID } from "node:crypto";
import { format, inspect } from "node:util";

import { mailOAuthOptionsSchema, mailOAuthStartResultSchema, MINUTE_MS } from "@ea/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test, type Mock } from "bun:test";
import { sql } from "kysely";

import {
  consumeOAuthState,
  createMailOAuthClients,
  createOAuthState,
  mailOAuthRoutes,
  OAuthStateRefusedError,
  type MailOAuthClients,
  type MailOAuthProvider,
  type OAuthStart,
} from "../../src/modules/mail";
import { challengeOf, OAUTH_STATE_CAP, OAUTH_STATE_TTL_MS, stateHashOf } from "../../src/modules/mail/oauth/state";
import { insertInboxFolder, insertMailbox } from "../../src/modules/mail/repo";
import { setOrgFeature } from "../../src/modules/tenancy";
import { insertMembership, insertUser } from "../../src/modules/tenancy/repo";
import { loadConfig } from "../../src/platform/config";
import { createSecretBox } from "../../src/platform/crypto";
import { droppedLogFields } from "../../src/platform/log";
import { openApiSpec } from "../../src/platform/openapi";
import { startFakeMailOAuth, type FakeMailOAuth } from "../fake-mail-oauth";

import { testCapabilities } from "./fixtures";
import { testDb } from "./helpers";
import { as, TEST_ORIGIN, webOrg, webTestApp, type WebOrg } from "./web-helpers";

// The sign-in state (single use, hashed, encrypted verifier, binding to user and organization) and the start and options
// routes. Rows are committed, because the state store runs its own transactions. Times are set by SQL; the clock never moves.
const db = testDb();
const NOW = new Date("2026-11-15T10:00:00.000Z");
const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);
const HOSTS = {
  imap: { host: "127.0.0.1", port: 1993 },
  smtp: { host: "127.0.0.1", port: 1465, security: "tls" as const },
};

let fake: FakeMailOAuth;
let org: WebOrg;
let logLines: string[] = [];
let logSpies: Mock<(...args: unknown[]) => void>[] = [];

// The loaded config makes the clients: the redirect URI of a client comes from the config exactly.
function configWith(env: Record<string, string>) {
  return loadConfig({
    DATABASE_URL: "postgres://x",
    CREDENTIALS_KEY: randomBytes(32).toString("base64"),
    WEB_BASE_URL: TEST_ORIGIN,
    WEB_AUTH_SECRET: "x".repeat(32),
    ...env,
  });
}

beforeAll(async () => {
  fake = await startFakeMailOAuth();
});

afterAll(async () => {
  await fake.stop();
  await db.destroy();
});

beforeEach(async () => {
  org = await webOrg(db);
  captureLogs();
});

afterEach(async () => {
  for (const spy of logSpies) spy.mockRestore();
  logSpies = [];
  await org.cleanup();
});

function captureLogs(): void {
  logLines = [];
  for (const method of ["log", "error", "warn", "info", "debug"] as const) {
    const spy = spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logLines.push(format(...args));
    });
    logSpies.push(spy as unknown as Mock<(...args: unknown[]) => void>);
  }
}

function clientsOf(provider: MailOAuthProvider[]): MailOAuthClients {
  const env: Record<string, string> = {};
  for (const key of provider) {
    env[`MAIL_OAUTH_${key.toUpperCase()}_CLIENT_ID`] = fake.clientId;
    env[`MAIL_OAUTH_${key.toUpperCase()}_CLIENT_SECRET`] = fake.clientSecret;
  }
  return createMailOAuthClients(configWith(env), { specs: fake.specs(HOSTS) });
}

function appOf(use: MailOAuthClients) {
  return webTestApp({
    db,
    sessions: { owner: org.ownerId, assistant: org.assistantId, other: org.otherOwnerId },
    routers: (api) => api.route("/", mailOAuthRoutes({ db, now: () => NOW, secrets, clients: use })),
  });
}

const ctxA = () => ({ orgId: org.orgId });
const startOf = (provider: MailOAuthProvider, userId: string, mailboxId: string | null = null): OAuthStart => ({
  provider,
  userId,
  mailboxId,
});

const rowsOf = (userId: string) =>
  db.selectFrom("mailbox_oauth_states").selectAll().where("user_id", "=", userId).orderBy("created_at").execute();

async function addOAuthMailbox(orgId: string, provider: MailOAuthProvider | null, address: string): Promise<string> {
  const id = randomUUID();
  await insertMailbox(
    db,
    { orgId },
    {
      id,
      address,
      imapHost: "imap.x.test",
      imapPort: 993,
      smtpHost: "smtp.x.test",
      smtpPort: 465,
      capabilities: testCapabilities,
      folderMap: {},
    }
  );
  await insertInboxFolder(db, { orgId }, id);
  if (provider !== null) {
    await db.updateTable("mailboxes").set({ oauth_provider: provider }).where("id", "=", id).execute();
  }
  return id;
}

const stateOfUrl = (url: string): string => new URL(url).searchParams.get("state") ?? "";

async function start(app: ReturnType<typeof appOf>, who: string, provider: string, body: unknown = {}) {
  return app.request(`/api/mailboxes/oauth/${provider}/start`, as(who, { method: "POST", body }));
}

describe("the state store", () => {
  test("1. a row keeps the hash of the state and an encrypted verifier; the challenge is the S256 of the verifier", async () => {
    const before = Date.now();
    const made = await createOAuthState(db, secrets, ctxA(), startOf("google", org.ownerId), NOW);
    expect(made.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(made.codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [row] = await rowsOf(org.ownerId);
    expect(row?.state_hash).toBe(stateHashOf(made.state));
    expect(row?.provider).toBe("google");
    expect(row?.mailbox_id).toBeNull();
    expect(row?.org_id).toBe(org.orgId);
    expect(row?.expires_at.getTime()).toBe(NOW.getTime() + OAUTH_STATE_TTL_MS);
    expect(OAUTH_STATE_TTL_MS).toBe(10 * MINUTE_MS);
    // The verifier is only in the row as ciphertext with the AAD of the row; the decrypt gives the verifier of the challenge.
    const verifier = secrets.decrypt(
      { ciphertext: row?.encrypted_verifier ?? "", keyVersion: row?.key_version ?? 0 },
      `oauth_state:${row?.id}`
    );
    expect(challengeOf(verifier)).toBe(made.codeChallenge);
    for (const [name, value] of Object.entries(row ?? {})) {
      expect({ name, clear: String(value).includes(made.state) }).toEqual({ name, clear: false });
      expect({ name, clear: String(value).includes(verifier) }).toEqual({ name, clear: false });
    }
    expect(Date.now() - before).toBeLessThan(5_000);
    // Two starts never share a value.
    const second = await createOAuthState(db, secrets, ctxA(), startOf("google", org.ownerId), NOW);
    expect(second.state).not.toBe(made.state);
    expect(second.codeChallenge).not.toBe(made.codeChallenge);
  });

  test("2. consume with the right input gives the start and the verifier; a second call is invalid", async () => {
    const made = await createOAuthState(db, secrets, ctxA(), startOf("microsoft", org.ownerId), NOW);
    const input = { state: made.state, provider: "microsoft" as const, userId: org.ownerId };
    const first = await consumeOAuthState(db, secrets, ctxA(), input, NOW);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(challengeOf(first.verifier)).toBe(made.codeChallenge);
    expect(first.start).toEqual(startOf("microsoft", org.ownerId));
    expect(await rowsOf(org.ownerId)).toHaveLength(0);
    expect(await consumeOAuthState(db, secrets, ctxA(), input, NOW)).toEqual({
      ok: false,
      code: "oauth_state_invalid",
    });
  });

  test("3. two starts, two states: each is valid once, in any order", async () => {
    const one = await createOAuthState(db, secrets, ctxA(), startOf("google", org.ownerId), NOW);
    const two = await createOAuthState(db, secrets, ctxA(), startOf("google", org.ownerId), NOW);
    const input = (state: string) => ({ state, provider: "google" as const, userId: org.ownerId });
    expect((await consumeOAuthState(db, secrets, ctxA(), input(two.state), NOW)).ok).toBe(true);
    expect((await consumeOAuthState(db, secrets, ctxA(), input(one.state), NOW)).ok).toBe(true);
  });

  test("4. another user, another organization or another provider is invalid and the row stays", async () => {
    // V is a member of both organizations: only the organization filter can refuse the second case.
    const { id: both } = await insertUser(db, { email: `both-${randomUUID()}@x.test`, displayName: "Both" });
    await insertMembership(db, ctxA(), { userId: both, role: "assistant" });
    await insertMembership(db, { orgId: org.otherOrgId }, { userId: both, role: "owner" });
    const made = await createOAuthState(db, secrets, ctxA(), startOf("google", both), NOW);
    const invalid = { ok: false, code: "oauth_state_invalid" } as const;
    const same = { state: made.state, provider: "google" as const, userId: both };
    // Another user of the same organization.
    expect(await consumeOAuthState(db, secrets, ctxA(), { ...same, userId: org.ownerId }, NOW)).toEqual(invalid);
    // The other organization, the right user.
    expect(await consumeOAuthState(db, secrets, { orgId: org.otherOrgId }, same, NOW)).toEqual(invalid);
    // Another provider.
    expect(await consumeOAuthState(db, secrets, ctxA(), { ...same, provider: "microsoft" }, NOW)).toEqual(invalid);
    // A value this server never made.
    for (const state of ["", "x", made.state.slice(1), `${made.state}x`, "'; drop table users; --"]) {
      expect(await consumeOAuthState(db, secrets, ctxA(), { ...same, state }, NOW)).toEqual(invalid);
    }
    expect(await rowsOf(both)).toHaveLength(1);
    expect((await consumeOAuthState(db, secrets, ctxA(), same, NOW)).ok).toBe(true);
  });

  test("5. a state that expired by SQL is `oauth_state_expired` and its row is deleted", async () => {
    const made = await createOAuthState(db, secrets, ctxA(), startOf("google", org.ownerId), NOW);
    await sql`UPDATE mailbox_oauth_states SET expires_at = now() - interval '1 second' WHERE user_id = ${org.ownerId}`.execute(
      db
    );
    const result = await consumeOAuthState(
      db,
      secrets,
      ctxA(),
      { state: made.state, provider: "google", userId: org.ownerId },
      new Date()
    );
    expect(result).toEqual({ ok: false, code: "oauth_state_expired" });
    expect(await rowsOf(org.ownerId)).toHaveLength(0);
  });

  test("6. the cap: six starts leave five rows and the first is gone; a second user keeps its own rows", async () => {
    const hashes: string[] = [];
    for (let i = 0; i < OAUTH_STATE_CAP + 1; i += 1) {
      hashes.push(
        stateHashOf((await createOAuthState(db, secrets, ctxA(), startOf("google", org.ownerId), NOW)).state)
      );
    }
    const rows = await rowsOf(org.ownerId);
    expect(rows).toHaveLength(OAUTH_STATE_CAP);
    expect(rows.map((row) => row.state_hash)).toEqual(hashes.slice(1));
    await createOAuthState(db, secrets, ctxA(), startOf("google", org.assistantId), NOW);
    expect(await rowsOf(org.ownerId)).toHaveLength(OAUTH_STATE_CAP);
    expect(await rowsOf(org.assistantId)).toHaveLength(1);
  });

  test("7. parallel starts of one user never pass the cap", async () => {
    await Promise.all(
      Array.from({ length: 12 }, () => createOAuthState(db, secrets, ctxA(), startOf("microsoft", org.ownerId), NOW))
    );
    expect(await rowsOf(org.ownerId)).toHaveLength(OAUTH_STATE_CAP);
  });

  test("7b. single use under a parallel double consume: 8 parallel consumes on the pool, 20 rounds, exactly one winner each round", async () => {
    for (let round = 0; round < 20; round += 1) {
      const made = await createOAuthState(db, secrets, ctxA(), startOf("google", org.ownerId), NOW);
      const input = { state: made.state, provider: "google" as const, userId: org.ownerId };
      const results = await Promise.all(
        Array.from({ length: 8 }, () => consumeOAuthState(db, secrets, ctxA(), input, NOW))
      );
      expect({ round, wins: results.filter((result) => result.ok).length }).toEqual({ round, wins: 1 });
    }
    expect(await rowsOf(org.ownerId)).toHaveLength(0);
  });

  test("8. the binding: user U is a member of organization B only; a state for organization A and U is refused", async () => {
    const outsider = org.otherOwnerId; // an owner of the other organization, no member of ours
    await expect(createOAuthState(db, secrets, ctxA(), startOf("google", outsider), NOW)).rejects.toBeInstanceOf(
      OAuthStateRefusedError
    );
    const error = await createOAuthState(db, secrets, ctxA(), startOf("google", outsider), NOW).catch(
      (e: unknown) => e
    );
    expect(error).toMatchObject({ reason: "not_a_member" });
    expect(String((error as Error).message)).not.toContain(outsider);
    expect(String((error as Error).message)).not.toContain(org.orgId);
    const rows = await db.selectFrom("mailbox_oauth_states").selectAll().where("user_id", "=", outsider).execute();
    expect(rows).toHaveLength(0);
    // The same user in its own organization is fine.
    await createOAuthState(db, secrets, { orgId: org.otherOrgId }, startOf("google", outsider), NOW);
    expect(await rowsOf(outsider)).toHaveLength(1);
  });

  test("9. a row for a non-member that SQL wrote is refused at consume; a member removed after the start is refused too", async () => {
    // The foreign keys alone let this row exist (user and organization are checked one by one). The code refuses it.
    const stateValue = randomBytes(32).toString("base64url");
    const encrypted = secrets.encrypt("v".repeat(43), "oauth_state:x");
    await db
      .insertInto("mailbox_oauth_states")
      .values({
        org_id: org.orgId,
        user_id: org.otherOwnerId,
        provider: "google",
        mailbox_id: null,
        state_hash: stateHashOf(stateValue),
        encrypted_verifier: encrypted.ciphertext,
        key_version: encrypted.keyVersion,
        expires_at: new Date(NOW.getTime() + MINUTE_MS),
      })
      .execute();
    expect(
      await consumeOAuthState(
        db,
        secrets,
        ctxA(),
        { state: stateValue, provider: "google", userId: org.otherOwnerId },
        NOW
      )
    ).toEqual({ ok: false, code: "oauth_state_invalid" });

    const made = await createOAuthState(db, secrets, ctxA(), startOf("google", org.assistantId), NOW);
    await db.deleteFrom("memberships").where("org_id", "=", org.orgId).where("user_id", "=", org.assistantId).execute();
    expect(
      await consumeOAuthState(
        db,
        secrets,
        ctxA(),
        { state: made.state, provider: "google", userId: org.assistantId },
        NOW
      )
    ).toEqual({ ok: false, code: "oauth_state_invalid" });
  });

  test("10. a Reconnect state needs an OAuth mailbox of the same provider in the same organization", async () => {
    const mine = await addOAuthMailbox(org.orgId, "google", `mine-${randomUUID()}@x.test`);
    const password = await addOAuthMailbox(org.orgId, null, `pw-${randomUUID()}@x.test`);
    const foreign = await addOAuthMailbox(org.otherOrgId, "google", `foreign-${randomUUID()}@x.test`);
    const refused = async (provider: MailOAuthProvider, mailboxId: string) =>
      createOAuthState(db, secrets, ctxA(), startOf(provider, org.ownerId, mailboxId), NOW).catch((e: unknown) => e);
    for (const error of [
      await refused("google", foreign),
      await refused("google", password),
      await refused("microsoft", mine),
    ]) {
      expect(error).toBeInstanceOf(OAuthStateRefusedError);
      expect(error).toMatchObject({ reason: "mailbox_not_found" });
    }
    expect(await rowsOf(org.ownerId)).toHaveLength(0);
    const made = await createOAuthState(db, secrets, ctxA(), startOf("google", org.ownerId, mine), NOW);
    const result = await consumeOAuthState(
      db,
      secrets,
      ctxA(),
      { state: made.state, provider: "google", userId: org.ownerId },
      NOW
    );
    expect(result.ok && result.start.mailboxId).toBe(mine);
    // The mailbox of a state is deleted: the state goes with it.
    await createOAuthState(db, secrets, ctxA(), startOf("google", org.ownerId, mine), NOW);
    await db.deleteFrom("mailboxes").where("id", "=", mine).execute();
    expect(await rowsOf(org.ownerId)).toHaveLength(0);
  });

  test("11. the verifier is bound to its row: a ciphertext moved to another row does not decrypt (invalid, one log line, no value)", async () => {
    const one = await createOAuthState(db, secrets, ctxA(), startOf("google", org.ownerId), NOW);
    await createOAuthState(db, secrets, ctxA(), startOf("google", org.assistantId), NOW);
    const [other] = await rowsOf(org.assistantId);
    await db
      .updateTable("mailbox_oauth_states")
      .set({ encrypted_verifier: other?.encrypted_verifier ?? "" })
      .where("user_id", "=", org.ownerId)
      .execute();
    const result = await consumeOAuthState(
      db,
      secrets,
      ctxA(),
      { state: one.state, provider: "google", userId: org.ownerId },
      NOW
    );
    expect(result).toEqual({ ok: false, code: "oauth_state_invalid" });
    expect(logLines.filter((line) => line.includes("oauth_state_decrypt_failed"))).toHaveLength(1);
    expect(logLines.join("\n")).not.toContain(one.state);
    // A key change since the start gives the same answer.
    const key2 = createSecretBox(randomBytes(32).toString("base64"), 2);
    const made = await createOAuthState(db, secrets, ctxA(), startOf("google", org.ownerId), NOW);
    expect(
      await consumeOAuthState(db, key2, ctxA(), { state: made.state, provider: "google", userId: org.ownerId }, NOW)
    ).toEqual({ ok: false, code: "oauth_state_invalid" });
  });
});

describe("the routes", () => {
  test("1. an owner starts a Google sign-in: the URL holds the state, the S256 challenge and the exact redirect URI; one row, nothing in clear", async () => {
    await setOrgFeature(db, ctxA(), { flag: "mail_oauth_google", enabled: true, actor: org.ownerId, now: NOW });
    const app = appOf(clientsOf(["google"]));
    const res = await start(app, "owner", "google");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const { url } = mailOAuthStartResultSchema.parse(await res.json());
    const query = new URL(url).searchParams;
    expect(new URL(url).origin + new URL(url).pathname).toBe(fake.specs(HOSTS).google.authorizeUrl);
    expect(query.get("response_type")).toBe("code");
    expect(query.get("code_challenge_method")).toBe("S256");
    expect(query.get("redirect_uri")).toBe(`${TEST_ORIGIN}/api/mailboxes/oauth/google/callback`);
    expect(query.get("client_id")).toBe(fake.clientId);
    expect(query.has("login_hint")).toBe(false);
    expect(url).not.toContain(fake.clientSecret);
    const [row] = await rowsOf(org.ownerId);
    expect(await rowsOf(org.ownerId)).toHaveLength(1);
    expect(row?.state_hash).toBe(stateHashOf(query.get("state") ?? ""));
    expect(row?.provider).toBe("google");
    expect(row?.user_id).toBe(org.ownerId);
    const verifier = secrets.decrypt(
      { ciphertext: row?.encrypted_verifier ?? "", keyVersion: row?.key_version ?? 0 },
      `oauth_state:${row?.id}`
    );
    expect(challengeOf(verifier)).toBe(query.get("code_challenge") ?? "");
    expect(JSON.stringify(row)).not.toContain(query.get("state") ?? "never");
    expect(JSON.stringify(row)).not.toContain(verifier);
  });

  test("2. flag off, no mailboxId: 403 feature_off and no row; flag off with an OAuth Google mailbox: 200 with login_hint", async () => {
    const app = appOf(clientsOf(["google"]));
    const off = await start(app, "owner", "google");
    expect(off.status).toBe(403);
    expect(await off.json()).toEqual({ error: "feature_off" });
    expect(await rowsOf(org.ownerId)).toHaveLength(0);

    const address = `box-${randomUUID()}@x.test`;
    const mailboxId = await addOAuthMailbox(org.orgId, "google", address);
    const res = await start(app, "owner", "google", { mailboxId });
    expect(res.status).toBe(200);
    const { url } = mailOAuthStartResultSchema.parse(await res.json());
    expect(new URL(url).searchParams.get("login_hint")).toBe(address);
    const [row] = await rowsOf(org.ownerId);
    expect(row?.mailbox_id).toBe(mailboxId);
  });

  test("3. a member gets owner_only; yahoo is 404; keys missing is 409 not_configured; a bad body is 400; no cookie is 401", async () => {
    await setOrgFeature(db, ctxA(), { flag: "mail_oauth_google", enabled: true, actor: org.ownerId, now: NOW });
    const app = appOf(clientsOf(["google"]));
    const member = await start(app, "assistant", "google");
    expect(member.status).toBe(403);
    expect(await member.json()).toEqual({ error: "owner_only" });
    const yahoo = await start(app, "owner", "yahoo");
    expect(yahoo.status).toBe(404);
    expect(await yahoo.json()).toEqual({ error: "not_found" });
    const missing = await start(app, "owner", "microsoft");
    expect(missing.status).toBe(409);
    expect(await missing.json()).toEqual({ error: "not_configured" });
    const badBody = await start(app, "owner", "google", { mailboxId: "not-a-uuid" });
    expect(badBody.status).toBe(400);
    expect(((await badBody.json()) as { error: string }).error).toBe("validation");
    const noCookie = await app.request("/api/mailboxes/oauth/google/start", {
      method: "POST",
      headers: { origin: TEST_ORIGIN, "content-type": "application/json" },
      body: "{}",
    });
    expect(noCookie.status).toBe(401);
    const noOrigin = await app.request("/api/mailboxes/oauth/google/start", {
      method: "POST",
      headers: { cookie: "ea.session_token=owner", "content-type": "application/json" },
      body: "{}",
    });
    expect(noOrigin.status).toBe(403);
    expect(await noOrigin.json()).toEqual({ error: "bad_origin" });
    expect(await rowsOf(org.ownerId)).toHaveLength(0);
    expect(await rowsOf(org.assistantId)).toHaveLength(0);
  });

  test("4. a Reconnect mailbox that is not an OAuth mailbox of this provider in this organization is 404", async () => {
    const app = appOf(clientsOf(["google", "microsoft"]));
    const password = await addOAuthMailbox(org.orgId, null, `pw-${randomUUID()}@x.test`);
    const microsoft = await addOAuthMailbox(org.orgId, "microsoft", `ms-${randomUUID()}@x.test`);
    const foreign = await addOAuthMailbox(org.otherOrgId, "google", `foreign-${randomUUID()}@x.test`);
    for (const mailboxId of [password, microsoft, foreign, randomUUID()]) {
      const res = await start(app, "owner", "google", { mailboxId });
      expect({ mailboxId, status: res.status, body: await res.json() }).toEqual({
        mailboxId,
        status: 404,
        body: { error: "not_found" },
      });
    }
    expect(await rowsOf(org.ownerId)).toHaveLength(0);
  });

  test("5. the second organization: its owner reaches only its own mailboxes and flags, and its state is bound to its own organization", async () => {
    const app = appOf(clientsOf(["google"]));
    const mineId = await addOAuthMailbox(org.orgId, "google", `mine-${randomUUID()}@x.test`);
    // The owner of the other organization cannot start a Reconnect of a mailbox of ours.
    const res = await start(app, "other", "google", { mailboxId: mineId });
    expect(res.status).toBe(404);
    // A flag of our organization does not open a new connect for the other one.
    await setOrgFeature(db, ctxA(), { flag: "mail_oauth_google", enabled: true, actor: org.ownerId, now: NOW });
    expect((await start(app, "other", "google")).status).toBe(403);
    expect((await start(app, "owner", "google")).status).toBe(200);
    expect(await rowsOf(org.otherOwnerId)).toHaveLength(0);
    // The state of the owner of the other organization is bound to that organization.
    await setOrgFeature(
      db,
      { orgId: org.otherOrgId },
      {
        flag: "mail_oauth_google",
        enabled: true,
        actor: org.otherOwnerId,
        now: NOW,
      }
    );
    expect((await start(app, "other", "google")).status).toBe(200);
    const [row] = await rowsOf(org.otherOwnerId);
    expect(row?.org_id).toBe(org.otherOrgId);
  });

  test("6. six starts leave five rows; the first is gone", async () => {
    await setOrgFeature(db, ctxA(), { flag: "mail_oauth_google", enabled: true, actor: org.ownerId, now: NOW });
    const app = appOf(clientsOf(["google"]));
    const states: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const { url } = mailOAuthStartResultSchema.parse(await (await start(app, "owner", "google")).json());
      states.push(stateOfUrl(url));
    }
    const hashes = (await rowsOf(org.ownerId)).map((row) => row.state_hash);
    expect(hashes).toEqual(states.slice(1).map(stateHashOf));
  });

  test("7. options: Microsoft configured with the flag off, Google not configured; any member reads it", async () => {
    const app = appOf(clientsOf(["microsoft"]));
    for (const who of ["owner", "assistant"]) {
      const res = await app.request("/api/mailboxes/oauth/options", as(who));
      expect(res.status).toBe(200);
      expect(mailOAuthOptionsSchema.parse(await res.json()).providers).toEqual([
        { provider: "microsoft", connect: false, reconnect: true },
        { provider: "google", connect: false, reconnect: false },
      ]);
    }
    await setOrgFeature(db, ctxA(), { flag: "mail_oauth_microsoft", enabled: true, actor: org.ownerId, now: NOW });
    // A flag of Google alone does not open a provider that has no keys.
    await setOrgFeature(db, ctxA(), { flag: "mail_oauth_google", enabled: true, actor: org.ownerId, now: NOW });
    const on = await app.request("/api/mailboxes/oauth/options", as("assistant"));
    expect(mailOAuthOptionsSchema.parse(await on.json()).providers).toEqual([
      { provider: "microsoft", connect: true, reconnect: true },
      { provider: "google", connect: false, reconnect: false },
    ]);
    expect((await app.request("/api/mailboxes/oauth/options", { headers: { origin: TEST_ORIGIN } })).status).toBe(401);
    // The other organization sees its own flags.
    const other = await app.request("/api/mailboxes/oauth/options", as("other"));
    expect(mailOAuthOptionsSchema.parse(await other.json()).providers[0]).toEqual({
      provider: "microsoft",
      connect: false,
      reconnect: true,
    });
  });

  test("8. canary: no log line, error or audit row holds a state, a verifier or the client secret", async () => {
    await setOrgFeature(db, ctxA(), { flag: "mail_oauth_google", enabled: true, actor: org.ownerId, now: NOW });
    const app = appOf(clientsOf(["google"]));
    const droppedBefore = droppedLogFields();
    const bodies: string[] = [];
    const states: string[] = [];
    for (const [who, provider, body] of [
      ["owner", "google", {}],
      ["owner", "google", {}],
      ["owner", "yahoo", {}],
      ["assistant", "google", {}],
      ["owner", "microsoft", {}],
      ["owner", "google", { mailboxId: randomUUID() }],
    ] as const) {
      const res = await start(app, who, provider, body);
      const text = await res.text();
      bodies.push(text);
      if (res.status === 200) states.push(stateOfUrl((JSON.parse(text) as { url: string }).url));
    }
    // A consume, with a verifier we can name, and a refused start with an outsider.
    const made = await createOAuthState(db, secrets, ctxA(), startOf("google", org.ownerId), NOW);
    const consumed = await consumeOAuthState(
      db,
      secrets,
      ctxA(),
      { state: made.state, provider: "google", userId: org.ownerId },
      NOW
    );
    const verifier = consumed.ok ? consumed.verifier : "";
    expect(verifier).not.toBe("");
    const refused = await createOAuthState(db, secrets, ctxA(), startOf("google", org.otherOwnerId), NOW).catch(
      (e: unknown) => e
    );
    // Where a state may not appear: log lines, the refusal error, every answer except the 200 of a start, the audit rows.
    const audit = JSON.stringify(
      await db.selectFrom("audit_log").selectAll().where("org_id", "in", [org.orgId, org.otherOrgId]).execute()
    );
    const places = [
      ...logLines,
      inspect(refused, { depth: 5 }),
      ...bodies.filter((body) => !body.includes('"url"')),
      audit,
    ];
    expect(states.length).toBeGreaterThan(0);
    expect(logLines.some((line) => line.includes("oauth_state"))).toBe(false);
    for (const secret of [...states, made.state, verifier, fake.clientSecret]) {
      expect({ length: secret.length, found: places.some((place) => place.includes(secret)) }).toEqual({
        length: secret.length,
        found: false,
      });
    }
    // The 200 answer carries the state and the challenge, never the verifier or the client secret.
    const answers = bodies.filter((body) => body.includes('"url"')).join("\n");
    expect(answers.includes(verifier) || answers.includes(fake.clientSecret)).toBe(false);
    expect(droppedLogFields()).toBe(droppedBefore);
  });

  test("9. the OpenAPI file describes both routes with the shared schemas: the mailbox id is a uuid, the provider an enum, the codes are listed", async () => {
    const spec = (await openApiSpec(appOf(clientsOf(["google"])))) as unknown as {
      paths: Record<string, Record<string, Record<string, unknown>>>;
    };
    const startOp = spec.paths["/api/mailboxes/oauth/{provider}/start"]?.post;
    expect(startOp?.operationId).toBe("postMailOAuthStart");
    const json = JSON.stringify(startOp);
    expect(json).toContain('"mailboxId":{"type":"string","format":"uuid"');
    expect(json).toContain('"in":"path"');
    expect(json).toContain('"enum":["microsoft","google"]');
    for (const code of ["owner_only", "feature_off", "not_found", "not_configured"]) expect(json).toContain(code);
    expect(spec.paths["/api/mailboxes/oauth/options"]?.get?.operationId).toBe("getMailOAuthOptions");
  });
});
