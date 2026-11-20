import { randomUUID } from "node:crypto";
import { format, inspect } from "node:util";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test, type Mock } from "bun:test";
import { sql } from "kysely";

import { type MailOAuthClients } from "../../src/modules/mail";
import { readOAuthSecret, saveOAuthSecret, withMailboxOAuthLock } from "../../src/modules/mail/oauth/secret-store";
import { insertMembership, insertUser } from "../../src/modules/tenancy/repo";
import { currentTenantScope } from "../../src/platform/db";
import { startFakeMailOAuth, type FakeMailOAuth } from "../fake-mail-oauth";

import { testDb } from "./helpers";
import {
  dropped,
  locationOf,
  login,
  makeClients,
  makeOAuthConnectKit,
  resultOf,
  secrets,
  type SignedIn,
} from "./mail-oauth-connect-helpers";
import { webOrg, type WebOrg } from "./web-helpers";

const db = testDb();

let fake: FakeMailOAuth;
let clients: MailOAuthClients;
let org: WebOrg;
let secondOwnerId = "";
let logLines: string[] = [];
let logSpies: Mock<(...args: unknown[]) => void>[] = [];

beforeAll(async () => {
  fake = await startFakeMailOAuth();
  clients = makeClients(fake);
});

afterAll(async () => {
  await fake.stop();
  await db.destroy();
});

beforeEach(async () => {
  org = await webOrg(db);
  const second = await insertUser(db, { email: `second-owner-${randomUUID()}@x.test`, displayName: "Second owner" });
  secondOwnerId = second.id;
  await insertMembership(db, { orgId: org.orgId }, { userId: secondOwnerId, role: "owner" });
  login.imap.length = 0;
  login.smtp.length = 0;
  login.refuseImap = false;
  login.refuseSmtp = false;
  login.accountUser = null;
  login.throwImap = null;
  dropped.length = 0;
  fake.calls.length = 0;
  fake.rotate.microsoft = true;
  logLines = [];
  for (const method of ["log", "error", "warn", "info", "debug"] as const) {
    const spy = spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logLines.push(format(...args));
    });
    logSpies.push(spy as unknown as Mock<(...args: unknown[]) => void>);
  }
});

afterEach(async () => {
  for (const spy of logSpies) spy.mockRestore();
  logSpies = [];
  await org.cleanup();
  await db.deleteFrom("users").where("id", "=", secondOwnerId).execute();
});

const {
  extrasOf,
  appOf,
  ctxA,
  addressOf,
  enable,
  signIn,
  callback,
  mailboxRows,
  stateRows,
  credentialsOf,
  secretOf,
  seedMailbox,
  mailboxOf,
} = makeOAuthConnectKit({
  db,
  org: () => org,
  fake: () => fake,
  clients: () => clients,
  secondOwnerId: () => secondOwnerId,
});

describe("the callback route", () => {
  test("19. no session cookie: 303 /login, the state row stays, the provider is not called", async () => {
    await enable("google");
    const address = addressOf();
    const { query } = await signIn("google", { address });
    const res = await callback(appOf(), null, "google", query);
    expect(locationOf(res)).toBe("/login");
    expect(await stateRows()).toHaveLength(1);
    expect(fake.calls).toHaveLength(0);
    expect(await mailboxRows(address)).toHaveLength(0);
    // An unknown session cookie is no session either.
    expect(locationOf(await callback(appOf(), "no-such-session", "google", query))).toBe("/login");
    expect(await stateRows()).toHaveLength(1);
  });

  test("20. login CSRF: the callback URL of user A in the session of user B is refused; A's row stays, nothing is redeemed", async () => {
    await enable("google");
    const address = addressOf();
    const mine = await signIn("google", { address, userId: org.ownerId });
    // Another owner of the same organization; and the owner of another organization.
    for (const cookie of ["owner2", "other"]) {
      const res = await callback(appOf(), cookie, "google", mine.query);
      expect(locationOf(res)).toBe("/mailboxes?oauth=oauth_state_invalid");
      expect(await stateRows()).toHaveLength(1);
      expect(fake.calls).toHaveLength(0);
      expect(await mailboxRows(address)).toHaveLength(0);
    }
    // The real owner still finishes the flow with the same URL.
    expect(resultOf(await callback(appOf(), "owner", "google", mine.query)).get("oauth")).toBe("connected");
  });

  test("20b. the query never names the user, the organization or the mailbox: extra parameters are ignored", async () => {
    await enable("google");
    const address = addressOf();
    const { query } = await signIn("google", { address });
    const extra = {
      ...query,
      org: org.otherOrgId,
      org_id: org.otherOrgId,
      orgId: org.otherOrgId,
      user: org.otherOwnerId,
      user_id: org.otherOwnerId,
      userId: org.otherOwnerId,
      mailbox: randomUUID(),
      mailbox_id: randomUUID(),
      mailboxId: randomUUID(),
    };
    expect(resultOf(await callback(appOf(), "owner", "google", extra)).get("oauth")).toBe("connected");
    expect(await mailboxRows(address)).toHaveLength(1);
    const other = await db.selectFrom("mailboxes").select("id").where("org_id", "=", org.otherOrgId).execute();
    expect(other).toHaveLength(0);
  });

  test("21. an owner demoted since the start gets oauth_failed: nothing is redeemed or stored", async () => {
    await enable("google");
    const address = addressOf();
    const { query } = await signIn("google", { address, userId: org.assistantId });
    expect(locationOf(await callback(appOf(), "assistant", "google", query))).toBe("/mailboxes?oauth=oauth_failed");
    expect(fake.calls).toHaveLength(0);
    expect(await mailboxRows(address)).toHaveLength(0);
  });

  test("22. a suspended organization: oauth_failed, nothing is redeemed or stored", async () => {
    await enable("google");
    const address = addressOf();
    const { query } = await signIn("google", { address });
    expect(locationOf(await callback(appOf({ suspended: true }), "owner", "google", query))).toBe(
      "/mailboxes?oauth=oauth_failed"
    );
    expect(fake.calls).toHaveLength(0);
    expect(await mailboxRows(address)).toHaveLength(0);
  });

  test("23. an unknown provider and a provider that is not configured give a 303, never JSON", async () => {
    const { query } = await signIn("google", { address: addressOf() });
    const unknown = await callback(appOf(), "owner", "yahoo", query);
    expect(locationOf(unknown)).toBe("/mailboxes?oauth=oauth_failed");
    expect(unknown.headers.get("content-type") ?? "").not.toContain("json");
    const none = appOf({ extras: { mailOAuthClients: {} } });
    expect(locationOf(await callback(none, "owner", "google", query))).toBe("/mailboxes?oauth=not_configured");
  });

  test("24. the provider answers an error: oauth_cancelled, and the state is consumed", async () => {
    const { state } = await signIn("google", { address: addressOf() });
    const res = await callback(appOf(), "owner", "google", { error: "access_denied", state });
    expect(locationOf(res)).toBe("/mailboxes?oauth=oauth_cancelled");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await stateRows()).toHaveLength(0);
  });

  test("25. the route enters the tenant scope itself: the login runs in the scope of the session's organization; none stays behind", async () => {
    await enable("google");
    const { query } = await signIn("google", { address: addressOf() });
    expect(resultOf(await callback(appOf(), "owner", "google", query)).get("oauth")).toBe("connected");
    expect(login.imap.map((entry) => entry.scope)).toEqual([org.orgId]);
    expect(currentTenantScope()).toBeNull();
  });

  test("26. a throw inside the route is still a 303 with oauth_failed; the log line holds the error name only", async () => {
    await enable("google");
    const { query } = await signIn("google", { address: addressOf() });
    const secret = "tok-should-not-appear-1234";
    const res = await callback(
      appOf({ failSuspendedRead: new Error(`db-said-${secret}-${query.code}`) }),
      "owner",
      "google",
      query
    );
    expect(locationOf(res)).toBe("/mailboxes?oauth=oauth_failed");
    const lines = logLines.join("\n");
    expect(lines).toContain("oauth_callback_failed");
    expect(lines).not.toContain(secret);
    expect(lines).not.toContain(query.code ?? "no");
  });

  test("27. a replay of a used callback URL: oauth_state_invalid, one mailbox", async () => {
    await enable("google");
    const address = addressOf();
    const { query } = await signIn("google", { address });
    expect(resultOf(await callback(appOf(), "owner", "google", query)).get("oauth")).toBe("connected");
    const again = await callback(appOf(), "owner", "google", query);
    expect(locationOf(again)).toBe("/mailboxes?oauth=oauth_state_invalid");
    expect(await mailboxRows(address)).toHaveLength(1);
  });
});

describe("secrets never leave", () => {
  test("28. canary: no code, state, token, client secret or ID token in a log line, a Location header, a body, an audit row or an error", async () => {
    await enable("google");
    await enable("microsoft");
    const seen: string[] = [];
    const secretsSeen: string[] = [fake.clientSecret];
    const track = (signed: SignedIn) => secretsSeen.push(signed.code, signed.state);

    // Connect with every outcome that touches the tokens.
    const ok = await signIn("google", { address: addressOf("ok") });
    track(ok);
    seen.push(...(await collect(await callback(appOf(), "owner", "google", ok.query))));

    const consent = await signIn("microsoft", { address: addressOf("consent") });
    track(consent);
    fake.failNextRefresh({
      status: 400,
      error: "invalid_grant",
      aadsts: 65001,
      description: `AADSTS65001: ${consent.code} ${consent.state}`,
    });
    seen.push(...(await collect(await callback(appOf(), "owner", "microsoft", consent.query))));

    const refused = await signIn("google", { address: addressOf("refused") });
    track(refused);
    login.refuseImap = true;
    seen.push(...(await collect(await callback(appOf(), "owner", "google", refused.query))));
    login.refuseImap = false;

    const rotated = await signIn("microsoft", { address: addressOf("rotated") });
    track(rotated);
    seen.push(...(await collect(await callback(appOf(), "owner", "microsoft", rotated.query))));

    // A login stub that throws an error whose message holds the access token it was given.
    const thrown = await signIn("google", { address: addressOf("thrown") });
    track(thrown);
    const app = appOf({
      extras: {
        mailOAuthLogin: {
          ...extrasOf().mailOAuthLogin,
          openProvider: async (opts) => {
            throw new Error(`login failed with ${opts.auth.kind === "oauth" ? opts.auth.accessToken : ""}`);
          },
        },
      },
    });
    seen.push(...(await collect(await callback(app, "owner", "google", thrown.query))));

    // Reconnect, a replay, a CSRF attempt and a cancel.
    const box = await seedMailbox({ status: "auth_error", reason: "oauth_expired" });
    const again = await signIn("google", { address: box.address, mailboxId: box.id });
    track(again);
    seen.push(...(await collect(await callback(appOf(), "owner", "google", again.query))));
    seen.push(...(await collect(await callback(appOf(), "owner", "google", again.query))));
    const csrf = await signIn("google", { address: addressOf("csrf") });
    track(csrf);
    seen.push(...(await collect(await callback(appOf(), "other", "google", csrf.query))));
    const cancel = await signIn("google", { address: addressOf("cancel") });
    track(cancel);
    seen.push(
      ...(await collect(
        await callback(appOf(), "owner", "google", {
          error: "access_denied",
          error_description: `${cancel.code} ${cancel.state}`,
          state: cancel.state,
        })
      ))
    );

    secretsSeen.push(...fake.issuedRefreshTokens);
    const audit = await db.selectFrom("audit_log").selectAll().where("org_id", "=", org.orgId).execute();
    const text = [...logLines, ...seen, inspect(audit, { depth: 10 })].join("\n");
    expect(secretsSeen.filter((value) => value !== "").length).toBeGreaterThan(15);
    expect(audit.length).toBeGreaterThan(2);
    expect(logLines.length).toBeGreaterThan(0);
    for (const value of secretsSeen) {
      expect({ value: value.slice(0, 8), leaked: value !== "" && text.includes(value) }).toEqual({
        value: value.slice(0, 8),
        leaked: false,
      });
    }
    // The access tokens the fake issued (`at-<n>-<hex>`) and the thrown access token, and any ID token.
    expect(text).not.toMatch(/\bat-\d+-[0-9a-f]{12}\b/);
    expect(text).not.toMatch(/eyJ|id_token|client_secret|refresh_token/);
    // The stored secret is encrypted: the refresh token is not in the credentials row.
    const stored = await db
      .selectFrom("mailbox_credentials")
      .select("encrypted_secret")
      .where("org_id", "=", org.orgId)
      .execute();
    for (const row of stored) {
      for (const token of fake.issuedRefreshTokens) expect(row.encrypted_secret).not.toContain(token);
    }
  });

  /** The Location header and the body of an answer: both must be free of secrets. */
  async function collect(res: Response): Promise<string[]> {
    expect(res.status).toBe(303);
    return [res.headers.get("location") ?? "", await res.text(), inspect(Object.fromEntries(res.headers))];
  }

  test("29. two organizations hold a mailbox of one address: a Reconnect of one never changes the other", async () => {
    const address = addressOf("twin");
    const mine = await seedMailbox({ address, status: "auth_error", reason: "oauth_expired" });
    const theirs = await seedMailbox({ orgId: org.otherOrgId, address, status: "auth_error", reason: "oauth_expired" });
    const { query } = await signIn("google", { address, mailboxId: mine.id });
    expect(resultOf(await callback(appOf(), "owner", "google", query)).get("oauth")).toBe("reconnected");
    expect(await mailboxOf(theirs.id)).toMatchObject({ status: "auth_error", auth_reason: "oauth_expired" });
    expect((await secretOf(theirs.id)).refreshToken).toBe(theirs.refreshToken);
    const { rows } = await sql<{ n: string }>`
      select count(*) as n from audit_log where org_id = ${org.otherOrgId} and event = 'mailbox.reconnected'`.execute(
      db
    );
    expect(Number(rows[0]?.n)).toBe(0);
  });
});

describe("the secret store", () => {
  const sample = (refreshToken: string) => ({
    v: 1 as const,
    provider: "google" as const,
    refreshToken,
    tenantId: null,
    scopes: ["s"],
  });

  test("30. save then read; the secret is sealed with the AAD of its mailbox and the kind stays oauth", async () => {
    const box = await seedMailbox();
    const other = await seedMailbox();
    await db.transaction().execute((tx) => saveOAuthSecret(tx, secrets, ctxA(), box.id, sample("saved-token")));
    expect(await db.transaction().execute((tx) => readOAuthSecret(tx, secrets, ctxA(), box.id))).toEqual(
      sample("saved-token")
    );
    // The ciphertext of one mailbox does not open under another mailbox id.
    const row = await credentialsOf(box.id);
    expect(() =>
      secrets.decrypt(
        { ciphertext: row?.encrypted_secret ?? "", keyVersion: row?.key_version ?? 0 },
        `mailbox:${other.id}`
      )
    ).toThrow();
    expect(row?.secret_kind).toBe("oauth");
  });

  test("31. read refuses a password secret and a missing row; save of a missing row throws; another organization sees nothing", async () => {
    const password = await seedMailbox({ password: true });
    await expect(db.transaction().execute((tx) => readOAuthSecret(tx, secrets, ctxA(), password.id))).rejects.toThrow(
      "not an oauth secret"
    );
    const missing = randomUUID();
    await expect(db.transaction().execute((tx) => readOAuthSecret(tx, secrets, ctxA(), missing))).rejects.toThrow(
      "no stored secret"
    );
    await expect(
      db.transaction().execute((tx) => saveOAuthSecret(tx, secrets, ctxA(), missing, sample("x")))
    ).rejects.toThrow("no stored secret");
    const mine = await seedMailbox();
    await expect(
      db.transaction().execute((tx) => readOAuthSecret(tx, secrets, { orgId: org.otherOrgId }, mine.id))
    ).rejects.toThrow("no stored secret");
    await expect(
      db.transaction().execute((tx) => saveOAuthSecret(tx, secrets, { orgId: org.otherOrgId }, mine.id, sample("x")))
    ).rejects.toThrow("no stored secret");
    expect((await secretOf(mine.id)).refreshToken).toBe(mine.refreshToken);
  });

  test("32. a failure after the save rolls the secret back: the replacement is atomic", async () => {
    const box = await seedMailbox();
    await expect(
      withMailboxOAuthLock(db, box.id, async (tx) => {
        await saveOAuthSecret(tx, secrets, ctxA(), box.id, sample("half-written"));
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect((await secretOf(box.id)).refreshToken).toBe(box.refreshToken);
  });

  test("33. the lock holds two writers of one mailbox apart (two connections) and lets another mailbox through", async () => {
    const one = await seedMailbox();
    const two = await seedMailbox();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let acquired: () => void = () => undefined;
    const holding = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const order: string[] = [];
    const first = withMailboxOAuthLock(db, one.id, async () => {
      acquired();
      await held;
      order.push("first");
    });
    await holding;
    const second = withMailboxOAuthLock(db, one.id, async () => {
      order.push("second");
    });
    // Another mailbox is not blocked.
    await withMailboxOAuthLock(db, two.id, async () => {
      order.push("other");
    });
    expect(order).toEqual(["other"]);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["other", "first", "second"]);
  });
});
